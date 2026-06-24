/* ============================================================
   EON — hype-man.js
   PUBLIC-mode behaviour: EON is his owner's proud hype-man.
   When a visitor scrolls your portfolio (profile / achievements)
   and your photo, wins or achievements come into view, EON walks
   over, strikes a proud/celebratory emote, drops a brag line and a
   little particle flourish, then returns to wandering.

   It only ever reacts to content ALREADY rendered publicly on the
   page (never the private brain feed / your data doc), and it stands
   down entirely when you are signed in as owner — that session gets
   the companion experience instead.

   Public surface (consumed by main.js):
     .start()            // discover targets on this page + observe them
     .update(dt, now)    // per-frame state machine (walk → react → cool)
   ============================================================ */

// Which elements are "brag-worthy" on each page, and the reaction flavour.
// Selectors are the stable container ids that profile.html / app.js render.
const PAGE_TARGETS = {
  profile: [
    { sel: '#pfPhoto',        context: 'ownerPhoto',  side: 'left' },
    { sel: '#pfWins',         context: 'win'   },
    { sel: '#pfAchievements', context: 'achievement' },
    { sel: '#pfProjects',     context: 'project' },
    { sel: '#pfResearch',     context: 'research' },
  ],
  achievements: [
    { sel: '.gal-grid',       context: 'achievement' },
    { sel: '#achGallery',     context: 'achievement' },
  ],
  index: [
    { sel: '#pfPhoto',        context: 'ownerPhoto',  side: 'left' },
  ],
};

// Brag lines per context. {name} is replaced with the owner's name.
const PHRASES = {
  ownerPhoto: [
    "That's my boss, {name} — isn't he awesome?! 😎",
    "The legend himself 👑 {name}!",
    "Yep, I work for {name}. Lucky me! ✨",
  ],
  win: [
    "Boom — another win for {name}! 🔥",
    "That's how it's done! 🏆",
    "{name} just keeps on winning!",
  ],
  achievement: [
    "He nailed it! 🎯",
    "Certified brilliance right here ✨",
    "Another one in the bag for {name}! 🏅",
  ],
  project: [
    "{name} built this — impressive, right? 🚀",
    "Look at this work. Pure skill. 💡",
  ],
  research: [
    "Big-brain energy 🧠 — {name}'s research!",
    "Pushing boundaries, as always. 🔬",
  ],
  generic: [
    "Take a look around — {name} did all this! 👏",
  ],
};

// Emote choices + a particle glyph per context (all emotes already exist).
const REACTIONS = {
  ownerPhoto:  { emotes: ['proud', 'point'],         glyphs: ['👑', '😎', '✨'] },
  win:         { emotes: ['cheer', 'jump'],          glyphs: ['🔥', '🎉', '⭐'] },
  achievement: { emotes: ['celebrate', 'spin'],      glyphs: ['🏆', '✨', '🎉'] },
  project:     { emotes: ['flex', 'cheer'],          glyphs: ['🚀', '💪', '💡'] },
  research:    { emotes: ['applaud', 'think'],        glyphs: ['🧠', '🔬', '✨'] },
  generic:     { emotes: ['applaud', 'wave'],         glyphs: ['👏', '✨'] },
};

const COOLDOWN_MS  = 16000;   // min gap between brags
const REACT_MS     = 2700;    // how long he holds the reaction (≈ emote dur)
const WALK_MAX_MS  = 5000;    // give up walking after this and react in place
const MAX_PER_LOAD = 8;       // don't over-brag in one page view

export class HypeMan {
  constructor(ctx) {
    this.ctx = ctx;
    this.page = document.body?.getAttribute('data-page') || '';
    this.ownerName = this._resolveOwnerName();
    this.targets = [];              // { el, context, side, seen }
    this.queue = [];                // contexts/elements waiting to be bragged about
    this.seen = this._loadSeen();   // dedupe keys for this browser session
    this.active = null;             // current brag { el, context, side }
    this.phase = 'idle';            // idle | walk | react
    this.coolUntil = 0;
    this.phaseUntil = 0;
    this.count = 0;
    this._io = null;
    this._scans = 0;
  }

