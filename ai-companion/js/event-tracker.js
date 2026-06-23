/* ============================================================
   EON — event-tracker.js
   Non-intrusively observes the host ERP and turns user actions
   into EON reactions. Every listener is passive/capture and NEVER
   calls preventDefault — the app keeps working exactly as before.
   ============================================================ */

export class EventTracker {
  constructor(ctx) {
    this.ctx = ctx;
    this._bound = [];
    this._lastMove = 0;
    this._typingTimer = null;
  }

  _on(target, type, fn, opts = { passive: true, capture: true }) {
    target.addEventListener(type, fn, opts);
    this._bound.push(() => target.removeEventListener(type, fn, opts));
  }

  start() {
    const { emotion, activity, character, screenToLook, nav, project } = this.ctx;

    // ---- Mouse move: eyes + head follow cursor ----
    this._on(window, 'mousemove', (e) => {
      const now = performance.now();
      this._lastMouse = { x: e.clientX, y: e.clientY };
      if (now - this._lastMove < 30) return; // throttle
      this._lastMove = now;
      character.lookAt(screenToLook(e.clientX, e.clientY));
    });

    // ---- Click: react by the body part you tapped, else just glance ----
    // Overlay never blocks the page, so we detect "clicked EON" geometrically.
    this._on(window, 'click', (e) => {
      activity.notifyActivity();
      const head = project(character.headAnchor);    // top of head
      const feet = project(character.root);          // feet
      const cx = head.x, span = Math.max(24, feet.y - head.y);
      const onEon = Math.abs(e.clientX - cx) < span * 0.45 &&
                    e.clientY > head.y - 16 && e.clientY < feet.y + 16;
      if (onEon) { this._pokeEon(e.clientY, head.y, feet.y); return; }
      character.face(e.clientX > cx ? 1 : -1);        // glance toward the click
    });

    // ---- Typing: walk near input, watch, tilt head ----
    this._on(window, 'input', (e) => {
      activity.notifyActivity();
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        if (!this.ctx.stayHome) {                 // stay put when home-locked
          const r = el.getBoundingClientRect();
          // walk right up beside the field (just to its left, at its height)
          const w = this.ctx.screenToWorld(r.left, r.top + r.height / 2);
          nav.goTo(w.x - 40, w.y);
        }
        character.setState('think');
        clearTimeout(this._typingTimer);
        this._typingTimer = setTimeout(() => {
          if (character.state === 'think') character.setState('idle');
        }, 1500);
      }
    });

    // ---- Form submit: happy jump + celebration ----
    this._on(window, 'submit', () => {
      activity.notifyActivity();
      emotion.react('celebrating', { priority: 3 });
    });

    // ---- Scroll: stroll alongside the page ----
    this._on(window, 'scroll', () => {
      activity.notifyActivity();
      if (!this.ctx.stayHome && Math.random() < 0.25) nav.wander();
    });

    // ---- Tab focus / blur ----
    this._on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') activity.notifyActivity();
    }, { capture: false });

    // ---- Watch the app for success / error notifications (toasts) ----
    this._watchNotifications();
  }

  _isEon(node) {
    return node && node.closest && node.closest('#eon-layer');
  }

  _pokeEon(clickY, headY, feetY) {
    const { emotion, character, ai, particles } = this.ctx;
    const now = performance.now();

    // Rapid clicking → dizzy / playfully annoyed.
    this._clicks = (this._clicks || []).filter((tm) => now - tm < 1200);
    this._clicks.push(now);
    if (this._clicks.length >= 4) {
      this._clicks = [];
      emotion.react('confused', { priority: 3 });
      particles?.think(character._worldHead(0.2, 0.6));
      ai?.bumpAffection();
      return;
    }

    // Tapped while sleeping → groggy half-wake, then dozes off again.
    if (character.state === 'sleep') { character.setState('wakeUp'); ai?.bumpAffection(); return; }

    // Which body part? 0 = top of head … 1 = feet.
    const span = Math.max(24, feetY - headY);
    const frac = (clickY - headY) / span;
    if (frac > 0.7) {                         // legs / feet → break into a dance
      character.setState('dance');
    } else if (frac > 0.45) {                 // belly → ticklish laugh + confetti
      emotion.react('celebrating', { priority: 2, speak: false });
    } else {                                  // head / face → giggle or shy wink
      if (Math.random() < 0.5) character.setState('wink');
      else emotion.react('waving', { priority: 2, speak: false });
    }
    particles?.heart(character._worldHead(0, 0.65));
    ai?.bumpAffection();
  }

  /**
   * Observe DOM mutations for toast/alert nodes and react. Works with most
   * frameworks (Bootstrap toasts, .toast, [role=alert], .alert-success…).
   */
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
      for (const m of muts) {
        for (const node of m.addedNodes) {
          const kind = classify(node);
          if (kind === 'success') emotion.react('celebrating', { priority: 3 });
          else if (kind === 'error') emotion.react('confused', { priority: 3 });
          else if (kind === 'info') emotion.react('curious', { priority: 1, speak: false });
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    this._bound.push(() => obs.disconnect());
  }

  stop() { this._bound.forEach(off => off()); this._bound = []; }
}
