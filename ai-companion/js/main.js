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
import { HypeMan }            from './hype-man.js';
import { Personality, ARCHETYPES } from './personality.js';

// Front-end mirror of config/settings.php so EON works with no backend.
const DEFAULTS = {
  version: '1.0.0', name: 'EON',
  idle:     { goHome: 5 * 60000, activity: 10 * 60000, sleep: 20 * 60000 },
  lifeTick: 45000,
  palette: {
    ocean: '#1f6dff', blue: '#2f8bff', cyan: '#28c7d8', lime: '#7ed957',
    navy: '#10225e', violet: '#7b54e0', purple: '#b08ff0', white: '#eef4ff',
  },
  features: { pet: false, home: false, speech: true, particles: true, dayNight: true, sound: false },
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
    this.personality = new Personality();   // before _buildDom (panel needs it)

    this._buildDom();
    this._buildScene();

    // ---- subsystems share one ctx object (filled below) ----
    const ctx = (this.ctx = { config: this.config });

    this.particles = new ParticleSystem(this.scene, this.config.palette);
    this.character = new CharacterController(this.scene, this.config.palette, {
      detailed: true,                     // high-fidelity EON (matches EPAL art)
      renderer: this.renderer,            // needed for the studio env map
      targetPx: 132,                      // on-screen height
      scale: 42,                          // procedural fallback scale
      withPet: this.config.features.pet,
      // To use a finished GLB later instead: set detailed:false and
      // modelUrl: `${this._base}assets/models/eon.glb`, targetPx, baseYaw.
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
      followMode: true,                 // Follow mode: he watches your typing
      focus: false,                     // Focus/DND: shrink + silent
      meditating: false,                // brain-driven: absorbing data
      activityLevel: 0.5,               // calm ↔ lively
      drag: { active: false, x: 0, y: 0 },
      personality: this.personality,
      THREE, scene: this.scene, particles: this.particles, character: this.character,
      nav: this.nav, ai: this.ai, emotion: this.emotion, home: this.home,
      activity: this.activity,
      project:        (o) => this._project(o),
      screenToLook:   (x, y) => this._screenToLook(x, y),
      screenToWorld:  (x, y) => this._screenToWorld(x, y),
      screenXToWorld: (x) => x - this.W / 2,
    });

    this.home.mount(this.layer);
    try { this.hype = new HypeMan(this.ctx); this.hype.start(); }  // public-mode: the aware guide
    catch (e) { console.warn('[EON] guide failed to start:', e); this.hype = null; }
    this._setSize(this._userScale || 1);     // apply saved size now the model exists

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
    // No PHP backend in the Firebase build — config is the in-code DEFAULTS.
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
      <div id="eon-panel" class="eon-panel">
        <div class="eon-pan-h">Personality</div>
        <div class="eon-pan-row" id="eon-arche"></div>
        <div class="eon-pan-h">Mode</div>
        <div class="eon-pan-row" id="eon-modes"></div>
        <div class="eon-pan-h">Energy <span id="eon-energy-v"></span></div>
        <input type="range" id="eon-energy" min="0" max="100" value="50" class="eon-range">
        <div class="eon-pan-h">Size</div>
        <input type="range" id="eon-size" min="55" max="175" value="100" class="eon-range">
        <button class="eon-pill" id="eon-meditate" style="width:100%;margin-top:9px">🧘 Meditate now</button>
      </div>
      <div id="eon-controls">
        <button class="eon-chip" id="eon-settings" title="EON settings">⚙</button>
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

    this._buildPanel();
  }

  /** Settings popover: personality, mode, energy. */
  _buildPanel() {
    const panel = this.layer.querySelector('#eon-panel');
    this.layer.querySelector('#eon-settings').onclick = () => panel.classList.toggle('show');

    // personality archetypes
    const arche = this.layer.querySelector('#eon-arche');
    arche.innerHTML = Object.entries(ARCHETYPES).map(([k, v]) =>
      `<button class="eon-pill" data-a="${k}">${v.name}</button>`).join('');
    const syncArche = () => arche.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.a === this.personality.archetype));
    arche.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.personality.setArchetype(b.dataset.a); syncArche();
      this.ai.speak(this.personality.line('greet'));
    };
    syncArche();

    // modes
    const modes = this.layer.querySelector('#eon-modes');
    const MODES = [['follow', 'Follow'], ['roam', 'Roam'], ['focus', 'Focus'], ['home', 'Home']];
    modes.innerHTML = MODES.map(([k, l]) => `<button class="eon-pill" data-m="${k}">${l}</button>`).join('');
    modes.onclick = (e) => { const b = e.target.closest('button'); if (b) this._setMode(b.dataset.m); };
    this._syncModes = () => modes.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.m === this._mode));
    this._mode = 'follow'; this._syncModes();

    // energy / activity level
    const energy = this.layer.querySelector('#eon-energy');
    const energyV = this.layer.querySelector('#eon-energy-v');
    const showE = () => { energyV.textContent = energy.value < 34 ? '· calm' : energy.value > 66 ? '· lively' : '· balanced'; };
    energy.oninput = () => { this.ctx.activityLevel = energy.value / 100; showE(); };
    showE();

    // meditate-now — runs a cycle and reports what EON found (visible feedback)
    const med = this.layer.querySelector('#eon-meditate');
    if (med) med.onclick = async () => {
      const B = window.EonBrain;
      if (!B) { this.ai.speak('My brain is still loading… try again in a sec.', 4000); return; }
      if (typeof B.isOwner !== 'function' || !B.isOwner()) { this.ai.speak('Sign in as owner first 🔒', 4000); return; }
      this.ai.speak('Meditating… reading your data 🧘', 4000);
      try {
        await B.meditate();
        const a = B.getAlerts() || [];
        const m = B.status ? B.status() : null;
        if (a.length) this.ai.speak(`I read ${m?.learned ?? '?'} records. Nearest deadline: ${a[0].label}`, 7000);
        else this.ai.speak(`Read ${m?.learned ?? 0} records — no deadlines nearby. 🌿`, 6000);
      } catch (e) { this.ai.speak('I had trouble reading (check console).', 5000); console.warn(e); }
    };

    // size (applied for real once the character exists; see boot)
    const size = this.layer.querySelector('#eon-size');
    const savedSize = parseFloat(localStorage.getItem('eon-size'));
    this._userScale = (!isNaN(savedSize) && savedSize > 0) ? savedSize : 1;
    size.value = Math.round(this._userScale * 100);
    size.oninput = () => this._setSize(size.value / 100);
  }

  /** Set EON's on-screen size (combined with the Focus-mode shrink). */
  _setSize(scale) {
    this._userScale = scale;
    try { localStorage.setItem('eon-size', String(scale)); } catch {}
    if (this.character) this.character.root.scale.setScalar(scale * (this.ctx.focus ? 0.62 : 1));
  }

  // ---------------- brain-driven meditation visuals ----------------
  _buildAura() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(126,217,87,0.9)');
    grd.addColorStop(0.4, 'rgba(40,199,216,0.35)');
    grd.addColorStop(1, 'rgba(40,199,216,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.aura = new THREE.Sprite(mat); this.aura.scale.setScalar(150); this.aura.renderOrder = -1;
    this.scene.add(this.aura);
  }

  _updateAura(t, dt) {
    if (!this.aura) return;
    const r = this.character.root.position;
    this.aura.position.set(r.x, r.y + 46, -6);
    const target = this.ctx.meditating ? (0.45 + 0.3 * Math.sin(t * 3)) : 0;
    this.aura.material.opacity += (target - this.aura.material.opacity) * 0.08;
    this.aura.scale.setScalar(this.ctx.meditating ? 170 + Math.sin(t * 2) * 18 : 150);
    if (this.ctx.meditating && ((t * 5) % 1) < dt * 5) {
      this.particles.lightStream(this.character._worldHead(0, 0.1));
    }
  }

  /** Poll the brain (owner-only) and reflect its lifecycle in the avatar. */
  _pollBrain(dt) {
    this._brainT = (this._brainT || 0) + dt;
    if (this._brainT < 0.4) return;              // getState() is in-memory; cheap
    this._brainT = 0;
    const B = window.EonBrain;
    // Owner-only: visitors must never see private deadline reminders.
    if (!B || typeof B.isOwner !== 'function' || !B.isOwner()) { this._setMeditation(false); return; }
    let s; try { s = B.getState(); } catch { return; }
    const st = s && s.state;
    if (st === 'meditating' || st === 'reading-section') {
      this._setMeditation(true);
    } else if (st === 'insight') {
      if (this._medActive) this._onInsight(s);   // fire once on the transition
      this._setMeditation(false);
    } else {
      this._setMeditation(false);
    }
  }

  _setMeditation(on) {
    if (this._medActive === on) return;
    this._medActive = on;
    this.ctx.meditating = on;
    this.character.setMeditating(on);
    if (on && !this.ctx.stayHome && !this.hidden) this.nav.goHome();   // sit in his corner
  }

  /** EON decides to meditate on his own every ~5-10 min (owner, when free). */
  _selfMeditate() {
    const B = window.EonBrain;
    if (!B || typeof B.isOwner !== 'function' || !B.isOwner()) return;
    if (this._medActive || this.ctx.drag.active || this.hidden || this.ctx.focus || this.ctx.stayHome) return;
    const now = Date.now();
    if (!this._nextSelfMed) { this._nextSelfMed = now + 75000; return; }   // first ~75s after load
    if (now < this._nextSelfMed) return;
    this._nextSelfMed = now + (5 * 60000 + Math.random() * 5 * 60000);     // then every 5–10 min
    try { B.meditate(); } catch { /* ignore */ }
  }

  _onInsight(s) {
    this.ctx.meditating = false;
    this.character.setMeditating(false);
    this.character.playEmote('point');                                 // eyes open, points
    for (let i = 0; i < 8; i++) this.particles.emote('✨', this.character._worldHead((Math.random() - 0.5) * 0.6, 0.7));
    if (s && s.message) this.ai.speak(s.message, 6500);
  }

  /** Switch behaviour mode: follow / roam / focus / home. */
  _setMode(m) {
    this._mode = m;
    this.ctx.focus = (m === 'focus');
    this.ctx.followMode = (m === 'follow');
    if (m === 'home') { if (!this.ctx.stayHome) this._setStayHome(true); }
    else if (this.ctx.stayHome) { this._setStayHome(false); }
    // Focus/DND: shrink + go quiet (keeps the user's size preference)
    this.character.root.scale.setScalar((this.ctx.focus ? 0.62 : 1) * (this._userScale || 1));
    if (this._syncModes) this._syncModes();
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;   // soft, filmic plastic look
    this.renderer.toneMappingExposure = 0.98;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(
      -this.W / 2, this.W / 2, this.H / 2, -this.H / 2, -2000, 2000);
    this.camera.position.z = 1000;

    // soft studio lighting (env map for reflections is set by the model build)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb6c4e6, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(-320, 500, 600);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9d8ff, 0.32);
    fill.position.set(400, 120, 300);
    this.scene.add(fill);

    this._buildAura();
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
    // wave hello once arrived, with a time-of-day greeting
    this.activity._whenArrived(() => {
      this.emotion.react('waving', { priority: 2 });
      this.ai.speak(this._greeting());
    });
  }

  /** Greeting: occasionally Bangla, occasionally personality-flavored,
      otherwise time-of-day (with a seasonal touch). */
  _greeting() {
    const d = new Date(), h = d.getHours(), m = d.getMonth();
    const back = this.ai.memory.visits > 1;
    if (Math.random() < 0.25) return h < 12 ? 'Shubho Shokal! 🌅' : 'Assalamu Alaikum 👋';
    if (this.personality && Math.random() < 0.4) return this.personality.line('greet');
    const season = (m === 11 || m <= 1) ? ' ❄️' : (m >= 2 && m <= 4) ? ' 🌸' : '';
    if (h < 5)  return 'Working late? I’m here. 🌙';
    if (h < 12) return (back ? 'Good morning! ☀️' : 'Morning! Let’s do this. ☀️') + season;
    if (h < 17) return 'Good afternoon! 🌤️' + season;
    if (h < 21) return (back ? 'Evening — welcome back! 🌆' : 'Good evening! 🌆');
    return 'Working late? Don’t forget to rest. 🌙';
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
    this.personality.decay(dt);

    // being dragged: snap to the cursor, flail, skip normal nav/activity
    if (this.ctx.drag.active) {
      this.nav.set(this.ctx.drag.x, this.ctx.drag.y);
      this.character.root.position.x = this.nav.x;
      this.character.root.position.y = this.nav.y;
      this.character.update(dt, t, this.ctx);
      this.particles.update(dt);
      this._syncOverlays();
      this.renderer.render(this.scene, this.camera);
      return;
    }

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
    this._pollBrain(dt);
    this._updateAura(t, dt);
    this._selfMeditate();
    try { this.hype?.update(); } catch (e) { /* guide must never break the loop */ }

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