  start() {
    const list = PAGE_TARGETS[this.page];
    if (!list || !('IntersectionObserver' in window)) return;   // nothing to hype here

    this._io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.5) this._enqueue(e.target);
      }
    }, { threshold: [0.5] });

    // Cards render asynchronously (app.js + Firestore), so re-scan for a while.
    this._scan();
    this._scanTimer = setInterval(() => {
      this._scan();
      if (++this._scans > 12) clearInterval(this._scanTimer);   // ~18s of catch-up
    }, 1500);
  }

  // ---- discover + observe targets currently in the DOM ----
  _scan() {
    const list = PAGE_TARGETS[this.page] || [];
    for (const t of list) {
      document.querySelectorAll(t.sel).forEach((el) => {
        if (el.__eonHyped) return;            // already tracking this node
        el.__eonHyped = true;
        const rec = { el, context: t.context, side: t.side || 'left' };
        this.targets.push(rec);
        el.__eonRec = rec;
        this._io.observe(el);
      });
    }
  }

  _enqueue(el) {
    const rec = el.__eonRec; if (!rec) return;
    const key = this._key(rec);
    if (this.seen.has(key)) return;           // already bragged this session
    if (this.queue.includes(rec) || this.active === rec) return;
    this.queue.push(rec);
  }

  // ---- per-frame state machine ----
  update(dt, now) {
    if (this._disabled()) { this._abort(); return; }

    if (this.phase === 'react') {
      // hold position, keep facing the target, let the emote play out
      if (this.active) this._facePoint(this.active.el);
      if (now >= this.phaseUntil) this._finish(now);
      return;
    }

    if (this.phase === 'walk') {
      const p = this._navTarget(this.active);
      if (p) this.ctx.nav.goTo(p.x, p.y);     // re-assert each frame so wander can't steal him
      if (this.ctx.nav.atTarget() || now >= this.phaseUntil) this._react(now);
      return;
    }

    // idle: maybe start the next brag
    if (now < this.coolUntil || this.count >= MAX_PER_LOAD) return;
    const rec = this.queue.shift();
    if (!rec) return;
    if (!this._inViewport(rec.el)) return;    // visitor scrolled away — skip quietly
    this._begin(rec, now);
  }

  _begin(rec, now) {
    this.active = rec;
    this.phase = 'walk';
    this.phaseUntil = now + WALK_MAX_MS;
    this.ctx.hypeBusy = true;                 // activity-engine yields while we present
  }

  _react(now) {
    const rec = this.active; if (!rec) { this._finish(now); return; }
    this.phase = 'react';
    this.phaseUntil = now + REACT_MS;
    this.seen.add(this._key(rec));
    this._saveSeen();
    this.count++;

    this.ownerName = this._resolveOwnerName();   // name may have rendered since start()
    this._facePoint(rec.el);
    const R = REACTIONS[rec.context] || REACTIONS.generic;
    const emote = R.emotes[(Math.random() * R.emotes.length) | 0];
    try { this.ctx.character.playEmote(emote); } catch {}

    const line = this._phrase(rec.context);
    try { this.ctx.ai?.speak(line, REACT_MS + 800); } catch {}

    this._sparkle(R.glyphs);
    this._highlight(rec.el);
  }

  _finish(now) {
    this.ctx.hypeBusy = false;
    this.active = null;
    this.phase = 'idle';
    this.coolUntil = now + COOLDOWN_MS;
  }

  _abort() {
    if (this.phase === 'idle' && !this.ctx.hypeBusy) return;
    this.ctx.hypeBusy = false;
    this.active = null;
    this.phase = 'idle';
  }

  // ---- helpers ----
  _disabled() {
    const c = this.ctx;
    if (c.drag?.active || c.focus || c.meditating) return true;
    // Owner gets the companion, not the hype-man.
    try { if (window.EonBrain?.isOwner?.()) return true; } catch {}
    return false;
  }

  /** Stand just beside the element (not on top of it) in nav coords. */
  _navTarget(rec) {
    if (!rec?.el) return null;
    const r = rec.el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    const cy = r.top + r.height / 2;
    const cx = rec.side === 'right' ? r.right + 50 : r.left - 50;
    return this.ctx.screenToWorld(cx, cy);
  }

  _facePoint(el) {
    try {
      const r = el.getBoundingClientRect();
      const elx = r.left + r.width / 2;
      const eonx = this.ctx.character.root.position.x + innerWidth / 2;
      this.ctx.character.face(elx >= eonx ? 1 : -1);
    } catch {}
  }

  _inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0;
  }

  _sparkle(glyphs) {
    const ch = this.ctx.character, P = this.ctx.particles;
    if (!P || !ch) return;
    for (let i = 0; i < 6; i++) {
      const g = glyphs[(Math.random() * glyphs.length) | 0];
      try { P.emote(g, ch._worldHead((Math.random() - 0.5) * 0.7, 0.5 + Math.random() * 0.4)); } catch {}
    }
  }

  /** Brief glow ring on the element being celebrated (cosmetic, reversible). */
  _highlight(el) {
    try {
      el.animate(
        [
          { boxShadow: '0 0 0 0 rgba(126,217,87,0)' },
          { boxShadow: '0 0 0 6px rgba(126,217,87,0.55)' },
          { boxShadow: '0 0 0 0 rgba(126,217,87,0)' },
        ],
        { duration: 1600, easing: 'ease-out' },
      );
    } catch {}
  }

  _phrase(context) {
    const pool = PHRASES[context] || PHRASES.generic;
    const s = pool[(Math.random() * pool.length) | 0];
    return s.replace(/\{name\}/g, this.ownerName);
  }

  _resolveOwnerName() {
    const fromDom = document.getElementById('pfName')?.textContent?.trim();
    if (fromDom && fromDom.toLowerCase() !== 'name') return fromDom.split(/\s+/)[0];
    if (typeof window !== 'undefined' && window.OWNER_NAME) return String(window.OWNER_NAME);
    return 'Imran';
  }

  _key(rec) { return `${this.page}:${rec.context}:${rec.el.id || rec.el.className || 'el'}`; }

  _loadSeen() {
    try { return new Set(JSON.parse(sessionStorage.getItem('eon-hyped') || '[]')); }
    catch { return new Set(); }
  }
  _saveSeen() {
    try { sessionStorage.setItem('eon-hyped', JSON.stringify([...this.seen])); } catch {}
  }
}
