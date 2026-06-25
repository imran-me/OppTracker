/* ============================================================
   EON — owner/coach.js  ·  "The Section Coach"
   Owner-mode awareness. As the owner moves through the app, EON reads
   WHICH section he's in and reacts in-character with content related to
   that field: an observation, a prompt ("adding a new one?"), a quick
   technical tip, or a DATA-aware callout pulled from the owner's own
   records ("'Chevening' is due in 6 days — want to open it?").

   He's gentle by design (a decision brain decides WHEN it's worth a word),
   never talks over the standup / nudger / ask panels, and stands down for
   public visitors entirely.

   Consumed by main.js:  .start()   .update()
   ============================================================ */

import { OWNER, ownerFirstName } from '../../js/owner-config.js';

const FIRST_DELAY = 6500;     // settle on a page before the first remark
const GAP_MS = 52000;         // ~52s between ambient remarks
const IDLE_MIN = 5000;        // only chime in once the owner's paused a beat
const SPEAK_MS = 5200;

// data-page → content key (details pages fold into their parent)
const PAGE_KEY = {
  dashboard: 'dashboard', index: 'dashboard',
  opportunities: 'opportunities', 'opportunity-details': 'opportunityDetails',
  tasks: 'tasks', documents: 'documents', achievements: 'achievements',
  training: 'training', projects: 'projects', research: 'research',
  volunteering: 'volunteering', contacts: 'contacts', profile: 'profile',
  categories: 'system', owner: 'system',
};
// content key → the data entity it counts / reads
const KEY_ENTITY = {
  opportunities: 'opportunities', opportunityDetails: 'opportunities', tasks: 'tasks',
  documents: 'documents', achievements: 'achievements', training: 'training',
  projects: 'projects', research: 'research', volunteering: 'volunteering', contacts: 'contacts',
};
const LABEL = {
  opportunities: 'opportunities', tasks: 'tasks', documents: 'documents',
  achievements: 'achievements', training: 'training', projects: 'projects',
  research: 'research ideas', volunteering: 'activities', contacts: 'contacts',
};

