/* ============================================================
   EON — den-engine.js
   A DEDICATED second 3D engine for EON's house. It builds the room
   AND hosts a real EON (reusing EonModel — his code is untouched) so
   he genuinely sleeps in the bed, sits at the desk/chair and roams.
   Because the room and EON share ONE scene here, his placement is
   pixel-accurate — without merging anything into the main avatar.

   It renders to its own canvas, runs its own loop, and is completely
   optional: main.js shows/hides it from Settings → House. Nothing here
   reaches back into the live avatar.

   Public:  start() · show(on) · setActive(on) · setSize(scale) · dispose()
   ============================================================ */
import * as THREE from 'three';
import { EonModel } from './eon-model.js';

// ---- tuning knobs (easy to nudge after a look) ----
const EON_SCALE = 0.42;          // EON's size inside the room
const FEET_Y    = 0.0;           // vertical fudge so his feet meet the floor/seat
// Where EON rests, matched to the room furniture. y = surface his feet/seat sit on.
const SPOTS = {
  bed:   { x: 2.1,  y: 0.66, z: -2.4, yaw: -0.5, state: 'sleep', lie: true,  hold: [9, 16] },
  chair: { x: -2.0, y: 0.9,  z: 1.2,  yaw: 0.2,  state: 'read',  lie: false, hold: [7, 13] },
  desk:  { x: 2.0,  y: 0.95, z: 0.95, yaw: Math.PI, state: 'work', lie: false, hold: [8, 14] },
  roam:  { x: 0.2,  y: 0.0,  z: 0.7,  yaw: 0.4,  state: 'walk',  lie: false, hold: [4, 7] },
};
const ORDER = ['roam', 'chair', 'roam', 'desk', 'roam', 'bed'];

export class DenEngine {
  constructor() { this.built = false; this._visible = false; this._active = false; this._raf = 0; }

  start() { if (!this.built) this._build(); }

