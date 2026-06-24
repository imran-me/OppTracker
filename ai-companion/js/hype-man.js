/* ============================================================
   EON — hype-man.js
   PUBLIC-mode behaviour: EON is his owner's proud host & hype-man.
   As a visitor explores the site, EON works out — by himself — which
   page they're on and what they're hovering / scrolling past, walks
   over, plays a fitting emote, drops a contextual line ("That's my
   boss — handsome AND brilliant!", "He studied there — top place!"),
   sparkles, and highlights the spot. Then he goes back to his normal
   life (tea, reading, wandering) until the next thing catches an eye.

   He only ever reacts to content ALREADY rendered publicly on the page
   (never the private brain feed / data doc), and stands down entirely
   when the owner is signed in (that session gets the companion).

   Consumed by main.js:  .start()   .update(dt)
   ============================================================ */

// ---- element id → context (profile page is the richest stage) ----
const ID_CONTEXT = {
  pfPhoto: 'ownerPhoto', pfName: 'ownerName', pfHeadline: 'ownerName',
  pfCurrentRole: 'experience', pfBio: 'about', pfMeta: 'about',
  pfAbout: 'education', pfSkills: 'skills', pfInterests: 'interests',
  pfSocial: 'social', pfContact: 'contact', pfStats: 'stats',
  pfExperience: 'experience', pfWins: 'win', pfAchievements: 'achievement',
  pfProjects: 'project', pfResearch: 'research', pfReferences: 'reference',
};

// ---- <section>/<header> id → context ----
const SECTION_CONTEXT = {
  top: 'ownerPhoto', about: 'education', experience: 'experience',
  wins: 'win', showcase: 'achievement', projects: 'project',
  research: 'research', references: 'reference', contact: 'contact',
};

// ---- heading-text keyword → context (EON "reads" the heading) ----
const KEYWORD_CONTEXT = [
  [/educat|universit|study|academ|school|degree|college/, 'education'],
  [/experience|role|career|intern|work history|employ/, 'experience'],
  [/skill|expertise|tech stack|tool/, 'skills'],
  [/interest|hobby|passion/, 'interests'],
  [/win|scholarship|recognition|prize/, 'win'],
  [/achiev|award|certif|honou?r|badge|trophy/, 'achievement'],
  [/project|build|portfolio/, 'project'],
  [/research|paper|publication|thesis/, 'research'],
  [/reference|testimonial|recommend/, 'reference'],
  [/contact|reach|get in touch|connect/, 'contact'],
  [/opportunit/, 'opportunity'],
  [/task|to-?do/, 'task'],
  [/document|file|attachment/, 'document'],
  [/deadline|due|upcoming/, 'deadline'],
];

// ---- per-page fallback context (when nothing more specific matches) ----
const PAGE_CONTEXT = {
  opportunities: 'opportunity', 'opportunity-details': 'opportunity',
  tasks: 'task', documents: 'document', contacts: 'contact',
  research: 'research', projects: 'project', achievements: 'achievement',
  categories: 'generic', dashboard: 'stats', profile: 'generic', index: 'generic',
};