/* Section content. Each: emotes + three line pools (observe / prompt / tip). */
const SECTIONS = {
  dashboard: {
    emotes: ['point', 'think', 'salute', 'lookWatch', 'wave'],
    observe: ["Command centre online. Let's make today count, {name}.", 'The whole picture, right here. Where do we start?', 'Numbers looking alive today. 📊', 'Morning briefing vibes. I like it.', "This is mission control, {name}."],
    prompt: ['Want me to plan your day? Just ask. 🗓️', "Pick a number — I'll show you what's behind it.", 'Shall we tackle the nearest deadline first?', 'Ask me "what\'s due this week?" anytime.'],
    tip: ['Tip: click any stat to see the list behind it.', 'Tip: the calendar dots mark reminders and deadlines.', 'Tip: say "remind me in 30 minutes to…" and I will.', 'Tip: hover a sidebar item and I\'ll tell you what\'s inside.'],
  },
  opportunities: {
    emotes: ['point', 'idea', 'fistPump', 'lookWatch', 'salute'],
    observe: ['Lots of opportunities here — I love to see it. 🧭', 'This is where momentum is built, {name}.', 'Your opportunity board is buzzing.', 'Every one of these is a door. Let\'s open a few.', 'Opportunity radar: active. 🎯', 'Scholarships, comps, internships — the hunt is on.', 'Fortune favours the prepared. And you, {name}, prepare.'],
    prompt: ['Anything cooking? Add a new one? ➕', "Found something out there? Let's log it.", "Adding a fresh one? I'll track its deadline.", 'See a competition online? Bring it here.', 'Which one are we applying to next?', 'Spotted a fellowship? Don\'t let it slip away.'],
    tip: ['Tip: set a deadline and I\'ll remind you before it.', 'Tip: mark status "Applied" so we can track it.', 'Tip: "Won" ones flow straight to your portfolio. 🏆', 'Tip: add the organizer — handy for follow-ups.', 'Tip: set Priority so I know what matters most.', 'Tip: add the official link so it\'s one click away.'],
  },
  opportunityDetails: {
    emotes: ['point', 'think', 'fistPump', 'lookWatch', 'work'],
    observe: ['Let\'s give this one your best shot.', 'This could be a big one, {name}.', 'Eyes on the prize. 🎯', 'Focus mode — this deserves it.'],
    prompt: ['Deadline set? Want me to remind you?', 'Need a task list for this? Break it down.', 'Form a team for this one? 🤝', "Draft started? Don't wait for perfect."],
    tip: ['Tip: jot the next steps in the notes.', 'Tip: attach your draft so it\'s all in one place.', 'Tip: add the event date too, not just the deadline.'],
  },
  tasks: {
    emotes: ['work', 'typing', 'nod', 'point', 'fistPump'],
    observe: ['The board where plans become done. ✅', 'Momentum lives here, {name}.', "Let's clear a couple of these.", 'Doing beats planning. And this is doing.', 'Checklists are quietly heroic. 🦸', 'A moving task board is a moving life.'],
    prompt: ['Drag a card forward — feels good, doesn\'t it?', "New task to capture? Don't let it slip.", 'Anything blocking you? Park it in Waiting.', 'One task, full focus. Which one?', 'What\'s the smallest next step? Start there.', 'Knock out a quick one for momentum. ⚡'],
    tip: ['Tip: set due dates so I can nudge you.', 'Tip: link a task to its opportunity for context.', 'Tip: keep "In Progress" to 1–2 — focus wins. 🎯', 'Tip: overdue ones surface on your dashboard.', 'Tip: break big tasks into tiny ones — they move faster.'],
  },
  documents: {
    emotes: ['read', 'point', 'salute', 'nod'],
    observe: ['Your paperwork fortress. 📁', 'All filed and ready — impressive.', 'Documents in order, mind at ease.', 'Boring? Maybe. Lifesaving? Absolutely.'],
    prompt: ['Need to add a new file or link?', 'Passport, CV, transcript — all current?', 'Drop a Drive link so it\'s reachable anywhere.'],
    tip: ['Tip: add expiry dates — I\'ll warn before they lapse.', 'Tip: keep your CV here, always the latest.', 'Tip: mark status "Ready" so you know what\'s set.'],
  },
  achievements: {
    emotes: ['proud', 'cheer', 'applaud', 'heartHands', 'thumbsUp'],
    observe: ['The trophy room. 🏆 Every one of these is earned.', 'Look at this wall, {name}. Proud of you.', 'Wins on wins. Keep stacking. 🥇', "Hard to be humble in here, isn't it? 😏", 'Receipts of greatness, all in a row. 🧾', 'I never get tired of this view. 🏅'],
    prompt: ['Just won something? Add it — show it off.', 'New certificate to display? Let\'s add it.', 'Add a photo — these look great with one. 📸', 'Don\'t be shy — log that win.', 'Recent recognition? It belongs on this wall.'],
    tip: ['Tip: mark "Portfolio" to feature it publicly.', 'Tip: add the position and issuer — looks sharp.', 'Tip: a cover image makes the card pop.', 'Tip: no deadlines here — these are pure wins. 🎉', 'Tip: the "View details" opens the full story.'],
  },
  training: {
    emotes: ['read', 'idea', 'thumbsUp', 'nod', 'salute'],
    observe: ['Always leveling up. 🎓 Respect.', 'Skills compounding right here.', 'Every course makes you sharper, {name}.', 'Learning is your superpower. Keep going.'],
    prompt: ['Finished a course? Log it — and its skills.', 'Add the skills you gained — they boost your portfolio.', 'New certification to add?'],
    tip: ['Tip: list the skills — they auto-appear on your portfolio.', 'Tip: add the credential ID for proof.', 'Tip: a certificate link adds credibility.'],
  },
  projects: {
    emotes: ['flex', 'point', 'fistPump', 'proud', 'work'],
    observe: ['Where ideas become real things. 🚀', 'Builder mode. I like it.', 'These projects tell your story, {name}.', 'Shipping > talking. And you ship.'],
    prompt: ['Shipping something new? Add the project.', 'Add the tech stack — recruiters love it.', 'Got a repo or demo link? Drop it in.'],
    tip: ['Tip: mark Completed vs Ongoing to track progress.', 'Tip: add images — visuals sell the work.', 'Tip: a crisp subtitle makes the card shine.', 'Tip: use the content studio for a deep write-up.'],
  },
  research: {
    emotes: ['think', 'ponder', 'idea', 'read'],
    observe: ['Big-brain territory. 🧠', 'Pushing boundaries, as always.', 'Ideas worth chasing live here.', 'This is how you stand out, {name}.'],
    prompt: ['New direction? Capture it before it fades.', 'Add the problem statement — clarity first.', 'Got references? Keep them with the idea.'],
    tip: ['Tip: track the stage from Idea to Published.', 'Tip: use the content studio for a rich write-up.', 'Tip: link papers in the references field.'],
  },
  volunteering: {
    emotes: ['heartHands', 'wave', 'nod', 'salute', 'bow'],
    observe: ["Giving back — that's character, {name}. ❤️", 'Community work matters. Glad you track it.', 'This says a lot about who you are.', 'Service is leadership in disguise.'],
    prompt: ['Did some good lately? Add the activity.', 'Add your role and the cause.', 'Skills from volunteering count too — list them.'],
    tip: ['Tip: skills here flow to your portfolio.', 'Tip: add the organization for context.', 'Tip: a photo brings the story to life.'],
  },
  contacts: {
    emotes: ['wave', 'point', 'salute', 'nod'],
    observe: ['Your network — quietly powerful. 🤝', 'People open doors. Keep them close.', 'Relationships are the real currency.', 'Your future references live here.'],
    prompt: ['Met someone useful? Add them while it\'s fresh.', 'Add a note so you remember the context.', 'Reconnect with anyone today?'],
    tip: ['Tip: note how you met — future-you will thank you.', 'Tip: tag mentors and referees.', 'Tip: add LinkedIn for easy reach.'],
  },
  profile: {
    emotes: ['proud', 'wave', 'heartHands', 'bow', 'wink'],
    observe: ['Your story, all in one place. ✨', 'This is the you the world sees, {name}.', 'Looking sharp. Recruiters will love this.', 'A portfolio with a soul. Nice. 😎'],
    prompt: ['Keep your headline fresh — first impressions count.', 'Add a new reference? Social proof is gold.', 'Update your skills as you grow.'],
    tip: ['Tip: feature your best work with the Portfolio flag.', 'Tip: a good photo lifts the whole page.', 'Tip: keep experience dates current.'],
  },
  system: {
    emotes: ['salute', 'think', 'nod'],
    observe: ['Behind-the-scenes stuff. I\'ll keep watch.', 'Tuning the engine, are we?'],
    prompt: ['Set things up the way you like — I\'ll adapt.'],
    tip: ['Tip: categories you add show up in the forms.'],
  },
};

