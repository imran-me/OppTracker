/* ============================================================
   EON — eon-model.js
   The detailed procedural EON (ported from the standalone build,
   adapted to three r160 ES modules + EXTERNAL control). It only
   builds geometry/materials and animates itself each frame from
   values the companion supplies (look direction, facing, state).
   No camera/renderer/loop/UI of its own.

   Public API used by character-controller.js:
     .eon          THREE.Group   (add to the scene graph)
     .head .body   THREE.Group   (used to measure standing height)
     .headAnchor   THREE.Object3D (bubble / look anchor, head-top)
     .env          THREE.Texture  (studio env for the glossy look)
     .setState(name)              // 'happy','wave','tea',... (CFG keys)
     .update(dt, t, { lookX, lookY, facing, particles })
   ============================================================ */
import * as THREE from 'three';

const C = {
  navy: 0x0A2C5B, hood: 0x0E78DC, royal: 0x0E78DC, cyan: 0x1DC7E4,
  green: 0xAAE545, greenSoft: 0xBCEE63, purple: 0x7E6BD9, lightPurple: 0xB2A3F3,
  white: 0xffffff, mouth: 0x1DC7E4, mouthLip: 0xffffff, tongue: 0xff6f91, soleW: 0xE8ECF0,
  wood: 0x7a4a26, screen: 0x0E78DC,
};

// Full-body emotes (PUBG/Free-Fire style). dur = seconds; face = expression
// override; the body motion itself lives in EonModel._runEmote().
const EMOTE_DEF = {
  spin:  { dur: 1.3, face: { eL: 'happy', eR: 'happy' } },
  dance: { dur: 3.6, face: { eL: 'happy', eR: 'happy', mouth: 'open' } },
  sing:  { dur: 4.0, face: { mouth: 'open', eL: 'happy', eR: 'happy' } },
  think: { dur: 3.0, face: { mouth: 'smile', tilt: 0.18, hx: 0.16 } },
  wave:  { dur: 2.2, face: { mouth: 'smile' } },
  kick:  { dur: 1.3, face: { eL: 'happy', eR: 'happy' } },
  jump:  { dur: 1.1, face: { mouth: 'open' } },
  cheer: { dur: 2.6, face: { eL: 'happy', eR: 'happy', mouth: 'open' } },
  point: { dur: 2.4, face: { mouth: 'smile' } },
  // Hype-man set (used when EON brags about his owner in public mode).
  proud:   { dur: 2.8, face: { eL: 'happy', eR: 'happy', mouth: 'smile' } },
  applaud: { dur: 2.8, face: { eL: 'happy', eR: 'happy', mouth: 'open' } },
  flex:    { dur: 2.4, face: { eL: 'happy', eR: 'happy', mouth: 'open' } },
  // Companion expressions (used by the owner-mode helpers).
  idea:     { dur: 2.0, face: { eL: 'open', eR: 'open', mouth: 'o' } },
  facepalm: { dur: 2.2, face: { mouth: 'smile', tilt: 0.06 } },
  shrug:    { dur: 2.0, face: { mouth: 'smile' } },
  peek:     { dur: 2.6, face: { eL: 'open', eR: 'open', mouth: 'smile' } },
  sleepy:   { dur: 2.8, face: { eL: 'closed', eR: 'closed', mouth: 'smile' } },
  sad:      { dur: 2.2, face: { eL: 'open', eR: 'open', mouth: 'o' } },
  nod:      { dur: 1.6, face: { mouth: 'smile' } },
  // Owner-coach set (section-aware reactions).
  lookWatch:  { dur: 2.6, face: { mouth: 'smile', tilt: 0.10, hx: 0.14 } },   // checks wrist — deadlines
  salute:     { dur: 2.0, face: { eL: 'open', eR: 'open', mouth: 'smile' } }, // ready / acknowledge
  thumbsUp:   { dur: 2.2, face: { eL: 'happy', eR: 'happy', mouth: 'smile' } },
  heartHands: { dur: 2.6, face: { eL: 'happy', eR: 'happy', mouth: 'smile' } },
  bow:        { dur: 2.2, face: { mouth: 'smile' } },
  wink:       { dur: 1.8, face: { eL: 'closed', eR: 'happy', mouth: 'smile' } },
  surprised:  { dur: 2.0, face: { eL: 'open', eR: 'open', mouth: 'o' } },
  ponder:     { dur: 3.2, face: { mouth: 'smile', tilt: 0.16, hx: 0.14 } },
  typing:     { dur: 3.2, face: { mouth: 'smile', hx: 0.18 } },
  fistPump:   { dur: 1.8, face: { eL: 'happy', eR: 'happy', mouth: 'open' } },
};

export class EonModel {
  constructor(renderer) {
    this.renderer = renderer;
    this.state = 'happy';
    this._build();
    this._initAnim();
  }

  // ---------- material / helpers ----------
  _plastic(color, o = {}) {
    const emiss = (o.emissive != null) ? o.emissive : 0x000000;
    const ei = (o.emissive != null) ? (o.ei || 0) : 0;
    return new THREE.MeshPhysicalMaterial({
      color, roughness: o.rough != null ? o.rough : 0.5, metalness: 0,
      clearcoat: o.cc != null ? o.cc : 0.25, clearcoatRoughness: o.ccr != null ? o.ccr : 0.35,
      envMapIntensity: o.env != null ? o.env : 0.14, emissive: emiss, emissiveIntensity: ei,
      transparent: !!o.transparent, opacity: o.opacity != null ? o.opacity : 1,
    });
  }
  _add(p, m, x, y, z) { m.position.set(x || 0, y || 0, z || 0); m.castShadow = false; m.receiveShadow = false; p.add(m); return m; }

