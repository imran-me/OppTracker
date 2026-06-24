/* ============================================================
   EON — hype-man.js  ·  "The Aware Guide"
   Public-mode intelligence. ~75% of what EON does in public is
   perceptive: he knows the page, watches the cursor, understands the
   element under it, reacts meaningfully, and proactively offers to
   lead the visitor to the owner's best work ("wanna see?"). A small
   decision brain decides WHEN it's worth speaking, so he feels like a
   guide who thinks — not a mascot that twitches at everything. The
   other ~25% (idle life: tea, reading, wandering) is left to the
   activity engine, and breathes between his perceptive moments.

   He only reads content already rendered publicly on the page (never
   the private brain feed), and stands down entirely for the owner.

   Consumed by main.js:  .start()   .update()
   ============================================================ */

import { OWNER, ownerFirstName, HOOKS, ANNOUNCEMENTS } from './owner-config.js';

// ---- element id → context ----
const ID_CONTEXT = {
  pfPhoto: 'ownerPhoto', pfName: 'ownerName', pfHeadline: 'ownerName',
  pfCurrentRole: 'experience', pfBio: 'about', pfMeta: 'about',
  pfAbout: 'education', pfSkills: 'skills', pfInterests: 'interests',
  pfSocial: 'social', pfContact: 'contact', pfStats: 'stats',
  pfExperience: 'experience', pfWins: 'win', pfAchievements: 'achievement',
  pfProjects: 'project', pfResearch: 'research', pfReferences: 'reference',
};
const SECTION_CONTEXT = {
  top: 'ownerPhoto', about: 'education', experience: 'experience',
  wins: 'win', showcase: 'achievement', projects: 'project',
  research: 'research', references: 'reference', contact: 'contact',
};
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
  [/opportunit/, 'opportunity'], [/task|to-?do/, 'task'],
  [/document|file|attachment/, 'document'], [/deadline|due|upcoming/, 'deadline'],
];
const PAGE_CONTEXT = {
  opportunities: 'opportunity', 'opportunity-details': 'opportunity',
  tasks: 'task', documents: 'document', contacts: 'contact',
  research: 'research', projects: 'project', achievements: 'achievement',
  categories: 'generic', dashboard: 'stats', profile: 'generic', index: 'generic',
};

// How "worth reacting to" each context is (decision brain gate, 0..1).
const RELEVANCE = {
  ownerPhoto: 1, ownerName: 0.85, win: 0.95, achievement: 0.95, project: 0.95,
  research: 0.85, experience: 0.8, education: 0.8, skills: 0.7, stats: 0.7,
  opportunity: 0.7, nav: 0.55, reference: 0.6, contact: 0.6, interests: 0.5,
  social: 0.5, about: 0.45, task: 0.6, document: 0.55, deadline: 0.7, generic: 0.35,
};