// Cross-section colour: time-of-day + pure encouragement (used occasionally).
const TIME_MORNING = ['Morning, {name}. Fresh start, big day. ☀️', 'Early and at it — respect the hustle.', "Coffee first, then we conquer. ☕", 'New day, clean slate. Let\'s write something good.', 'Sun\'s up, {name}. So are your chances. 🌅'];
const TIME_NIGHT = ["It's late, {name}. One more thing, then rest? 🌙", 'Burning the midnight oil — I\'m right here.', 'Night owl mode. Don\'t forget to sleep. 😴', 'Quiet hours hit different. Deep work time. 🌌', 'Late session — I\'ll keep you company.'];
const ENCOURAGE = ["You've got this, {name}.", 'One step at a time. We move. 💪', 'Small progress is still progress.', "Proud of the work you're putting in.", 'Future you is already grateful.', 'Consistency beats intensity. Keep showing up.', 'You\'re closer than you think, {name}.', 'Trust the reps. They add up. 📈'];

// Cross-cutting banter + personality + universal tips (a little goes a long way).
const MISC = [
  'Just so you know — I\'m always watching your back. 🛡️',
  'Need anything? Hit "Ask EON" and grill me about your data.',
  'I read your records so you don\'t have to remember everything.',
  'Spelling slip while you type? I\'ll quietly flag it. ✍️',
  'Type "remind me in 10 minutes to…" — I\'ll actually remind you.',
  'Your portfolio updates itself as you add things here. Magic. ✨',
  'I never nag about achievements or awards — those are pure wins. 🏆',
  'Drag me around if I\'m in the way. I bounce back. 🙂',
  'Every field you fill makes your portfolio sharper.',
  'I\'m rooting for you, {name}. Quietly. Loudly. Always.',
  'One more entry today? Momentum loves company.',
  'Tidy data, clear mind. We\'re building both.',
  'When in doubt, ship it. You can polish later. 🚀',
  'I\'ll fetch anything — just ask me to take you there.',
  'Deadlines I track. Wins I celebrate. Spelling I fix. Deal? 🤝',
  'Pro move: review your dashboard every morning. 60 seconds, big clarity.',
  'You build the data, I turn it into a portfolio. Teamwork. 🤝',
  'Forgot where you left off? Ask me — I remember.',
  'Quality over quantity, but quantity has a quality of its own. 😄',
  'I\'m basically your hype-man AND your assistant. Lucky you. 😎',
  'Add a cover image somewhere today — visuals win.',
  'Your network is an asset. Water it. 🌱',
  'Tiny tip: the search bar up top finds anything fast. 🔍',
  'Set one reminder before you log off — future-you stays on track.',
  'I keep your private stuff private. Visitors never see your reminders. 🔒',
  'When you win something, tell me first. I throw confetti. 🎉',
  'Stuck? Break it into one tiny next step. Then do that.',
  'Every pro was once an amateur who kept going, {name}.',
  'Keep your CV here and always current — opportunity waits for no one.',
  'A finished draft beats a perfect idea. Ship it. 📨',
];

