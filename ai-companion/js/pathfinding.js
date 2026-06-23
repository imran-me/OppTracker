/* ============================================================
   EON — pathfinding.js
   2-D free-roam navigation. EON can move to ANY point on screen
   (left/right, up/down, diagonal) with smooth arrival — he's a
   digital being, so floating is fine. Kept separate so a richer
   nav-mesh / obstacle avoidance can replace it later without
   touching the controller.
   ============================================================ */

export class Navigator {
  /**
   * @param {object} opts
   *   bounds: () => ({minX,maxX,minY,maxY})  world-space roam box
   *   speed:  units / second
   */
  constructor(opts) {
    this.bounds = opts.bounds;
    this.speed = opts.speed ?? 150;
    this.x = 0; this.y = 0;        // current position
    this.tx = 0; this.ty = 0;      // target
    this.arriveEps = 4;            // "close enough"
    this.moving = false;
    this.facing = 1;               // 1 right, -1 left (for sprite flip)
  }

  set(x, y) { this.x = x; this.y = y; this.tx = x; this.ty = y; this.moving = false; }

  _clamp(x, y) {
    const b = this.bounds();
    return [Math.max(b.minX, Math.min(b.maxX, x)),
            Math.max(b.minY, Math.min(b.maxY, y))];
  }

  /** Head to an absolute world point. */
  goTo(x, y) {
    [this.tx, this.ty] = this._clamp(x, y);
    this.moving = this._dist() > this.arriveEps;
    if (Math.abs(this.tx - this.x) > 2) this.facing = this.tx > this.x ? 1 : -1;
  }

  /** Random reachable spot anywhere in the roam box. */
  wander() {
    const b = this.bounds();
    this.goTo(b.minX + Math.random() * (b.maxX - b.minX),
              b.minY + Math.random() * (b.maxY - b.minY));
  }

  /** The home corner (bottom-right, where the house sits). */
  goHome() {
    const b = this.bounds();
    this.goTo(b.maxX - 50, b.minY + 36);
  }

  _dist() { return Math.hypot(this.tx - this.x, this.ty - this.y); }
  atTarget() { return this._dist() <= this.arriveEps; }

  /** Step toward target. Returns true while actively moving. */
  update(dt) {
    if (this.atTarget()) { this.moving = false; return false; }
    const dx = this.tx - this.x, dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1;
    const step = this.speed * dt;
    if (d <= step) { this.x = this.tx; this.y = this.ty; this.moving = false; return false; }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    this.moving = true;
    return true;
  }
}