const PHRASES = {
  ownerPhoto: ["That's {boss} — isn't he awesome?! 😎", 'The legend himself 👑 — {name}!',
    'Handsome AND brilliant. How does he do it? ✨', 'Yep, I work for {name}. Lucky me! 🍀',
    'Main-character energy, right there. 🌟'],
  ownerName: ['{name} — remember the name. 📣', "That's the boss. {name}. A whole vibe. 😎",
    "Future's brightest — {name}! 🌟"],
  about: ['Want to know {name}? Right place. 📖', "There's a whole story here — a good one. ✨"],
  education: ['Yes, {name} studied there — top place! 🎓', 'Smart cookie. Look at that education! 🧠',
    'Great school, greater student. 📚'],
  experience: ['Look at that experience — {name} has done it all! 💼', 'Role after role of real impact. 🙌',
    'From AI to strategy — {name} wears every hat. 🎩'],
  skills: ['These skills? Sharp as they come. 🛠️', '{name} speaks fluent code AND people. 💡',
    'A toolbox most only dream of. 🔧'],
  interests: ['Curious mind, big heart — that\'s {name}. ❤️', 'Work hard, play hard! 🎯'],
  social: ['Go on — connect with {name}! 🤝', "Slide into those links, you won't regret it. 🔗"],
  win: ['Boom — another win for {name}! 🔥', "That's how it's done! 🏆", '{name} keeps on winning. 🥇',
    'He collects prizes like stamps! ✨'],
  achievement: ['He nailed it! 🎯', 'Certified brilliance, right here. 🏅', 'Another one for {name}! 🎉',
    'Awards on awards on awards. 👏'],
  project: ['{name} built this — impressive, right? 🚀', 'Pure skill. 💡',
    "Ideas into reality — that's {name}'s superpower. ⚙️"],
  research: ['Big-brain energy 🧠 — {name}\'s research!', 'Pushing boundaries, as always. 🔬',
    'Genius at work. ✨'],
  reference: ["Don't take my word — read what people say! 💬", 'Mentors all rave about {name}. ⭐'],
  contact: ['Reach out — {name} would love to hear from you! 📬', 'One message from something great. ✉️'],
  stats: ["The numbers don't lie — {name} stays busy! 📊", 'Look at that scoreboard. 🔥'],
  opportunity: ['{name} is always chasing the next big thing. 🧭', "Opportunities everywhere — he's on them. 🎯"],
  task: ['{name} gets things done. ✅', 'On top of every task. 🗂️'],
  document: ['All neatly filed — {name} is organised! 📁', 'Receipts for the greatness. 📄'],
  deadline: ["{name}'s lined up and on schedule. ⏰", 'Busy season, but the boss is locked in. 💪'],
  nav: ['Ooh, check out his {thing}! 👀', "His {thing} are worth a look — click! 👉"],
  generic: ['Take a look around — {name} did all this! 👏', 'Everything here screams quality. ✨',
    "You're exploring greatness, just so you know. 😄"],
};
// Specific lines used when EON can read the actual item's title ({thing}).
const SPECIFIC = {
  project: ["'{thing}' — {name} built that one. 🚀", "Ooh, '{thing}'. A personal favourite. 💡"],
  achievement: ["'{thing}' — {name} earned every bit of it. 🏅", "'{thing}'. Yeah, he's proud of that. 🏆"],
  win: ["'{thing}' — what a win! 🥇", "'{thing}'. {name} called it. 🔥"],
  research: ["'{thing}' — big-brain {name} at work. 🧠"],
};

const REACTIONS = {
  ownerPhoto: { emotes: ['proud', 'point'], glyphs: ['👑', '😎', '✨'] },
  ownerName: { emotes: ['proud', 'cheer'], glyphs: ['📣', '🌟'] },
  about: { emotes: ['wave', 'think'], glyphs: ['📖', '✨'] },
  education: { emotes: ['proud', 'think'], glyphs: ['🎓', '🧠', '📚'] },
  experience: { emotes: ['flex', 'proud'], glyphs: ['💼', '🙌'] },
  skills: { emotes: ['flex', 'cheer'], glyphs: ['🛠️', '💡'] },
  interests: { emotes: ['dance', 'wave'], glyphs: ['❤️', '🎯'] },
  social: { emotes: ['wave', 'point'], glyphs: ['🤝', '🔗'] },
  win: { emotes: ['cheer', 'jump'], glyphs: ['🔥', '🏆', '🥇'] },
  achievement: { emotes: ['celebrate', 'spin'], glyphs: ['🏅', '🎉'] },
  project: { emotes: ['flex', 'cheer'], glyphs: ['🚀', '⚙️'] },
  research: { emotes: ['applaud', 'think'], glyphs: ['🧠', '🔬'] },
  reference: { emotes: ['applaud', 'wave'], glyphs: ['💬', '⭐'] },
  contact: { emotes: ['wave', 'point'], glyphs: ['📬', '✉️'] },
  stats: { emotes: ['cheer', 'proud'], glyphs: ['📊', '🔥'] },
  opportunity: { emotes: ['point', 'cheer'], glyphs: ['🧭', '🎯'] },
  task: { emotes: ['cheer', 'applaud'], glyphs: ['✅', '🗂️'] },
  document: { emotes: ['point', 'wave'], glyphs: ['📁', '📄'] },
  deadline: { emotes: ['point', 'think'], glyphs: ['⏰', '💪'] },
  nav: { emotes: ['point', 'wave'], glyphs: ['👀', '👉'] },
  guide: { emotes: ['point', 'proud'], glyphs: ['✨', '🎉'] },
  generic: { emotes: ['applaud', 'wave'], glyphs: ['👏', '✨'] },
};
const GREETINGS = {
  profile: "Welcome! You've found {boss}. Take your time. 😊",
  projects: "Ooh, you landed on {name}'s projects — great place to start! 🚀",
  achievements: "Straight to the trophy room? Good taste. 🏆",
  research: "Brave — you started with {name}'s research. 🧠",
  dashboard: "Welcome to {name}'s world. Have a look around! 👋",
  default: "Hey there! I'm EON. Let me show you {boss}'s world. ✨",
};

