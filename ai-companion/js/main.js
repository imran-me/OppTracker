/* ============================================================
   EON — main.js  (module entry point)
   Boots the overlay, Three.js scene and every subsystem, then
   runs the 60 FPS loop. Drop into any page with:

     <script type="module" src="/ai-companion/js/main.js"></script>

   (an import-map providing "three" must be present — see index.php)
   ============================================================ */
import * as THREE from 'three';
import { ParticleSystem }     from './particle-system.js';
import { CharacterController } from './character-controller.js';
import { Navigator }          from './pathfinding.js';
import { EmotionEngine }      from './emotion-engine.js';
import { ActivityEngine }     from './activity-engine.js';
import { EventTracker }       from './event-tracker.js';
import { AiCore }             from './ai-core.js';
import { HomeSystem }         from './home-system.js';

// Front-end mirror of config/settings.php so EON works with no backend.
const DEFAULTS = {
  version: '1.0.0', name: 'EON',
  idle:     { goHome: 5 * 60000, activity: 10 * 60000, sleep: 20 * 60000 },
  lifeTick: 45000,
  palette: {
    ocean: '#1f6dff', blue: '#2f8bff', cyan: '#28c7d8', lime: '#7ed957',
    navy: '#10225e', violet: '#7b54e0', purple: '#b08ff0', white: '#eef4ff',
  },
  features: { pet: false, home: true, speech: true, particles: true, dayNight: true, sound: false },
};

