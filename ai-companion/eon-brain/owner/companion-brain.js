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
    return { ...f, consequence: c, score: u * c, line: this._line(f) };
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

  /** A short spoken intro for the whole standup. */
  intro(items) {
    const name = this.ownerName();
    if (!items.length) return `All clear, ${name} — nothing urgent. 🌿`;
    const n = items.length;
    const over = items.filter((i) => i.urgency === 'overdue').length;
    if (over) return `Morning, ${name}. ${n} thing${n > 1 ? 's' : ''} to review — ${over} already overdue.`;
    return `Morning, ${name}. ${n} thing${n > 1 ? 's' : ''} on your radar. Shall we?`;
  }
}