const MATCH = ['#pfPhoto', '#pfName', '#pfHeadline', '#pfBio', '#pfCurrentRole', '#pfMeta',
  '#pfAbout', '#pfSkills', '#pfInterests', '#pfSocial', '#pfContact', '#pfStats',
  '#pfExperience', '#pfWins', '#pfAchievements', '#pfProjects', '#pfResearch', '#pfReferences',
  '.pf-section', '.pf-hero', '.pf-photo', '.pf-timeline > *', '.gal-grid > *',
  '.stack-16 > *', '.stat-card', '.card', '.dt tbody tr', '.sidebar a', '[data-eon]'].join(',');
const SCROLL_MATCH = '.pf-section, .pf-hero, .gal-grid, .stat-card';
const CARD_SEL = '.gal-grid > *, .stack-16 > *, .dt tbody tr, .pf-timeline > *';

// decision-brain timing
const SPEAK_MIN_GAP = 6500;   // min ms between any two spoken moments
const SPEAK_PER_MIN = 7;      // hard cap on speak-ups per minute
const HOOK_MIN_GAP  = 30000;  // min ms between "wanna see?" offers
const REARM_MS      = 35000;  // same element can delight again after this
const REACT_MS      = 2700;
const WALK_MAX_MS   = 4500;
const DWELL_MS      = 380;    // hover this long before it counts as interest
const SCAN_V        = 1100;   // px/s scroll above this = scanning → stay quiet
const MAX_QUEUE     = 3;

export class HypeMan {
  constructor(ctx) {
    this.ctx = ctx;
    this.page = document.body?.getAttribute('data-page') || '';
    this.pageFile = (location.pathname.split('/').pop() || 'index.html');
    this.ownerName = ownerFirstName(document.getElementById('pfName')?.textContent) || OWNER.name;

    this.queue = [];
    this.reactedAt = this._load('eon-hyped');
    this.active = null;
    this.phase = 'idle';                       // idle | walk | react
    this.coolUntil = 0; this.phaseUntil = 0;
    this._hoverCand = null;

    // behaviour signals (the raw material for interest detection)
    this.sig = { scrollV: 0, lastY: 0, lastT: 0, engage: 0.35, dwell: 0 };
    this.journey = this._journey();

    // decision brain
    this.spokeTimes = [];
    this.recentLines = [];
    this.lastHookAt = 0;
    this.shownHooks = new Set();
    this.declinedHooks = new Set();
    this.activeHook = null;
    this._greeted = false;
    this._startedAt = Date.now();
  }