export class Coach {
  constructor(ctx) {
    this.ctx = ctx;
    this.page = document.body?.getAttribute('data-page') || 'dashboard';
    this.key = PAGE_KEY[this.page] || 'dashboard';
    this._startedAt = Date.now();
    this._next = 0;
    this._greeted = false;
    this._recent = [];                 // avoid repeating recent lines
    this._rot = 0;                     // rotate observe/prompt/tip
  }

  start() { /* nothing to build — speaks through the avatar */ }

  update() {
    if (!this._owner()) return;
    const c = this.ctx, now = Date.now();
    if (c.drag?.active || c.focus || c.meditating || c.hypeBusy) { this._next = now + 12000; return; }
    if (this._otherCardUp()) { this._next = now + 12000; return; }

    if (!this._greeted) {
      if (now - this._startedAt < FIRST_DELAY) return;
      if (!this._idleEnough()) return;
      this._greeted = true; this._next = now + GAP_MS;
      this._say(this._greetingLine(), true);
      return;
    }
    if (now < this._next) return;
    if (!this._idleEnough()) { this._next = now + 8000; return; }
    this._next = now + GAP_MS + (this._rot % 3) * 6000;   // light jitter
    this._say(this._ambientLine(), false);
  }

  // ---- line selection ----
  _greetingLine() {
    // greet with the time-of-day sometimes, else a section observation,
    // and fold in a data callout when there's something worth saying.
    const data = this._dataLine();
    const hour = new Date().getHours();
    if (data && Math.random() < 0.5) return data;
    if (hour < 7 && Math.random() < 0.6) return { text: this._pick(TIME_MORNING), emote: 'wave' };
    if (hour >= 23 && Math.random() < 0.6) return { text: this._pick(TIME_NIGHT), emote: 'sleepy' };
    return data || this._sectionLine('observe');
  }
  _ambientLine() {
    this._rot++;
    // ~40% a real data callout, otherwise rotate observe → prompt → tip, with
    // the odd encouragement / bit of banter mixed in for personality.
    if (Math.random() < 0.4) { const d = this._dataLine(); if (d) return d; }
    if (this._rot % 7 === 0) return { text: this._pick(ENCOURAGE), emote: 'heartHands' };
    if (this._rot % 5 === 0) return { text: this._pick(MISC), emote: this._pick(['wink', 'salute', 'point', 'nod', 'wave']) };
    const pool = ['observe', 'prompt', 'tip'][this._rot % 3];
    return this._sectionLine(pool);
  }
  _sectionLine(pool) {
    const S = SECTIONS[this.key] || SECTIONS.dashboard;
    const lines = S[pool] && S[pool].length ? S[pool] : S.observe;
    return { text: this._pick(lines), emote: this._pick(S.emotes) };
  }

