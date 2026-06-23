/* ============================================================
   EON — ai-core.js
   Avatar persistence (Firestore for long-term memory; per-tab session
   for transient cross-page continuity), speech-bubble messaging,
   lightweight memory/affection, and a forward-compatible think() hook.
   EON's deadline/reminder MIND lives separately in eon-brain/.
   ============================================================ */

const SMART_MESSAGES = [
  'Working hard today?', 'Nice work.', 'Don’t forget to save.',
  'Need a short break?', 'Welcome back.', 'Great job.',
  'I’m right here if you need me.', 'Looking good so far.',
];

const OWNER_EMAIL = (typeof window !== 'undefined' && window.OWNER_EMAIL) || 'me.imran.personal@gmail.com';

export class AiCore {
  constructor(ctx) {
    this.ctx = ctx;
    this.bubble = null;                      // { text, until }
    this._saveTimer = null;
    this.memory = {
      firstSeen: null, visits: 0, affection: 0,
      lastEmotion: 'happy', activities: 0,
    };
    this._lastAmbient = performance.now();
  }

  // Firebase is loaded globally on every page (firebase-config.js).
  _fb() { return (typeof window !== 'undefined' && window.firebase && window.firebase.apps?.length) ? window.firebase : null; }
  _isOwner() {
    const fb = this._fb(); const u = fb?.auth().currentUser;
    return !!u && String(u.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase();
  }
  _avatarDoc() { return this._fb().firestore().collection('eon-brain').doc('avatar'); }

  // -------------------- persistence (Firebase + per-tab continuity) --------------------
  async loadState() {
    // long-term MEMORY lives in Firestore (visits / mood / affection)
    const fb = this._fb();
    if (fb) {
      try {
        const d = await this._avatarDoc().get();
        if (d.exists) { const s = d.data() || {}; if (s.memory) Object.assign(this.memory, s.memory); }
      } catch { /* offline — keep defaults */ }
    }
    // transient cross-page resume (which pose/spot) is per-tab session state,
    // not stored data — so it stays in sessionStorage (cheap, no Firestore writes).
    try {
      const raw = sessionStorage.getItem('eon-live');
      if (raw) { const live = JSON.parse(raw); return { memory: this.memory, live: live.live, lastSeen: live.lastSeen }; }
    } catch { /* ignore */ }
    return (this.memory.visits || this.memory.firstSeen) ? { memory: this.memory } : null;
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

  /** Save: transient resume → sessionStorage; long-term memory → Firestore (owner). */
  saveState(immediate = false) {
    const state = this.collect();
    // per-tab continuity (synchronous, always — survives page navigation)
    try { sessionStorage.setItem('eon-live', JSON.stringify({ live: state.live, lastSeen: state.lastSeen })); } catch {}

    const persistMemory = async () => {
      const fb = this._fb();
      if (!fb || !this._isOwner()) return;     // only the owner writes EON's memory
      try { await this._avatarDoc().set({ memory: state.memory, updatedAt: new Date().toISOString() }, { merge: true }); }
      catch { /* offline — sessionStorage already holds continuity */ }
    };
    clearTimeout(this._saveTimer);
    if (immediate) return persistMemory();
    this._saveTimer = setTimeout(persistMemory, 1500);
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
  // Reserved for later voice/chat; no backend wired in the Firebase build.
  async think() {
    return { ok: false, reply: 'Still learning — but I’m here. 🌱', emotion: 'curious' };
  }
}
