/* ============================================================
   EON — activity-engine.js
   Owns EON's "life": the idle ladder (go home -> relax -> sleep),
   the random-life loop (tea, read, dance, water plants…), and
   waking/greeting when the user returns. Drives navigation via
   the pathfinding Navigator.
   ============================================================ */

const RANDOM_LIFE = [
  { state: 'drinkTea',   atHome: true,  weight: 3, bubble: 'Tea break. 🍵' },
  { state: 'read',       atHome: true,  weight: 3 },
  { state: 'work',       atHome: true,  weight: 2 },
  { state: 'dance',      atHome: false, weight: 1, bubble: '🎶' },
  { state: 'stretch',    atHome: false, weight: 2 },
  { state: 'brushTeeth', atHome: true,  weight: 1 },
  { state: 'think',      atHome: false, weight: 2 },
];

export class ActivityEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.lastActive = performance.now();
    this.lastLifeTick = performance.now();
    this.phase = 'active';   // active | home | relaxing | sleeping
    this.busyUntil = 0;      // don't interrupt a chosen activity early
  }

  /** Called by the event-tracker on ANY user interaction. */
  notifyActivity(now = performance.now()) {
    this.lastActive = now;
    // Home-locked: he's parked on purpose — don't re-greet on every scroll/click
    // (that was making his speech bubble flicker).
    if (this.ctx.stayHome) { this.phase = 'home'; return; }
    const wasAway = this.phase !== 'active';

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

    // ---- random life while active & not busy ----
    if (this.phase === 'active' && !busy &&
        now - this.lastLifeTick > this.ctx.config.lifeTick) {
      this.lastLifeTick = now;
      if (Math.random() < 0.7) {
        const act = this._pickLife();
        if (act.atHome) { nav.goHome(); this._whenArrived(() => character.setState(act.state)); }
        else { nav.wander(); this._whenArrived(() => character.setState(act.state)); }
        if (act.bubble) ai?.speak(act.bubble);
        this.busyUntil = now + 6000;
      } else {
        nav.wander(); // just take a stroll
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