// ---- the lines. {name}=owner first name, {thing}=hovered label ----
const PHRASES = {
  ownerPhoto: [
    "That's my boss, {name} — isn't he awesome?! 😎",
    "The legend himself 👑 — {name}!",
    "Handsome AND brilliant. How does he do it? ✨",
    "Yep, I work for {name}. Lucky me! 🍀",
    "Look at that face — pure main-character energy! 🌟",
  ],
  ownerName: [
    "{name} — remember the name, you'll see it everywhere. 📣",
    "That's the boss. {name}. A whole vibe. 😎",
    "Future's brightest — {name}! 🌟",
  ],
  about: [
    "Want to know {name}? You're in the right place. 📖",
    "There's a whole story here — and it's a good one. ✨",
  ],
  education: [
    "Yes, {name} studied there — a top place! 🎓",
    "Smart cookie, this one. Look at that education! 🧠",
    "Great school, greater student. 📚",
  ],
  experience: [
    "Look at that experience — {name} has done it all! 💼",
    "Real-world impact, role after role. Respect. 🙌",
    "From AI to strategy — {name} wears every hat. 🎩",
  ],
  skills: [
    "These skills? Sharp as they come. 🛠️",
    "{name} speaks fluent code AND people. Rare combo! 💡",
    "A toolbox most people only dream of. 🔧",
  ],
  interests: [
    "Curious mind, big heart — that's {name}. ❤️",
    "Work hard, play hard — look at these interests! 🎯",
  ],
  social: [
    "Go on — connect with {name}, he's friendly! 🤝",
    "Slide into those links, you won't regret it. 🔗",
  ],
  win: [
    "Boom — another win for {name}! 🔥",
    "That's how it's done! 🏆",
    "{name} just keeps on winning. 🥇",
    "Scholarships, prizes — he collects them like stamps! ✨",
  ],
  achievement: [
    "He nailed it! 🎯",
    "Certified brilliance, right here. 🏅",
    "Another one in the bag for {name}! 🎉",
    "Awards on awards on awards. 👏",
  ],
  project: [
    "{name} built this — impressive, right? 🚀",
    "Look at this work. Pure skill. 💡",
    "Ideas into reality — that's {name}'s superpower. ⚙️",
  ],
  research: [
    "Big-brain energy 🧠 — {name}'s research!",
    "Pushing boundaries, as always. 🔬",
    "Real questions, real answers. Genius at work. ✨",
  ],
  reference: [
    "Don't take my word for it — read what people say! 💬",
    "Mentors, managers, teachers — they all rave about {name}. ⭐",
  ],
  contact: [
    "Reach out — {name} would love to hear from you! 📬",
    "One message away from something great. ✉️",
  ],
  stats: [
    "The numbers don't lie — {name} stays busy! 📊",
    "Look at that scoreboard. 🔥",
  ],
  opportunity: [
    "{name} is always chasing the next big thing. 🧭",
    "Opportunities everywhere — and he's on them. 🎯",
  ],
  task: [
    "{name} gets things done. Look at that hustle! ✅",
    "On top of every task — organised legend. 🗂️",
  ],
  document: [
    "All neatly filed — {name} is organised! 📁",
    "Receipts for the greatness. 📄",
  ],
  deadline: [
    "{name}'s got things lined up — and he's on schedule. ⏰",
    "Busy season for the boss, but he's locked in. 💪",
  ],
  nav: [
    "Ooh, check out his {thing}! 👀",
    "His {thing} are worth a look — go on, click! 👉",
  ],
  generic: [
    "Take a look around — {name} did all this! 👏",
    "Everything here screams quality. ✨",
    "You're exploring greatness, just so you know. 😄",
  ],
};

// ---- emote + particle glyphs per context (all emotes already exist) ----
const REACTIONS = {
  ownerPhoto:  { emotes: ['proud', 'point'],     glyphs: ['👑', '😎', '✨'] },
  ownerName:   { emotes: ['proud', 'cheer'],     glyphs: ['📣', '🌟', '✨'] },
  about:       { emotes: ['wave', 'think'],      glyphs: ['📖', '✨'] },
  education:   { emotes: ['proud', 'think'],     glyphs: ['🎓', '🧠', '📚'] },
  experience:  { emotes: ['flex', 'proud'],      glyphs: ['💼', '🙌', '🎩'] },
  skills:      { emotes: ['flex', 'cheer'],      glyphs: ['🛠️', '💡', '🔧'] },
  interests:   { emotes: ['dance', 'wave'],      glyphs: ['❤️', '🎯', '✨'] },
  social:      { emotes: ['wave', 'point'],      glyphs: ['🤝', '🔗'] },
  win:         { emotes: ['cheer', 'jump'],      glyphs: ['🔥', '🏆', '🥇'] },
  achievement: { emotes: ['celebrate', 'spin'],  glyphs: ['🏅', '🎉', '✨'] },
  project:     { emotes: ['flex', 'cheer'],      glyphs: ['🚀', '⚙️', '💡'] },
  research:    { emotes: ['applaud', 'think'],    glyphs: ['🧠', '🔬', '✨'] },
  reference:   { emotes: ['applaud', 'wave'],     glyphs: ['💬', '⭐'] },
  contact:     { emotes: ['wave', 'point'],       glyphs: ['📬', '✉️'] },
  stats:       { emotes: ['cheer', 'proud'],      glyphs: ['📊', '🔥'] },
  opportunity: { emotes: ['point', 'cheer'],      glyphs: ['🧭', '🎯'] },
  task:        { emotes: ['cheer', 'applaud'],     glyphs: ['✅', '🗂️'] },
  document:    { emotes: ['point', 'wave'],         glyphs: ['📁', '📄'] },
  deadline:    { emotes: ['point', 'think'],        glyphs: ['⏰', '💪'] },
  nav:         { emotes: ['point', 'wave'],          glyphs: ['👀', '👉'] },
  generic:     { emotes: ['applaud', 'wave'],         glyphs: ['👏', '✨'] },
};

