/* ============================================================
   EON — activity-engine.js
   EON's autonomous "life". He decides what to do on his OWN —
   wandering anywhere, sipping tea, reading, laughing, dancing,
   stretching, looking around, napping — independent of what the
   user is doing. He is NOT a work-follower; he has his own mood.

   The 🏠 button sets `ctx.stayHome`, which simply keeps his roaming
   confined to the bottom-right corner (he still does his own thing
   there). No house graphic is involved.
   ============================================================ */

// Weighted pool of things EON might autonomously decide to do.
// move:true  → first stroll to a random spot, then do it there.
// move:false → do it right where he is.
const LIFE = [
  { s: 'idle',     move: true,  min: 3,  max: 7,  w: 3 },
  { s: 'drinkTea', move: true,  min: 6,  max: 10, w: 3, say: 'Tea time. 🍵' },
  { s: 'read',     move: true,  min: 7,  max: 12, w: 3 },
  { s: 'work',     move: true,  min: 6,  max: 10, w: 2 },
  { s: 'laugh',    move: false, min: 2,  max: 3,  w: 2, say: 'hehe 😄' },
  { s: 'dance',    move: true,  min: 4,  max: 6,  w: 1, say: '🎶' },
  { s: 'stretch',  move: false, min: 2,  max: 3,  w: 2 },
  { s: 'curious',  move: true,  min: 2,  max: 4,  w: 2 },   // look around
  { s: 'wave',     move: false, min: 2,  max: 2,  w: 1 },
  { s: 'sleep',    move: true,  min: 12, max: 22, w: 1, say: 'getting sleepy… 💤' },
];

export class ActivityEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.lastActive = performance.now();
    this.phase = 'active';                       // kept for save/resume compat
    this.until = performance.now() + 4500;       // let the entrance play first
    this._arriveCb = null;
  }

  /** Light touch — we just note it. EON does NOT chase user activity. */
  notifyActivity(now = performance.now()) { this.lastActive = now; }

  _pick() {
    const total = LIFE.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * total;
    for (const a of LIFE) { if ((r -= a.w) <= 0) return a; }
    return LIFE[0];
  }

  /** A random destination — anywhere, or just the corner when home-locked. */
  _roamPoint() {
    const b = this.ctx.nav.bounds();
    if (this.ctx.stayHome) {
      const cx = b.maxX - 70, cy = b.minY + 40;
      return [cx + (Math.random() - 0.5) * 130, cy + (Math.random() - 0.5) * 80];
    }
    return [b.minX + Math.random() * (b.maxX - b.minX),
            b.minY + Math.random() * (b.maxY - b.minY)];
  }

  update(dt, now = performance.now()) {
    const { nav, character, ai } = this.ctx;
    if (nav.moving) return;            // strolling somewhere — let him arrive
    if (now < this.until) return;      // mid-activity — let him enjoy it

    const act = this._pick();
    const dur = (act.min + Math.random() * (act.max - act.min)) * 1000;
    this.until = now + dur + (act.move ? 3500 : 0);   // + buffer for walking
    if (act.say && ai && Math.random() < 0.55) ai.speak(act.say);

    if (act.move) {
      const [x, y] = this._roamPoint();
      nav.goTo(x, y);
      this._whenArrived(() => character.setState(act.s));
    } else {
      character.setState(act.s);
    }
  }

  /** Run cb once the navigator reaches its current target. */
  _whenArrived(cb) { this._arriveCb = cb; }

  /** main loop calls this after nav.update so arrival callbacks fire. */
  onNavTick() {
    if (this._arriveCb && this.ctx.nav.atTarget()) {
      const cb = this._arriveCb; this._arriveCb = null; cb();
    }
  }
}