  start() {
    if (!('IntersectionObserver' in window)) return;
    this._buildPrompt();

    this._onOver = (e) => this._onHover(e.target);
    document.addEventListener('pointerover', this._onOver, { passive: true, capture: true });
    this._onScroll = () => this._noteScroll();
    addEventListener('scroll', this._onScroll, { passive: true });

    this._io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.55) {
          const context = this._contextFor(e.target);
          if (context) this._enqueue({ el: e.target, context, label: this._labelFor(e.target) });
        }
      }
    }, { threshold: [0.55] });
    this._scan();
    let n = 0;
    this._scanTimer = setInterval(() => { this._scan(); if (++n > 12) clearInterval(this._scanTimer); }, 1500);

    this._resumeTour();   // landed here from a "wanna see?" lead on another page
  }

  _scan() {
    document.querySelectorAll(SCROLL_MATCH).forEach((el) => {
      if (el.__eonObs) return; el.__eonObs = true; this._io.observe(el);
    });
  }

  // ================= behaviour signals =================
  _noteScroll() {
    const now = Date.now(), y = scrollY;
    const dt = Math.max(16, now - (this.sig.lastT || now));
    this.sig.scrollV = Math.abs(y - this.sig.lastY) / dt * 1000;   // px/s
    this.sig.lastY = y; this.sig.lastT = now;
  }
  _journey() {
    let j = []; try { j = JSON.parse(sessionStorage.getItem('eon-journey') || '[]'); } catch {}
    j.push(this.page || this.pageFile);
    if (j.length > 12) j = j.slice(-12);
    try { sessionStorage.setItem('eon-journey', JSON.stringify(j)); } catch {}
    return j;
  }

  // ================= hover handling =================
  _onHover(node) {
    if (this._disabled() || !node || this._inEon(node)) return;
    const el = node.closest ? node.closest(MATCH) : null;
    if (!el || this._inEon(el)) return;
    if (this._hoverCand && this._hoverCand.el === el) return;
    const context = this._contextFor(el); if (!context) return;
    const isCard = el.matches?.(CARD_SEL);
    this._hoverCand = {
      el, context, label: this._labelFor(el),
      item: isCard ? this._labelFor(el) : '', ts: Date.now(), hover: true,
    };
  }

  // ================= per-frame =================
  update() {
    if (this._disabled()) { this._abort(); return; }
    const now = Date.now();
    this._decay(now);
    this._positionPrompt();

    // first impression — once, shortly after landing
    if (!this._greeted && now - this._startedAt > 1600) this._greet(now);

    // promote a settled hover (genuine interest) into the queue
    if (this._hoverCand && now - this._hoverCand.ts >= DWELL_MS) {
      const c = this._hoverCand; this._hoverCand = null;
      this.sig.engage = Math.min(1, this.sig.engage + 0.08);     // hovering = curiosity
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

    // idle → pick the next worthwhile moment (decision brain)
    if (now < this.coolUntil) return;
    if (this.activeHook) return;                       // waiting on the visitor's answer
    const rec = this.queue.shift();
    if (rec) { this._consider(rec, now); return; }

    if (this._maybeAnnounce(now)) return;              // timely owner-set message
    this._maybeOfferHook(now);                         // or proactively offer a discovery hook
  }

  /** Decide whether a perceived moment is worth a reaction. */
  _consider(rec, now) {
    if (rec.force) { this._begin(rec, now); return; }      // accepted leads always run
    if (!this._eligible(rec, now) || !this._inViewport(rec.el)) return;
    if (this.sig.scrollV > SCAN_V) return;                 // they're scanning, not reading
    if (!this._canSpeak(now)) return;                      // frequency budget
    const rel = (RELEVANCE[rec.context] ?? 0.4) * (0.6 + this.sig.engage * 0.8);
    if (Math.random() > rel) return;                       // restraint: skip low-value moments
    this._begin(rec, now);
  }

  _begin(rec, now) {
    this.active = rec; this.phase = 'walk';
    this.phaseUntil = now + WALK_MAX_MS;
    this.ctx.hypeBusy = true;
  }
  _react(now) {
    const rec = this.active; if (!rec) { this._finish(now); return; }
    this.phase = 'react'; this.phaseUntil = now + REACT_MS;
    this.reactedAt.set(this._key(rec), now); this._save('eon-hyped', this.reactedAt);
    this._noteSpoke(now);
    this.ownerName = ownerFirstName(document.getElementById('pfName')?.textContent) || OWNER.name;

    this._facePoint(rec.el);
    const R = REACTIONS[rec.context] || REACTIONS.generic;
    const emote = rec.emote || R.emotes[(Math.random() * R.emotes.length) | 0];
    try { this.ctx.character.playEmote(emote); } catch {}
    const line = rec.say ? this._fill(rec.say, rec) : this._phrase(rec);
    try { this.ctx.ai?.speak(line, REACT_MS + 900); } catch {}
    this._sparkle(R.glyphs);
    this._highlight(rec.el);
  }
  _finish(now) {
    this.ctx.hypeBusy = false; this.active = null;
    this.phase = 'idle'; this.coolUntil = now + 1200;
  }
  _abort() {
    if (this.phase === 'idle' && !this.ctx.hypeBusy) { this._hidePrompt(); return; }
    this.ctx.hypeBusy = false; this.active = null; this.phase = 'idle';
  }

  // ================= guided discovery: "wanna see?" =================
  _maybeOfferHook(now) {
    if (this.activeHook || this.sig.scrollV > SCAN_V) return;
    if (now - this.lastHookAt < HOOK_MIN_GAP) return;
    if (this.sig.engage < 0.55 || !this._canSpeak(now)) return;   // only when they seem interested
    const hook = this._pickHook();
    if (!hook) return;
    this.activeHook = hook; this.lastHookAt = now;
    this.shownHooks.add(hook.id);
    this._noteSpoke(now);
    this._showPrompt(this._fill(hook.teaser, {}));
  }
  _pickHook() {
    // prefer something on a DIFFERENT page (so he can lead), unseen + not declined
    const pool = HOOKS.filter((h) => !this.declinedHooks.has(h.id));
    const fresh = pool.filter((h) => !this.shownHooks.has(h.id));
    const offPage = (arr) => arr.filter((h) => h.page !== this.pageFile);
    return offPage(fresh)[0] || fresh[0] || offPage(pool)[0] || pool[0] || null;
  }
  _acceptHook() {
    const h = this.activeHook; this._hidePrompt(); this.activeHook = null;
    if (!h) return;
    this.sig.engage = Math.min(1, this.sig.engage + 0.15);
    if (h.page && h.page !== this.pageFile) {
      // lead across pages: drop a baton, then navigate there
      try { sessionStorage.setItem('eon-tour', JSON.stringify({ page: h.page, selector: h.selector, say: h.land })); } catch {}
      try { this.ctx.ai?.speak('Follow me! ✨', 2200); } catch {}
      setTimeout(() => { location.href = h.page; }, 700);
    } else {
      this._leadTo(h.selector, this._fill(h.land, {}));     // same page
    }
  }
  _declineHook() {
    const h = this.activeHook; this._hidePrompt(); this.activeHook = null;
    if (h) this.declinedHooks.add(h.id);
    this.sig.engage = Math.max(0, this.sig.engage - 0.15);   // read the room, back off
    this.lastHookAt = Date.now() + 15000;                    // extra cool-down after a no
  }
  /** Walk EON to a selector on the current page and land with a line. */
  _leadTo(selector, say) {
    const el = document.querySelector(selector); if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    setTimeout(() => {
      if (!el.isConnected) return;
      this._enqueue({ el, context: 'guide', label: this._labelFor(el), say, emote: 'proud', force: true }, true);
    }, 650);
  }
  _resumeTour() {
    let t = null; try { t = JSON.parse(sessionStorage.getItem('eon-tour') || 'null'); } catch {}
    if (!t || t.page !== this.pageFile) return;
    try { sessionStorage.removeItem('eon-tour'); } catch {}
    // content renders async → poll for the target, then land on it
    let tries = 0;
    const tick = () => {
      const el = document.querySelector(t.selector);
      if (el) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
        setTimeout(() => this._enqueue({ el, context: 'guide', label: this._labelFor(el), say: t.say, emote: 'proud', force: true }, true), 600);
        return;
      }
      if (++tries < 20) setTimeout(tick, 400);
    };
    setTimeout(tick, 600);
  }

  // ================= greeting / announcements =================
  /** Surface an owner-set announcement, in-character, occasionally. */
  _maybeAnnounce(now) {
    if (!ANNOUNCEMENTS.length || this.sig.scrollV > SCAN_V) return false;
    if (now - (this._lastAnn || 0) < 60000 || !this._canSpeak(now)) return false;
    this._annSeen = this._annSeen || new Set();
    const a = ANNOUNCEMENTS.find((x) =>
      (x.pages?.includes('*') || x.pages?.includes(this.page)) && !this._annSeen.has(x.id));
    if (!a) return false;
    this._annSeen.add(a.id); this._lastAnn = now; this._noteSpoke(now);
    try { this.ctx.character.playEmote('point'); } catch {}
    try { this.ctx.ai?.speak(this._fill(a.text, {}), 5500); } catch {}
    return true;
  }

  _greet(now) {
    this._greeted = true;
    if (!this._canSpeak(now)) return;
    // adapt to how they arrived (first page in the journey)
    const landed = this.journey[0] || this.page;
    const g = GREETINGS[landed] || GREETINGS[this.page] || GREETINGS.default;
    this._noteSpoke(now);
    try { this.ctx.ai?.speak(this._fill(g, {}), 5000); } catch {}
    if (this.journey.length === 1) try { this.ctx.character.playEmote('wave'); } catch {}
  }

  // ================= decision-brain helpers =================
  _canSpeak(now) {
    this.spokeTimes = this.spokeTimes.filter((t) => now - t < 60000);
    if (this.spokeTimes.length >= SPEAK_PER_MIN) return false;
    const last = this.spokeTimes[this.spokeTimes.length - 1] || 0;
    return now - last >= SPEAK_MIN_GAP;
  }
  _noteSpoke(now) { this.spokeTimes.push(now); }
  _decay(now) {
    // scroll velocity fades; engagement drifts toward calm baseline
    if (now - (this.sig.lastT || 0) > 250) this.sig.scrollV *= 0.85;
    this.sig.engage += (0.35 - this.sig.engage) * 0.002;   // slow pull to baseline
    if (this.sig.scrollV > SCAN_V) this.sig.engage = Math.max(0, this.sig.engage - 0.01);
  }

  // ================= classification =================
  _contextFor(el) {
    if (!el || this._inEon(el)) return null;
    if (el.id && ID_CONTEXT[el.id]) return ID_CONTEXT[el.id];
    if (el.matches?.('.sidebar a')) return 'nav';
    const sec = el.closest?.('section[id], header[id]');
    if (sec && SECTION_CONTEXT[sec.id]) return SECTION_CONTEXT[sec.id];
    const head = el.querySelector?.('h1,h2,h3') || el.closest?.('section,header')?.querySelector?.('h1,h2,h3');
    const text = (head?.textContent || el.getAttribute?.('data-eon') || '').toLowerCase();
    for (const [re, ctx] of KEYWORD_CONTEXT) if (re.test(text)) return ctx;
    return PAGE_CONTEXT[this.page] || 'generic';
  }
  _labelFor(el) {
    const h = el.querySelector?.('h1,h2,h3');
    const t = (h?.textContent || el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > 2 && t.length < 42 ? t : '';
  }

  // ================= queue / gating =================
  _enqueue(rec, front = false) {
    const key = this._key(rec);
    this.queue = this.queue.filter((r) => this._key(r) !== key);
    if (this.active && this._key(this.active) === key) return;
    if (front) this.queue.unshift(rec); else this.queue.push(rec);
    if (this.queue.length > MAX_QUEUE) this.queue.length = MAX_QUEUE;
  }
  _disabled() {
    const c = this.ctx;
    if (c.config && c.config.features && c.config.features.speech === false) return true;
    if (c.drag?.active || c.focus || c.meditating) return true;
    try { if (window.EonBrain?.isOwner?.()) return true; } catch {}
    return false;
  }
  _eligible(rec, now) {
    const el = rec?.el; if (!el || !el.isConnected) return false;
    const last = this.reactedAt.get(this._key(rec));
    return !last || now - last > REARM_MS;
  }
  _inViewport(el) { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; }
  _inEon(el) { return !!(el.closest && el.closest('#eon-layer, #eon-hook')); }
  _navTarget(rec) {
    if (!rec?.el) return null;
    const r = rec.el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    const cy = r.top + r.height / 2;
    const cx = r.left < innerWidth / 2 ? r.right + 50 : r.left - 50;
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

  // ================= flourishes =================
  _sparkle(glyphs) {
    const ch = this.ctx.character, P = this.ctx.particles; if (!P || !ch) return;
    for (let i = 0; i < 6; i++) {
      const g = glyphs[(Math.random() * glyphs.length) | 0];
      try { P.emote(g, ch._worldHead((Math.random() - 0.5) * 0.7, 0.5 + Math.random() * 0.4)); } catch {}
    }
  }
  _highlight(el) {
    try {
      el.animate([{ boxShadow: '0 0 0 0 rgba(126,217,87,0)' },
        { boxShadow: '0 0 0 6px rgba(126,217,87,0.5)' },
        { boxShadow: '0 0 0 0 rgba(126,217,87,0)' }], { duration: 1500, easing: 'ease-out' });
    } catch {}
  }

  // ================= the clickable "wanna see?" prompt =================
  _buildPrompt() {
    if (document.getElementById('eon-hook')) { this.promptEl = document.getElementById('eon-hook'); return; }
    const style = document.createElement('style');
    style.textContent = `
      #eon-hook{position:fixed;z-index:2147483600;max-width:260px;transform:translate(-50%,-100%);
        background:#fff;color:#10225e;border-radius:14px;padding:11px 13px;box-shadow:0 10px 30px rgba(16,34,94,.22);
        font:600 13.5px/1.35 system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .18s ease;
        border:1.5px solid #7ed95755}
      #eon-hook.show{opacity:1;pointer-events:auto}
      #eon-hook .eh-b{display:flex;gap:7px;margin-top:9px}
      #eon-hook button{flex:1;border:0;border-radius:9px;padding:6px 8px;cursor:pointer;font:700 12.5px system-ui;}
      #eon-hook .eh-y{background:#1f6dff;color:#fff}
      #eon-hook .eh-y:hover{background:#1559d8}
      #eon-hook .eh-n{background:#eef1f7;color:#52607a}
      #eon-hook .eh-n:hover{background:#e2e7f2}`;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'eon-hook';
    el.innerHTML = `<div class="eh-t"></div><div class="eh-b">
      <button class="eh-y">Yes, show me ✨</button><button class="eh-n">Not now</button></div>`;
    document.body.appendChild(el);
    el.querySelector('.eh-y').onclick = (e) => { e.stopPropagation(); this._acceptHook(); };
    el.querySelector('.eh-n').onclick = (e) => { e.stopPropagation(); this._declineHook(); };
    this.promptEl = el;
    this._promptT = el.querySelector('.eh-t');
  }
  _showPrompt(text) {
    if (!this.promptEl) return;
    this._promptT.textContent = text;
    this.promptEl.classList.add('show');
    this._positionPrompt();
    this._promptTimeout = setTimeout(() => this._softDismiss(), 9000);   // ignored = soft no (can resurface)
  }
  /** Visitor ignored the offer: tuck it away but don't hold it against them. */
  _softDismiss() {
    if (!this.activeHook) return;
    this.shownHooks.add(this.activeHook.id);   // try a different one next time
    this.activeHook = null; this._hidePrompt();
    this.lastHookAt = Date.now();
  }
  _hidePrompt() {
    if (this._promptTimeout) { clearTimeout(this._promptTimeout); this._promptTimeout = null; }
    this.promptEl?.classList.remove('show');
  }
  _positionPrompt() {
    if (!this.promptEl || !this.promptEl.classList.contains('show')) return;
    try {
      const h = this.ctx.project(this.ctx.character.headAnchor);
      this.promptEl.style.left = Math.max(140, Math.min(innerWidth - 140, h.x)) + 'px';
      this.promptEl.style.top = Math.max(90, h.y - 26) + 'px';
    } catch {}
  }

  // ================= text =================
  _fill(s, rec) {
    return String(s)
      .replace(/\{name\}/g, this.ownerName)
      .replace(/\{boss\}/g, OWNER.boss.replace(OWNER.name, this.ownerName))
      .replace(/\{thing\}/g, (rec && (rec.item || rec.label)) || 'this');
  }
  _phrase(rec) {
    let pool = PHRASES[rec.context] || PHRASES.generic;
    if (rec.item && SPECIFIC[rec.context] && Math.random() < 0.65) pool = SPECIFIC[rec.context];
    // variety: avoid the last few lines
    const fresh = pool.filter((s) => !this.recentLines.includes(s));
    const s = (fresh.length ? fresh : pool)[(Math.random() * (fresh.length ? fresh.length : pool.length)) | 0];
    this.recentLines.push(s); if (this.recentLines.length > 8) this.recentLines.shift();
    return this._fill(s, rec);
  }

  // ================= persistence =================
  _key(rec) { return `${this.page}:${rec.context}:${rec.el.id || rec.el.className || 'el'}`; }
  _load(k) { try { return new Map(Object.entries(JSON.parse(sessionStorage.getItem(k) || '{}'))); } catch { return new Map(); } }
  _save(k, map) { try { sessionStorage.setItem(k, JSON.stringify(Object.fromEntries([...map.entries()].slice(-60)))); } catch {} }
}