// Hover candidates: anything worth commenting on, across pages.
const MATCH = [
  '#pfPhoto', '#pfName', '#pfHeadline', '#pfBio', '#pfCurrentRole', '#pfMeta',
  '#pfAbout', '#pfSkills', '#pfInterests', '#pfSocial', '#pfContact', '#pfStats',
  '#pfExperience', '#pfWins', '#pfAchievements', '#pfProjects', '#pfResearch', '#pfReferences',
  '.pf-section', '.pf-hero', '.pf-photo', '.pf-timeline > *', '.gal-grid > *',
  '.stack-16 > *', '.stat-card', '.card', '.dt tbody tr', '.sidebar a', '[data-eon]',
].join(',');
// Elements that trigger on scroll-into-view (proactive roaming).
const SCROLL_MATCH = '.pf-section, .pf-hero, .gal-grid, .stat-card';

const COOLDOWN_MS = 6000;    // min gap between any two reactions (leaves room for tea/reading)
const REARM_MS    = 35000;   // same element can delight again after this
const REACT_MS    = 2700;    // hold the reaction (≈ emote duration)
const WALK_MAX_MS = 4500;    // give up walking and react in place after this
const DWELL_MS    = 360;     // hover this long before EON commits
const MAX_QUEUE   = 3;       // only chase what you're exploring now, not a backlog

export class HypeMan {
  constructor(ctx) {
    this.ctx = ctx;
    this.page = document.body?.getAttribute('data-page') || '';
    this.ownerName = this._resolveOwnerName();
    this.queue = [];                 // [{ el, context, label }]
    this.reactedAt = this._loadSeen();
    this.active = null;
    this.phase = 'idle';             // idle | walk | react
    this.coolUntil = 0;
    this.phaseUntil = 0;
    this._hoverCand = null;          // { el, context, label, ts }
    this._io = null;
  }

