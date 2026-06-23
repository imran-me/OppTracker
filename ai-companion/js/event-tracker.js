/* ============================================================
   EON — event-tracker.js
   Observes the host app and the pointer, turning them into EON
   reactions: gaze, click-by-body-part, drag/flail/drop, high-five,
   long-press, secret combo, toast reactions. Passive/capture
   listeners; never calls preventDefault — the app is unaffected.
   ============================================================ */

export class EventTracker {
  constructor(ctx) {
    this.ctx = ctx;
    this._bound = [];
    this._lastMove = 0;
    this._typingTimer = null;
    this._press = null;          // active mouse press on EON
    this._suppressClick = false; // set after a drag so the click doesn't poke
    this._clicks = [];           // recent click timestamps (rapid detection)
    this._secret = 0;            // total clicks on EON (50 = easter egg)
    this._lastHi5 = 0;
    this._mv = { x: 0, y: 0, t: 0 };
  }

  _on(target, type, fn, opts = { passive: true, capture: true }) {
    target.addEventListener(type, fn, opts);
    this._bound.push(() => target.removeEventListener(type, fn, opts));
  }

  /** Hit-test the pointer against EON's body; returns {on, frac, head, feet}. */
  _hit(x, y) {
    const { character, project } = this.ctx;
    const head = project(character.headAnchor);
    const feet = project(character.root);
    const span = Math.max(24, feet.y - head.y);
    const on = Math.abs(x - head.x) < span * 0.45 && y > head.y - 18 && y < feet.y + 18;
    const frac = (y - head.y) / span;     // 0 = top of head … 1 = feet
    return { on, frac, head, feet };
  }

