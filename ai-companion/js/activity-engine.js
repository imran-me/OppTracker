/* ============================================================
   EON — activity-engine.js
   Owns EON's "life": the idle ladder (go home -> relax -> sleep),
   the random-life loop (tea, read, dance, water plants…), and
   waking/greeting when the user returns. Drives navigation via
   the pathfinding Navigator.
   ============================================================ */

// dur = [min, max] seconds he stays absorbed in the activity (longer = calmer).
const RANDOM_LIFE = [
  { state: 'drinkTea',   atHome: true,  weight: 4, dur: [14, 24], bubble: 'Tea break. 🍵' },
  { state: 'read',       atHome: true,  weight: 4, dur: [18, 30] },
  { state: 'work',       atHome: true,  weight: 3, dur: [14, 24] },
  { state: 'dance',      atHome: false, weight: 1, dur: [5, 8],   bubble: '🎶' },
  { state: 'stretch',    atHome: false, weight: 2, dur: [3, 5] },
  { state: 'brushTeeth', atHome: true,  weight: 1, dur: [5, 8] },
  { state: 'think',      atHome: false, weight: 2, dur: [6, 10] },
];

export class ActivityEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.lastActive = performance.now();
    this.nextDecision = performance.now() + 9000;  // settle after the entrance
    this.phase = 'active';   // active | home | relaxing | sleeping
    this.busyUntil = 0;      // don't interrupt a chosen activity early
  }

  /** A relaxed destination biased to the edges + lower area, so EON mostly
      keeps to the sides and rarely strolls across the user's content. */
  _goRoam() {
    const nav = this.ctx.nav, b = nav.bounds();
    const span = b.maxX - b.minX;
    const x = Math.random() < 0.5
      ? b.minX + Math.random() * span * 0.32          // left edge band
      : b.maxX - Math.random() * span * 0.32;         // right edge band
    const y = b.minY + Math.random() * (b.maxY - b.minY) * 0.5;   // lower half
    nav.goTo(x, y);
  }

  /** Called by the event-tracker on ANY user interaction. */
  notifyActivity(now = performance.now()) {
    const wasAway = this.phase !== 'active';
    this.lastActive = now;

    if (wasAway) {
      // Wake + greet sequence.
      const { character, nav, emotion, home } = this.ctx;
      home?.setActive(true);
      if (this.phase === 'sleeping') {
        character.setState('wakeUp', () => {
          character.setState('stretch', () => emotion.react('waving', { priority: 2 }));
        });
      } else {
        emotion.react('waving', { priority: 2 });
      }
      // Stroll back toward the user — unless home-locked, then stay put.
      if (this.ctx.stayHome) nav.goHome(); else nav.wander();
      this.phase = this.ctx.stayHome ? 'home' : 'active';
      this.busyUntil = now + 2500;
    }
  }

  _pickLife() {
    const total = RANDOM_LIFE.reduce((s, a) => s + a.weight, 0);
    let r = Math.random() * total;
    for (const a of RANDOM_LIFE) { if ((r -= a.weight) <= 0) return a; }
    return RANDOM_LIFE[0];
  }

  update(dt, now = performance.now()) {
    const { idle } = this.ctx.config;
    const since = now - this.lastActive;
    const { character, nav, ai, home, emotion } = this.ctx;

    // Home-lock: EON sits at home and never wanders or climbs the idle ladder.
    if (this.ctx.stayHome) { this.phase = 'home'; return; }

    // Don't reshuffle while mid-activity or while walking somewhere.
    const busy = now < this.busyUntil || nav.moving;

    // ---- idle ladder ----
    if (since > idle.sleep && this.phase !== 'sleeping') {
      this.phase = 'sleeping';
      nav.goHome();
      home?.setActive(true);
      this._whenArrived(() => { character.setState('sleep'); home?.setSleeping(true); });
      return;
    }
    if (since > idle.activity && this.phase === 'home') {
      this.phase = 'relaxing';
      const act = this._pickLife();
      this._whenArrived(() => {
        character.setState(act.atHome ? act.state : 'idle');
        if (act.bubble) ai?.speak(act.bubble);
      });
      this.busyUntil = now + 8000;
      return;
    }
    if (since > idle.goHome && this.phase === 'active') {
      this.phase = 'home';
      nav.goHome();
      home?.show(true);
      this._whenArrived(() => { character.setState('idle'); });
      return;
    }

    // ---- autonomous life while active & not busy (relaxed pacing) ----
    if (this.phase === 'active' && !busy && now > this.nextDecision) {
      const roll = Math.random();
      if (roll < 0.6) {
        // settle into an activity and stay absorbed in it for a good while
        const act = this._pickLife();
        const dur = (act.dur[0] + Math.random() * (act.dur[1] - act.dur[0])) * 1000;
        if (act.atHome) { nav.goHome(); this._whenArrived(() => character.setState(act.state)); }
        else { this._goRoam(); this._whenArrived(() => character.setState(act.state)); }
        if (act.bubble && Math.random() < 0.55) ai?.speak(act.bubble);
        this.busyUntil = now + dur + 4500;                               // + walking buffer
        this.nextDecision = this.busyUntil + 10000 + Math.random() * 25000; // rest, then reconsider
      } else if (roll < 0.72) {
        this._goRoam();                                                  // occasional quiet stroll
        this.nextDecision = now + 35000 + Math.random() * 40000;
      } else {
        character.setState('idle');                                     // often just chill in place
        this.nextDecision = now + 30000 + Math.random() * 45000;
      }
    }

    // Hide the home once EON wanders away while active.
    if (this.phase === 'active' && home && nav.x < nav.bounds().maxX - 120) {
      home.setSleeping(false);
      home.show(false);
    }
  }

  /** Run cb once the navigator reaches its current target. */
  _whenArrived(cb) {
    this._arriveCb = cb;
  }

  /** main loop calls this after nav.update so arrival callbacks fire. */
  onNavTick() {
    if (this._arriveCb && this.ctx.nav.atTarget()) {
      const cb = this._arriveCb; this._arriveCb = null; cb();
    }
  }
}
