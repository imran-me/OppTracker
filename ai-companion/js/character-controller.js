/* ============================================================
   EON — character-controller.js
   Builds EON procedurally (rounded primitives, EPAL palette) and
   drives every animation state. Designed so a future rigged GLTF
   can replace _build() while keeping the same public API:
       setState(name), lookAt(vec2), update(dt,t), setBadgeGlow(x)
   ============================================================ */
import * as THREE from 'three';
import { EonModel } from './eon-model.js';

// GLTFLoader is imported lazily inside _loadModel so a CDN failure can fall
// back to the procedural EON instead of breaking the whole module.
const GLTF_LOADER_URL = 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

// Smooth critically-damped lerp toward a target (frame-rate independent).
const damp = (cur, tgt, lambda, dt) => cur + (tgt - cur) * (1 - Math.exp(-lambda * dt));

export class CharacterController {
  /**
   * @param {THREE.Scene} scene
   * @param {object} palette  hex colour map
   * @param {object} opts     { withPet:boolean, scale:number }
   */
  constructor(scene, palette, opts = {}) {
    this.scene = scene;
    this.P = palette;
    this.scale = opts.scale ?? 42;
    this.targetPx = opts.targetPx ?? 96;   // on-screen height for a loaded model
    this.baseYaw = opts.baseYaw ?? 0;      // rotate the model's "front" if needed
    this.state = 'idle';
    this.prevState = 'idle';
    this.stateTime = 0;
    this.facing = 1;                 // +1 right, -1 left
    this.look = new THREE.Vector2(); // normalised cursor direction (-1..1)
    this.blink = 1;                  // 1 open, 0 closed
    this._nextBlink = 2 + Math.random() * 3;
    this.badgeTarget = 0.6;          // persistent badge-glow target
    this.onStateEnd = null;          // optional one-shot callback
    this.ready = false;              // true once a body exists
    this.rigless = false;            // true when driving a static (un-rigged) GLB
    this.detailed = false;           // true when driving the detailed EonModel
    this.renderer = opts.renderer || null;

    if (opts.detailed && this.renderer) {
      // Detailed, high-fidelity EON (matches the EPAL reference).
      try { this._buildDetailed(); }
      catch (e) { console.warn('[EON] detailed build failed — procedural fallback.', e); this._build(); this.ready = true; }
    } else if (opts.modelUrl) {
      // Real 3D model file: whole-body animation (no skeleton in the mesh).
      this._setupRigless();
      this._loadModel(opts.modelUrl);
    } else {
      // Simple procedural EON: per-limb rig.
      this._build();
      this.ready = true;
      if (opts.withPet) this._buildPet();
    }
  }

  // ---------------------------------------------------------------
  // Detailed-model mode — wrap EonModel in nav groups, scale to size,
  // and drop its feet onto the navigation point.
  // ---------------------------------------------------------------
  _buildDetailed() {
    this.modelObj = new EonModel(this.renderer);
    this.root = new THREE.Group();
    this.scaler = new THREE.Group();
    this.lift = new THREE.Group();             // shifts feet to the group origin
    this.root.add(this.scaler);
    this.scaler.add(this.lift);
    this.lift.add(this.modelObj.eon);

    // Measure standing height from head+body only (props excluded).
    this.modelObj.eon.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    box.expandByObject(this.modelObj.head);
    box.expandByObject(this.modelObj.body);
    const height = (box.max.y - box.min.y) || 3;
    this.scaler.scale.setScalar(this.targetPx / height);
    this.lift.position.y = -box.min.y;          // feet → origin

    this.scene.add(this.root);
    if (this.modelObj.env) this.scene.environment = this.modelObj.env;
    this.headAnchor = this.modelObj.headAnchor;
    this.detailed = true;
    this.ready = true;
  }

  /** Map companion state names → EonModel CFG states. */
  _mapState(s) {
    return ({
      idle: 'happy', walk: 'walk', run: 'walk', wave: 'wave', think: 'thinking',
      drinkTea: 'tea', read: 'read', work: 'work', celebrate: 'celebrate', sleep: 'sleep',
      excited: 'excited', curious: 'curious', confused: 'curious', proud: 'happy',
      stretch: 'excited', brushTeeth: 'happy', wakeUp: 'happy', dance: 'excited', sit: 'happy',
      wink: 'wink',
    })[s] || 'happy';
  }

