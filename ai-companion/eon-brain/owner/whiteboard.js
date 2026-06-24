/* ============================================================
   EON — owner/whiteboard.js
   OWNER-MODE signature experience: the Whiteboard Standup + Escort.

   • Standup: in his home corner EON runs a briefing — one item at a
     time from the decision brain (companion-brain.js). Each card:
     "X is due today" → [Show me] [Later] [Dismiss]. A passive alert
     becomes a small conversation.
   • Escort: on "Show me" EON physically takes you there — walks to the
     sidebar menu item, navigates to the module (carrying a baton across
     the page load), then lands on the exact record and points it out.

   Owner-only. Reuses the avatar ctx (character / nav / ai / particles).
   ============================================================ */

import { CompanionBrain } from './companion-brain.js';

const AUTO_DELAY   = 2500;   // ms after load before the first standup is considered
const LAND_MS      = 4500;   // max walk time before landing on a record
const MENU_MS      = 3500;   // max walk time to the sidebar item
const REACT_MS     = 2800;

export class OwnerCompanion {
  constructor(ctx) {
    this.ctx = ctx;
    this.cb = new CompanionBrain(() => (typeof window !== 'undefined' ? window.EonBrain : null));
    this.pageFile = (location.pathname.split('/').pop() || 'index.html');
    this.agenda = [];
    this.idx = 0;
    this.esc = null;                 // escort state machine
    this._presenting = false;
    this._startedAt = Date.now();
    this._autoTries = 0;
  }

  start() {
    this._injectStyle();
    this._buildBoard();
    if (typeof window !== 'undefined') window.EonCompanion = this;   // manual: EonCompanion.standup()
    this._resumeEscort();            // did we just arrive from a "Show me"?
  }

  // ---------------- per-frame ----------------
  update() {
    const owner = this.cb.isOwner();
    if (!owner) { if (this._presenting || this.esc) this._cancel(); this._hideBoard(); return; }
    const now = Date.now();
    if (this.esc) { this._driveEscort(now); return; }

    // auto-run the standup once per session, after the brain has a feed
    if (!this._autoDone && now - this._startedAt > AUTO_DELAY) this._tryAuto(now);
  }

  _tryAuto(now) {
    if (this._sessionFlag('eon-standup-shown')) { this._autoDone = true; return; }
    const b = this.cb.brain();
    const cycled = (() => { try { return !!(b && b.status && b.status().lastCycleAt); } catch { return false; } })();
    const hasAlerts = (() => { try { return (b && b.getAlerts && b.getAlerts().length) > 0; } catch { return false; } })();
    if (!cycled && !hasAlerts) {                 // brain still meditating — wait a little
      if (++this._autoTries > 12) this._autoDone = true;   // give up after ~30s
      this._startedAt = now - AUTO_DELAY + 2500;           // retry in ~2.5s
      return;
    }
    this._autoDone = true;
    this._setSessionFlag('eon-standup-shown');
    this.standup();
  }

  // ---------------- the standup ----------------
  standup() {
    if (!this.cb.isOwner()) return;
    this.agenda = this.cb.buildStandup({ max: 6 });
    this.idx = 0;
    try { this.ctx.ai?.speak(this.cb.intro(this.agenda), 4600); } catch {}
    if (!this.agenda.length) return;             // nothing to brief
    this._present(true);
    this._showCard(0);
  }

  _present(on) {
    this._presenting = on;
    this.ctx.hypeBusy = on;                       // hold position while briefing
    if (on) { try { this.ctx.nav.goHome(); } catch {} }
  }

  _showCard(i) {
    this.idx = i;
    const item = this.agenda[i];
    if (!item) { this._finish(); return; }
    this._boardLine.textContent = item.line;
    this._boardProg.textContent = `${i + 1} / ${this.agenda.length}`;
    this._board.classList.add('show');
    try { this.ctx.character.playEmote(item.urgency === 'overdue' ? 'point' : 'think'); } catch {}
  }

  _next() { this._showCard(this.idx + 1); }
  _finish() {
    this._hideBoard();
    this._present(false);
    try { this.ctx.ai?.speak('That’s the lot. You’ve got this, boss. 💪', 3800); } catch {}
  }
  _cancel() { this._present(false); this.esc = null; }

