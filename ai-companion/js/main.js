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
  features: { pet: true, home: true, speech: true, particles: true, dayNight: true, sound: false },
};

class Eon {
  constructor() {
    // module base URL (works regardless of which page embeds EON)
    this._base = new URL('../', import.meta.url).href;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async boot() {
    if (document.getElementById('eon-layer')) return;          // already running
    if (localStorage.getItem('eon-disabled') === '1') return;  // user turned EON off

    this.config = await this._loadConfig();
    this.config._base = this._base;

    this._buildDom();
    this._buildScene();

    // ---- subsystems share one ctx object (filled below) ----
    const ctx = (this.ctx = { config: this.config });

    this.particles = new ParticleSystem(this.scene, this.config.palette);
    this.character = new CharacterController(this.scene, this.config.palette,
      { withPet: this.config.features.pet, scale: 42 });
    this.nav = new Navigator({ bounds: () => this._bounds(), speed: 150 });

    this.ai       = new AiCore(ctx);
    this.emotion  = new EmotionEngine(ctx);
    this.home     = new HomeSystem(ctx);
    this.activity = new ActivityEngine(ctx);
    this.tracker  = new EventTracker(ctx);

    // fill ctx with everything + helpers
    Object.assign(ctx, {
      THREE, scene: this.scene, particles: this.particles, character: this.character,
      nav: this.nav, ai: this.ai, emotion: this.emotion, home: this.home,
      activity: this.activity,
      project:        (o) => this._project(o),
      screenToLook:   (x, y) => this._screenToLook(x, y),
      screenXToWorld: (x) => x - this.W / 2,
    });

    this.home.mount(this.layer);

    // ---- restore memory, then make an entrance ----
    await this.ai.loadState();
    this._entrance();

    this.tracker.start();
    this._bindLifecycle();

    this.clock = new THREE.Clock();
    this._loop();
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
        <button class="eon-chip" id="eon-mute" title="Mute EON’s messages">💬</button>
        <button class="eon-chip" id="eon-power" title="Hide EON">✕</button>
      </div>`;
    document.body.appendChild(layer);
    this.layer = layer;
    this.canvas = layer.querySelector('#eon-canvas');
    this.bubbleEl = layer.querySelector('#eon-bubble');
    this.shadowEl = layer.querySelector('#eon-floor-shadow');
    this.hitEl = layer.querySelector('#eon-hit');

    layer.querySelector('#eon-mute').onclick = () => {
      this.config.features.speech = !this.config.features.speech;
      this.bubbleEl.classList.remove('show');
    };
    layer.querySelector('#eon-power').onclick = () => {
      localStorage.setItem('eon-disabled', '1');
      this.destroy();
    };
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
    return { minX: -this.W / 2 + 60, maxX: this.W / 2 - 60, groundY: -this.H / 2 + 80 };
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

  _entrance() {
    const b = this._bounds();
    this.character.setPosition(b.minX - 120, b.groundY);
    this.nav.setX(b.minX - 120);
    this.nav.goTo(b.minX + (b.maxX - b.minX) * 0.35);
    this.character.setState('walk');
    // wave hello once arrived
    this.activity._whenArrived(() => {
      this.emotion.react('waving', { priority: 2 });
      if (this.ai.memory.visits > 1) this.ai.speak('Welcome back!');
    });
  }

  // -------------------- main loop --------------------
  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);  // clamp after tab-away
    const t = this.clock.elapsedTime;

    // navigation → position
    const moving = this.nav.update(dt);
    this.character.root.position.x = this.nav.x;
    this.character.root.position.y = this._bounds().groundY;
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
    // floor shadow at EON's feet (pixel-mapped from world X)
    const base = { x: this.character.root.position.x + this.W / 2 };
    this.shadowEl.style.left = base.x + 'px';
    this.shadowEl.style.top = (this.H - 12) + 'px';
    this.shadowEl.style.transform = 'translate(-50%,-50%)';

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
