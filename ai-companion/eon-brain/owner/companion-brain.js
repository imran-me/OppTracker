/* ============================================================
   EON — owner/companion-brain.js
   The owner-mode DECISION BRAIN. It sits on top of the existing
   deadline brain (window.EonBrain) and turns its raw alert feed into
   a ranked "standup agenda": the few things that matter most, scored
   by urgency × consequence, phrased for the whiteboard.

   Pure logic, no DOM — the whiteboard consumes what this returns.
   Owner: Imran. (Name comes from owner-config, never "Md.".)
   ============================================================ */

import { OWNER, ownerFirstName } from '../../js/owner-config.js';

// urgency → weight (overdue bites hardest; reminders sit mid).
const URGENCY_WEIGHT = {
  overdue: 4.0, 'due-today': 3.0, 'within-1d': 2.4,
  'within-3d': 1.8, 'within-7d': 1.3, reminder: 1.6,
};
// consequence by what the record is about (money/clients/legal > chores).
function consequenceOf(entity, label) {
  const s = `${entity || ''} ${label || ''}`.toLowerCase();
  if (/invoice|payment|salary|tax|fee|visa|passport|contract|renew|legal|client|due/.test(s)) return 1.6;
  if (/opportun|application|submission|deadline|ticket|booking|exam|interview/.test(s)) return 1.3;
  if (/task|to-?do|chore|note/.test(s)) return 1.0;
  return 0.95;
}

export class CompanionBrain {
  /** @param {() => any} getBrain  returns window.EonBrain (may be undefined early) */
  constructor(getBrain) { this.getBrain = getBrain; }

  brain() { try { return this.getBrain(); } catch { return null; } }
  isOwner() { const b = this.brain(); try { return !!(b && b.isOwner && b.isOwner()); } catch { return false; } }
  ownerName() {
    const dom = (typeof document !== 'undefined') ? document.getElementById('pfName')?.textContent : '';
    return ownerFirstName(dom) || OWNER.name;
  }

  /** Ranked agenda for the standup. Returns [] until the brain has a feed. */
  buildStandup({ max = 6 } = {}) {
    const b = this.brain();
    if (!b || !b.isOwner || !b.isOwner()) return [];
    let feed = [];
    try { feed = b.getAlerts() || []; } catch {}
    return feed
      .filter((f) => f && f.status !== 'dismissed')
      .map((f) => this._score(f))
      .sort((x, y) => y.score - x.score)
      .slice(0, max);
  }

  _score(f) {
    const u = URGENCY_WEIGHT[f.urgency] ?? 1.2;
    const c = consequenceOf(f.entity, f.label);
    const esc = this._escalation(f);      // grows the longer something is overdue
    const w = this._weight(f.entity);     // learned: down-rank what you keep dismissing
    return { ...f, consequence: c, score: u * c * esc * w, line: this._line(f) };
  }
  _escalation(f) {
    const iso = f.dueAt || f.deadlineAt;
    if (f.urgency === 'overdue' && iso) {
      const od = Math.max(0, (Date.now() - Date.parse(iso)) / 86400000);
      return 1 + Math.min(0.6, od * 0.05);
    }
    return 1;
  }

  // ---- learning: remember what the owner dismisses, and ease off ----
  _learn() { try { return JSON.parse(localStorage.getItem('eon-learn') || '{}'); } catch { return {}; } }
  _weight(entity) { const c = (this._learn().dismissed || {})[entity] || 0; return 1 / (1 + 0.25 * Math.min(c, 6)); }
  noteDismiss(entity) {
    if (!entity) return;
    try { const l = this._learn(); l.dismissed = l.dismissed || {}; l.dismissed[entity] = (l.dismissed[entity] || 0) + 1; localStorage.setItem('eon-learn', JSON.stringify(l)); } catch {}
  }

  // ---- planning: an ordered way to tackle what's due (from raw records) ----
  plan({ horizon = 7, max = 8 } = {}) {
    const recs = (() => { try { return this.brain()?.getRecords?.() || []; } catch { return []; } })();
    const now = Date.now();
    const items = recs
      .filter((r) => r.deadlineAt && !Number.isNaN(Date.parse(r.deadlineAt)))
      .map((r) => { const days = Math.floor((Date.parse(r.deadlineAt) - now) / 86400000); return { ...r, dueAt: r.deadlineAt, days, urgency: this._urg(days) }; })
      .filter((r) => r.days <= horizon)
      .map((r) => this._score(r))
      .sort((a, b) => b.score - a.score)
      .slice(0, max);
    const byDay = {};
    items.forEach((i) => { const k = String(i.dueAt).slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; });
    const overload = Object.entries(byDay).filter(([, c]) => c >= 3).map(([date, count]) => ({ date, count }));
    return { items, overload };
  }
  _urg(days) { return days < 0 ? 'overdue' : days === 0 ? 'due-today' : days <= 1 ? 'within-1d' : days <= 3 ? 'within-3d' : 'within-7d'; }

  // ---- anomaly / data hygiene: things that look off or unfinished ----
  hygiene() {
    const b = this.brain();
    const data = (() => { try { return b?.getData?.() || {}; } catch { return {}; } })();
    const ents = (() => { try { return b?.getEntities?.() || {}; } catch { return {}; } })();
    const out = [];
    for (const [entity, arr] of Object.entries(data)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      const desc = ents[entity] || {};
      const lf = desc.labelField, df = desc.deadlineField;
      const haveDl = df ? arr.filter((r) => r && r[df]).length / arr.length : 0;
      const seen = {};
      for (const r of arr) {
        if (!r || typeof r !== 'object') continue;
        const label = (lf && r[lf]) ? String(r[lf]) : (r.name || r.title || `${entity} #${r.id ?? '?'}`);
        if (lf && !r[lf]) out.push({ entity, label, issue: 'no title' });
        else if (df && haveDl > 0.5 && !r[df]) out.push({ entity, label, issue: 'missing deadline' });
        const key = label.toLowerCase().trim();
        if (key) { if (seen[key]) out.push({ entity, label, issue: 'possible duplicate' }); seen[key] = 1; }
      }
    }
    return out.slice(0, 12);
  }

