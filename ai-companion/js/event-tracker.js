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

    // ---- Click anywhere: poke EON if it's near him, else just watch ----
    // The overlay never blocks the page, so we detect "clicked EON" by distance.
    this._on(window, 'click', (e) => {
      activity.notifyActivity();
      const eonScreen = project(character.headAnchor);
      const dist = Math.hypot(e.clientX - eonScreen.x, e.clientY - eonScreen.y);
      if (dist < 55) { this._pokeEon(); return; }       // clicked on EON
      character.face(e.clientX > eonScreen.x ? 1 : -1);  // just glance toward it
    });

    // ---- Typing: EON does NOT follow your work; just notes activity ----
    this._on(window, 'input', () => activity.notifyActivity());

    // ---- Form submit: a quick shared celebration (he notices wins) ----
    this._on(window, 'submit', () => {
      activity.notifyActivity();
      emotion.react('celebrating', { priority: 3 });
    });

    // ---- Scroll: just note activity (he keeps living his own life) ----
    this._on(window, 'scroll', () => activity.notifyActivity());

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

  _pokeEon() {
    const { emotion, character, activity, ai, particles } = this.ctx;
    activity.notifyActivity();
    const reactions = ['waving', 'excited', 'happy', 'proud', 'thinking', 'celebrating'];
    const pick = reactions[Math.floor(Math.random() * reactions.length)];
    if (pick === 'happy') character.setState('dance');
    else emotion.react(pick, { priority: 2 });
    particles?.heart(character._worldHead(0, 0.7));
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