  start() {
    if (!('IntersectionObserver' in window)) return;

    // hover → dwell → react (works on every page, dynamic content included)
    this._onOver = (e) => this._onHover(e.target);
    document.addEventListener('pointerover', this._onOver, { passive: true, capture: true });

    // scroll-into-view of major blocks → proactive walk-over
    this._io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.55) {
          const c = this._contextFor(e.target);
          if (c) this._enqueue({ el: e.target, context: c, label: this._labelFor(e.target) });
        }
      }
    }, { threshold: [0.55] });
    this._scan();
    let n = 0;
    this._scanTimer = setInterval(() => { this._scan(); if (++n > 12) clearInterval(this._scanTimer); }, 1500);
  }

  _scan() {
    document.querySelectorAll(SCROLL_MATCH).forEach((el) => {
      if (el.__eonObs) return; el.__eonObs = true; this._io.observe(el);
    });
  }

  // ---- hover handling ----
  _onHover(node) {
    if (this._disabled()) return;
    if (!node || this._inEon(node)) return;
    const el = node.closest ? node.closest(MATCH) : null;
    if (!el || this._inEon(el)) return;
    if (this._hoverCand && this._hoverCand.el === el) return;
    const context = this._contextFor(el);
    if (!context) return;
    this._hoverCand = { el, context, label: this._labelFor(el), ts: Date.now() };
  }

  // ---- per-frame state machine ----
  update() {
    if (this._disabled()) { this._abort(); return; }
    const now = Date.now();

    // promote a settled hover into the queue (front = priority)
    if (this._hoverCand && now - this._hoverCand.ts >= DWELL_MS) {
      const c = this._hoverCand; this._hoverCand = null;
      if (this._eligible(c, now) && this._inViewport(c.el)) this._enqueue(c, true);
    }

    if (this.phase === 'react') {
      if (this.active) this._facePoint(this.active.el);
      if (now >= this.phaseUntil) this._finish(now);
      return;
    }
    if (this.phase === 'walk') {
      const p = this._navTarget(this.active);
      if (p) this.ctx.nav.goTo(p.x, p.y);
      if (this.ctx.nav.atTarget() || now >= this.phaseUntil) this._react(now);
      return;
    }
    // idle → start next
    if (now < this.coolUntil) return;
    const rec = this.queue.shift();
    if (!rec) return;
    if (!this._eligible(rec, now) || !this._inViewport(rec.el)) return;
    this._begin(rec, now);
  }

  _begin(rec, now) {
    this.active = rec; this.phase = 'walk';
    this.phaseUntil = now + WALK_MAX_MS;
    this.ctx.hypeBusy = true;          // activity-engine yields while presenting
  }

  _react(now) {
    const rec = this.active; if (!rec) { this._finish(now); return; }
    this.phase = 'react'; this.phaseUntil = now + REACT_MS;
    this.reactedAt.set(this._key(rec), now); this._saveSeen();
    this.ownerName = this._resolveOwnerName();

    this._facePoint(rec.el);
    const R = REACTIONS[rec.context] || REACTIONS.generic;
    try { this.ctx.character.playEmote(R.emotes[(Math.random() * R.emotes.length) | 0]); } catch {}
    try { this.ctx.ai?.speak(this._phrase(rec), REACT_MS + 900); } catch {}
    this._sparkle(R.glyphs);
    this._highlight(rec.el);
  }

  _finish(now) {
    this.ctx.hypeBusy = false; this.active = null;
    this.phase = 'idle'; this.coolUntil = now + COOLDOWN_MS;
  }
  _abort() {
    if (this.phase === 'idle' && !this.ctx.hypeBusy) return;
    this.ctx.hypeBusy = false; this.active = null; this.phase = 'idle';
  }

  // ---- EON "analyses" what an element is ----
  _contextFor(el) {
    if (!el || this._inEon(el)) return null;
    if (el.id && ID_CONTEXT[el.id]) return ID_CONTEXT[el.id];
    if (el.matches?.('.sidebar a')) return 'nav';

    const sec = el.closest?.('section[id], header[id]');
    if (sec && SECTION_CONTEXT[sec.id]) return SECTION_CONTEXT[sec.id];

    const head = (el.querySelector?.('h1,h2,h3') ||
                  el.closest?.('section,header')?.querySelector?.('h1,h2,h3'));
    const text = (head?.textContent || el.getAttribute?.('data-eon') || '').toLowerCase();
    for (const [re, ctx] of KEYWORD_CONTEXT) if (re.test(text)) return ctx;

    if (el.matches?.('.dt tbody tr, .card, .stat-card')) return PAGE_CONTEXT[this.page] || 'generic';
    return PAGE_CONTEXT[this.page] || 'generic';
  }

  _labelFor(el) {
    const h = el.querySelector?.('h1,h2,h3');
    const t = (h?.textContent || el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > 2 && t.length < 40 ? t : '';
  }

  // ---- queue helpers ----
  _enqueue(rec, front = false) {
    const key = this._key(rec);
    this.queue = this.queue.filter((r) => this._key(r) !== key);
    if (this.active && this._key(this.active) === key) return;
    if (front) this.queue.unshift(rec); else this.queue.push(rec);
    if (this.queue.length > MAX_QUEUE) this.queue.length = MAX_QUEUE;   // keep freshest
  }

  // ---- gating / geometry ----
  _disabled() {
    const c = this.ctx;
    if (c.drag?.active || c.focus || c.meditating) return true;
    try { if (window.EonBrain?.isOwner?.()) return true; } catch {}
    return false;
  }
  _eligible(rec, now) {
    const el = rec?.el;
    if (!el || !el.isConnected) return false;
    const last = this.reactedAt.get(this._key(rec));
    return !last || now - last > REARM_MS;
  }
  _navTarget(rec) {
    if (!rec?.el) return null;
    const r = rec.el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    const cy = r.top + r.height / 2;
    const cx = r.left < innerWidth / 2 ? r.right + 50 : r.left - 50;   // stand on the open side
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
  _inEon(el) { return !!(el.closest && el.closest('#eon-layer')); }

  // ---- flourishes ----
  _sparkle(glyphs) {
    const ch = this.ctx.character, P = this.ctx.particles;
    if (!P || !ch) return;
    for (let i = 0; i < 6; i++) {
      const g = glyphs[(Math.random() * glyphs.length) | 0];
      try { P.emote(g, ch._worldHead((Math.random() - 0.5) * 0.7, 0.5 + Math.random() * 0.4)); } catch {}
    }
  }
  _highlight(el) {
    try {
      el.animate([
        { boxShadow: '0 0 0 0 rgba(126,217,87,0)' },
        { boxShadow: '0 0 0 6px rgba(126,217,87,0.5)' },
        { boxShadow: '0 0 0 0 rgba(126,217,87,0)' },
      ], { duration: 1500, easing: 'ease-out' });
    } catch {}
  }

  // ---- text ----
  _phrase(rec) {
    const pool = PHRASES[rec.context] || PHRASES.generic;
    const s = pool[(Math.random() * pool.length) | 0];
    return s.replace(/\{name\}/g, this.ownerName).replace(/\{thing\}/g, rec.label || 'work');
  }
  _resolveOwnerName() {
    const dom = document.getElementById('pfName')?.textContent?.trim();
    if (dom && dom.toLowerCase() !== 'name') return dom.split(/\s+/)[0];
    if (typeof window !== 'undefined' && window.OWNER_NAME) return String(window.OWNER_NAME);
    return 'Imran';
  }

  // ---- keys / persistence (Date.now so it survives page navigation) ----
  _key(rec) { return `${this.page}:${rec.context}:${rec.el.id || rec.el.className || 'el'}`; }
  _loadSeen() {
    try { return new Map(Object.entries(JSON.parse(sessionStorage.getItem('eon-hyped') || '{}'))); }
    catch { return new Map(); }
  }
  _saveSeen() {
    try {
      const entries = [...this.reactedAt.entries()].slice(-60);
      sessionStorage.setItem('eon-hyped', JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }
}
