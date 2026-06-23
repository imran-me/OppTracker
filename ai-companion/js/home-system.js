/* ============================================================
   EON — home-system.js
   Builds EON's cozy corner house (DOM/CSS) and runs its ambience:
   day/night sky through the window, rain, TV/lamp on while EON is
   home. EON (3D) walks in front of it; this is the backdrop.
   ============================================================ */

export class HomeSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.el = null;
    this._lastClock = 0;
  }

  mount(layer) {
    if (!this.ctx.config.features.home) return;
    const el = document.createElement('div');
    el.id = 'eon-home';
    el.innerHTML = `
      <div class="home-dim"></div>
      <div class="home-window"><div class="rain"></div></div>
      <div class="furn tv"></div>
      <div class="furn shelf"></div>
      <div class="furn bed"></div>
      <div class="furn sofa"></div>
      <div class="furn tea"></div>
      <div class="furn lamp"></div>
      <div class="furn plant"></div>
      <div class="home-name">EON · HOME</div>`;
    layer.appendChild(el);
    this.el = el;
    this.updateClock(true);
  }

  show(v = true) { this.el?.classList.toggle('show', v); }

  /** Lamp + TV glow while EON is home/awake. */
  setActive(on) {
    if (!this.el) return;
    this.el.querySelector('.tv')?.classList.toggle('on', on);
  }

  setSleeping(sleeping) {
    if (!this.el) return;
    this.show(true);
    this.el.querySelector('.tv')?.classList.toggle('on', !sleeping);
    // Force a night-dim feel while sleeping regardless of clock.
    this.el.classList.toggle('is-sleeping', sleeping);
  }

  /** Day/night by real local time + occasional rain. */
  updateClock(force = false) {
    if (!this.el || !this.ctx.config.features.dayNight) return;
    const now = Date.now();
    if (!force && now - this._lastClock < 60 * 1000) return; // once a minute
    this._lastClock = now;

    const h = new Date().getHours();
    const time = h >= 5 && h < 11 ? 'morning'
               : h >= 11 && h < 17 ? 'day'
               : h >= 17 && h < 20 ? 'evening' : 'night';
    this.el.setAttribute('data-time', time);

    // light, occasional rain
    if (Math.random() < 0.15) this.el.classList.add('raining');
    else if (Math.random() < 0.4) this.el.classList.remove('raining');
  }

  update() { this.updateClock(); }
}
