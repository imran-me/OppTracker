/* ============================================================
   EON — pathfinding.js
   EON lives on a 1-D "floor" line along the bottom of the screen,
   so navigation is horizontal steering with smooth arrival. This
   module owns target selection (wander / go-home / follow cursor)
   and the easing toward a target. Kept separate so a richer 2-D
   nav-mesh can replace it later without touching the controller.
   ============================================================ */

export class Navigator {
  /**
   * @param {object} opts
   *   bounds: () => ({minX, maxX, groundY})  world-space floor extents
   *   speed:  walk speed in world units / second
   */
  constructor(opts) {
    this.bounds = opts.bounds;
    this.speed = opts.speed ?? 140;
    this.x = 0;            // current position
    this.targetX = 0;      // desired position
    this.arriveEps = 3;    // "close enough" threshold
    this.moving = false;
    this.facing = 1;       // 1 = right, -1 = left
  }

  setX(x) { this.x = x; this.targetX = x; }

  /** Send EON to an absolute world X. */
  goTo(x) {
    const b = this.bounds();
    this.targetX = Math.max(b.minX, Math.min(b.maxX, x));
    this.moving = Math.abs(this.targetX - this.x) > this.arriveEps;
    if (this.moving) this.facing = this.targetX > this.x ? 1 : -1;
  }

  /** Pick a random reachable spot to stroll to. */
  wander() {
    const b = this.bounds();
    const span = b.maxX - b.minX;
    this.goTo(b.minX + 0.15 * span + Math.random() * 0.7 * span);
  }

  /** Walk to the home corner (right side). */
  goHome() {
    const b = this.bounds();
    this.goTo(b.maxX - 30);
  }

  atTarget() {
    return Math.abs(this.targetX - this.x) <= this.arriveEps;
  }

  /**
   * Step toward target. Returns true while actively walking so the
   * controller knows to play the walk animation.
   * @param {number} dt seconds
   */
  update(dt) {
    if (this.atTarget()) { this.moving = false; return false; }
    const dir = Math.sign(this.targetX - this.x);
    this.facing = dir;
    const step = this.speed * dt;
    if (Math.abs(this.targetX - this.x) <= step) {
      this.x = this.targetX;
      this.moving = false;
      return false;
    }
    this.x += dir * step;
    this.moving = true;
    return true;
  }
}
