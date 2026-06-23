/* ============================================================
   EON — pathfinding.js
   2-D free-roam navigation with simple physics: EON has velocity,
   accelerates from rest, eases to a stop near the target, and
   carries momentum — so he no longer glides at a constant speed.
   Exposes velocity/speed so the character can lean and time its
   steps to how fast it's actually moving.
   ============================================================ */

export class Navigator {
  /**
   * @param {object} opts
   *   bounds: () => ({minX,maxX,minY,maxY})  world-space roam box
   *   speed:  max speed (units / second)
   *   accel:  acceleration (units / second^2)
   */
  constructor(opts) {
    this.bounds = opts.bounds;
    this.maxSpeed = opts.speed ?? 150;
    this.accel = opts.accel ?? this.maxSpeed * 4.5;
    this.slowRadius = opts.slowRadius ?? 90;   // start easing to a stop here
    this.arriveEps = 4;
    this.x = 0; this.y = 0;       // position
    this.tx = 0; this.ty = 0;     // target
    this.vx = 0; this.vy = 0;     // velocity
    this.speed = 0;               // |velocity|
    this.moving = false;
    this.facing = 1;              // 1 right, -1 left
  }

  set(x, y) { this.x = x; this.y = y; this.tx = x; this.ty = y; this.vx = 0; this.vy = 0; this.speed = 0; this.moving = false; }

  _clamp(x, y) {
    const b = this.bounds();
    return [Math.max(b.minX, Math.min(b.maxX, x)), Math.max(b.minY, Math.min(b.maxY, y))];
  }

  goTo(x, y) { [this.tx, this.ty] = this._clamp(x, y); this.moving = this._dist() > this.arriveEps; }

  wander() {
    const b = this.bounds();
    this.goTo(b.minX + Math.random() * (b.maxX - b.minX), b.minY + Math.random() * (b.maxY - b.minY));
  }
  goHome() { const b = this.bounds(); this.goTo(b.maxX - 50, b.minY + 36); }

  _dist() { return Math.hypot(this.tx - this.x, this.ty - this.y); }
  /** Arrived only once he's basically stopped (so momentum can settle). */
  atTarget() { return this._dist() <= this.arriveEps && this.speed < 6; }

  /** Normalised speed 0..1 (for animation cadence / lean strength). */
  get speedN() { return Math.min(1, this.speed / this.maxSpeed); }

  update(dt) {
    const dx = this.tx - this.x, dy = this.ty - this.y;
    const dist = Math.hypot(dx, dy);

    // Settle: within the arrival radius, brake to a clean stop.
    if (dist <= this.arriveEps) {
      this.vx *= 0.5; this.vy *= 0.5;
      this.speed = Math.hypot(this.vx, this.vy);
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.speed < 3) { this.x = this.tx; this.y = this.ty; this.vx = this.vy = this.speed = 0; this.moving = false; return false; }
      this.moving = true; return true;
    }

    // Desired speed ramps down inside slowRadius for a soft arrival.
    let desired = this.maxSpeed;
    if (dist < this.slowRadius) desired = this.maxSpeed * (dist / this.slowRadius);
    const dirx = dx / dist, diry = dy / dist;
    const tvx = dirx * desired, tvy = diry * desired;

    // Accelerate velocity toward the target velocity (this is the momentum).
    const a = this.accel * dt;
    this.vx += Math.max(-a, Math.min(a, tvx - this.vx));
    this.vy += Math.max(-a, Math.min(a, tvy - this.vy));

    [this.x, this.y] = this._clamp(this.x + this.vx * dt, this.y + this.vy * dt);
    this.speed = Math.hypot(this.vx, this.vy);
    if (Math.abs(this.vx) > 4) this.facing = this.vx > 0 ? 1 : -1;
    this.moving = true;
    return true;
  }
}
