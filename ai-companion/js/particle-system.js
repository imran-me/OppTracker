/* ============================================================
   EON — particle-system.js
   Lightweight, pooled 3D particle effects (footsteps, ZZZ,
   confetti, tea steam, thought dots, hearts). Uses sprites with
   procedurally-generated canvas textures so there are NO asset
   downloads and it stays at 60 FPS.
   ============================================================ */
import * as THREE from 'three';

/** Build a small canvas texture once and cache it. */
const _texCache = {};
function makeTexture(key, draw) {
  if (_texCache[key]) return _texCache[key];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  draw(g, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _texCache[key] = t;
  return t;
}

function circleTex(color) {
  return makeTexture('c_' + color, (g, s) => {
    const r = s / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  });
}

function glyphTex(ch, color) {
  return makeTexture('g_' + ch + color, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = color;
    g.font = '700 44px "Plus Jakarta Sans", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, s / 2, s / 2 + 2);
  });
}

function squareTex(color) {
  return makeTexture('s_' + color, (g, s) => {
    g.fillStyle = color;
    g.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.6);
  });
}

export class ParticleSystem {
  /** @param {THREE.Scene} scene  @param {object} palette */
  constructor(scene, palette) {
    this.scene = scene;
    this.palette = palette;
    this.items = [];   // live particles
    this.pool = [];    // reusable sprites
  }

  _spawn(texture, opts) {
    const sprite = this.pool.pop() || new THREE.Sprite();
    sprite.material = new THREE.SpriteMaterial({
      map: texture, transparent: true, depthTest: false, depthWrite: false,
    });
    sprite.material.opacity = opts.opacity ?? 1;
    sprite.position.copy(opts.pos);
    sprite.scale.setScalar(opts.size ?? 16);
    sprite.renderOrder = 999;
    this.scene.add(sprite);
    this.items.push({
      sprite,
      life: opts.life ?? 1,
      age: 0,
      vel: opts.vel ?? new THREE.Vector3(),
      grav: opts.grav ?? 0,
      spin: opts.spin ?? 0,
      fade: opts.fade ?? true,
      grow: opts.grow ?? 0,
    });
    return sprite;
  }

  // ---- public effects (pos is a THREE.Vector3 in world space) ----

  footstep(pos) {
    this._spawn(circleTex('rgba(176,143,240,0.9)'), {
      pos: pos.clone(), size: 10, life: 0.5,
      vel: new THREE.Vector3((Math.random() - 0.5) * 6, 6, 0), grow: 14,
    });
  }

  zzz(pos) {
    const z = this._spawn(glyphTex('z', this.palette.purple), {
      pos: pos.clone(), size: 18, life: 1.8,
      vel: new THREE.Vector3(8, 22, 0),
    });
    z.material.rotation = -0.2;
  }

  steam(pos) {
    this._spawn(circleTex('rgba(255,255,255,0.65)'), {
      pos: pos.clone(), size: 8, life: 1.4,
      vel: new THREE.Vector3((Math.random() - 0.5) * 4, 16, 0), grow: 18,
    });
  }

  think(pos) {
    this._spawn(circleTex('rgba(126,217,87,0.9)'), {
      pos: pos.clone(), size: 6, life: 1.0,
      vel: new THREE.Vector3(6, 14, 0), grow: 8,
    });
  }

  heart(pos) {
    this._spawn(glyphTex('♥', '#ff5d8f'), {
      pos: pos.clone(), size: 16, life: 1.3,
      vel: new THREE.Vector3((Math.random() - 0.5) * 8, 24, 0),
    });
  }

  /** Confetti burst — used on success/celebrate. */
  confetti(pos, count = 26) {
    const colors = [this.palette.ocean, this.palette.lime, this.palette.violet,
                    this.palette.cyan, this.palette.purple, '#ffd76a'];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI - Math.PI; // upward-ish fan
      const speed = 40 + Math.random() * 70;
      this._spawn(squareTex(colors[i % colors.length]), {
        pos: pos.clone(),
        size: 7 + Math.random() * 6,
        life: 1.1 + Math.random() * 0.8,
        vel: new THREE.Vector3(Math.cos(a) * speed, 40 + Math.random() * 60, 0),
        grav: -180, spin: (Math.random() - 0.5) * 12,
      });
    }
  }

  /** Advance all particles. dt in seconds. */
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.pool.push(p.sprite);
        this.items.splice(i, 1);
        continue;
      }
      p.vel.y += p.grav * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      if (p.grow) p.sprite.scale.addScalar(p.grow * dt);
      if (p.spin) p.sprite.material.rotation += p.spin * dt;
      if (p.fade) p.sprite.material.opacity = 1 - k;
    }
  }
}