  // ---------------- build ----------------
  _build() {
    const cv = document.createElement('canvas'); cv.id = 'eon-den-canvas';
    const st = document.createElement('style');
    st.textContent = `
      #eon-den-canvas{position:fixed;right:0;bottom:0;width:520px;height:440px;pointer-events:none;
        z-index:2147482000;opacity:0;transform-origin:bottom right;transition:opacity .45s ease;}
      #eon-den-canvas.show{opacity:1;}`;
    document.head.appendChild(st);
    document.body.appendChild(cv);
    this.cv = cv;

    const r = this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setClearColor(0x000000, 0);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;

    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    this._target = new THREE.Vector3(0.2, 0.9, 0.4);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ee, 0.65));
    const sun = new THREE.DirectionalLight(0xfff2da, 1.15); sun.position.set(7, 12, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const S = 10; Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 40 });
    sun.shadow.bias = -0.0004; sun.shadow.radius = 4; scene.add(sun);
    const winL = new THREE.DirectionalLight(0xbfe0ff, 0.35); winL.position.set(0, 4, -9); scene.add(winL);

    this._buildRoom(scene);
    this._buildEon(scene);

    this._clock = new THREE.Clock();
    this._resize();
    addEventListener('resize', () => this._resize(), { passive: true });
    this.built = true;
    this._loop();
  }

  // ---------------- room (ported to r160) ----------------
  _mat(c, o = {}) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: o.r != null ? o.r : 0.8, metalness: o.m || 0,
      emissive: o.e || 0x000000, emissiveIntensity: o.ei || 0, transparent: !!o.t, opacity: o.o != null ? o.o : 1 });
  }
  _box(w, h, d, m) { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.castShadow = me.receiveShadow = true; return me; }
  _cyl(rt, rb, h, m, s) { const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s || 24), m); me.castShadow = me.receiveShadow = true; return me; }
  _put(p, o, x, y, z) { o.position.set(x || 0, y || 0, z || 0); p.add(o); return o; }
  _outlines(root, color) {
    const ms = []; root.traverse((o) => { if (o.isMesh) ms.push(o); });
    ms.forEach((m) => {
      if (m.material && m.material.transparent && m.material.opacity < 0.99) return;
      const eg = new THREE.EdgesGeometry(m.geometry, 28);
      const ls = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
      ls.position.copy(m.position); ls.quaternion.copy(m.quaternion); ls.scale.copy(m.scale); m.parent.add(ls);
    });
  }
  _woodTex() {
    const w = 512, h = 512, cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
    g.fillStyle = '#b9895a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { const y = i * h / 8; g.fillStyle = i % 2 ? '#b07e50' : '#c0915f'; g.fillRect(0, y, w, h / 8);
      g.strokeStyle = 'rgba(90,60,30,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  _emblem(fg) {
    const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s; const g = cv.getContext('2d');
    g.strokeStyle = fg; g.lineWidth = 16; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 26, 0, 7); g.stroke();
    g.fillStyle = fg; g.font = '700 150px Georgia,serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('e', s / 2, s / 2 + 8);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  _screenTex() {
    const w = 320, h = 200, cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0f78dc'); gr.addColorStop(1, '#0b4fa0'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.92)'; g.font = '700 70px Georgia,serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('e', w * 0.22, h * 0.5);
    g.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 5; i++) g.fillRect(w * 0.4, 30 + i * 30, w * 0.45 * 0.8, 10);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  _buildRoom(scene) {
    const P = { wood: 0xb9895a, woodDark: 0x8a6038, wall: 0xf3f1ea, navy: 0x12326a, royal: 0x2f7be0, cyan: 0x1fc8e0,
      green: 0x86c83a, purple: 0x7b63d8, cream: 0xeef0f5, white: 0xf8fafc, metal: 0x3a4256, lampGlow: 0xffd58a };
    const M = (c, o) => this._mat(c, o), box = (w, h, d, m) => this._box(w, h, d, m), cyl = (a, b, c, m, s) => this._cyl(a, b, c, m, s), put = (p, o, x, y, z) => this._put(p, o, x, y, z);
    const room = new THREE.Group(); scene.add(room); this.room = room;

    const floor = box(8, 0.3, 8, new THREE.MeshStandardMaterial({ map: this._woodTex(), roughness: 0.7 }));
    floor.position.y = -0.15; floor.receiveShadow = true; room.add(floor);

    const wavyTop = (x) => 1.35 + 0.16 * Math.sin(x * 1.05 + 0.6) + 0.085 * Math.sin(x * 2.6 + 1.2) + 0.05 * Math.sin(x * 4.7 + 0.2);
    const wavyWall = (len) => {
      const sh = new THREE.Shape(); sh.moveTo(-len / 2, 0); sh.lineTo(len / 2, 0);
      const N = 64; for (let i = 0; i <= N; i++) { const x = len / 2 - i * (len / N); sh.lineTo(x, wavyTop(x)); }
      sh.lineTo(-len / 2, 0);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: false }); geo.translate(0, 0, -0.1);
      const m = new THREE.Mesh(geo, M(P.wall, { r: 0.95 })); m.castShadow = m.receiveShadow = true; return m;
    };
    const backW = wavyWall(8); backW.position.set(0, 0, -3.9); room.add(backW);
    put(room, box(8, 0.55, 0.06, M(P.navy, { r: 0.8 })), 0, 0.275, -3.78);
    const leftW = wavyWall(8); leftW.rotation.y = Math.PI / 2; leftW.position.set(-3.9, 0, 0); room.add(leftW);
    put(room, box(0.06, 0.55, 8, M(P.navy, { r: 0.8 })), -3.78, 0.275, 0);
    // window
    put(room, box(1.5, 0.55, 0.05, M(0xbfe6ff, { e: 0xbfe6ff, ei: 0.55, r: 0.2 })), 1.4, 0.92, -3.77);
    put(room, box(1.66, 0.1, 0.12, M(P.white, { r: 0.6 })), 1.4, 1.22, -3.76);
    put(room, box(1.66, 0.1, 0.12, M(P.white, { r: 0.6 })), 1.4, 0.62, -3.76);
    // rug
    put(room, cyl(2.0, 2.0, 0.04, M(P.navy, { r: 0.9 }), 40), 0.2, 0.02, 0.6);
    put(room, cyl(1.6, 1.6, 0.05, M(P.green, { r: 0.9 }), 40), 0.2, 0.025, 0.6);
    put(room, cyl(1.2, 1.2, 0.06, M(P.navy, { r: 0.9 }), 40), 0.2, 0.03, 0.6);
    put(room, cyl(0.7, 0.7, 0.07, M(P.cyan, { r: 0.8 }), 40), 0.2, 0.035, 0.6);

    const bed = new THREE.Group(); bed.position.set(2.1, 0, -2.4); room.add(bed);
    put(bed, box(1.8, 0.45, 2.9, M(P.woodDark, { r: 0.7 })), 0, 0.22, 0);
    put(bed, box(1.7, 0.28, 2.7, M(P.cream, { r: 0.9 })), 0, 0.5, 0);
    put(bed, box(1.74, 0.18, 1.7, M(P.royal, { r: 0.85 })), 0, 0.62, 0.45);
    put(bed, box(1.5, 0.22, 0.5, M(P.white, { r: 0.9 })), 0, 0.66, -1.05);
    put(bed, box(1.85, 1.0, 0.2, M(P.navy, { r: 0.7 })), 0, 0.62, -1.45);

    const chair = new THREE.Group(); chair.position.set(-2.0, 0, 1.2); room.add(chair);
    put(chair, box(1.2, 0.45, 1.1, M(P.green, { r: 0.85 })), 0, 0.42, 0);
    put(chair, box(1.1, 0.35, 1.0, M(0x9bd84a, { r: 0.8 })), 0, 0.7, 0);
    put(chair, box(1.2, 1.0, 0.3, M(P.green, { r: 0.85 })), 0, 0.95, -0.5);
    put(chair, box(0.25, 0.6, 1.0, M(P.green, { r: 0.85 })), 0.62, 0.7, 0);
    put(chair, box(0.25, 0.6, 1.0, M(P.green, { r: 0.85 })), -0.62, 0.7, 0);

    const st = new THREE.Group(); st.position.set(-3.2, 0, 1.0); room.add(st);
    put(st, cyl(0.45, 0.45, 0.1, M(P.woodDark, { r: 0.6 }), 24), 0, 0.78, 0);
    put(st, cyl(0.06, 0.06, 0.78, M(P.metal, { m: 0.6, r: 0.4 }), 16), 0, 0.39, 0);
    put(st, cyl(0.12, 0.1, 0.16, M(P.white, { r: 0.4 }), 20), 0, 0.9, 0);

    const lampG = new THREE.Group(); lampG.position.set(-3.4, 0, 2.7); room.add(lampG);
    put(lampG, cyl(0.22, 0.26, 0.06, M(P.metal, { m: 0.6, r: 0.4 }), 18), 0, 0.03, 0);
    put(lampG, cyl(0.04, 0.04, 2.0, M(P.metal, { m: 0.6, r: 0.4 }), 12), 0, 1.0, 0);
    this._shade = put(lampG, cyl(0.34, 0.24, 0.4, M(P.cream, { e: P.lampGlow, ei: 0.5, r: 0.7, t: 1, o: 0.95 }), 20), 0, 2.1, 0);

    const desk = new THREE.Group(); desk.position.set(2.0, 0, 1.9); room.add(desk);
    put(desk, box(2.0, 0.12, 0.95, M(P.wood, { r: 0.6 })), 0, 1.1, 0);
    [[0.9, 0.38], [-0.9, 0.38], [0.9, -0.38], [-0.9, -0.38]].forEach((p) => put(desk, box(0.1, 1.1, 0.1, M(P.woodDark, { r: 0.6 })), p[0], 0.55, p[1]));
    const lap = new THREE.Group(); desk.add(lap); lap.position.set(0, 1.17, 0.06);
    put(lap, box(0.7, 0.04, 0.46, M(P.metal, { m: 0.5, r: 0.4 })), 0, 0, 0);
    const scr = put(lap, box(0.7, 0.46, 0.03, M(0x10151f, { r: 0.4 })), 0, 0.22, -0.2); scr.rotation.x = 0.4;
    this._screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), new THREE.MeshStandardMaterial({ map: this._screenTex(), emissive: 0xffffff, emissiveMap: this._screenTex(), emissiveIntensity: 0.9, roughness: 0.3 }));
    put(scr, this._screen, 0, 0, 0.02);
    const stool = new THREE.Group(); stool.position.set(2.0, 0, 0.85); room.add(stool);
    put(stool, cyl(0.42, 0.42, 0.14, M(P.royal, { r: 0.7 }), 24), 0, 0.85, 0);
    put(stool, cyl(0.05, 0.05, 0.85, M(P.metal, { m: 0.6, r: 0.4 }), 16), 0, 0.42, 0);

    const plant = new THREE.Group(); plant.position.set(3.2, 0, 2.9); room.add(plant);
    put(plant, cyl(0.28, 0.22, 0.4, M(P.purple, { r: 0.6 }), 18), 0, 0.2, 0);
    put(plant, cyl(0.04, 0.05, 0.5, M(P.green, { r: 0.6 }), 10), 0, 0.6, 0);
    const leaf = (x, rz) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 14), M(P.green, { r: 0.6 })); l.scale.set(0.5, 1.1, 0.28); l.position.set(x, 0.85, 0); l.rotation.z = rz; plant.add(l); return l; };
    this._lf1 = leaf(-0.12, 0.6); this._lf2 = leaf(0.12, -0.6);

    const shelf = new THREE.Group(); shelf.position.set(-1.1, 0, -3.74); room.add(shelf);
    put(shelf, box(1.2, 1.8, 0.3, M(P.woodDark, { r: 0.7 })), 0, 0.9, 0);
    const cols = [P.royal, P.green, P.purple, P.cyan, P.navy];
    for (let sY = 0; sY < 3; sY++) for (let bx = 0; bx < 5; bx++) put(shelf, box(0.12, 0.34, 0.22, M(cols[(bx + sY) % 5], { r: 0.7 })), -0.45 + bx * 0.22, 0.5 + sY * 0.5, 0.06);

    [bed, chair, st, lampG, desk, stool, plant, shelf].forEach((g) => this._outlines(g, 0x232b3c));
  }

  // ---------------- the real EON, inside the room ----------------
  _buildEon(scene) {
    this.model = new EonModel(this.renderer);
    if (this.model.env) scene.environment = this.model.env;
    const mover = this.mover = new THREE.Group();   // positions/rotates him at furniture
    mover.scale.setScalar(EON_SCALE);
    mover.add(this.model.eon);
    mover.visible = false;
    scene.add(mover);
    this._pos = new THREE.Vector3(SPOTS.roam.x, SPOTS.roam.y, SPOTS.roam.z);
    this._spot = 'roam'; this._oi = 0; this._holdUntil = 0; this._moving = false;
    this.model.setState('happy');
    this._applySpot(SPOTS.roam, true);
  }
  _applySpot(s, snap) {
    if (snap) this._pos.set(s.x, s.y, s.z);
    this.mover.position.set(this._pos.x, this._pos.y + FEET_Y, this._pos.z);
    this.mover.rotation.x += ((s.lie ? -1.25 : 0) - this.mover.rotation.x) * (snap ? 1 : 0.12);
    this.mover.rotation.y += (s.yaw - this.mover.rotation.y) * (snap ? 1 : 0.12);
  }

  // ---------------- per-frame life ----------------
  _stepLife(dt, t) {
    if (!this._active) return;
    const now = t;
    const s = SPOTS[this._spot];
    if (this._moving) {
      const tx = s.x, tz = s.z;
      this._pos.x += (tx - this._pos.x) * Math.min(1, dt * 2.2);
      this._pos.z += (tz - this._pos.z) * Math.min(1, dt * 2.2);
      this._pos.y += (s.y - this._pos.y) * Math.min(1, dt * 2.2);
      this.mover.position.set(this._pos.x, this._pos.y + FEET_Y, this._pos.z);
      this.mover.rotation.y += (Math.atan2(tx - this.mover.position.x, tz - this.mover.position.z) * 0 + s.yaw - this.mover.rotation.y) * 0.1;
      if (Math.hypot(tx - this._pos.x, tz - this._pos.z) < 0.06) {
        this._moving = false; this.model.setState(s.state);
        this._holdUntil = now + (s.hold[0] + Math.random() * (s.hold[1] - s.hold[0]));
      }
    } else {
      this._applySpot(s, false);
      if (now >= this._holdUntil) {
        this._oi = (this._oi + 1) % ORDER.length;
        this._spot = ORDER[this._oi];
        this.mover.rotation.x += (0 - this.mover.rotation.x) * 1;   // stand up before walking
        this.model.setState('walk'); this._moving = true;
      }
    }
  }

  // ---------------- loop ----------------
  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    if (!this._visible) return;                       // don't render while hidden
    const dt = Math.min(this._clock.getDelta(), 0.05), t = this._clock.elapsedTime;
    this._applyCam();
    try { this.model.update(dt, t, {}); } catch {}
    this._stepLife(dt, t);
    if (this._screen) this._screen.material.emissiveIntensity = 0.8 + Math.sin(t * 9) * 0.06;
    if (this._lf1) { this._lf1.rotation.x = Math.sin(t * 1.2) * 0.06; this._lf2.rotation.x = Math.sin(t * 1.2 + 0.5) * 0.06; }
    this.renderer.render(this.scene, this.camera);
  }
  _applyCam() {
    const az = 0.5, pol = 0.95, dist = 14;
    this.camera.position.set(this._target.x + dist * Math.sin(pol) * Math.sin(az),
      this._target.y + dist * Math.cos(pol), this._target.z + dist * Math.sin(pol) * Math.cos(az));
    this.camera.lookAt(this._target);
  }
  _resize() {
    if (!this.cv) return;
    const w = this.cv.clientWidth || 520, h = this.cv.clientHeight || 440;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------------- public ----------------
  show(on) { this._visible = !!on; this.cv?.classList.toggle('show', this._visible); if (this._visible) this._clock?.start(); }
  setActive(on) {                                     // is EON currently AT home?
    this._active = !!on;
    if (this.mover) this.mover.visible = this._active;
    if (on) { this._spot = ORDER[0]; this._oi = 0; this._moving = false; this._holdUntil = (this._clock?.elapsedTime || 0) + 3; this.model?.setState(SPOTS.roam.state); }
  }
  setSize(scale) { if (this.cv) this.cv.style.transform = `scale(${scale})`; }
  dispose() { cancelAnimationFrame(this._raf); this.cv?.remove(); }
}