  // button actions
  _showMe() {
    const item = this.agenda[this.idx]; if (!item) return;
    this._hideBoard();
    this._escort(item);
  }
  _later() {
    const item = this.agenda[this.idx];
    try { window.EonBrain?.snooze?.(item.id, 120); } catch {}
    this._next();
  }
  _dismiss() {
    const item = this.agenda[this.idx];
    try { this.cb.noteDismiss(item.entity); } catch {}     // learn: ease off this kind next time
    try { window.EonBrain?.dismiss?.(item.id); } catch {}
    this._next();
  }

  // ---------------- escort ----------------
  _escort(item) {
    this.ctx.hypeBusy = true;
    const page = this._entityPage(item);
    const link = this._findSidebarLink(page);
    if (link) {
      this.esc = { phase: 'toMenu', el: link, item, until: Date.now() + MENU_MS };
      try { this.ctx.ai?.speak(`Taking you to your ${this._entityLabel(item)}… ✨`, 3000); } catch {}
    } else {
      this._navigate(item);                       // already in the right place / no sidebar
    }
  }

  _driveEscort(now) {
    const e = this.esc;
    if (e.phase === 'toMenu') {
      const p = this._navTarget(e.el); if (p) this.ctx.nav.goTo(p.x, p.y);
      this._face(e.el);
      if (this.ctx.nav.atTarget() || now >= e.until) { this._highlight(e.el); this._navigate(e.item); this.esc = null; }
      return;
    }
    if (e.phase === 'land') {
      const p = this._navTarget(e.el); if (p) this.ctx.nav.goTo(p.x, p.y);
      this._face(e.el);
      if (this.ctx.nav.atTarget() || now >= e.until) {
        try { this.ctx.character.playEmote('point'); } catch {}
        try { this.ctx.ai?.speak(e.item.line || 'Here it is. 👇', 5200); } catch {}
        this._highlight(e.el);
        this.esc = { phase: 'react', until: now + REACT_MS };
      }
      return;
    }
    if (e.phase === 'react') {
      if (now >= e.until) { this.ctx.hypeBusy = false; this.esc = null; }
      return;
    }
  }

  _navigate(item) {
    const baton = {
      page: this._pageFile(item.pointTo), record: String(item.recordId || ''),
      line: item.line, entity: item.entity,
    };
    try { sessionStorage.setItem('eon-escort', JSON.stringify(baton)); } catch {}
    this._setSessionFlag('eon-standup-shown');     // don't auto-rerun after we land
    setTimeout(() => { try { location.href = item.pointTo; } catch {} }, 650);
  }

  _resumeEscort() {
    let t = null; try { t = JSON.parse(sessionStorage.getItem('eon-escort') || 'null'); } catch {}
    if (!t || t.page !== this.pageFile) return;
    try { sessionStorage.removeItem('eon-escort'); } catch {}
    let tries = 0;
    const tick = () => {
      const el = this._findRecordEl(t);
      if (el) {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
        this.ctx.hypeBusy = true;
        setTimeout(() => { this.esc = { phase: 'land', el, item: { line: t.line }, until: Date.now() + LAND_MS }; }, 500);
        return;
      }
      if (++tries < 22) setTimeout(tick, 400);
    };
    setTimeout(tick, 700);
  }