  // ---- loose ends: what the owner is likely forgetting / losing track of ----
  looseEnds({ max = 10 } = {}) {
    const b = this.brain();
    const data = (() => { try { return b?.getData?.() || {}; } catch { return {}; } })();
    const ents = (() => { try { return b?.getEntities?.() || {}; } catch { return {}; } })();
    const recs = (() => { try { return b?.getRecords?.() || []; } catch { return []; } })();
    const now = Date.now();
    const DONE = /done|complete|closed|won|accept|success|approved|paid|submitted|finished|archiv|reject/i;
    const out = [];

    // deadline-based: overdue-and-still-open, due today / tomorrow
    for (const r of recs) {
      if (!r.deadlineAt || Number.isNaN(Date.parse(r.deadlineAt))) continue;
      const status = String(r.payload?.status || r.payload?.stage || r.payload?.state || '');
      const done = DONE.test(status);
      const days = Math.floor((Date.parse(r.deadlineAt) - now) / 86400000);
      if (days < 0 && !done) out.push(this._le(r, `overdue ${-days}d, still ${status || 'open'}`, 5 + Math.min(20, -days) * 0.1));
      else if (days === 0 && !done) out.push(this._le(r, 'due today', 4.5));
      else if (days === 1 && !done) out.push(this._le(r, 'due tomorrow', 3.4));
    }

    // stale: a created/added/updated date long in the past, not finished
    for (const [entity, arr] of Object.entries(data)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      const desc = ents[entity] || {};
      const sf = this._staleField(arr, desc.deadlineField);
      if (!sf) continue;
      for (const rec of arr) {
        if (!rec || typeof rec !== 'object') continue;
        if (DONE.test(String(rec.status || rec.stage || ''))) continue;
        const t = Date.parse(rec[sf]); if (Number.isNaN(t)) continue;
        const ageD = Math.floor((now - t) / 86400000);
        if (ageD < 21) continue;
        const label = (desc.labelField && rec[desc.labelField]) ? String(rec[desc.labelField]) : (rec.name || rec.title || `${entity} #${rec.id ?? '?'}`);
        if (out.some((o) => o.entity === entity && o.label === label)) continue;
        out.push({ entity, recordId: rec.id, label, reason: `untouched ~${ageD}d`, dueAt: null, pointTo: this._pointTo(entity, rec.id), score: 2 + Math.min(2, ageD / 60) });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, max);
  }
  _le(r, reason, score) { return { entity: r.entity, recordId: r.id, label: r.label, reason, dueAt: r.deadlineAt, pointTo: this._pointTo(r.entity, r.id), score }; }
  _staleField(arr, exclude) {
    const fields = [...new Set(arr.slice(0, 20).flatMap((r) => (r && typeof r === 'object') ? Object.keys(r) : []))];
    const pref = ['updatedat', 'updated', 'modified', 'lastedit', 'createdat', 'created', 'added', 'dateadded', 'logged'];
    for (const p of pref) { const f = fields.find((x) => x !== exclude && x.toLowerCase().replace(/[^a-z]/g, '').includes(p)); if (f) return f; }
    return null;
  }
  _pointTo(entity, id) {
    const map = { opportunities: `opportunity-details.html?id=${encodeURIComponent(id)}` };
    return map[entity] || `${entity}.html`;
  }

  /** Human one-liner for the board. */
  _line(f) {
    const L = (f.label || `${f.entity} item`).trim();
    switch (f.urgency) {
      case 'overdue':   return `"${L}" is overdue — it needs you now. ⚠️`;
      case 'due-today': return `"${L}" is due today. ⏰`;
      case 'within-1d': return `"${L}" is due tomorrow.`;
      case 'within-3d': return `"${L}" is due within 3 days.`;
      case 'within-7d': return `"${L}" is coming up this week.`;
      case 'reminder':  return `Reminder: ${L}`;
      default:          return `"${L}" needs a look.`;
    }
  }

  /** A short spoken intro for the whole standup, with a quick data digest. */
  intro(items) {
    const name = this.ownerName();
    const digest = this._digest();
    if (!items.length) return `All clear, ${name} — nothing urgent.${digest} 🌿`;
    const n = items.length;
    const over = items.filter((i) => i.urgency === 'overdue').length;
    if (over) return `Morning, ${name}. ${n} thing${n > 1 ? 's' : ''} to review — ${over} already overdue.${digest}`;
    return `Morning, ${name}. ${n} thing${n > 1 ? 's' : ''} on your radar.${digest} Shall we?`;
  }

  /** " · 9 opportunities, 8 tasks, 2 research" from the cached data. */
  _digest() {
    try {
      const data = this.brain()?.getData?.() || {};
      const parts = Object.keys(data)
        .filter((k) => Array.isArray(data[k]) && data[k].length)
        .sort((a, b) => data[b].length - data[a].length)
        .slice(0, 4)
        .map((k) => `${data[k].length} ${k}`);
      return parts.length ? ` · ${parts.join(', ')}.` : '';
    } catch { return ''; }
  }
}
