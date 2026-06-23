/* ============================================================
   EON — ai-core.js
   The "brain": state persistence (PHP → localStorage fallback),
   speech-bubble messaging, lightweight memory/affection, and the
   forward-compatible think() hook that will call a real LLM in
   later roadmap phases. All network calls degrade gracefully.
   ============================================================ */

const SMART_MESSAGES = [
  'Working hard today?', 'Nice work.', 'Don’t forget to save.',
  'Need a short break?', 'Welcome back.', 'Great job.',
  'I’m right here if you need me.', 'Looking good so far.',
];

export class AiCore {
  constructor(ctx) {
    this.ctx = ctx;
    this.base = ctx.config._base;            // module base URL
    this.key = this._userKey();
    this.bubble = null;                      // { text, until }
    this._saveTimer = null;
    this.memory = {
      firstSeen: null, visits: 0, affection: 0,
      lastEmotion: 'happy', activities: 0,
    };
    this._lastAmbient = performance.now();
  }

  _userKey() {
    let k = localStorage.getItem('eon-user-key');
    if (!k) {
      k = 'u-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('eon-user-key', k);
    }
    return k;
  }

  // -------------------- persistence --------------------
  async loadState() {
    // 1) Try PHP backend.
    try {
      const r = await fetch(`${this.base}php/load-state.php?key=${encodeURIComponent(this.key)}`,
        { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j.found && j.state) { this._apply(j.state); return j.state; }
      }
    } catch { /* PHP not available — fall through */ }

    // 2) localStorage fallback.
    try {
      const raw = localStorage.getItem('eon-state-' + this.key);
      if (raw) { const s = JSON.parse(raw); this._apply(s); return s; }
    } catch { /* ignore */ }
    return null;
  }

  _apply(state) {
    // Merge persisted memory only; visit counting happens in main on a fresh
    // visit so page-to-page navigation doesn't inflate the count.
    if (state.memory) Object.assign(this.memory, state.memory);
  }

  /** Full snapshot used to resume EON seamlessly across page navigation. */
  collect() {
    const { nav, emotion, activity, character } = this.ctx;
    return {
      memory: this.memory,
      live: {
        emotion: emotion?.current ?? 'happy',
        phase: activity?.phase ?? 'active',
        // ms of idleness at save time, so the next page continues the ladder
        idleElapsed: activity ? Math.max(0, performance.now() - activity.lastActive) : 0,
        stayHome: !!this.ctx.stayHome,
        pos: { x: nav?.x ?? 0, y: nav?.y ?? 0 },
        charState: character?.state ?? 'idle',
      },
      lastSeen: Date.now(),
      savedAt: new Date().toISOString(),
    };
  }

  /** Debounced save (PHP first, localStorage always as a safety net). */
  saveState(immediate = false) {
    const doSave = async () => {
      const state = this.collect();
      try { localStorage.setItem('eon-state-' + this.key, JSON.stringify(state)); } catch {}
      try {
        await fetch(`${this.base}php/save-state.php`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: this.key, state }), keepalive: true,
        });
      } catch { /* offline / static host — localStorage already holds it */ }
    };
    clearTimeout(this._saveTimer);
    if (immediate) return doSave();
    this._saveTimer = setTimeout(doSave, 1500);
  }

  // -------------------- speech --------------------
  speak(text, ttl = 3200) {
    if (!this.ctx.config.features.speech) return;
    if (this.ctx.stayHome || this.ctx.focus) return;   // quiet when parked / in Focus mode
    this.bubble = { text, until: performance.now() + ttl };
  }

  /** Occasionally surface a gentle, non-intrusive ambient message. */
  maybeAmbient(now = performance.now()) {
    if (now - this._lastAmbient < 90 * 1000) return;   // at most ~every 90s
    if (this.bubble && now < this.bubble.until) return;
    if (Math.random() > 0.5) return;                   // and only sometimes
    this._lastAmbient = now;
    // half the time, use a personality-flavored line; otherwise a smart tip.
    let msg;
    const p = this.ctx.personality;
    if (p && Math.random() < 0.5) msg = p.line('idle');
    else { msg = SMART_MESSAGES[Math.floor(Math.random() * SMART_MESSAGES.length)]; if (this.memory.visits > 1 && Math.random() < 0.3) msg = 'Welcome back.'; }
    this.speak(msg);
  }

  // -------------------- memory / affection --------------------
  bumpAffection() {
    this.memory.affection = Math.min(100, (this.memory.affection || 0) + 1);
    this.memory.activities++;
    this.saveState();
  }

  // -------------------- future LLM hook (Phase 2-6) --------------------
  async think(message, context = {}) {
    try {
      const r = await fetch(`${this.base}api/future-ai-endpoints.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'chat', message, context }),
      });
      if (r.ok) return await r.json();
    } catch { /* not wired yet */ }
    return { ok: false, reply: 'Still learning — but I’m here. 🌱', emotion: 'curious' };
  }
}