  // ---------------------------------------------------------------
  // Rigless (static-GLB) mode — animate the whole body
  // ---------------------------------------------------------------
  _setupRigless() {
    this.root = new THREE.Group();              // navigates
    this.bob = new THREE.Group();               // vertical bob / hop
    this.gesture = new THREE.Group();           // lean / pitch / spin / squash
    this.bob.add(this.gesture);
    this.root.add(this.bob);
    this.scene.add(this.root);
    this.gpose = { bobY: 0, hop: 0, lean: 0, pitch: 0, sx: 1, sy: 1 };
    this._spin = 0;
    this.headAnchor = new THREE.Object3D();     // bubble / look anchor (set after load)
    this.gesture.add(this.headAnchor);
  }

  async _loadModel(url) {
    let GLTFLoader;
    try {
      ({ GLTFLoader } = await import(GLTF_LOADER_URL));
    } catch (e) {
      console.warn('[EON] GLTFLoader unavailable — using procedural fallback.', e);
      this.scene.remove(this.root); this._build(); this.ready = true; return;
    }
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene;
      // Normalise: scale to target on-screen height, feet at y=0, centred X/Z.
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      const h = size.y || 1;
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;            // drop feet to the ground
      model.rotation.y = this.baseYaw;
      model.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = false;
          if (o.material) o.material.envMapIntensity = 1;
        }
      });
      this.root.scale.setScalar(this.targetPx / h);
      this.gesture.add(model);
      this.headAnchor.position.set(0, h * 1.04, 0);
      this.model = model;
      this.rigless = true;
      this.ready = true;
    }, undefined, (err) => {
      console.warn('[EON] model failed to load — using procedural fallback.', err);
      this.scene.remove(this.root);
      this._build();
      this.ready = true;
    });
  }

  // ---------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------
  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.rough ?? 0.55,
      metalness: opts.metal ?? 0.05,
      emissive: new THREE.Color(opts.emissive ?? '#000000'),
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    });
  }

  _build() {
    const P = this.P;
    this.root = new THREE.Group();        // moves along the floor
    this.bob = new THREE.Group();         // vertical bob / hop
    this.root.add(this.bob);

    // ---- Body ----
    this.body = new THREE.Group();
    this.bob.add(this.body);

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 0.5, 8, 20),
      this._mat(P.ocean, { rough: 0.45 })
    );
    torso.position.y = 0.95;
    torso.scale.set(1, 0.95, 0.85);
    this.body.add(torso);

    // Hoodie pocket hint (navy band)
    const pocket = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.18, 6, 16),
      this._mat(P.navy, { rough: 0.6 })
    );
    pocket.rotation.z = Math.PI / 2;
    pocket.position.set(0, 0.66, 0.4);
    pocket.scale.set(0.5, 1, 0.4);
    this.body.add(pocket);

    // Glowing E badge
    this.badge = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 24),
      this._mat(P.lime, { emissive: P.lime, emissiveIntensity: 0.6, rough: 0.3 })
    );
    this.badge.position.set(0, 1.0, 0.74);
    this.body.add(this.badge);
    const eGlyph = new THREE.Mesh(
      new THREE.TorusGeometry(0.07, 0.025, 8, 16, Math.PI * 1.4),
      this._mat(P.navy)
    );
    eGlyph.position.set(0, 1.0, 0.76);
    eGlyph.rotation.z = -0.4;
    this.body.add(eGlyph);

    // Backpack (violet) behind torso
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.35, 1, 1, 1),
      this._mat(P.violet, { rough: 0.5 })
    );
    pack.position.set(0, 0.95, -0.55);
    this._round(pack);
    this.body.add(pack);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 8, 24),
      this._mat(P.purple));
    strap.position.set(0, 1.0, 0.1);
    strap.rotation.x = Math.PI / 2.2;
    this.body.add(strap);

    // ---- Arms ---- (pivot at shoulder)
    this.armL = this._limb(P.ocean, 0.16, 0.5);
    this.armL.position.set(-0.52, 1.25, 0);
    this.body.add(this.armL);
    this.armR = this._limb(P.ocean, 0.16, 0.5);
    this.armR.position.set(0.52, 1.25, 0);
    this.body.add(this.armR);
    // lime cuffs / hands
    [this.armL, this.armR].forEach(a => {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12),
        this._mat(P.lime, { rough: 0.4 }));
      hand.position.y = -0.6;
      a.add(hand);
    });

    // ---- Legs ---- (pivot at hip)
    this.legL = this._limb(P.navy, 0.18, 0.4);
    this.legL.position.set(-0.22, 0.45, 0);
    this.body.add(this.legL);
    this.legR = this._limb(P.navy, 0.18, 0.4);
    this.legR.position.set(0.22, 0.45, 0);
    this.body.add(this.legR);
    [this.legL, this.legR].forEach(l => {
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12),
        this._mat(P.white, { rough: 0.4 }));
      shoe.position.set(0, -0.5, 0.06);
      shoe.scale.set(1, 0.7, 1.3);
      l.add(shoe);
    });

    // ---- Head ---- (pivot at neck)
    this.head = new THREE.Group();
    this.head.position.y = 1.55;
    this.bob.add(this.head);

    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.72, 28, 24),
      this._mat(P.blue, { rough: 0.4 }));
    this.head.add(hood);

    // Dark glossy visor/face
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.6, 28, 24),
      this._mat(P.navy, { rough: 0.18, metal: 0.2 }));
    visor.position.set(0, -0.02, 0.2);
    visor.scale.set(1, 0.96, 0.7);
    this.head.add(visor);

    // Lime hood trim
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.05, 10, 32),
      this._mat(P.lime, { emissive: P.lime, emissiveIntensity: 0.25 }));
    trim.position.set(0, 0, 0.22);
    trim.scale.set(1, 0.98, 1);
    this.head.add(trim);

    // Eyes
    this.eyeL = this._eye(); this.eyeL.position.set(-0.22, 0.04, 0.62);
    this.eyeR = this._eye(); this.eyeR.position.set(0.22, 0.04, 0.62);
    this.head.add(this.eyeL, this.eyeR);

    // Mouth (soft smile)
    this.mouth = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.03, 8, 16, Math.PI),
      this._mat(P.cyan, { emissive: P.cyan, emissiveIntensity: 0.3 })
    );
    this.mouth.position.set(0, -0.26, 0.6);
    this.mouth.rotation.z = Math.PI;
    this.head.add(this.mouth);

    // Leaf sprout
    this.leaf = new THREE.Group();
    this.leaf.position.set(0.05, 0.7, 0);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 8),
      this._mat(P.lime));
    stalk.position.y = 0.1;
    this.leaf.add(stalk);
    [[-0.13, 0.5], [0.13, -0.5]].forEach(([x, r]) => {
      const blade = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10),
        this._mat(P.lime, { emissive: P.lime, emissiveIntensity: 0.18 }));
      blade.position.set(x, 0.24, 0);
      blade.scale.set(1.5, 0.7, 0.5);
      blade.rotation.z = r;
      this.leaf.add(blade);
    });
    this.head.add(this.leaf);

    // Headphones (violet discs)
    [[-0.7, P.violet], [0.7, P.violet]].forEach(([x, c]) => {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 20),
        this._mat(c, { rough: 0.4 }));
      ear.rotation.z = Math.PI / 2;
      ear.position.set(x, -0.02, 0.05);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.13, 18),
        this._mat(P.cyan, { emissive: P.cyan, emissiveIntensity: 0.4 }));
      inner.position.set(x > 0 ? 0.09 : -0.09, 0, 0);
      inner.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      ear.add(inner);
      this.head.add(ear);
    });

    this.root.scale.setScalar(this.scale);
    this.scene.add(this.root);

    // Cache neutral pose targets
    this.pose = this._neutralPose();
    this.cur = this._neutralPose();

    // World anchor at head-top for DOM bubble/hit projection
    this.headAnchor = new THREE.Object3D();
    this.headAnchor.position.set(0, 0.85, 0);
    this.head.add(this.headAnchor);
  }

  _round(mesh) { mesh.geometry.computeVertexNormals(); }

  _limb(color, r, len) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12),
      this._mat(color, { rough: 0.5 }));
    m.position.y = -len / 2 - r / 2;
    g.add(m);
    return g;
  }

  _eye() {
    const g = new THREE.Group();
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 14),
      this._mat('#ffffff', { rough: 0.1, emissive: '#ffffff', emissiveIntensity: 0.15 }));
    white.scale.set(1, 1.15, 0.6);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12),
      this._mat('#0a1030', { rough: 0.1 }));
    pupil.position.z = 0.1;
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8),
      this._mat('#bfe6ff', { emissive: '#bfe6ff', emissiveIntensity: 0.8 }));
    glint.position.set(0.04, 0.04, 0.16);
    g.add(white, pupil, glint);
    g.userData = { white, pupil, glint };
    return g;
  }

  _neutralPose() {
    return {
      bobY: 0, hop: 0, lean: 0, headTilt: 0, headYaw: 0, headPitch: 0,
      armLx: 0.05, armLz: 0.08, armRx: 0.05, armRz: -0.08,
      legLx: 0, legRx: 0, eyeOpen: 1, mouth: 1, leafSway: 0,
    };
  }

  // ---- tiny robot pet ----
  _buildPet() {
    const P = this.P;
    this.pet = new THREE.Group();
    const bodyP = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.32),
      this._mat(P.cyan, { rough: 0.4, metal: 0.3 }));
    this._round(bodyP);
    const eyeP = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16),
      this._mat(P.navy, { emissive: P.cyan, emissiveIntensity: 0.5 }));
    eyeP.position.set(0, 0.02, 0.17);
    const antenna = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8),
      this._mat(P.lime, { emissive: P.lime, emissiveIntensity: 0.6 }));
    antenna.position.y = 0.24;
    this.pet.add(bodyP, eyeP, antenna);
    this.pet.scale.setScalar(this.scale * 0.7);
    this.pet.position.set(-90, 0, 5);
    this.petX = -90;
    this.scene.add(this.pet);
  }

  // ---------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------
  setState(name, onEnd = null) {
    if (this.state === name) return;
    this.prevState = this.state;
    this.state = name;
    this.stateTime = 0;
    this.onStateEnd = onEnd;
    if (this.detailed && this.modelObj) this.modelObj.setState(this._mapState(name));
  }

  /** Normalised cursor direction relative to EON (-1..1 each axis). */
  lookAt(vec2) { this.look.set(
    THREE.MathUtils.clamp(vec2.x, -1, 1),
    THREE.MathUtils.clamp(vec2.y, -1, 1)); }

  face(dir) { if (dir) this.facing = dir < 0 ? -1 : 1; }

  setBadgeGlow(v) { this.badgeTarget = v; }

  /** True for one-shot states that should auto-return to idle. */
  _oneShotDuration(s) {
    return ({ wave: 2.2, celebrate: 2.6, think: 2.8, stretch: 2.0,
              wakeUp: 2.4, dance: 3.2, brushTeeth: 2.6, wink: 1.5 })[s] || 0;
  }

  // ---------------------------------------------------------------
  // Whole-body animation for a static (un-rigged) model.
  // No skeleton → express states via bob, hop, lean, pitch, spin and
  // squash-and-stretch. Reads alive without per-limb bones.
  // ---------------------------------------------------------------
  _updateRigless(dt, t, ctx) {
    this.stateTime += dt;
    const s = this.state, st = this.stateTime;
    let bobY = 0, hop = 0, lean = 0, pitch = 0, spinV = 0, sx = 1, sy = 1;

    switch (s) {
      case 'walk': hop = Math.abs(Math.sin(t * 9)) * 0.05; lean = 0.06 * this.facing; break;
      case 'run':  hop = Math.abs(Math.sin(t * 13)) * 0.10; lean = 0.16 * this.facing; break;
      case 'wave': lean = Math.sin(t * 10) * 0.20; hop = Math.abs(Math.sin(t * 3)) * 0.03; break;
      case 'think':
        lean = 0.16; pitch = 0.12;
        if (Math.random() < dt * 2.2 && ctx) ctx.particles?.think(this._worldHead(0.15, 0.3));
        break;
      case 'work': bobY = -0.05; lean = Math.sin(t * 22) * 0.012; break;
      case 'read': bobY = -0.05; pitch = 0.18; break;
      case 'drinkTea':
        bobY = -0.03; pitch = 0.08;
        if (Math.random() < dt * 3 && ctx) ctx.particles?.steam(this._worldHead(0.1, 0.25));
        break;
      case 'celebrate':
        hop = Math.abs(Math.sin(t * 7)) * 0.28; spinV = 6.5;
        if (st < 0.05 && ctx) ctx.particles?.confetti(this._worldHead(0, 0.5), 30);
        break;
      case 'excited': hop = Math.abs(Math.sin(t * 9)) * 0.16; break;
      case 'dance':
        hop = Math.abs(Math.sin(t * 8)) * 0.14; lean = Math.sin(t * 4) * 0.22;
        spinV = Math.sin(t * 3) * 3.2;
        break;
      case 'stretch': sy = 1.12; sx = 0.94; bobY = 0.04; break;
      case 'brushTeeth':
        lean = Math.sin(t * 16) * 0.05;
        if (Math.random() < dt * 4 && ctx) ctx.particles?.steam(this._worldHead(0.1, 0.15));
        break;
      case 'sleep':
        bobY = -0.08 + Math.sin(t * 1.2) * 0.02; lean = 0.18; pitch = 0.10;
        if (Math.random() < dt * 1.2 && ctx) ctx.particles?.zzz(this._worldHead(0.2, 0.5));
        break;
      case 'wakeUp': sy = 1 + Math.max(0, 1 - st) * 0.12; bobY = Math.sin(t * 8) * 0.03; break;
      case 'confused': lean = Math.sin(t * 3) * 0.18; break;
      case 'proud': bobY = 0.03; sy = 1.05; break;
      case 'idle':
      default:
        bobY = Math.sin(t * 1.8) * 0.03; lean = Math.sin(t * 0.7) * 0.03;
        break;
    }

    // squash & stretch on hops (mid-air stretch, gives weight)
    if (hop > 0.001) { sy *= 1 + hop * 0.4; sx *= 1 - hop * 0.25; }
    this._spin += spinV * dt;

    // damp toward targets for smoothness
    const g = this.gpose, L = 12;
    g.bobY = damp(g.bobY, bobY, L, dt); g.hop = damp(g.hop, hop, L, dt);
    g.lean = damp(g.lean, lean, L, dt); g.pitch = damp(g.pitch, pitch, L, dt);
    g.sx = damp(g.sx, sx, L, dt);       g.sy = damp(g.sy, sy, L, dt);

    this.bob.position.y = g.bobY + g.hop;
    const lookPitch = s !== 'sleep' ? -this.look.y * 0.12 : 0;
    this.gesture.rotation.set(g.pitch + lookPitch, this._spin, g.lean);
    this.gesture.scale.set(g.sx, g.sy, g.sx);

    // whole-body turn: face travel direction + subtle lean toward cursor
    const faceTurn = (this.facing > 0 ? 0.35 : -0.35) + this.baseYaw;
    const lookYaw = s !== 'sleep' ? this.look.x * 0.25 : 0;
    this.root.rotation.y = damp(this.root.rotation.y, faceTurn + lookYaw, 8, dt);

    // auto-return one-shot states
    const dur = this._oneShotDuration(s);
    if (dur && st >= dur) {
      const cb = this.onStateEnd; this.onStateEnd = null;
      this.setState('idle');
      if (cb) cb();
    }
  }

  // ---------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------
  update(dt, t, ctx) {
    if (!this.ready) return;                              // body not built yet

    if (this.detailed) {
      this.stateTime += dt;
      const nav = ctx && ctx.nav;
      this.modelObj.update(dt, t, {
        lookX: this.look.x, lookY: this.look.y, facing: this.facing,
        particles: ctx && ctx.particles,
        speed: nav ? nav.speedN : 0,
        vx: nav ? Math.max(-1, Math.min(1, nav.vx / nav.maxSpeed)) : 0,
      });
      const dur = this._oneShotDuration(this.state);
      if (dur && this.stateTime >= dur) {
        const cb = this.onStateEnd; this.onStateEnd = null;
        this.setState('idle');
        if (cb) cb();
      }
      return;
    }

    if (this.rigless) return this._updateRigless(dt, t, ctx);

    this.stateTime += dt;
    const p = this.pose;
    const P = this._neutralPose();   // reset targets each frame, then override
    Object.assign(p, P);

    const s = this.state;
    const st = this.stateTime;

    // ---- blink scheduling (skip while sleeping) ----
    if (s !== 'sleep') {
      this._nextBlink -= dt;
      if (this._nextBlink <= 0) { this._blinkT = 0.16; this._nextBlink = 2.5 + Math.random() * 4; }
      if (this._blinkT > 0) { this._blinkT -= dt; p.eyeOpen = 0.1; }
    }

    switch (s) {
      case 'walk': {
        const sp = 9;
        p.legLx = Math.sin(t * sp) * 0.6;
        p.legRx = -Math.sin(t * sp) * 0.6;
        p.armLx = -Math.sin(t * sp) * 0.5;
        p.armRx = Math.sin(t * sp) * 0.5;
        p.bobY = Math.abs(Math.sin(t * sp)) * 0.06;
        break;
      }
      case 'run': {
        const sp = 14;
        p.legLx = Math.sin(t * sp) * 0.9;
        p.legRx = -Math.sin(t * sp) * 0.9;
        p.armLx = -Math.sin(t * sp) * 0.8;
        p.armRx = Math.sin(t * sp) * 0.8;
        p.bobY = Math.abs(Math.sin(t * sp)) * 0.12;
        p.lean = 0.18 * this.facing;
        break;
      }
      case 'wave':
        p.armRz = -1.9 + Math.sin(t * 12) * 0.35;
        p.armRx = -0.3;
        p.headTilt = 0.08;
        p.mouth = 1.3;
        p.bobY = Math.sin(t * 3) * 0.03;
        break;
      case 'think':
        p.armRz = -1.2; p.armRx = -1.1;   // hand to chin
        p.headTilt = 0.18; p.headPitch = 0.12;
        p.mouth = 0.5;
        if (Math.random() < dt * 2.2 && ctx) ctx.particles?.think(this._worldHead(0.2, 0.4));
        break;
      case 'work':
        p.headPitch = 0.35; p.bobY = -0.06;
        p.armLx = -1.1; p.armRx = -1.1;
        p.armLz = 0.4; p.armRz = -0.4;
        p.legLx = 1.4; p.legRx = 1.4;     // sitting
        this.badgeTarget = 0.6 + Math.sin(t * 6) * 0.35;
        break;
      case 'read':
        p.headPitch = 0.4; p.armLx = -1.2; p.armRx = -1.2;
        p.legLx = 1.4; p.legRx = 1.4; p.bobY = -0.08;
        break;
      case 'drinkTea':
        p.armRx = -1.6; p.armRz = -0.5; p.headPitch = 0.15;
        p.legLx = 1.3; p.legRx = 1.3; p.bobY = -0.06;
        if (Math.random() < dt * 3 && ctx) ctx.particles?.steam(this._worldHead(0.25, 0.1));
        break;
      case 'celebrate':
        p.armLz = 1.9; p.armRz = -1.9; p.armLx = -0.4; p.armRx = -0.4;
        p.hop = Math.abs(Math.sin(t * 7)) * 0.32;
        p.mouth = 1.6; p.headTilt = Math.sin(t * 6) * 0.1;
        this.badgeTarget = 1;
        if (st < 0.05 && ctx) ctx.particles?.confetti(this._worldHead(0, 0.6), 30);
        break;
      case 'excited':
        p.hop = Math.abs(Math.sin(t * 9)) * 0.18; p.mouth = 1.5;
        p.armLz = 0.5; p.armRz = -0.5;
        break;
      case 'dance':
        p.lean = Math.sin(t * 4) * 0.25;
        p.armLz = 0.8 + Math.sin(t * 8) * 0.6;
        p.armRz = -0.8 - Math.sin(t * 8) * 0.6;
        p.hop = Math.abs(Math.sin(t * 8)) * 0.16;
        p.headTilt = Math.sin(t * 4) * 0.15; p.mouth = 1.4;
        break;
      case 'stretch':
        p.armLz = 1.6; p.armRz = -1.6; p.armLx = -0.6; p.armRx = -0.6;
        p.lean = Math.sin(t * 2) * 0.06; p.bobY = 0.05;
        break;
      case 'brushTeeth':
        p.armRx = -1.5; p.armRz = -0.2;
        p.headTilt = 0.1;
        p.lean = Math.sin(t * 14) * 0.04;  // scrub
        if (Math.random() < dt * 4 && ctx) ctx.particles?.steam(this._worldHead(0.2, -0.1));
        break;
      case 'sleep':
        p.headPitch = 0.5; p.headTilt = 0.12; p.eyeOpen = 0.05;
        p.bobY = Math.sin(t * 1.2) * 0.04 - 0.05; p.mouth = 0.3;
        p.legLx = 0.2; p.legRx = -0.2;
        if (Math.random() < dt * 1.2 && ctx) ctx.particles?.zzz(this._worldHead(0.3, 0.6));
        break;
      case 'wakeUp':
        if (st < 1.0) { p.armLz = 1.5; p.armRz = -1.5; p.bobY = 0.05; } // stretch
        else { p.headTilt = Math.sin(t * 8) * 0.05; }                    // shake off
        p.eyeOpen = Math.min(1, st);
        break;
      case 'confused':
        p.headTilt = Math.sin(t * 3) * 0.2; p.mouth = 0.4;
        p.armRz = -0.6; p.armRx = -0.3;
        break;
      case 'proud':
        p.lean = 0; p.bobY = 0.04; p.mouth = 1.3;
        p.armLz = 0.3; p.armRz = -0.3; p.headPitch = -0.08;
        break;
      case 'idle':
      default:
        this.badgeTarget = 0.6;          // resting glow
        p.bobY = Math.sin(t * 1.8) * 0.035;
        p.armLz = 0.08 + Math.sin(t * 1.8) * 0.04;
        p.armRz = -0.08 - Math.sin(t * 1.8) * 0.04;
        p.headTilt = Math.sin(t * 0.7) * 0.04;
        p.leafSway = Math.sin(t * 2.2) * 0.12;
        break;
    }

    // Eyes/head follow cursor (subtle), unless sleeping/working head-down
    if (s !== 'sleep') {
      p.headYaw += this.look.x * 0.25;
      p.headPitch += -this.look.y * 0.12;
    }

    // ---- damp current pose toward targets ----
    const L = 12;
    for (const k in p) this.cur[k] = damp(this.cur[k], p[k], L, dt);
    const c = this.cur;

    // ---- apply to rig ----
    this.bob.position.y = c.bobY + c.hop;
    this.body.rotation.z = c.lean;
    this.root.rotation.y = damp(this.root.rotation.y,
      this.facing > 0 ? 0.35 : -0.35, 8, dt);

    this.head.rotation.set(c.headPitch, c.headYaw, c.headTilt);
    this.armL.rotation.set(c.armLx, 0, c.armLz);
    this.armR.rotation.set(c.armRx, 0, c.armRz);
    this.legL.rotation.x = c.legLx;
    this.legR.rotation.x = c.legRx;
    this.leaf.rotation.z = c.leafSway;

    // eyes
    const setEye = (e) => {
      e.userData.white.scale.y = 1.15 * Math.max(0.08, c.eyeOpen);
      e.userData.pupil.position.x = this.look.x * 0.05;
      e.userData.pupil.position.y = this.look.y * 0.04;
    };
    setEye(this.eyeL); setEye(this.eyeR);
    this.mouth.scale.set(c.mouth, c.mouth, 1);

    // badge emissive (badgeTarget persists; states/emotions set it)
    this.badge.material.emissiveIntensity = damp(
      this.badge.material.emissiveIntensity, this.badgeTarget, 8, dt);

    // ---- pet follows ----
    if (this.pet) {
      const targetX = this.root.position.x - 55 * this.facing;
      this.petX = damp(this.petX, targetX, 4, dt);
      this.pet.position.x = this.petX;
      this.pet.position.y = Math.abs(Math.sin(t * 6)) * 6;
      this.pet.rotation.y = damp(this.pet.rotation.y, this.facing > 0 ? 0.3 : -0.3, 6, dt);
      this.pet.children[2].material.emissiveIntensity = 0.5 + Math.sin(t * 8) * 0.4;
    }

    // ---- auto-return one-shot states ----
    const dur = this._oneShotDuration(s);
    if (dur && st >= dur) {
      const cb = this.onStateEnd; this.onStateEnd = null;
      this.setState('idle');
      if (cb) cb();
    }
  }

  /** World position offset from head anchor (local x,y in EON units). */
  _worldHead(x = 0, y = 0) {
    const v = new THREE.Vector3(x, y, 0);
    this.headAnchor.localToWorld(v);
    return v;
  }

  /** World position of EON's feet (for footstep particles). */
  worldFeet() {
    return new THREE.Vector3(this.root.position.x, this.root.position.y + 4, 6);
  }

  setPosition(x, groundY) {
    this.root.position.set(x, groundY, 0);
  }
}