class Eon {
  constructor() {
    // module base URL (works regardless of which page embeds EON)
    this._base = new URL('../', import.meta.url).href;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async boot() {
    if (document.getElementById('eon-layer')) return;          // already running

    this.config = await this._loadConfig();
    this.config._base = this._base;

    this._buildDom();
    this._buildScene();

    // ---- subsystems share one ctx object (filled below) ----
    const ctx = (this.ctx = { config: this.config });

    this.particles = new ParticleSystem(this.scene, this.config.palette);
    this.character = new CharacterController(this.scene, this.config.palette, {
      withPet: this.config.features.pet,
      scale: 42,
      // ── 3D model loading (disabled for now — using procedural EON) ──
      // To use the real model later, uncomment modelUrl and set targetPx/baseYaw:
      // modelUrl: `${this._base}assets/models/EPAL_EON_body_ar_v001.glb`,
      // targetPx: 110,
      // baseYaw: 0,
    });
    this.nav = new Navigator({ bounds: () => this._bounds(), speed: 150 });

    this.ai       = new AiCore(ctx);
    this.emotion  = new EmotionEngine(ctx);
    this.home     = new HomeSystem(ctx);
    this.activity = new ActivityEngine(ctx);
    this.tracker  = new EventTracker(ctx);

    // fill ctx with everything + helpers
    Object.assign(ctx, {
      stayHome: false,
      THREE, scene: this.scene, particles: this.particles, character: this.character,
      nav: this.nav, ai: this.ai, emotion: this.emotion, home: this.home,
      activity: this.activity,
      project:        (o) => this._project(o),
      screenToLook:   (x, y) => this._screenToLook(x, y),
      screenToWorld:  (x, y) => this._screenToWorld(x, y),
      screenXToWorld: (x) => x - this.W / 2,
    });

    this.home.mount(this.layer);

    // ---- restore memory + live state, then resume or greet ----
    const saved = await this.ai.loadState();
    this._restoreOrEnter(saved);

    this.tracker.start();
    this._bindLifecycle();

    this.clock = new THREE.Clock();
    this._loop();

    // Restore "hidden" preference (start EON away, with a bring-back button).
    if (localStorage.getItem('eon-hidden') === '1') this._setHidden(true);
  }

  async _loadConfig() {
    try {
      const r = await fetch(`${this._base}config/settings.php`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        return { ...DEFAULTS, ...j, idle: { ...DEFAULTS.idle, ...(j.idle || {}) },
          palette: { ...DEFAULTS.palette, ...(j.palette || {}) },
          features: { ...DEFAULTS.features, ...(j.features || {}) } };
      }
    } catch { /* static host — use DEFAULTS */ }
    return structuredClone(DEFAULTS);
  }

  // -------------------- DOM --------------------
  _buildDom() {
    const layer = document.createElement('div');
    layer.id = 'eon-layer';
    layer.innerHTML = `
      <canvas id="eon-canvas"></canvas>
      <div id="eon-floor-shadow"></div>
      <div id="eon-hit"></div>
      <div class="eon-bubble" id="eon-bubble"></div>
      <div id="eon-controls">
        <button class="eon-chip" id="eon-home-btn" title="Send EON home to sit">🏠</button>
        <button class="eon-chip" id="eon-mute" title="Hide EON’s messages">💬</button>
        <button class="eon-chip" id="eon-power" title="Hide EON">✕</button>
      </div>`;
    document.body.appendChild(layer);
    this.layer = layer;
    this.canvas = layer.querySelector('#eon-canvas');
    this.bubbleEl = layer.querySelector('#eon-bubble');
    this.shadowEl = layer.querySelector('#eon-floor-shadow');
    this.hitEl = layer.querySelector('#eon-hit');

    // 💬 messages — toggle speech bubbles on/off
    const muteBtn = layer.querySelector('#eon-mute');
    muteBtn.onclick = () => {
      this.config.features.speech = !this.config.features.speech;
      muteBtn.classList.toggle('active', this.config.features.speech === false);
      muteBtn.title = this.config.features.speech ? 'Hide EON’s messages' : 'Show EON’s messages';
      if (!this.config.features.speech) this.bubbleEl.classList.remove('show');
    };

    // 🏠 home — send EON home to sit, and keep him there (toggle)
    const homeBtn = layer.querySelector('#eon-home-btn');
    homeBtn.onclick = () => this._setStayHome(!this.ctx.stayHome);

    // ✕ hide — hide EON but keep a bring-back button (toggle)
    layer.querySelector('#eon-power').onclick = () => this._setHidden(!this.hidden);
  }

  /** Send EON home and lock him there (sitting), or release him to roam. */
  _setStayHome(on) {
    this.ctx.stayHome = on;
    const btn = this.layer.querySelector('#eon-home-btn');
    btn.classList.toggle('active', on);
    btn.title = on ? 'Let EON roam freely' : 'Send EON home to sit';
    if (on) {
      this.home?.show(true);
      this.home?.setActive(true);
      this.nav.goHome();
      this.activity._whenArrived(() => this.character.setState('drinkTea'));
      this.ai?.speak('Cozy here. 🍵');
    }
  }

  /** Hide EON entirely (pausing the render loop) but leave a bring-back button. */
  _setHidden(hidden) {
    this.hidden = hidden;
    localStorage.setItem('eon-hidden', hidden ? '1' : '0');
    const vis = hidden ? 'none' : '';

    this.canvas.style.display = vis;
    this.shadowEl.style.display = vis;
    this.hitEl.style.display = vis;
    if (hidden) this.bubbleEl.classList.remove('show');
    const homeEl = this.layer.querySelector('#eon-home');
    if (homeEl) homeEl.style.display = vis;

    // hide the other chips while EON is away; the ✕ becomes a bring-back 🙂
    this.layer.querySelector('#eon-mute').style.display = vis;
    this.layer.querySelector('#eon-home-btn').style.display = vis;
    const power = this.layer.querySelector('#eon-power');
    power.textContent = hidden ? '🙂' : '✕';
    power.title = hidden ? 'Bring EON back' : 'Hide EON';
    power.classList.toggle('bring-back', hidden);

    if (hidden) {
      cancelAnimationFrame(this._raf);
    } else {
      this.clock.start();          // reset delta so EON doesn't jump
      this._loop();
    }
  }

  // -------------------- Three.js --------------------
  _buildScene() {
    this.W = innerWidth; this.H = innerHeight;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(this.W, this.H, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(
      -this.W / 2, this.W / 2, this.H / 2, -this.H / 2, -2000, 2000);
    this.camera.position.z = 1000;

    // soft, friendly lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-200, 400, 600);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7b54e0, 0.5); // violet rim
    rim.position.set(300, 100, -400);
    this.scene.add(rim);

    addEventListener('resize', () => this._onResize(), { passive: true });
  }

  _onResize() {
    this.W = innerWidth; this.H = innerHeight;
    this.renderer.setSize(this.W, this.H, false);
    const c = this.camera;
    c.left = -this.W / 2; c.right = this.W / 2; c.top = this.H / 2; c.bottom = -this.H / 2;
    c.updateProjectionMatrix();
  }

  _bounds() {
    // Full-screen roam box (EON floats, so the whole vertical band is fair game).
    return {
      minX: -this.W / 2 + 60, maxX: this.W / 2 - 60,
      minY: -this.H / 2 + 70, maxY: this.H / 2 - 90,
    };
  }

  // -------------------- helpers --------------------
  _project(obj) {
    const v = new THREE.Vector3();
    obj.getWorldPosition(v);
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.W, y: (1 - (v.y * 0.5 + 0.5)) * this.H };
  }

  _screenToLook(cx, cy) {
    const h = this._project(this.character.headAnchor);
    return new THREE.Vector2(
      (cx - h.x) / (this.W * 0.28),
      (h.y - cy) / (this.H * 0.28),   // screen-y is down → invert
    );
  }

  /** Screen pixel (clientX/Y) → world coords (pixel-mapped ortho space). */
  _screenToWorld(cx, cy) {
    return { x: cx - this.W / 2, y: this.H / 2 - cy };
  }

  _entrance() {
    const b = this._bounds();
    const startY = b.minY + (b.maxY - b.minY) * 0.22;
    this.character.setPosition(b.minX - 120, startY);
    this.nav.set(b.minX - 120, startY);
    this.nav.goTo(b.minX + (b.maxX - b.minX) * 0.3, startY);
    this.character.setState('walk');
    // wave hello once arrived
    this.activity._whenArrived(() => {
      this.emotion.react('waving', { priority: 2 });
      if (this.ai.memory.visits > 1) this.ai.speak('Welcome back!');
    });
  }

  /**
   * Decide between resuming a continuous session (page navigation) and
   * greeting a fresh visitor. EON only replays the walk-in/wave when there's
   * been a real gap; clicking between pages resumes his exact state.
   */
  _restoreOrEnter(saved) {
    const CONTINUITY = 60000; // ms — within this, treat as the same session
    const live = saved && saved.live;
    const gap = saved && saved.lastSeen ? Date.now() - saved.lastSeen : Infinity;

    if (live && gap >= 0 && gap < CONTINUITY) {
      // ---- resume where he left off ----
      const b = this._bounds();
      let x = (live.pos && live.pos.x) || 0;
      let y = (live.pos && typeof live.pos.y === 'number') ? live.pos.y : b.minY;
      x = Math.max(b.minX, Math.min(b.maxX, x));
      y = Math.max(b.minY, Math.min(b.maxY, y));
      this.character.setPosition(x, y);
      this.nav.set(x, y);

      // resume the idle clock so the home/sleep ladder keeps progressing
      this.activity.lastActive = performance.now() - ((live.idleElapsed || 0) + gap);
      this.activity.phase = live.phase || 'active';

      if (live.stayHome) this._setStayHome(true);

      if (live.phase === 'sleeping') {
        this.character.setState('sleep');
        this.home?.show(true); this.home?.setSleeping(true);
      } else {
        const s = (live.charState && !['walk', 'run'].includes(live.charState))
          ? live.charState : 'idle';
        this.character.setState(s);
      }
    } else {
      // ---- fresh visit: count it and greet ----
      this.ai.memory.visits = (this.ai.memory.visits || 0) + 1;
      if (!this.ai.memory.firstSeen) this.ai.memory.firstSeen = new Date().toISOString();
      this._entrance();
    }
  }

  // -------------------- main loop --------------------
  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);  // clamp after tab-away
    const t = this.clock.elapsedTime;