  /** A specific, data-aware remark from the owner's records (or null). */
  _dataLine() {
    try {
      const B = window.EonBrain; if (!B) return null;
      const entity = KEY_ENTITY[this.key];
      const label = LABEL[entity] || 'items';
      const data = (B.getData && B.getData()) || {};
      const arr = Array.isArray(data[entity]) ? data[entity] : null;

      // deadline-aware sections: surface the nearest live deadline / overdue
      if (entity === 'opportunities' || entity === 'tasks') {
        const alerts = (B.getAlerts && B.getAlerts()) || [];
        const mine = alerts.filter(a => a && a.entity === entity && a.dueAt);
        if (mine.length) {
          const a = mine[0], days = Math.round((Date.parse(a.dueAt) - Date.now()) / 86400000);
          const name = this._short(a.label);
          if (days < 0) return { text: `Heads up — "${name}" is overdue. Shall we tackle it? ⚠️`, emote: 'point' };
          if (days === 0) return { text: `"${name}" is due today. Want me to open it? ⏰`, emote: 'lookWatch' };
          if (days <= 7) return { text: `"${name}" is due in ${days} day${days === 1 ? '' : 's'} — work on it? ⏰`, emote: 'lookWatch' };
        }
      }
      if (!arr) return null;
      const n = arr.length;
      if (n === 0) return { text: `No ${label} yet — add your first? I'll help. ➕`, emote: 'idea' };
      if (n === 1) return { text: `Just ${n} ${label} so far — let's grow this. 🌱`, emote: 'point' };
      if (n >= 5 && Math.random() < 0.5) return { text: `${n} ${label} and counting. You're on a roll, ${this._name()}! 🔥`, emote: 'fistPump' };
      // a random real record by name, nudging action
      if (Math.random() < 0.5) {
        const r = arr[(Math.random() * Math.min(n, 8)) | 0];
        const nm = this._short(r && (r.name || r.title));
        if (nm) return { text: `"${nm}" — want to pick this one up? 👀`, emote: 'point' };
      }
      return null;
    } catch { return null; }
  }

  // ---- speak ----
  _say(line, greeting) {
    if (!line || !line.text) return;
    try { this.ctx.character?.playEmote?.(line.emote || 'point'); } catch {}
    try { this.ctx.ai?.speak(this._fill(line.text), greeting ? SPEAK_MS + 600 : SPEAK_MS); } catch {}
  }

  // ---- helpers ----
  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }
  _idleEnough() { try { return (this.ctx.personality?.ignoredFor?.() ?? 1e9) >= IDLE_MIN; } catch { return true; } }
  _otherCardUp() {
    for (const id of ['eon-board', 'eon-nudge', 'eon-resume', 'eon-go', 'eon-hook', 'eon-ask']) {
      const e = document.getElementById(id); if (e && e.classList.contains('show')) return true;
    }
    return false;
  }
  _name() { return ownerFirstName(document.getElementById('pfName')?.textContent) || OWNER.name; }
  _fill(s) { return String(s).replace(/\{name\}/g, this._name()); }
  _pick(pool) {
    if (!pool || !pool.length) return '';
    const fresh = pool.filter(s => !this._recent.includes(s));
    const s = (fresh.length ? fresh : pool)[(Math.random() * (fresh.length ? fresh.length : pool.length)) | 0];
    this._recent.push(s); if (this._recent.length > 12) this._recent.shift();
    return s;
  }
  _short(t, n = 34) { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
}
