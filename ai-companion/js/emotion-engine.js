/* ============================================================
   EON — emotion-engine.js
   Translates high-level emotions into character states, badge
   glow and the occasional speech bubble. Emotions are transient
   "reactions" that auto-decay; the activity-engine owns the
   longer lifecycle (home / sleep / work).
   ============================================================ */

// emotion -> { state, glow, bubble? }
const EMOTIONS = {
  happy:       { state: 'idle',      glow: 0.7 },
  curious:     { state: 'think',     glow: 0.8,  bubbles: ['Ooh, what is this?', 'Interesting…'] },
  thinking:    { state: 'think',     glow: 0.9,  bubbles: ['Let me think…', 'Hmm…'] },
  working:     { state: 'work',      glow: 1.0 },
  excited:     { state: 'excited',   glow: 1.0,  bubbles: ['Yes!', 'Let’s go!'] },
  relaxing:    { state: 'drinkTea',  glow: 0.5,  bubbles: ['Tea time. 🍵'] },
  sleepy:      { state: 'sleep',     glow: 0.3 },
  celebrating: { state: 'celebrate', glow: 1.0,  bubbles: ['Great job!', 'Nailed it! 🎉', 'Woohoo!'] },
  confused:    { state: 'confused',  glow: 0.6,  bubbles: ['Hmm, something’s off.', 'That didn’t look right.'] },
  proud:       { state: 'proud',     glow: 0.9,  bubbles: ['Nice work.', 'Looking good.'] },
  waving:      { state: 'wave',      glow: 0.8,  bubbles: ['Hi there!', 'Hello! 👋', 'Welcome back!'] },
};

export class EmotionEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.current = 'happy';
    this.lockUntil = 0;     // ms timestamp; ignore weaker reactions until then
  }

  /** Trigger an emotional reaction. `priority` lets strong events override. */
  react(emotion, { priority = 1, speak = true, now = performance.now() } = {}) {
    const def = EMOTIONS[emotion];
    if (!def) return;
    if (now < this.lockUntil && priority < this._lockPriority) return;

    this.current = emotion;
    this._lockPriority = priority;
    this.lockUntil = now + (priority >= 2 ? 1800 : 600);

    const { character, ai } = this.ctx;
    character.setState(def.state);
    character.setBadgeGlow(def.glow);

    if (speak && def.bubbles && ai) {
      ai.speak(def.bubbles[Math.floor(Math.random() * def.bubbles.length)]);
    }
  }
}
