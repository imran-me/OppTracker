/* ============================================================
   EON — owner/nudger.js
   The "you forgot / losing track" helper. When the owner is idle and
   EON is free, he gently surfaces the single most-likely-forgotten
   thing (from companion-brain.looseEnds): overdue-but-open, due
   today, or a record gone stale. A small card floats by his head:
   "Don't forget — X. [Show me] [Dismiss]". Show me → he escorts you
   there (via the whiteboard's escort). Quiet by design.
   ============================================================ */

import { CompanionBrain } from './companion-brain.js';
import { OWNER, ownerFirstName } from '../../js/owner-config.js';

const FIRST_DELAY = 75000;     // settle before the first nudge
const GAP_MS = 9 * 60000;      // ~9 min between nudges
const IDLE_MS = 40000;         // only when the owner's been quiet a bit

export class Nudger {
  constructor(ctx) {
    this.ctx = ctx;
    this.cb = new CompanionBrain(() => (typeof window !== 'undefined' ? window.EonBrain : null));
    this._next = 0;
    this._active = null;
    this._shown = new Set();
  }

  start() { this._injectStyle(); this._buildCard(); }

  update() {
    if (!this.cb.isOwner()) { if (this._active) this._hide(); return; }
    const now = Date.now();
    if (this._active) { this._position(); return; }
    if (!this._next) { this._next = now + FIRST_DELAY; return; }
    if (now < this._next) return;

    const c = this.ctx;
    if (c.drag?.active || c.focus || c.hypeBusy || c.meditating) { this._next = now + 30000; return; }
    const idle = (() => { try { return c.personality?.ignoredFor?.() ?? 1e9; } catch { return 1e9; } })();
    if (idle < IDLE_MS) { this._next = now + 20000; return; }
    if (this._otherCardUp()) { this._next = now + 30000; return; }   // never stack on another card

    try { window.EonBrain?.ensureData?.(); } catch {}
    const le = this.cb.looseEnds({ max: 8 });
    const item = le.find((x) => !this._shown.has(this._key(x)));
    if (!item) { this._next = now + 5 * 60000; return; }
    this._next = now + GAP_MS;
    this._show(item);
  }

  _show(item) {
    ['eon-resume', 'eon-go', 'eon-hook'].forEach((id) => document.getElementById(id)?.classList.remove('show')); // never stack
    try { this.ctx.ai.bubble = null; } catch {}            // no speech bubble behind the card
    this._active = item;
    const name = ownerFirstName(document.getElementById('pfName')?.textContent) || OWNER.name;
    this._title.textContent = `Don't forget, ${name}:`;
    this._line.textContent = `${item.label} — ${item.reason}`;
    this._card.classList.add('show');
    this._position();
    try { this.ctx.character.playEmote(/overdue/.test(item.reason) ? 'idea' : 'peek'); } catch {}
    this._timeout = setTimeout(() => this._dismiss(true), 12000);   // ignored = soft dismiss (card is the message)
  }
  _accept() {
    const item = this._active; this._hide();
    if (!item) return;
    try { window.EonCompanion?.escortTo?.(item); } catch {}
  }
  _dismiss(soft) {
    const item = this._active; this._hide();
    if (!item) return;
    this._shown.add(this._key(item));
    if (!soft) { try { this.cb.noteDismiss(item.entity); } catch {} }   // explicit dismiss → learn
  }
  _hide() {
    if (this._timeout) { clearTimeout(this._timeout); this._timeout = null; }
    this._active = null; this._card?.classList.remove('show');
  }

  _position() {
    if (!this._card?.classList.contains('show')) return;
    try {
      const h = this.ctx.project(this.ctx.character.headAnchor);
      const ch = this._card.getBoundingClientRect().height || 90;
      this._card.style.left = Math.max(150, Math.min(innerWidth - 150, h.x)) + 'px';
      this._card.style.top = Math.max(ch + 8, Math.min(innerHeight - 8, h.y - 24)) + 'px';
    } catch {}
  }

  // ---- dom ----
  _injectStyle() {
    if (document.getElementById('eon-nudge-style')) return;
    const s = document.createElement('style'); s.id = 'eon-nudge-style';
    s.textContent = `
      #eon-nudge{position:fixed;z-index:2147483600;max-width:270px;transform:translate(-50%,-100%);
        background:#fff;color:#10225e;border-radius:14px;padding:11px 13px;box-shadow:0 12px 34px rgba(16,34,94,.24);
        border:1.5px solid #C9A22755;font:600 13px/1.35 system-ui;opacity:0;pointer-events:none;transition:opacity .18s}
      #eon-nudge.show{opacity:1;pointer-events:auto}
      #eon-nudge .en-t{font-size:11.5px;color:#C9A227;font-weight:800;letter-spacing:.2px}
      #eon-nudge .en-l{margin:3px 0 9px;color:#16203a}
      #eon-nudge .en-b{display:flex;gap:7px}
      #eon-nudge button{flex:1;border:0;border-radius:8px;padding:5px 6px;cursor:pointer;font:700 11px system-ui}
      #eon-nudge .en-go{background:#1f6dff;color:#fff}#eon-nudge .en-go:hover{background:#1559d8}
      #eon-nudge .en-no{background:#eef1f7;color:#52607a}#eon-nudge .en-no:hover{background:#e2e7f2}`;
    document.head.appendChild(s);
  }
  _buildCard() {
    if (document.getElementById('eon-nudge')) { this._card = document.getElementById('eon-nudge'); return; }
    const el = document.createElement('div'); el.id = 'eon-nudge';
    el.innerHTML = `<div class="en-t"></div><div class="en-l"></div>
      <div class="en-b"><button class="en-go">Show me</button><button class="en-no">Dismiss</button></div>`;
    document.body.appendChild(el);
    this._card = el; this._title = el.querySelector('.en-t'); this._line = el.querySelector('.en-l');
    el.querySelector('.en-go').onclick = (e) => { e.stopPropagation(); this._accept(); };
    el.querySelector('.en-no').onclick = (e) => { e.stopPropagation(); this._dismiss(false); };
  }

  _otherCardUp() {
    for (const id of ['eon-board', 'eon-resume', 'eon-go', 'eon-hook', 'eon-ask']) {
      const e = document.getElementById(id); if (e && e.classList.contains('show')) return true;
    }
    return false;
  }
  _key(x) { return `${x.entity}:${x.recordId}:${x.reason}`; }
  _short(t, n = 40) { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
}