  // ---------------- lookups ----------------
  _entityPage(item) {
    const known = ['opportunities', 'tasks', 'documents', 'achievements', 'projects', 'research', 'contacts'];
    if (known.includes(item.entity)) return `${item.entity}.html`;
    return this._pageFile(item.pointTo);
  }
  _entityLabel(item) {
    const m = { opportunities: 'opportunities', tasks: 'tasks', documents: 'documents',
      achievements: 'achievements', projects: 'projects', research: 'research', contacts: 'contacts' };
    return m[item.entity] || (item.entity || 'records');
  }
  _pageFile(url) { return String(url || '').split('?')[0].split('/').pop() || ''; }
  _findSidebarLink(page) {
    if (!page) return null;
    return document.querySelector(`#sidebar a[href$="${page}"], .side-nav a[href$="${page}"]`);
  }
  _findRecordEl(t) {
    if (t.record) {
      const rec = String(t.record).replace(/["\\]/g, '\\$&');
      const byId = document.querySelector(`[data-id="${rec}"], [href*="id=${rec}"], #record-${rec}`);
      if (byId) return byId;
    }
    return document.querySelector('#oppDetail, .page-wrap .card, .page-wrap, main, #app') || document.body;
  }

  // ---------------- geometry / flourish ----------------
  _navTarget(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    const cy = r.top + r.height / 2;
    const cx = r.left < innerWidth / 2 ? r.right + 48 : r.left - 48;
    return this.ctx.screenToWorld(cx, cy);
  }
  _face(el) {
    try {
      const r = el.getBoundingClientRect();
      const elx = r.left + r.width / 2;
      const eonx = this.ctx.character.root.position.x + innerWidth / 2;
      this.ctx.character.face(elx >= eonx ? 1 : -1);
    } catch {}
  }
  _highlight(el) {
    try {
      el.animate([{ boxShadow: '0 0 0 0 rgba(31,109,255,0)' },
        { boxShadow: '0 0 0 4px rgba(31,109,255,0.45)' },
        { boxShadow: '0 0 0 0 rgba(31,109,255,0)' }], { duration: 1400, easing: 'ease-out' });
    } catch {}
  }

  // ---------------- DOM ----------------
  _injectStyle() {
    if (document.getElementById('eon-board-style')) return;
    const s = document.createElement('style'); s.id = 'eon-board-style';
    s.textContent = `
      #eon-board{position:fixed;right:16px;bottom:66px;z-index:2147483600;width:330px;max-width:calc(100vw - 32px);
        background:#fff;color:#10225e;border-radius:16px;box-shadow:0 16px 44px rgba(16,34,94,.26);
        border:1.5px solid #1f6dff33;opacity:0;transform:translateY(8px);pointer-events:none;
        transition:opacity .2s ease,transform .2s ease;font:500 13.5px/1.4 system-ui,sans-serif;overflow:hidden}
      #eon-board.show{opacity:1;transform:none;pointer-events:auto}
      #eon-board .eb-h{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#10225e;color:#fff}
      #eon-board .eb-h b{font-size:13px;letter-spacing:.3px}
      #eon-board .eb-prog{margin-left:auto;font-size:11px;opacity:.8}
      #eon-board .eb-x{cursor:pointer;opacity:.7;font-size:15px;line-height:1}
      #eon-board .eb-x:hover{opacity:1}
      #eon-board .eb-body{padding:14px;font-weight:600;color:#16203a;min-height:42px}
      #eon-board .eb-btns{display:flex;gap:7px;padding:0 14px 14px}
      #eon-board button{flex:1;border:0;border-radius:10px;padding:8px 6px;cursor:pointer;font:700 12.5px system-ui}
      #eon-board .eb-go{background:#1f6dff;color:#fff}
      #eon-board .eb-go:hover{background:#1559d8}
      #eon-board .eb-l{background:#eef1f7;color:#52607a}
      #eon-board .eb-l:hover{background:#e2e7f2}
      #eon-board .eb-d{background:#fff0f0;color:#c0392b}
      #eon-board .eb-d:hover{background:#ffe2e2}`;
    document.head.appendChild(s);
  }
  _buildBoard() {
    if (document.getElementById('eon-board')) { this._board = document.getElementById('eon-board'); return; }
    const el = document.createElement('div'); el.id = 'eon-board';
    el.innerHTML = `
      <div class="eb-h">🧠 <b>EON · Standup</b><span class="eb-prog"></span><span class="eb-x" title="Close">✕</span></div>
      <div class="eb-body"></div>
      <div class="eb-btns">
        <button class="eb-go">Show me</button>
        <button class="eb-l">Later</button>
        <button class="eb-d">Dismiss</button>
      </div>`;
    document.body.appendChild(el);
    this._board = el;
    this._boardLine = el.querySelector('.eb-body');
    this._boardProg = el.querySelector('.eb-prog');
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
    el.querySelector('.eb-go').onclick = stop(() => this._showMe());
    el.querySelector('.eb-l').onclick = stop(() => this._later());
    el.querySelector('.eb-d').onclick = stop(() => this._dismiss());
    el.querySelector('.eb-x').onclick = stop(() => { this._hideBoard(); this._present(false); });
  }
  _hideBoard() { this._board?.classList.remove('show'); }

  // ---------------- session flags ----------------
  _sessionFlag(k) { try { return sessionStorage.getItem(k) === '1'; } catch { return false; } }
  _setSessionFlag(k) { try { sessionStorage.setItem(k, '1'); } catch {} }
}