  start() {
    const { emotion, activity, character, screenToLook, nav } = this.ctx;
    this.ctx.drag = this.ctx.drag || { active: false, x: 0, y: 0 };

    // ---- Mouse move: gaze + drag + high-five detection ----
    this._on(window, 'mousemove', (e) => {
      const now = performance.now();
      // velocity (for high-five)
      const dtm = Math.max(1, now - this._mv.t);
      const vy = (e.clientY - this._mv.y) / dtm;
      this._mv = { x: e.clientX, y: e.clientY, t: now };

      if (now - this._lastMove > 28) { this._lastMove = now; character.lookAt(screenToLook(e.clientX, e.clientY)); }

      // start a drag once the press moves enough
      if (this._press && !this._press.dragging) {
        if (Math.hypot(e.clientX - this._press.x, e.clientY - this._press.y) > 6) {
          clearTimeout(this._press.lp);
          this._press.dragging = true;
          this.ctx.drag.active = true;
          character.setState('curious');
        }
      }
      if (this.ctx.drag.active && this._press) {
        const w = this.ctx.screenToWorld(e.clientX, e.clientY);
        this.ctx.drag.x = w.x; this.ctx.drag.y = w.y;
      }

      // high-five: a quick upward flick of the cursor over EON → jump
      if (!this._press && vy < -1.6 && now - this._lastHi5 > 1500) {
        const h = this._hit(e.clientX, e.clientY);
        if (h.on) { this._lastHi5 = now; emotion.react('excited', { priority: 2, speak: false }); this.ctx.particles?.heart(character._worldHead(0, 0.7)); }
      }
    }, { passive: true, capture: false });

    // ---- Mouse down on EON: begin press (→ long-press or drag) ----
    this._on(window, 'mousedown', (e) => {
      const h = this._hit(e.clientX, e.clientY);
      if (!h.on) return;
      this._press = { x: e.clientX, y: e.clientY, dragging: false };
      // long-press (held still) → curl up to sleep
      this._press.lp = setTimeout(() => {
        if (this._press && !this._press.dragging) { character.setState('sleep'); this._suppressClick = true; }
      }, 700);
    }, { passive: true, capture: false });

    // ---- Mouse up: end drag → drop + sulk ----
    this._on(window, 'mouseup', () => {
      if (this._press) clearTimeout(this._press.lp);
      if (this._press && this._press.dragging) {
        this.ctx.drag.active = false;
        this._suppressClick = true;
        activity.startSulk();                 // dropped → sulk, then sleep
        this.ctx.particles?.footstep(character.worldFeet());
      }
      this._press = null;
    }, { passive: true, capture: false });

    // ---- Double-click EON: wake / snap out of sulk ----
    this._on(window, 'dblclick', (e) => {
      if (this._hit(e.clientX, e.clientY).on) {
        activity.wake();
        character.setState('wakeUp', () => emotion.react('waving', { priority: 2, speak: false }));
      }
    }, { passive: true, capture: false });

    // ---- Click: react by body part (unless that was a drag) ----
    this._on(window, 'click', (e) => {
      activity.notifyActivity();
      if (this._suppressClick) { this._suppressClick = false; return; }
      const h = this._hit(e.clientX, e.clientY);
      if (h.on) { this._pokeEon(h.frac); return; }
      character.face(e.clientX > h.head.x ? 1 : -1);
    });

    // ---- Typing: follow the field ONLY in Follow mode ----
    this._on(window, 'input', (e) => {
      activity.notifyActivity();
      const follow = this.ctx.followMode !== false && !this.ctx.stayHome && !this.ctx.focus;
      const el = e.target;
      if (follow && el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        const r = el.getBoundingClientRect();
        const w = this.ctx.screenToWorld(r.left, r.top + r.height / 2);
        nav.goTo(w.x - 40, w.y);
        character.setState('think');
        clearTimeout(this._typingTimer);
        this._typingTimer = setTimeout(() => { if (character.state === 'think') character.setState('idle'); }, 1500);
      }
    });

    // ---- Form submit: celebration ----
    this._on(window, 'submit', () => { activity.notifyActivity(); emotion.react('celebrating', { priority: 3 }); });

    // ---- Scroll: occasional stroll + "slips" on a very fast scroll ----
    this._on(window, 'scroll', () => {
      activity.notifyActivity();
      const now = performance.now();
      const sy = window.scrollY || 0;
      const v = Math.abs(sy - (this._lastScrollY || sy)) / Math.max(1, now - (this._lastScrollT || now));
      this._lastScrollY = sy; this._lastScrollT = now;
      if (v > 3 && now - (this._lastSlip || 0) > 4000 && !this.ctx.stayHome && !this.ctx.focus) {
        this._lastSlip = now; character.setState('confused');   // wobble/slip
      } else if (!this.ctx.stayHome && !this.ctx.focus && Math.random() < 0.18) {
        nav.wander();
      }
    });

    // ---- Tab focus ----
    this._on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') activity.notifyActivity();
    }, { capture: false });

    this._watchNotifications();
  }

  _pokeEon(frac) {
    const { emotion, character, ai, particles, personality } = this.ctx;
    const now = performance.now();
    personality?.nudge(2);

    // secret: 50 clicks in a row → hidden party
    if (++this._secret >= 50) {
      this._secret = 0;
      emotion.react('celebrating', { priority: 3 });
      for (let i = 0; i < 6; i++) particles?.heart(character._worldHead((Math.random() - 0.5), 0.7));
      ai?.speak('🎉 You found my secret! 🎉');
      return;
    }

    // rapid clicking → dizzy / playfully annoyed
    this._clicks = this._clicks.filter((tm) => now - tm < 1200); this._clicks.push(now);
    if (this._clicks.length >= 4) { this._clicks = []; emotion.react('confused', { priority: 3 }); particles?.think(character._worldHead(0.2, 0.6)); return; }

    // tapped while sleeping → groggy half-wake
    if (character.state === 'sleep') { character.setState('wakeUp'); return; }

    if (frac > 0.7) character.setState('dance');                                   // legs/feet → dance
    else if (frac > 0.45) emotion.react('celebrating', { priority: 2, speak: false }); // belly → tickle
    else { if (Math.random() < 0.5) character.setState('wink'); else emotion.react('waving', { priority: 2, speak: false }); } // head/face

    particles?.heart(character._worldHead(0, 0.65));
    ai?.bumpAffection();
  }

  _watchNotifications() {
    const { emotion } = this.ctx;
    const classify = (node) => {
      if (!(node instanceof HTMLElement)) return null;
      const s = (node.className + ' ' + (node.getAttribute('role') || '')).toLowerCase();
      const txt = (node.textContent || '').toLowerCase();
      if (/success|saved|done|complete/.test(s) || /success|saved|✓/.test(txt)) return 'success';
      if (/danger|error|fail|invalid/.test(s) || /error|failed|invalid/.test(txt)) return 'error';
      if (/toast|alert|notification|snackbar/.test(s)) return 'info';
      return null;
    };
    const obs = new MutationObserver((muts) => {
      for (const m of muts) for (const node of m.addedNodes) {
        const kind = classify(node);
        if (kind === 'success') emotion.react('celebrating', { priority: 3 });
        else if (kind === 'error') emotion.react('confused', { priority: 3 });
        else if (kind === 'info') emotion.react('curious', { priority: 1, speak: false });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    this._bound.push(() => obs.disconnect());
  }

  stop() { this._bound.forEach((off) => off()); this._bound = []; }
}
