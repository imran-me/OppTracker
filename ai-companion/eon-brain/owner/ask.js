/* ============================================================
   EON — owner/ask.js
   "Ask EON" — a lightweight question→answer over the owner's data.
   No backend / LLM: a rule-based engine that reads the brain's cached
   records (EonBrain.getRecords / ensureData) and answers the common
   things — counts, what's due / overdue / this week, totals & averages,
   list a module, find by name. Answers in his bubble + a small panel,
   and can drop results into the backpack.

   Owner-only. Examples:
     "how many opportunities?"  "what's due this week?"  "overdue"
     "total amount of invoices"  "list my tasks"  "find chevening"
   ============================================================ */

import { CompanionBrain } from './companion-brain.js';

const SYN = {
  opportunities: ['opportunit', 'opps', 'opp'],
  tasks: ['task', 'to-do', 'todo'],
  documents: ['document', 'doc', 'file'],
  contacts: ['contact', 'people', 'person'],
  achievements: ['achiev', 'award', 'certif', 'trophy'],
  projects: ['project'],
  research: ['research', 'paper', 'thesis'],
  reminders: ['reminder'],
};
const AMOUNT_HINTS = ['amount', 'value', 'price', 'cost', 'fee', 'total', 'budget', 'salary', 'paid'];

export class AskEon {
  constructor(ctx) { this.ctx = ctx; this._open = false; this.cb = new CompanionBrain(() => (typeof window !== 'undefined' ? window.EonBrain : null)); }

  start() {
    this._injectStyle();
    this._buildChip();
    this._buildPanel();
    if (typeof window !== 'undefined') window.EonAsk = this;
  }

  update() {
    const show = this._owner();
    if (this._chip) this._chip.style.display = show ? 'inline-flex' : 'none';
    if (!show && this._open) this._toggle(false);
  }

  // ---------------- ask flow ----------------
  async ask(q) {
    q = String(q || '').trim(); if (!q) return;
    this._echo(q);
    this._answerEl.textContent = '…thinking';
    try { this.ctx.character.playEmote('think'); } catch {}
    let res;
    try { res = await this._answer(q); } catch (e) { res = { speak: 'I tripped on that one — try rephrasing?' }; }
    this._lastItems = res.items || null;
    this._answerEl.textContent = res.detail ? `${res.speak}\n${res.detail}` : res.speak;
    const hasItems = !!(res.items && res.items.length);
    this._keepBtn.style.display = hasItems ? 'inline-block' : 'none';
    const first = hasItems ? res.items[0] : null;
    this._goBtn.style.display = (first && first.entity) ? 'inline-block' : 'none';
    if (first && first.entity) this._goBtn.textContent = `➡️ Take me to “${this._short(first.label, 22)}”`;
    try { this.ctx.character.playEmote('point'); } catch {}
    try { this.ctx.ai?.speak(res.speak.slice(0, 140), 5200); } catch {}
  }