  _emblemTexture() {
    const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, s, s); g.strokeStyle = '#9BD943'; g.lineWidth = 16;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 24, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#9BD943'; g.font = '700 158px Georgia,serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('e', s / 2, s / 2 + 10);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  _bubbleTex(ch) {
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6C53D8'; g.font = '700 80px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, s / 2, s / 2 + 6);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  _studioEnv() {
    const w = 1024, h = 512, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#aebfe0'); gr.addColorStop(.5, '#7e93c4');
    gr.addColorStop(.75, '#566ea0'); gr.addColorStop(1, '#34456f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const rg = g.createRadialGradient(w * .3, h * .24, 0, w * .3, h * .24, 120);
    rg.addColorStop(0, 'rgba(255,255,255,.7)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(w * .3, h * .24, 120, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(cv); tex.mapping = THREE.EquirectangularReflectionMapping;
    const p = new THREE.PMREMGenerator(this.renderer);
    const env = p.fromEquirectangular(tex).texture; p.dispose(); tex.dispose();
    return env;
  }

  // ---------- build ----------
  _build() {
    const P = (c, o) => this._plastic(c, o), add = (p, m, x, y, z) => this._add(p, m, x, y, z);
    this.env = this._studioEnv();
    const eon = this.eon = new THREE.Group();

    // ---------------- HEAD ----------------
    const head = this.head = new THREE.Group(); head.position.y = 0.52; eon.add(head);
    const hood = add(head, new THREE.Mesh(new THREE.SphereGeometry(0.8, 64, 64), P(C.hood, { rough: 0.28, cc: 0.4 })), 0, 0.02, -0.05); hood.scale.set(1.02, 1.04, 0.98);
    add(head, new THREE.Mesh(new THREE.SphereGeometry(0.66, 64, 64), P(0x1f4488, { rough: 0.34, cc: 0.2 })), 0, -0.02, 0.12).scale.set(1.04, 1, 1);
    add(head, new THREE.Mesh(new THREE.TorusGeometry(0.625, 0.06, 24, 64), P(C.green, { rough: 0.3, cc: 0.3 })), 0, -0.02, 0.36).rotation.x = 0.13;
    const string = (x) => { const s = add(head, new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 10), P(C.greenSoft)), x, -0.62, 0.5); s.rotation.x = 0.18; return s; };
    string(-0.16); string(0.16);
    add(head, new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), P(C.greenSoft)), -0.16, -0.79, 0.56);
    add(head, new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), P(C.greenSoft)), 0.16, -0.79, 0.56);
    const sprout = this.sprout = new THREE.Group(); sprout.position.set(0, 0.74, -0.04); head.add(sprout);
    add(sprout, new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.18, 12), P(C.green)), 0, 0, 0);
    const leaf = (x, rot) => { const l = add(sprout, new THREE.Mesh(new THREE.SphereGeometry(0.18, 28, 28), P(C.green, { rough: 0.3, cc: 0.3 })), x, 0.16, 0); l.scale.set(0.5, 1.1, 0.26); l.rotation.z = rot; return l; };
    leaf(-0.13, 0.6); leaf(0.13, -0.6);
    const headphone = (side) => {
      const g = new THREE.Group(); g.position.set(0.78 * side, -0.02, -0.02); head.add(g);
      const cup = add(g, new THREE.Mesh(new THREE.SphereGeometry(0.22, 40, 40), P(C.purple, { rough: 0.32, cc: 0.3 })), 0, 0, 0); cup.scale.set(0.72, 1.05, 1.05);
      add(g, new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 16, 32), P(C.green)), 0.14 * side, 0, 0).rotation.y = Math.PI / 2;
      add(g, new THREE.Mesh(new THREE.CircleGeometry(0.08, 28), P(C.greenSoft)), 0.165 * side, 0, 0).rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; return g;
    };
    headphone(1); headphone(-1);
    add(head, new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.05, 18, 48, Math.PI), P(C.purple, { cc: 0.4 })), 0, 0, -0.06);

    const eyes = new THREE.Group(); head.add(eyes);
    const eye = (side) => {
      const g = new THREE.Group(); g.position.set(0.255 * side, 0.04, 0.62); eyes.add(g);
      const ball = new THREE.Group(); g.add(ball);
      const wMat = new THREE.MeshPhysicalMaterial({ color: C.white, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.9 });
      add(ball, new THREE.Mesh(new THREE.SphereGeometry(0.2, 40, 40), wMat), 0, 0, 0).scale.set(1, 1.22, 0.72);
      const iris = add(ball, new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 32), new THREE.MeshPhysicalMaterial({ color: C.cyan, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04, emissive: C.cyan, emissiveIntensity: 0.2, envMapIntensity: 1.0 })), 0, -0.01, 0.11); iris.scale.set(1, 1.06, 0.55);
      const pupil = add(ball, new THREE.Mesh(new THREE.SphereGeometry(0.07, 28, 28), P(C.navy, { rough: 0.2, cc: 1, ccr: 0.05 })), 0, -0.015, 0.18);
      add(g, new THREE.Mesh(new THREE.SphereGeometry(0.038, 18, 18), new THREE.MeshBasicMaterial({ color: 0xffffff })), 0.06, 0.08, 0.255);
      add(g, new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff })), -0.035, -0.02, 0.255);
      const lidMat = P(C.navy, { rough: 0.5, cc: 0.2 });
      const upper = add(g, new THREE.Mesh(new THREE.SphereGeometry(0.225, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.56), lidMat), 0, 0, 0);
      const lower = add(g, new THREE.Mesh(new THREE.SphereGeometry(0.225, 28, 18, 0, Math.PI * 2, Math.PI * 0.44, Math.PI * 0.56), lidMat), 0, 0, 0);
      upper.rotation.x = -1.4; lower.rotation.x = 1.4;
      const arc = add(g, new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 12, 28, Math.PI), lidMat), 0, -0.02, 0.2); arc.visible = false;
      return { ball, iris, pupil, upper, lower, arc };
    };
    this.eyeL = eye(-1); this.eyeR = eye(1);
    // Green arc eyebrows. Both sides use the SAME upper-arc orientation so the
    // left mirrors the right (the old `Math.PI + 0.25` put the left arc on the
    // lower half — an upside-down brow that read as missing). Mirror angle:
    //   right = -0.25 ; left = π - (-0.25) - 0.85π = 0.15π + 0.25
    const brow = (side) => { const b = add(head, new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 12, 24, Math.PI * 0.85), P(C.green)), 0.255 * side, 0.3, 0.64); b.rotation.z = side > 0 ? -0.25 : (0.15 * Math.PI + 0.25); return b; };
    brow(-1); brow(1);
    // Always-visible smile — white so it reads clearly against the navy face
    // (the old cyan blended in and only showed during big open expressions).
    this.mSmile = add(head, new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.042, 16, 32, Math.PI), P(C.mouthLip, { cc: 0.4, ccr: 0.2, emissive: C.mouthLip, ei: 0.3 })), 0, -0.22, 0.66); this.mSmile.rotation.z = Math.PI;
    const mOpen = this.mOpen = new THREE.Group(); mOpen.position.set(0, -0.24, 0.64); head.add(mOpen);
    add(mOpen, new THREE.Mesh(new THREE.SphereGeometry(0.12, 28, 28), P(C.mouth, { cc: 0.2, emissive: C.mouth, ei: 0.85 })), 0, 0, 0).scale.set(1.1, 0.85, 0.55);
    add(mOpen, new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 20), P(C.tongue, { cc: 0.2 })), 0, -0.045, 0.05).scale.set(1, 0.7, 0.6);
    mOpen.visible = false;
    this.mO = add(head, new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.022, 12, 24), P(C.mouth, { cc: 0.2, emissive: C.mouth, ei: 0.85 })), 0, -0.24, 0.66); this.mO.visible = false;

    // ---------------- BODY ----------------
    const body = this.body = new THREE.Group(); body.position.y = -0.62; eon.add(body);
    add(body, new THREE.Mesh(new THREE.SphereGeometry(0.52, 48, 48), P(C.hood, { rough: 0.55, cc: 0.1 })), 0, 0.05, 0).scale.set(1, 1.08, 0.9);
    add(body, new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.46, 0.22, 40), P(C.hood, { rough: 0.55, cc: 0.1 })), 0, -0.34, 0);
    add(body, new THREE.Mesh(new THREE.CircleGeometry(0.21, 40), new THREE.MeshPhysicalMaterial({ map: this._emblemTexture(), transparent: true, roughness: 0.5, clearcoat: 0.3 })), 0, 0.06, 0.48);
    add(body, new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), P(C.green, { rough: 0.4 })), 0, 0.34, 0.47);
    const strap = (side) => { const s = add(body, new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 12, 28, Math.PI * 0.9), P(C.purple, { rough: 0.32, cc: 0.3 })), 0.28 * side, 0.28, 0.18); s.rotation.x = 1.3; s.rotation.z = side > 0 ? 0.3 : -0.3; return s; };
    strap(-1); strap(1);
    const pack = new THREE.Group(); pack.position.set(0, -0.04, -0.46); body.add(pack);
    add(pack, new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.66, 0.2), P(C.green, { rough: 0.4 })), 0, 0, -0.02);
    add(pack, new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.26), P(C.purple, { rough: 0.4, cc: 0.3 })), 0, 0, 0);
    add(pack, new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.28), P(C.purple, { rough: 0.4, cc: 0.3 })), 0, -0.16, 0.01);
    add(pack, new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 16, 40), P(C.green, { rough: 0.4 })), 0, 0.06, -0.135);
    add(pack, new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), new THREE.MeshPhysicalMaterial({ map: this._emblemTexture(), transparent: true, roughness: 0.5 })), 0, 0.06, -0.135).rotation.y = Math.PI;

    const makeArm = (side) => {
      const shoulder = new THREE.Group(); shoulder.position.set(0.52 * side, 0.1, 0.1); body.add(shoulder);
      add(shoulder, new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 24), P(C.hood, { rough: 0.55, cc: 0.1 })), 0, 0, 0);
      add(shoulder, new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.3, 24), P(C.hood, { rough: 0.55, cc: 0.1 })), 0, -0.15, 0);
      const elbow = new THREE.Group(); elbow.position.set(0, -0.3, 0); shoulder.add(elbow);
      add(elbow, new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.115, 0.27, 24), P(C.hood, { rough: 0.55, cc: 0.1 })), 0, -0.135, 0);
      const hand = add(elbow, new THREE.Mesh(new THREE.SphereGeometry(0.185, 32, 32), P(C.hood, { rough: 0.3, cc: 0.35 })), 0, -0.3, 0); hand.scale.set(1.05, 1.05, 0.95);
      add(elbow, new THREE.Mesh(new THREE.SphereGeometry(0.085, 18, 18), P(C.hood, { rough: 0.3, cc: 0.35 })), 0.14 * side, -0.25, 0.06);
      add(elbow, new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 12, 24), P(C.green, { rough: 0.4 })), 0, -0.18, 0).rotation.x = Math.PI / 2;
      shoulder.rotation.set(0.1, 0, side > 0 ? 0.45 : -0.45); elbow.rotation.set(0.12, 0, 0);
      return { shoulder, elbow, hand, side };
    };
    this.armL = makeArm(-1); this.armR = makeArm(1);

    const legMake = (side) => {
      const g = new THREE.Group(); g.position.set(0.23 * side, -0.52, 0.02); body.add(g);
      add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.13, 0.3, 24), P(C.navy, { rough: 0.4, cc: 0.25 })), 0, -0.1, 0);
      const shoe = add(g, new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 32), P(C.hood, { rough: 0.28, cc: 0.4 })), 0, -0.28, 0.07); shoe.scale.set(1, 0.78, 1.35);
      const sole = add(g, new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 32), P(C.soleW, { rough: 0.45, cc: 0.2 })), 0, -0.34, 0.07); sole.scale.set(1.02, 0.42, 1.4);
      add(g, new THREE.Mesh(new THREE.SphereGeometry(0.17, 28, 28), P(C.navy, { rough: 0.4 })), 0, -0.28, -0.12).scale.set(0.95, 0.7, 0.7);
      add(g, new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.032, 14, 28), P(C.cyan, { rough: 0.2, cc: 0.5 })), 0, -0.2, 0.05).rotation.x = Math.PI / 2;
      add(g, new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 12, 24, Math.PI), P(C.green, { rough: 0.4 })), 0, -0.235, 0.1).rotation.x = Math.PI / 2; return g;
    };
    this.legL = legMake(-1); this.legR = legMake(1);

    const cap = this.cap = add(head, new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.66, 28), P(C.royal, { rough: 0.5, cc: 0.35 })), 0, 0.72, 0.04); cap.rotation.z = -0.38; cap.rotation.x = -0.12;
    add(cap, new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 18), P(C.white)), 0.2, 0.3, 0); cap.visible = false;

    // ---------------- PROPS ----------------
    const tea = this.tea = new THREE.Group(); tea.position.set(0.17, -0.11, 0.52); tea.rotation.set(-0.2, 0, 0.22); eon.add(tea);
    add(tea, new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.16, 28), P(C.white, { cc: 0.4 })), 0, 0, 0);
    add(tea, new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.022, 12, 24), P(C.white)), 0.14, 0, 0).rotation.y = Math.PI / 2;
    add(tea, new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), P(0x6b3b1a, { rough: 0.3 })), 0, 0.081, 0).rotation.x = -Math.PI / 2;
    this.steam = []; for (let si = 0; si < 3; si++) this.steam.push(add(tea, new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), P(C.white, { transparent: true, opacity: 0.5, rough: 0.9 })), (si - 1) * 0.04, 0.12, 0));
    tea.visible = false;

    const book = this.book = new THREE.Group(); book.position.set(0, -0.44, 0.64); book.rotation.set(-0.7, 0, 0); eon.add(book);
    add(book, new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.46), P(C.purple, { rough: 0.32, cc: 0.3 })), -0.17, 0, 0).rotation.z = 0.18;
    add(book, new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.46), P(C.purple, { rough: 0.32, cc: 0.3 })), 0.17, 0, 0).rotation.z = -0.18;
    add(book, new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.42), P(C.white, { rough: 0.7 })), -0.17, 0.02, 0).rotation.z = 0.18;
    add(book, new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.42), P(C.white, { rough: 0.7 })), 0.17, 0.02, 0).rotation.z = -0.18;
    book.visible = false;

    const work = this.work = new THREE.Group(); eon.add(work);
    add(work, new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.08, 0.52), P(C.wood, { rough: 0.6 })), 0, -0.82, 0.52);
    add(work, new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.34), P(0x12245f, { cc: 0.4 })), 0, -0.76, 0.5);
    add(work, new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.025), P(C.screen, { cc: 0.4 })), 0, -0.54, 0.34).rotation.x = -0.42;
    add(work, new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshBasicMaterial({ map: this._emblemTexture(), transparent: true })), 0, -0.54, 0.356).rotation.x = -0.42;
    work.visible = false;

    const bed = this.bed = new THREE.Group(); eon.add(bed); bed.visible = false;
    add(bed, new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.78), P(C.navy, { rough: 0.5 })), 0, -1.62, 0.06);
    add(bed, new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.2, 0.7), P(C.soleW, { rough: 0.6 })), 0, -1.5, 0.06);
    add(bed, new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.16, 0.42), P(C.royal, { rough: 0.5 })), 0, -1.42, 0.22);
    add(bed, new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.34), P(C.white, { rough: 0.6 })), 0, -1.4, -0.18).rotation.x = -0.12;
    add(bed, new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.1), P(C.navy, { rough: 0.5 })), 0, -1.4, -0.34);

    this.think = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._bubbleTex('?'), transparent: true }));
    this.think.scale.set(0.4, 0.4, 0.4); this.think.position.set(0.55, 1.5, 0.2); eon.add(this.think); this.think.visible = false;

    const confetti = this.confetti = new THREE.Group(); eon.add(confetti); confetti.visible = false;
    const ccols = [0x0967E0, 0x0ED1E2, 0x9BD943, 0x6C53D8, 0xB0A0F3];
    for (let ci = 0; ci < 70; ci++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: ccols[ci % ccols.length] }));
      m.position.set((Math.random() - 0.5) * 2.6, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2);
      m.userData = { vy: 0.6 + Math.random() * 0.9, vr: (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 0.3 }; confetti.add(m);
    }

    eon.position.y = 0.16; eon.scale.setScalar(0.92);

    // head-top anchor for the speech bubble / look projection
    this.headAnchor = new THREE.Object3D(); this.headAnchor.position.set(0, 1.05, 0.1); head.add(this.headAnchor);

    this._buildStates();
  }

  _buildStates() {
    this.CFG = {
      happy:     { eL: 'open', eR: 'open', mouth: 'smile', tilt: 0, hx: 0 },
      wave:      { eL: 'open', eR: 'open', mouth: 'smile', tilt: 0.03, hx: 0 },
      wink:      { eL: 'open', eR: 'happy', mouth: 'smile', tilt: 0.04, hx: 0 },
      curious:   { eL: 'open', eR: 'open', mouth: 'o', tilt: 0.22, hx: 0 },
      excited:   { eL: 'happy', eR: 'happy', mouth: 'open', tilt: 0, hx: 0 },
      thinking:  { eL: 'open', eR: 'open', mouth: 'smile', tilt: 0.2, hx: 0.12, bubble: true, mscale: 0.8 },
      sleep:     { eL: 'closed', eR: 'closed', mouth: 'smile', tilt: 0.22, hx: 0.42, cap: true, zzz: true, bed: true, mscale: 0.7 },
      walk:      { eL: 'open', eR: 'open', mouth: 'smile', tilt: 0, hx: 0 },
      tea:       { eL: 'open', eR: 'open', mouth: 'smile', tilt: 0.05, hx: 0.34, prop: 'tea', lidBase: 0.4 },
      read:      { eL: 'open', eR: 'open', mouth: 'smile', tilt: 0.04, hx: 0.32, prop: 'book', lidBase: 0.15 },
      work:      { eL: 'open', eR: 'open', mouth: 'smile', tilt: 0, hx: 0.26, prop: 'work' },
      celebrate: { eL: 'happy', eR: 'happy', mouth: 'open', tilt: 0, hx: -0.05, confetti: true },
    };
  }

  _armPose(state, t) {
    const w = Math.sin(t * 6), w9 = Math.sin(t * 9), ty = Math.sin(t * 10);
    switch (state) {
      case 'wave':      return [0.1, 0, -0.45, 0.12, 0, 0, 1.55 + Math.sin(t * 8) * 0.28, -0.35];
      case 'walk':      { const ww = Math.sin(this.walkPhase || 0) * (0.3 + 0.7 * (this._speed || 0)); return [0.1 + ww * 0.6, 0, -0.45, 0.2, 0.1 - ww * 0.6, 0, 0.45, 0.2]; }
      case 'tea':       return [0.1, 0, -0.45, 0.12, -1.10, 0.30, -1.00, -0.80];
      case 'read':      return [-1.15, -0.10, 0.76, -0.56, -1.15, 0.10, -0.76, -0.56];
      case 'work':      return [-0.55, 0, 0.68, -0.96 + ty * 0.06, -0.55, 0, -0.68, -0.96 + Math.cos(t * 10) * 0.06];
      case 'celebrate': return [-0.1, 0, -2.5, -0.25, -0.1, 0, 2.5, -0.25];
      case 'excited':   return [0, 0, -1.9 - w9 * 0.25, -0.3, 0, 0, 1.9 + w9 * 0.25, -0.3];
      case 'thinking':  return [0.1, 0, -0.45, 0.12, -1.05, 0.30, -0.95, -0.75];
      default:          return [0.1, 0, -0.45, 0.12, 0.1, 0, 0.45, 0.12];
    }
  }

  _initAnim() {
    this.prevY = 0.16; this.prevHZ = 0;
    this.sprVx = 0; this.sprAx = 0; this.sprVz = 0; this.sprAz = 0;
    this.gazeX = 0; this.gazeY = 0; this.gTx = 0; this.gTy = 0; this.gVx = 0; this.gVy = 0;
    this.fixT = 0; this.fixDur = 1.3;
    this.blinkT = 0; this.nextBlink = 2 + Math.random() * 2; this.blinking = false; this.blinkPh = 0; this.dbl = 0;
    this.turn = 0;
    this._hv = new THREE.Vector3();
  }

  setState(s) { if (this.CFG[s]) this.state = s; }

  _setEye(E, mode, close, gx, gy, dilT) {
    if (mode === 'happy') { E.arc.visible = true; E.ball.visible = false; E.upper.visible = false; E.lower.visible = false; return; }
    E.arc.visible = false; E.ball.visible = true; E.upper.visible = true; E.lower.visible = true;
    if (mode === 'closed') close = 1;
    E.upper.rotation.x = -1.4 + close * 1.85;
    E.lower.rotation.x = 1.4 - close * 1.85;
    E.ball.rotation.y = gx * 0.42; E.ball.rotation.x = -gy * 0.34;
    let ps = E.pupil.scale.x; ps += (dilT - ps) * 0.12; E.pupil.scale.setScalar(ps);
  }
  _lerpArm(arm, sx, sy, sz, ex, k) {
    arm.shoulder.rotation.x += (sx - arm.shoulder.rotation.x) * k;
    arm.shoulder.rotation.y += (sy - arm.shoulder.rotation.y) * k;
    arm.shoulder.rotation.z += (sz - arm.shoulder.rotation.z) * k;
    arm.elbow.rotation.x += (ex - arm.elbow.rotation.x) * k;
  }
  _guardArm(arm) {
    arm.hand.getWorldPosition(this._hv); this.eon.worldToLocal(this._hv);
    if (this._hv.y > -1.18 && this._hv.y < -0.02 && this._hv.z < 0.42) {
      const horiz = Math.abs(this._hv.x), need = 0.66;
      if (horiz < need) { const dir = arm.side > 0 ? 1 : -1; arm.shoulder.rotation.z += dir * (need - horiz) * 0.6; }
    }
  }

  // ---------- per-frame ----------
  update(dt, t, opts = {}) {
    const eon = this.eon, head = this.head, sprout = this.sprout;
    if (this._emote) { this._emote.t += dt; if (this._emote.t >= this._emote.dur) this._emote = null; }
    const cfg0 = this.CFG[this.state] || this.CFG.happy;
    const cfg = (this._emote && this._emote.face) ? { ...cfg0, ...this._emote.face } : cfg0;
    const facing = opts.facing || 1;
    const ptrX = opts.lookX || 0, ptrY = opts.lookY || 0;
    const particles = opts.particles || null;

    // --- locomotion cadence (steps scale with actual speed) ---
    const speed = opts.speed || 0;          // 0..1 fraction of max speed
    this._speed = speed;
    this.walkPhase = (this.walkPhase || 0) + dt * (4 + speed * 10);

    const slp = (this.state === 'sleep');
    const hop = (this.state === 'celebrate') ? Math.abs(Math.sin(t * 4)) * 0.12
              : (this.state === 'walk') ? Math.abs(Math.sin(this.walkPhase)) * 0.06 * speed : 0;
    eon.position.y = (slp ? 0.06 : 0.16) + Math.sin(t * 1.6) * (slp ? 0 : 0.05) + hop;

    // facing turn + gentle idle sway (stays upright — no tilt/lean)
    this.turn += (((facing > 0 ? 0.32 : -0.32)) - this.turn) * 0.08;
    const sway = Math.sin(t * 0.5) * 0.10;
    eon.rotation.y = this.turn + sway;
    eon.rotation.z = Math.sin(t * 1.2) * 0.014;

    head.rotation.z += ((cfg.tilt || 0) - head.rotation.z) * 0.08;

    // sprout secondary spring
    const vy = (eon.position.y - this.prevY) / Math.max(dt, 0.001); this.prevY = eon.position.y;
    const hzv = (head.rotation.z - this.prevHZ) / Math.max(dt, 0.001); this.prevHZ = head.rotation.z;
    this.sprVx += (-this.sprAx * 70 - this.sprVx * 9 - vy * 7) * dt; this.sprAx += this.sprVx * dt;
    this.sprVz += (-this.sprAz * 70 - this.sprVz * 9 - hzv * 4) * dt; this.sprAz += this.sprVz * dt;
    sprout.rotation.x = this.sprAx; sprout.rotation.z = Math.sin(t * 1.4) * 0.04 + this.sprAz;

    // gaze: saccades + smooth pursuit of the supplied look direction
    this.fixT += dt;
    if (this.fixT > this.fixDur) {
      this.fixT = 0; this.fixDur = 0.7 + Math.random() * 2.0;
      if (Math.random() < 0.78) { this.gTx = Math.max(-0.85, Math.min(0.85, ptrX * 0.9)); this.gTy = Math.max(-0.7, Math.min(0.7, ptrY * 0.9)); }
      else if (Math.random() < 0.35) { this.gTx = 0; this.gTy = 0; }
      else { this.gTx = (Math.random() * 2 - 1) * 0.7; this.gTy = (Math.random() * 2 - 1) * 0.45; }
      if (Math.random() < 0.4) this.blinking = true;
    }
    this.gTx += (ptrX * 0.9 - this.gTx) * 0.05; this.gTy += (ptrY * 0.9 - this.gTy) * 0.05;
    const gk = 150, gd = 17;
    this.gVx += ((this.gTx - this.gazeX) * gk - this.gVx * gd) * dt; this.gazeX += this.gVx * dt;
    this.gVy += ((this.gTy - this.gazeY) * gk - this.gVy * gd) * dt; this.gazeY += this.gVy * dt;
    const gx = this.gazeX + Math.sin(t * 22) * 0.008 + Math.sin(t * 6.7) * 0.005;
    const gy = this.gazeY + Math.cos(t * 18) * 0.006;
    head.rotation.x += (((cfg.hx || 0) + gy * 0.05) - head.rotation.x) * 0.06;
    head.rotation.y += (gx * 0.07 - head.rotation.y) * 0.06;

    // blink (variable interval, occasional double)
    this.blinkT += dt;
    if (!this.blinking && this.blinkT > this.nextBlink) { this.blinking = true; this.blinkT = 0; this.nextBlink = 2.2 + Math.random() * 3.5; this.dbl = (Math.random() < 0.22) ? 1 : 0; }
    if (this.blinking) { this.blinkPh += dt / 0.15; if (this.blinkPh >= 1) { this.blinkPh = 0; this.blinking = false; if (this.dbl > 0) { this.dbl--; this.blinking = true; } } }
    const bclose = this.blinking ? Math.sin(Math.min(this.blinkPh, 1) * Math.PI) : 0;
    let dilT = (this.state === 'excited' || this.state === 'celebrate') ? 1.22 : (this.state === 'curious' ? 1.12 : (slp ? 0.85 : 1.0));
    dilT += Math.sin(t * 0.8) * 0.03;
    const baseLid = cfg.lidBase || 0, close = Math.max(baseLid, bclose);
    this._setEye(this.eyeL, cfg.eL, close, gx, gy, dilT);
    this._setEye(this.eyeR, cfg.eR, close, gx, gy, dilT);

    // mouth — the smile is the ALWAYS-visible base; the open / 'o' shapes are
    // reactions (happy, excited, curious, singing…) that take over when active.
    const mm = cfg.mouth, msc = cfg.mscale || 1;
    const openMouth = (mm === 'open'), oMouth = (mm === 'o');
    this.mOpen.visible = openMouth; this.mO.visible = oMouth;
    this.mSmile.visible = !openMouth && !oMouth;          // visible in every other state
    if (this.mSmile.visible) {
      const breathe = Math.sin(t * 2.2) * 0.05;            // gentle idle life
      this.mSmile.scale.x += ((msc * (1 + breathe)) - this.mSmile.scale.x) * 0.15;
      this.mSmile.scale.y += ((msc * (1 - breathe)) - this.mSmile.scale.y) * 0.15;
    }
    if (openMouth) { const pls = 1 + Math.sin(t * 8) * 0.08; this.mOpen.scale.set(pls, pls, 1); }

    // props
    this.cap.visible = !!cfg.cap; this.think.visible = !!cfg.bubble; this.bed.visible = !!cfg.bed;
    this.tea.visible = (cfg.prop === 'tea'); this.book.visible = (cfg.prop === 'book'); this.work.visible = (cfg.prop === 'work');
    this.confetti.visible = !!cfg.confetti;
    if (cfg.bubble) this.think.position.y = 1.45 + Math.sin(t * 2) * 0.05;
    if (this.tea.visible) for (let k = 0; k < this.steam.length; k++) { const sp = this.steam[k]; sp.position.y = 0.12 + ((t * 0.4 + k * 0.33) % 0.5); sp.material.opacity = 0.5 * (1 - ((t * 0.4 + k * 0.33) % 0.5) / 0.5); }
    if (this.confetti.visible) this.confetti.children.forEach((m) => { const u = m.userData; m.position.y -= u.vy * dt; m.position.x += u.vx * dt; m.rotation.x += u.vr * dt; m.rotation.z += u.vr * dt; if (m.position.y < -1.4) { m.position.y = 1.8; m.position.x = (Math.random() - 0.5) * 2.6; } });

    // arms
    const p = this._armPose(this.state, t);
    this._lerpArm(this.armL, p[0], p[1], p[2], p[3], 0.12);
    this._lerpArm(this.armR, p[4], p[5], p[6], p[7], 0.12);
    this._guardArm(this.armL); this._guardArm(this.armR);

    // legs — stride scales with actual speed
    let lLx = 0, lRx = 0; if (this.state === 'walk') { const w = Math.sin(this.walkPhase) * (0.55 * (0.25 + 0.75 * speed)); lLx = -w; lRx = w; }
    this.legL.rotation.x += (lLx - this.legL.rotation.x) * 0.15;
    this.legR.rotation.x += (lRx - this.legR.rotation.x) * 0.15;

    // dragged: limbs dangle & flail (overrides arm/leg pose while held)
    if (opts.held) {
      const f = Math.sin(t * 9) * 0.4;
      eon.rotation.z = Math.sin(t * 5) * 0.12;
      this.armL.shoulder.rotation.set(0.3 + f, 0, 0.5 + f * 0.3);
      this.armR.shoulder.rotation.set(0.3 - f, 0, -0.5 - f * 0.3);
      this.legL.rotation.x = -0.3 + f; this.legR.rotation.x = -0.3 - f;
    }

    // sleep: ZZZ + the occasional dream glyph (tracks his real position)
    if (cfg.zzz && particles) {
      const wp = new THREE.Vector3(); this.headAnchor.getWorldPosition(wp);
      if (Math.random() < dt * 1.0) particles.zzz(wp);
      if (Math.random() < dt * 0.5) particles.dream(wp);
    }

    // active full-body emote overrides the body for its duration
    if (this._emote) {
      this._runEmote(this._emote, t);
      if (this._emote.name === 'sing' && particles && Math.random() < dt * 2.5) {
        const wp = new THREE.Vector3(); this.headAnchor.getWorldPosition(wp); particles.emote('🎵', wp);
      }
    }

    // meditation pose wins over everything (but not the point emote on insight)
    if (this._meditating && !(this._emote && this._emote.name === 'point')) {
      this._applyMeditation(t);
    }
    // covering his eyes while a password is typed wins over all
    if (this._covering) this._applyCoverEyes(t);
  }

  /** Trigger a full-body emote by name. */
  playEmote(name) {
    const E = EMOTE_DEF[name]; if (!E) return;
    this._emote = { name, dur: E.dur, t: 0, face: E.face };
  }

  /** Drive the body for the active emote (overrides arm/leg/body pose). */
  _runEmote(em, t) {
    const eon = this.eon, ep = Math.min(1, em.t / em.dur), base = 0.16;
    const aL = this.armL, aR = this.armR, lL = this.legL, lR = this.legR;
    switch (em.name) {
      case 'spin':
        eon.position.y = base + Math.sin(ep * Math.PI) * 0.16;
        eon.rotation.y = this.turn + (ep * ep * (3 - 2 * ep)) * Math.PI * 4;   // 2 eased spins
        aL.shoulder.rotation.set(0, 0, 1.5); aR.shoulder.rotation.set(0, 0, -1.5);
        break;
      case 'dance':
        eon.position.y = base + Math.abs(Math.sin(t * 6)) * 0.12;
        eon.rotation.z = Math.sin(t * 6) * 0.18;
        aL.shoulder.rotation.set(0, 0, 0.7 + Math.sin(t * 6) * 0.8); aL.elbow.rotation.x = 0.3;
        aR.shoulder.rotation.set(0, 0, -0.7 - Math.sin(t * 6) * 0.8); aR.elbow.rotation.x = 0.3;
        lL.rotation.x = Math.sin(t * 6) * 0.2; lR.rotation.x = -Math.sin(t * 6) * 0.2;
        break;
      case 'sing':
        eon.position.y = base + Math.abs(Math.sin(t * 4)) * 0.05;
        eon.rotation.z = Math.sin(t * 3) * 0.10;
        aR.shoulder.rotation.set(-1.3, 0, -0.45); aR.elbow.rotation.x = -1.5;     // mic to mouth
        aL.shoulder.rotation.set(0, 0, 0.4 + Math.sin(t * 4) * 0.4);
        break;
      case 'think':
        eon.position.y = base + Math.sin(t * 1.6) * 0.03;
        aR.shoulder.rotation.set(-1.1, 0, -0.85); aR.elbow.rotation.x = -1.25;    // hand to chin
        break;
      case 'wave':
        eon.position.y = base + Math.sin(t * 3) * 0.03;
        aR.shoulder.rotation.set(-0.3, 0, -1.9 + Math.sin(t * 12) * 0.35); aR.elbow.rotation.x = -0.35;
        break;
      case 'kick': {
        const k = Math.sin(Math.min(1, ep * 2) * Math.PI);
        eon.position.y = base + 0.05 * k; eon.rotation.z = -0.12 * k;
        lR.rotation.x = -1.2 * k; aL.shoulder.rotation.set(0, 0, 1.2); aR.shoulder.rotation.set(0, 0, -0.6);
        break;
      }
      case 'jump': {
        const j = ep < 0.25 ? -0.12 * (ep / 0.25) : Math.sin((ep - 0.25) / 0.75 * Math.PI) * 0.45;
        eon.position.y = base + j;
        aL.shoulder.rotation.set(0, 0, 1.6); aR.shoulder.rotation.set(0, 0, -1.6);
        lL.rotation.x = ep < 0.25 ? 0.7 : -0.3; lR.rotation.x = ep < 0.25 ? 0.7 : -0.3;
        break;
      }
      case 'cheer':
        eon.position.y = base + Math.abs(Math.sin(t * 7)) * 0.24;
        aL.shoulder.rotation.set(-0.3, 0, 1.9); aR.shoulder.rotation.set(-0.3, 0, -1.9);
        break;
      case 'point':
        eon.position.y = base + Math.sin(t * 2) * 0.02;
        aR.shoulder.rotation.set(-1.35, 0, -0.25); aR.elbow.rotation.x = -0.1;   // arm extended, pointing
        break;
      case 'proud':                                                              // chest out, hands on hips, proud bounce
        eon.position.y = base + Math.abs(Math.sin(t * 3)) * 0.05;
        eon.rotation.z = Math.sin(t * 2) * 0.05;
        aL.shoulder.rotation.set(0.15, 0, 0.78); aL.elbow.rotation.x = 1.55;
        aR.shoulder.rotation.set(0.15, 0, -0.78); aR.elbow.rotation.x = 1.55;
        break;
      case 'applaud': {                                                          // clapping
        const clap = Math.sin(t * 16) * 0.2;
        eon.position.y = base + Math.sin(t * 4) * 0.03;
        aL.shoulder.rotation.set(-0.5, 0, 0.5 + clap); aL.elbow.rotation.x = -1.4;
        aR.shoulder.rotation.set(-0.5, 0, -0.5 - clap); aR.elbow.rotation.x = -1.4;
        break;
      }
      case 'flex':                                                               // both biceps up
        eon.position.y = base + Math.sin(t * 8) * 0.02;
        eon.rotation.z = Math.sin(t * 9) * 0.03;
        aL.shoulder.rotation.set(-0.2, 0, 1.5); aL.elbow.rotation.x = 2.3;
        aR.shoulder.rotation.set(-0.2, 0, -1.5); aR.elbow.rotation.x = 2.3;
        break;
      case 'idea': {                                                             // aha! finger up
        const k = Math.sin(Math.min(1, ep * 3) * Math.PI);
        eon.position.y = base + 0.06 * k;
        aR.shoulder.rotation.set(-0.3, 0, -1.95); aR.elbow.rotation.x = -0.15;
        aL.shoulder.rotation.set(0.1, 0, 0.4);
        break;
      }
      case 'facepalm':                                                           // hand to face
        eon.position.y = base + Math.sin(t * 1.6) * 0.02;
        this.head.rotation.x = 0.26; eon.rotation.z = Math.sin(t * 2) * 0.03;
        aR.shoulder.rotation.set(-1.5, 0, -0.42); aR.elbow.rotation.x = -1.95;
        break;
      case 'shrug':                                                              // "who knows?"
        eon.position.y = base + Math.abs(Math.sin(t * 4)) * 0.02;
        this.head.rotation.z = Math.sin(t * 1.5) * 0.06;
        aL.shoulder.rotation.set(-0.2, 0, 0.95); aL.elbow.rotation.x = -0.7;
        aR.shoulder.rotation.set(-0.2, 0, -0.95); aR.elbow.rotation.x = -0.7;
        break;
      case 'peek':                                                               // looks around
        eon.rotation.y = this.turn + Math.sin(t * 2.5) * 0.45;
        this.head.rotation.y = Math.sin(t * 2.5) * 0.2;
        break;
      case 'sleepy':                                                             // droopy, tilted
        eon.position.y = base + Math.sin(t * 1.2) * 0.03;
        this.head.rotation.z = 0.2 + Math.sin(t * 1.0) * 0.05;
        aL.shoulder.rotation.set(0.1, 0, 0.4); aR.shoulder.rotation.set(0.1, 0, -0.4);
        break;
      case 'sad':                                                                // slumped, head down
        eon.position.y = base - 0.04 + Math.sin(t * 1.2) * 0.015;
        this.head.rotation.x = 0.3;
        aL.shoulder.rotation.set(0.22, 0, 0.34); aR.shoulder.rotation.set(0.22, 0, -0.34);
        break;
      case 'nod':                                                                // yes, yes
        this.head.rotation.x = 0.1 + Math.sin(t * 7) * 0.16;
        break;
      case 'lookWatch':                                                          // raises wrist, checks the time
        eon.position.y = base + Math.sin(t * 1.6) * 0.02;
        this.head.rotation.x = 0.22;
        aL.shoulder.rotation.set(-1.25, 0, 0.45); aL.elbow.rotation.x = -2.05;   // wrist up to face
        aR.shoulder.rotation.set(0.12, 0, -0.4);
        break;
      case 'salute':                                                             // hand to brow, ready
        eon.position.y = base + Math.sin(t * 3) * 0.02;
        aR.shoulder.rotation.set(-1.5, 0, -0.18); aR.elbow.rotation.x = -2.1;
        aL.shoulder.rotation.set(0.12, 0, 0.42);
        break;
      case 'thumbsUp': {                                                         // arm forward, approving bob
        const k = Math.abs(Math.sin(t * 5));
        eon.position.y = base + 0.04 * k;
        aR.shoulder.rotation.set(-1.0, 0, -0.28); aR.elbow.rotation.x = -0.9;
        aL.shoulder.rotation.set(0.1, 0, 0.4);
        break;
      }
      case 'heartHands':                                                         // hands together at chest
        eon.position.y = base + Math.sin(t * 2) * 0.03;
        eon.rotation.z = Math.sin(t * 1.6) * 0.04;
        aL.shoulder.rotation.set(-0.7, 0, 0.62); aL.elbow.rotation.x = -1.7;
        aR.shoulder.rotation.set(-0.7, 0, -0.62); aR.elbow.rotation.x = -1.7;
        break;
      case 'bow': {                                                              // respectful bow
        const b = Math.sin(Math.min(1, ep * 1.6) * Math.PI);
        eon.rotation.x = 0.5 * b; eon.position.y = base - 0.02 * b;
        aL.shoulder.rotation.set(0.2, 0, 0.5); aR.shoulder.rotation.set(0.2, 0, -0.5);
        break;
      }
      case 'wink':                                                               // cheeky head tilt
        eon.position.y = base + Math.sin(t * 4) * 0.02;
        this.head.rotation.z = 0.13; eon.rotation.z = Math.sin(t * 3) * 0.04;
        aR.shoulder.rotation.set(0, 0, -0.5);
        break;
      case 'surprised': {                                                        // little jolt, arms out
        const s = Math.sin(Math.min(1, ep * 2) * Math.PI);
        eon.position.y = base + 0.05 * s; this.head.rotation.x = -0.12 * s;
        aL.shoulder.rotation.set(-0.2, 0, 1.2); aR.shoulder.rotation.set(-0.2, 0, -1.2);
        break;
      }
      case 'ponder':                                                             // chin in hand, slow pacing sway
        eon.position.y = base + Math.sin(t * 1.2) * 0.03;
        eon.rotation.z = Math.sin(t * 0.8) * 0.05;
        this.head.rotation.x = 0.14; this.head.rotation.y = Math.sin(t * 0.7) * 0.12;
        aR.shoulder.rotation.set(-1.1, 0, -0.85); aR.elbow.rotation.x = -1.3;
        break;
      case 'typing':                                                             // hunched at a tiny laptop
        eon.position.y = base - 0.04; this.head.rotation.x = 0.18;
        aL.shoulder.rotation.set(-0.55, 0, 0.5); aL.elbow.rotation.x = -1.3 + Math.sin(t * 20) * 0.08;
        aR.shoulder.rotation.set(-0.55, 0, -0.5); aR.elbow.rotation.x = -1.3 + Math.cos(t * 20) * 0.08;
        break;
      case 'fistPump': {                                                         // "yes!" elbow pull
        const k = Math.abs(Math.sin(t * 6));
        eon.position.y = base + 0.05 * k;
        aR.shoulder.rotation.set(-0.3, 0, -1.4); aR.elbow.rotation.x = -2.2 + k * 0.3;
        aL.shoulder.rotation.set(0.1, 0, 0.4);
        break;
      }
    }
  }

  /** Sustained meditation pose (seated, hands in lap, eyes closed, gentle float). */
  setMeditating(on) { this._meditating = !!on; }

  _applyMeditation(t) {
    const eon = this.eon;
    eon.position.y = 0.10 + Math.sin(t * 1.1) * 0.045;
    eon.rotation.z = Math.sin(t * 0.8) * 0.02;
    this.legL.rotation.x = 1.45; this.legR.rotation.x = 1.45;                 // folded under
    this.armL.shoulder.rotation.set(0.55, 0, 0.65); this.armL.elbow.rotation.x = 0.7;
    this.armR.shoulder.rotation.set(0.55, 0, -0.65); this.armR.elbow.rotation.x = 0.7;
    this._setEye(this.eyeL, 'open', 1, 0, 0, 1); this._setEye(this.eyeR, 'open', 1, 0, 0, 1); // eyes closed
  }

  /** Both hands over the eyes, eyes shut — "not peeking" while a password is typed. */
  setCoverEyes(on) { this._covering = !!on; }
  _applyCoverEyes(t) {
    this.armL.shoulder.rotation.set(-1.45, 0, 0.6); this.armL.elbow.rotation.x = -1.9;
    this.armR.shoulder.rotation.set(-1.45, 0, -0.6); this.armR.elbow.rotation.x = -1.9;
    this._setEye(this.eyeL, 'open', 1, 0, 0, 1); this._setEye(this.eyeR, 'open', 1, 0, 0, 1); // shut
    this.head.rotation.z = Math.sin(t * 2.2) * 0.04;                                          // tiny "no peeking" wiggle
  }
}