    // navigation → position (free 2-D)
    const moving = this.nav.update(dt);
    this.character.root.position.x = this.nav.x;
    this.character.root.position.y = this.nav.y;
    if (moving) this.character.face(this.nav.facing);
    this.activity.onNavTick();

    // movement drives walk/idle unless a persistent activity owns the body
    const persistent = ['sleep', 'work', 'read', 'drinkTea'];
    if (moving && !persistent.includes(this.character.state)) {
      if (this.character.state !== 'run') this.character.setState('walk');
      // footstep puffs
      if (((t * 9) % 1) < dt * 9) this.particles.footstep(this.character.worldFeet());
    } else if (!moving && (this.character.state === 'walk' || this.character.state === 'run')) {
      this.character.setState('idle');
    }

    // subsystems
    this.character.update(dt, t, this.ctx);
    this.activity.update(dt);
    this.particles.update(dt);
    this.home.update();
    this.ai.maybeAmbient();

    // DOM overlays follow EON
    this._syncOverlays();

    this.renderer.render(this.scene, this.camera);
  }

  _syncOverlays() {
    // contact shadow tracks EON's feet in 2-D; it shrinks/fades as he floats up
    const sx = this.character.root.position.x + this.W / 2;
    const feetY = this.H / 2 - this.character.root.position.y;
    const height = (feetY) / this.H;               // 0 top → 1 bottom
    this.shadowEl.style.left = sx + 'px';
    this.shadowEl.style.top = feetY + 'px';
    this.shadowEl.style.transform = `translate(-50%,-50%) scale(${0.55 + height * 0.6})`;
    this.shadowEl.style.opacity = String(0.35 + height * 0.45);

    // hit area over the body
    const head = this._project(this.character.headAnchor);
    this.hitEl.style.left = head.x + 'px';
    this.hitEl.style.top = (head.y + 45) + 'px';

    // speech bubble
    const b = this.ai.bubble;
    if (b && performance.now() < b.until && this.config.features.speech) {
      if (this.bubbleEl.textContent !== b.text) this.bubbleEl.textContent = b.text;
      this.bubbleEl.style.left = head.x + 'px';
      this.bubbleEl.style.top = (head.y - 14) + 'px';
      this.bubbleEl.classList.add('show');
    } else {
      this.bubbleEl.classList.remove('show');
    }
  }

  // -------------------- lifecycle --------------------
  _bindLifecycle() {
    this._save = () => this.ai.saveState(true);
    addEventListener('pagehide', this._save);
    addEventListener('beforeunload', this._save);
    this._saveInterval = setInterval(() => this.ai.saveState(), 30000);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    clearInterval(this._saveInterval);
    removeEventListener('pagehide', this._save);
    removeEventListener('beforeunload', this._save);
    this.tracker?.stop();
    this.ai?.saveState(true);
    this.renderer?.dispose();
    this.layer?.remove();
  }
}

// ---- auto-boot ----
const eon = new Eon();
window.EON = eon;                    // expose for debugging / manual control
if (document.readyState === 'loading') {
  addEventListener('DOMContentLoaded', () => eon.boot());
} else {
  eon.boot();
}

export default eon;