  async _answer(q) {
    const B = window.EonBrain;
    await B?.ensureData?.();
    const data = B?.getData?.() || {};
    const records = B?.getRecords?.() || [];
    const keys = Object.keys(data).filter((k) => Array.isArray(data[k]));
    if (!records.length) return { speak: "I can't see your data yet — give the brain a moment, or run a meditation." };

    const nq = q.toLowerCase();
    const now = Date.now();
    const days = (iso) => Math.floor((Date.parse(iso) - now) / 86400000);

    if (/\bremind me\b|don'?t let me forget|set (a )?reminder/.test(nq)) return this._remind(q);
    if (/forget|forgetting|loose ?ends?|losing track|slipping|fell through|follow[- ]?up|\bstale\b|neglect/.test(nq)) {
      const le = this.cb.looseEnds();
      if (!le.length) return { speak: "You're on top of everything — nothing slipping. ✨" };
      const detail = le.map((x) => `• ${x.label} — ${x.reason}`).join('\n');
      return { speak: `${le.length} thing${le.length > 1 ? 's' : ''} you might be losing track of:`, detail, items: le };
    }
    if (/\bplan\b|what should i do|where (to|do i) start|prioriti|my day|to-?do list|organi[sz]e/.test(nq)) {
      const { items, overload } = this.cb.plan();
      if (!items.length) return { speak: "Nothing scheduled — you're clear. 🌿" };
      const detail = items.map((i, idx) => `${idx + 1}. ${i.label}${i.dueAt ? ` — ${this._date(i.dueAt)}` : ''}`).join('\n');
      const ov = overload.length ? ` Heads up: ${overload.map((o) => `${o.count} on ${this._date(o.date)}`).join(', ')}.` : '';
      return { speak: `Here's how I'd tackle it:${ov}`, detail, items };
    }
    if (/problem|issue|anomal|missing|incomplete|looks off|clean ?up|hygiene|wrong|tidy/.test(nq)) {
      const h = this.cb.hygiene();
      if (!h.length) return { speak: 'Everything looks tidy. ✨' };
      const detail = h.map((x) => `• ${x.label} — ${x.issue} (${x.entity})`).join('\n');
      return { speak: `${h.length} thing${h.length > 1 ? 's' : ''} to tidy:`, detail };
    }
    const ent = this._entityIn(nq, keys);
    const recs = ent ? records.filter((r) => r.entity === ent) : records;
    const dl = recs.filter((r) => r.deadlineAt && !Number.isNaN(Date.parse(r.deadlineAt)));

    if (/overdue|past due|missed|late\b/.test(nq)) {
      const od = dl.filter((r) => Date.parse(r.deadlineAt) < now).sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt));
      return this._list(od, `${od.length} overdue${ent ? ' ' + ent : ''}`);
    }
    if (/due today|\btoday\b/.test(nq)) {
      const td = dl.filter((r) => days(r.deadlineAt) === 0);
      return this._list(td, `${td.length} due today`);
    }
    if (/tomorrow/.test(nq)) {
      const tm = dl.filter((r) => days(r.deadlineAt) === 1);
      return this._list(tm, `${tm.length} due tomorrow`);
    }
    if (/next deadline|nearest|soonest|what'?s next/.test(nq)) {
      const fut = dl.filter((r) => Date.parse(r.deadlineAt) >= now).sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt));
      if (!fut.length) return { speak: 'No upcoming deadlines on the radar. 🌿' };
      const f = fut[0]; return { speak: `Next up: "${f.label}" — ${this._date(f.deadlineAt)} (${days(f.deadlineAt)} days).`, items: [f] };
    }
    if (/this week|next 7|upcoming|coming up|\bsoon\b|due\b/.test(nq)) {
      const wk = dl.filter((r) => { const d = days(r.deadlineAt); return d >= 0 && d <= 7; }).sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt));
      return this._list(wk, `${wk.length} due in the next 7 days`);
    }
    if (/how many|number of|count|how much.*have/.test(nq)) {
      if (ent) return { speak: `You have ${recs.length} ${ent}.` };
      return { speak: keys.map((k) => `${data[k].length} ${k}`).join(', ') + '.' };
    }
    if (/total|sum|average|avg|how much/.test(nq)) {
      const field = this._amountField(nq, recs);
      if (field) {
        const vals = recs.map((r) => this._num(r.payload?.[field])).filter((n) => n != null);
        if (!vals.length) return { speak: `No numeric "${field}" to add up.` };
        const s = vals.reduce((a, b) => a + b, 0);
        if (/average|avg/.test(nq)) return { speak: `Average ${field}${ent ? ' of ' + ent : ''}: ${this._fmt(s / vals.length)} (over ${vals.length}).` };
        return { speak: `Total ${field}${ent ? ' of ' + ent : ''}: ${this._fmt(s)} across ${vals.length}.` };
      }
      return { speak: 'Which number should I total? Try e.g. "total amount of opportunities".' };
    }
    if (ent && /list|show|what are|give me|^my |all my/.test(nq)) {
      return this._list(recs.slice(0, 10), `${recs.length} ${ent}`);
    }
    if (/find|search|look ?up|who is|where is/.test(nq)) {
      const term = nq.replace(/.*?(find|search|look ?up|who is|where is)\s+/, '').replace(/[?.!]/g, '').trim();
      if (term.length >= 2) {
        const hits = records.filter((r) => (r.label || '').toLowerCase().includes(term));
        return this._list(hits.slice(0, 10), `${hits.length} match "${term}"`);
      }
    }
    if (ent) return this._list(recs.slice(0, 10), `${recs.length} ${ent}`);
    return { speak: this._help(keys) };
  }

  _remind(q) {
    let task = q.replace(/.*?(remind me( to| about)?|don'?t let me forget( to)?|set (a )?reminder( to| about)?)\s*/i, '').trim();
    const parsed = this._parseWhen(task);
    task = (parsed.task || task).replace(/[?.!]+$/, '').trim();
    if (!task) return { speak: 'Sure — what should I remind you about, and when?' };
    const when = parsed.date || (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })();
    try {
      if (window.AppReminders?.create) window.AppReminders.create({ title: task, remindAt: when.toISOString(), source: 'eon' });
      else if (window.EonBrain?.createReminder) { const r = window.EonBrain.createReminder({ title: task, remindAt: when.toISOString() }); if (r && r.catch) r.catch(() => {}); }
      else return { speak: 'Sign in as owner and I’ll set reminders. 🔒' };
    } catch { return { speak: 'Sign in as owner and I’ll set reminders. 🔒' }; }
    return { speak: `Done — I'll remind you to "${task}" ${this._whenLabel(when)}. ⏰` };
  }

  /* Parse a natural "when" out of a reminder phrase. Understands:
     in/after N sec|min|hour|day|week · today/tonight/tomorrow/next week
     · a date (YYYY-MM-DD or D/M/Y, day-first) · a weekday · a time (10pm,
     22:00, 10:30 am), combinable e.g. "at 10pm on 26/06/2026". */
  _parseWhen(text) {
    let task = ' ' + text + ' ';
    let base = null, timeH = null, timeM = 0, rel = null, m;

    // relative offset: "in 5 min", "after 2 hours", "in 90 seconds", "in 3 days"
    if ((m = task.match(/\b(?:in|after|within)\s+(\d+)\s*(sec(?:ond)?|min(?:ute)?|hour|hr|day|week)s?\b/i))) {
      const n = parseInt(m[1], 10), u = m[2].toLowerCase();
      const mult = u.startsWith('sec') ? 1000 : u.startsWith('min') ? 60000
        : (u.startsWith('hour') || u === 'hr') ? 3600000 : u.startsWith('day') ? 86400000 : 604800000;
      rel = n * mult; task = task.replace(m[0], ' ');
    }
    // explicit date anywhere (ISO or day-first D/M/Y)
    if ((m = task.match(/\b(\d{4}-\d{1,2}-\d{1,2})\b/)) || (m = task.match(/\b(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\b/))) {
      const dd = this._parseDateStr(m[1]); if (dd) { base = dd; task = task.replace(m[0], ' '); }
    }
    // relative day words (only if no explicit date)
    if (!base && rel == null) {
      if (/\btomorrow\b/i.test(task)) { base = new Date(); base.setDate(base.getDate() + 1); task = task.replace(/\btomorrow\b/i, ' '); }
      else if (/\bnext week\b/i.test(task)) { base = new Date(); base.setDate(base.getDate() + 7); task = task.replace(/\bnext week\b/i, ' '); }
      else if (/\btonight\b/i.test(task)) { base = new Date(); timeH = timeH ?? 20; task = task.replace(/\btonight\b/i, ' '); }
      else if (/\btoday\b/i.test(task)) { base = new Date(); task = task.replace(/\btoday\b/i, ' '); }
      else { const wm = task.toLowerCase().match(/\b(?:on |next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*/); if (wm) { const dn = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], idx = dn.indexOf(wm[1]); if (idx >= 0) { const d = new Date(); let add = (idx - d.getDay() + 7) % 7; if (add === 0) add = 7; d.setDate(d.getDate() + add); base = d; task = task.replace(wm[0], ' '); } } }
    }
    // time of day: "at 10pm", "at 22:00", "10:30 am", "at 7"
    if ((m = task.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)) ||
        (m = task.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)) ||
        (m = task.match(/\b(\d{1,2})\s*(am|pm)\b/i))) {
      let h = parseInt(m[1], 10); const mins = /^\d{2}$/.test(m[2] || '') ? parseInt(m[2], 10) : 0;
      const ap = (m[3] || m[2] || '').toString().toLowerCase();
      if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
      if (h >= 0 && h <= 23) { timeH = h; timeM = (mins >= 0 && mins < 60) ? mins : 0; task = task.replace(m[0], ' '); }
    }

    let date = null;
    if (rel != null) date = new Date(Date.now() + rel);
    else if (base || timeH != null) {
      date = base || new Date();
      if (timeH != null) date.setHours(timeH, timeM, 0, 0); else date.setHours(9, 0, 0, 0);
      // a bare time already past today → assume the owner means tomorrow
      if (!base && timeH != null && date.getTime() < Date.now()) date.setDate(date.getDate() + 1);
    }
    task = task.replace(/^\s*(to|that|about)\s+/i, '').replace(/\s+/g, ' ').trim();
    return { date, task };
  }
  /* Parse a date token. ISO stays ISO; D/M/Y is read day-first. */
  _parseDateStr(s) {
    s = String(s).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/))) {
      let y = m[3] ? +m[3] : new Date().getFullYear(); if (y < 100) y += 2000;
      return new Date(y, +m[2] - 1, +m[1]);   // day-first
    }
    const t = Date.parse(s); return Number.isNaN(t) ? null : new Date(t);
  }
  /* Human label: "in 5 minutes" stays relative; dated reminders show date (+time). */
  _whenLabel(d) {
    const ms = d.getTime() - Date.now();
    if (ms > 0 && ms < 3600000) return `in ${Math.max(1, Math.round(ms / 60000))} minute${Math.round(ms / 60000) === 1 ? '' : 's'}`;
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    const date = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    if (!hasTime) return `on ${date}`;
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `on ${date} at ${time}`;
  }

  _list(items, lead) {
    if (!items.length) return { speak: `Nothing there — ${lead.replace(/^\d+\s*/, '')}. 🌿` };
    const detail = items.slice(0, 8).map((r) => `• ${r.label}${r.deadlineAt ? ` — ${this._date(r.deadlineAt)}` : ''}`).join('\n');
    return { speak: `${lead}:`, detail, items };
  }

  // ---------------- helpers ----------------
  _entityIn(nq, keys) {
    for (const k of keys) { const syns = SYN[k] || [k]; if (nq.includes(k) || syns.some((s) => nq.includes(s))) return k; }
    return null;
  }
  _amountField(nq, recs) {
    const fields = [...new Set(recs.flatMap((r) => Object.keys(r.payload || {})))];
    // a field named in the question?
    const named = fields.find((f) => nq.includes(f.toLowerCase()));
    if (named && this._isNumericField(named, recs)) return named;
    // a common money-ish field that actually holds numbers?
    for (const h of AMOUNT_HINTS) { const f = fields.find((x) => x.toLowerCase().includes(h)); if (f && this._isNumericField(f, recs)) return f; }
    return null;
  }
  _isNumericField(f, recs) { return recs.some((r) => this._num(r.payload?.[f]) != null); }
  _num(v) { if (v == null) return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isNaN(n) ? null : n; }
  _fmt(n) { return (Math.round(n * 100) / 100).toLocaleString(); }
  _date(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }
  _help(keys) { return `Ask me things like "how many ${keys[0] || 'tasks'}?", "what's due this week?", "overdue", "find <name>", or "total <field>".`; }
  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }

  // ---------------- DOM ----------------
  _injectStyle() {
    if (document.getElementById('eon-ask-style')) return;
    const s = document.createElement('style'); s.id = 'eon-ask-style';
    s.textContent = `
      #eon-ask-chip{position:relative;display:none;align-items:center;gap:5px;height:26px;white-space:nowrap;
        background:#1f6dff;color:#fff;border:0;border-radius:14px;padding:0 11px;cursor:pointer;line-height:1;
        box-shadow:0 4px 12px rgba(31,109,255,.3);font:700 12px system-ui;transition:transform .15s,background .15s}
      #eon-ask-chip:hover{background:#1559d8;transform:translateY(-2px)}
      #eon-ask{position:fixed;right:16px;bottom:50px;z-index:2147483600;width:320px;max-width:calc(100vw - 32px);
        background:#fff;color:#10225e;border-radius:14px;border:1.5px solid #1f6dff33;box-shadow:0 16px 44px rgba(16,34,94,.26);
        opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .18s,transform .18s;font:500 13px system-ui;overflow:hidden}
      #eon-ask.show{opacity:1;transform:none;pointer-events:auto}
      #eon-ask .ea-h{display:flex;align-items:center;padding:10px 12px;background:#1f6dff;color:#fff;font-weight:700;font-size:12.5px}
      #eon-ask .ea-x{margin-left:auto;cursor:pointer;opacity:.85;font-size:14px}
      #eon-ask .ea-in{display:flex;gap:6px;padding:10px 12px}
      #eon-ask input{flex:1;border:1.5px solid #e2e7f2;border-radius:9px;padding:8px 10px;font:500 13px system-ui;color:#16203a}
      #eon-ask input:focus{outline:none;border-color:#1f6dff}
      #eon-ask .ea-go{border:0;border-radius:9px;background:#1f6dff;color:#fff;padding:0 12px;cursor:pointer;font:700 13px system-ui}
      #eon-ask .ea-a{padding:0 12px 12px;white-space:pre-wrap;color:#16203a;max-height:42vh;overflow:auto;font-weight:600}
      #eon-ask .ea-keep{display:none;margin:0 12px 12px;border:0;border-radius:9px;background:#eef1f7;color:#10225e;padding:7px 10px;cursor:pointer;font:700 12px system-ui}
      #eon-ask .ea-keep:hover{background:#e2e7f2}
      #eon-ask .ea-go-there{display:none;margin:0 12px 8px;border:0;border-radius:9px;background:#1f6dff;color:#fff;padding:7px 10px;cursor:pointer;font:700 12px system-ui}
      #eon-ask .ea-go-there:hover{background:#1559d8}
      #eon-ask .ea-ex{padding:2px 12px 10px;color:#8a96ad;font-size:11px}`;
    document.head.appendChild(s);
  }
  _buildChip() {
    if (document.getElementById('eon-ask-chip')) { this._chip = document.getElementById('eon-ask-chip'); return; }
    const b = document.createElement('button'); b.id = 'eon-ask-chip';
    b.innerHTML = '💬 Ask EON'; b.title = 'Ask EON about your data';
    b.onclick = (e) => { e.stopPropagation(); this._toggle(); };
    (document.getElementById('eon-controls') || document.body).appendChild(b); this._chip = b;
  }
  _buildPanel() {
    if (document.getElementById('eon-ask')) { this._panel = document.getElementById('eon-ask'); return; }
    const p = document.createElement('div'); p.id = 'eon-ask';
    p.innerHTML = `
      <div class="ea-h">💬 Ask EON <span class="ea-x" title="Close">✕</span></div>
      <div class="ea-in"><input type="text" placeholder="e.g. what's due this week?" /><button class="ea-go">Ask</button></div>
      <div class="ea-ex">Try: what am I forgetting · remind me to call X tomorrow · plan my day · what's due · overdue · find &lt;name&gt; · total amount</div>
      <div class="ea-a"></div>
      <button class="ea-go-there">➡️ Take me there</button>
      <button class="ea-keep">🎒 Keep these in the backpack</button>`;
    document.body.appendChild(p);
    this._panel = p;
    this._input = p.querySelector('input');
    this._answerEl = p.querySelector('.ea-a');
    this._keepBtn = p.querySelector('.ea-keep');
    this._goBtn = p.querySelector('.ea-go-there');
    this._goBtn.onclick = (e) => { e.stopPropagation(); this._goThere(); };
    p.querySelector('.ea-x').onclick = (e) => { e.stopPropagation(); this._toggle(false); };
    p.querySelector('.ea-go').onclick = (e) => { e.stopPropagation(); this.ask(this._input.value); };
    this._input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.ask(this._input.value); });
    this._keepBtn.onclick = (e) => {
      e.stopPropagation();
      const items = this._lastItems || [];
      const text = items.map((r) => `${r.label}${r.deadlineAt ? ` — ${this._date(r.deadlineAt)}` : ''}`).join('\n');
      try { window.EonBackpack?.addText(text, `Kept ${items.length} from your question. 🎒`); } catch {}
      this._keepBtn.style.display = 'none';
    };
  }
  _goThere() {
    const f = (this._lastItems || [])[0]; if (!f || !f.entity) return;
    const id = f.recordId ?? f.id;
    const item = { entity: f.entity, recordId: id, pointTo: f.pointTo || this.cb._pointTo(f.entity, id), label: f.label, line: `Here it is — ${f.label}.` };
    this._toggle(false);
    try { window.EonCompanion?.escortTo?.(item); } catch {}
  }
  _short(t, n = 28) { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  _echo(q) { if (this._answerEl) this._answerEl.textContent = ''; if (this._keepBtn) this._keepBtn.style.display = 'none'; if (this._goBtn) this._goBtn.style.display = 'none'; }
  _toggle(force) {
    this._open = (force === undefined) ? !this._open : force;
    this._panel.classList.toggle('show', this._open);
    if (this._open) setTimeout(() => this._input?.focus(), 60);
  }
}
