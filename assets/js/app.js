/* ============================================================
   Personal Opportunity & Life Management System
   Centralized App Engine  (assets/js/app.js)
   ------------------------------------------------------------
   Pure Vanilla JS. No build step, no server, no database.
   All data lives in the browser's Local Storage and is loaded
   into one in-memory object (DB.data) at startup.

   How a page boots:
     1. Every page has <body data-page="dashboard"> (etc).
     2. On DOMContentLoaded we read that attribute, render the
        shared sidebar + topbar, then call the matching init().
   ============================================================ */

/* ==========================================================
   0. CONSTANTS — single source of truth for dropdown options
   These seed the editable Category Manager. After first run
   they are read from DB.data.categories so the Category page
   can change them globally.
   ========================================================== */
const DEFAULT_CATEGORIES = {
  opportunityTypes: ['Scholarship', 'Competition', 'Leadership Program', 'Exchange Program',
    'Fellowship', 'Conference', 'Internship', 'Training', 'Volunteer', 'Hackathon'],
  subTypes: ['AI', 'Software', 'Data Science', 'Research', 'Entrepreneurship',
    'Cyber Security', 'Robotics', 'Systems', 'Innovation'],
  statuses: ['New', 'Researching', 'Requirements Collected', 'Preparing', 'Documents Ready',
    'Writing Completed', 'Applied', 'Waitlisted', 'Shortlisted', 'Interview', 'Accepted',
    'Rejected', 'Won', 'Lost', 'Completed', 'Irrelevant'],
  priorities: ['Critical', 'High', 'Medium', 'Low'],
  countries: ['Bangladesh', 'USA', 'UK', 'Germany', 'Canada', 'Australia', 'Japan',
    'South Korea', 'Singapore', 'UAE', 'Turkey', 'Netherlands', 'Sweden', 'Online / Global'],
  fundingTypes: ['Fully Funded', 'Partially Funded', 'Self Funded', 'Paid / Stipend', 'Free', 'No Funding'],
  modes: ['Online', 'Offline', 'Hybrid'],
  taskCategories: ['Academic', 'Personal', 'Work', 'Research', 'Project', 'Application'],
  taskStatuses: ['To Do', 'In Progress', 'Waiting', 'Review', 'Completed', 'Cancelled'],
  documentStatuses: ['Need Preparation', 'Draft', 'Ready', 'Submitted', 'Updated'],
  documentCategories: ['Identity', 'Academic', 'Application', 'Reference', 'Certificate'],
  projectStatuses: ['Idea', 'Planning', 'Development', 'Testing', 'Completed'],
  contactTypes: ['Professor', 'Mentor', 'Team Member', 'Alumni', 'Industry Professional'],
  achievementCategories: ['Competition', 'Award', 'Certification', 'Leadership', 'Publication', 'Project']
};

/* The localStorage key. Bump the version suffix if the schema changes. */
const STORE_KEY = 'pomls_data_v1';

/* ==========================================================
   1. DB — storage layer (load / save / CRUD / backup / seed)
   ========================================================== */
const DB = {
  data: null,

  /* A short id unique to THIS browser tab, stamped on every cloud
     write so we can ignore our own live-sync echo (see subscribe). */
  _clientId: 'c-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
  _unsub: null,

  /* Merge a raw object into a complete, valid store: fill any missing
     collection, add newly introduced category keys and profile fields.
     Pure — does no storage I/O. */
  _hydrate(raw) {
    const data = (raw && typeof raw === 'object') ? raw : SEED_DATA();
    data.categories = Object.assign({}, DEFAULT_CATEGORIES, data.categories || {});
    ['opportunities','tasks','documents','achievements','contacts','research','projects','reminders','training','volunteering','education']
      .forEach(k => { if (!Array.isArray(data[k])) data[k] = []; });
    data.profile = Object.assign({}, SEED_DATA().profile, data.profile || {});
    if (!Array.isArray(data.profile.references)) data.profile.references = SEED_DATA().profile.references;
    if (!Array.isArray(data.profile.experience)) data.profile.experience = SEED_DATA().profile.experience;
    return data;
  },

  /* Instant first paint / offline fallback: read the local cache
     (or seed on a brand-new browser). Synchronous. */
  loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this.data = this._hydrate(raw ? JSON.parse(raw) : null);
    } catch (e) {
      console.error('Local cache unreadable — seeding fresh.', e);
      this.data = this._hydrate(null);
    }
    return this.data;
  },

  /* Authoritative load from Firestore (the shared cloud copy that all
     devices read). Falls back to the local cache if the network or
     security rules deny it, so the site still renders offline. */
  async loadCloud() {
    if (typeof CLOUD_DOC === 'undefined' || !CLOUD_DOC) return this.loadLocal();
    try {
      const snap = await CLOUD_DOC.get();
      if (snap.exists) {
        const d = snap.data() || {};
        this.data = this._hydrate(d.store || d);
        this._persistLocal();
      } else {
        // No cloud document yet. Seed it from whatever is local now
        // (preserving existing edits), but only the OWNER may create it.
        if (!this.data) this.loadLocal();
        if (Security.isOwner()) await this._persistCloud();
      }
    } catch (e) {
      console.warn('Cloud load failed — using local cache.', e);
      if (!this.data) this.loadLocal();
    }
    return this.data;
  },

  /* Live updates: when another device (or tab) saves, refresh in place.
     onRemote() is called only for changes that did NOT originate here. */
  subscribe(onRemote) {
    if (typeof CLOUD_DOC === 'undefined' || !CLOUD_DOC) return;
    if (this._unsub) { this._unsub(); this._unsub = null; }
    this._unsub = CLOUD_DOC.onSnapshot(snap => {
      if (!snap.exists) return;
      const d = snap.data() || {};
      if (d.writer === this._clientId) return; // ignore our own write echo
      this.data = this._hydrate(d.store || d);
      this._persistLocal();
      if (typeof onRemote === 'function') onRemote();
    }, err => console.warn('Live sync error', err));
  },

  /* Write the local cache copy (synchronous). */
  _persistLocal() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch (e) {
      // Cache full — the cloud copy is still the source of truth.
    }
  },

  /* Write the authoritative copy to Firestore (async). The server's
     security rules reject this for anyone but the owner. */
  async _persistCloud() {
    if (typeof CLOUD_DOC === 'undefined' || !CLOUD_DOC) return;
    setSync('saving');
    try {
      const json = JSON.stringify(this.data);
      // Firestore caps a single document at ~1 MiB. Warn before a big
      // save fails (heavy base64 uploads are the usual cause).
      if (json.length > 950000) {
        toast('Data is near the 1 MB cloud limit — use Drive links for large files.', 'err');
      }
      await CLOUD_DOC.set({ store: this.data, writer: this._clientId, updatedAt: Date.now() });
      setSync('synced');
    } catch (e) {
      console.error('Cloud save failed', e);
      setSync('error');
      toast('Could not sync to cloud. Check your connection or sign-in.', 'err');
    }
  },

  /* Mirror the whole store to the owner's Google Drive (backup only).
     Debounced + silent: does nothing unless the owner has connected
     Drive (Owner Dashboard → Connect Drive). */
  _persistDrive() {
    if (typeof Drive === 'undefined' || !Drive) return;
    if (!Security.isOwner()) return;
    try { Drive.backup(JSON.stringify(this.data)); } catch (e) { /* never block a save on backup */ }
  },

  /* Autosave — called after every change.
     GUARDED: the single persistence chokepoint, so even a console call
     like `DB.save()` is rejected for non-owners. Writes the local cache
     (instant), the cloud (synced to every device) and the Drive backup. */
  save() {
    if (!Security.guard('save changes')) return;
    this._persistLocal();
    this._persistCloud();
    this._persistDrive();
  },

  getAll(entity) { return this.data[entity] || []; },
  get(entity, id) { return this.getAll(entity).find(r => r.id === id); },

  /* Insert or update one record (matched by id).
     GUARDED: only the owner may write. The check sits here (not
     only on the button) so console / dev-tools calls are blocked
     too. Returns null when refused. */
  upsert(entity, record) {
    if (!Security.guard('save changes')) return null;
    const list = this.data[entity];
    // capture prior state so the Signal Layer can event-source the change
    let before = null;
    if ((entity === 'opportunities' || entity === 'tasks') && record.id) {
      const prev = list.find(r => r.id === record.id);
      if (prev) before = { status: prev.status, deadline: prev.deadline, dueDate: prev.dueDate, priority: prev.priority };
    }
    if (!record.id) {
      record.id = uid();
      record.createdAt = new Date().toISOString();
      list.push(record);
    } else {
      const i = list.findIndex(r => r.id === record.id);
      if (i > -1) list[i] = Object.assign(list[i], record);
      else list.push(record);
    }
    if (entity === 'opportunities') { try { logOppEvents(before, this.get('opportunities', record.id)); } catch {} }
    if (entity === 'tasks') { try { logTaskEvents(before, this.get('tasks', record.id)); } catch {} }
    this.save();
    if (entity === 'opportunities') { try { computeSignals(); } catch {} }
    if (entity === 'tasks') { try { computeProductivity(); celebrateIfCompleted(before, this.get('tasks', record.id)); } catch {} }
    return record;
  },

  /* GUARDED: owner-only delete. */
  remove(entity, id) {
    if (!Security.guard('delete items')) return;
    this.data[entity] = this.getAll(entity).filter(r => r.id !== id);
    this.save();
  },

  /* ---- Backup: export the whole store as a downloadable .json ---- */
  exportJSON() {
    const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pomls-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup downloaded.', 'ok');
  },

  /* ---- Restore from an uploaded .json backup file ---- */
  /* GUARDED: importing overwrites all data — owner only. */
  importJSON(file) {
    if (!Security.guard('import a backup')) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (!obj.opportunities) throw new Error('Not a valid backup.');
        this.data = Object.assign(SEED_DATA(), obj);
        this.data.categories = Object.assign({}, DEFAULT_CATEGORIES, obj.categories || {});
        this.save();
        toast('Backup restored. Reloading…', 'ok');
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        toast('That file could not be restored.', 'err');
      }
    };
    reader.readAsText(file);
  },

  /* GUARDED: destructive reset — owner only. */
  resetAll() {
    if (!Security.guard('reset all data')) return;
    this.data = SEED_DATA();
    this.save();
  }
};

/* short readable unique id */
function uid() { return 'id-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

/* convenient access to the editable category lists */
const CATS = (key) => (DB.data.categories[key] || []);

/* ==========================================================
   2. SMALL HELPERS — dates, formatting, escaping, toasts
   ========================================================== */

/* Calculate remaining days before a deadline (negative = overdue) */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* friendly "in 5 days" / "3 days ago" label */
function relDays(dateStr) {
  const n = daysUntil(dateStr);
  if (n === null) return '';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`;
}

/* prevent HTML injection from user-entered text */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Tiny, SAFE rich-text renderer. The toolbar in the entity modal writes a
   minimal Markdown subset; this turns it into HTML. Crucially it escapes the
   raw text FIRST, so only the tags WE generate are ever HTML (no XSS).
   Supports: **bold**  *italic*  __underline__  `- ` bullet lists  newlines. */
function mdToHtml(s) {
  if (s == null || s === '') return '';
  const esc = escapeHtml(s);
  const lines = esc.split(/\r?\n/);
  let html = '', inList = false;
  const inline = (t) => t
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  for (const ln of lines) {
    const li = ln.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; }
    else { if (inList) { html += '</ul>'; inList = false; } html += ln.trim() ? `<p>${inline(ln)}</p>` : ''; }
  }
  if (inList) html += '</ul>';
  return html;
}
/* Strip the formatting markers for plain-text previews (clamped card text). */
function mdStrip(s) {
  return String(s == null ? '' : s)
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1').replace(/^\s*[-*]\s+/gm, '• ');
}

/* Apply a formatting mark to the current selection of a <textarea>. */
function rtApply(ta, kind) {
  const start = ta.selectionStart, end = ta.selectionEnd, val = ta.value;
  const sel = val.slice(start, end);
  let rep;
  if (kind === 'list') {
    rep = (sel || 'item').split(/\n/).map(l => l.trim() ? `- ${l.replace(/^\s*[-*]\s*/, '')}` : l).join('\n');
  } else {
    const mark = kind === 'bold' ? '**' : kind === 'underline' ? '__' : '*';
    rep = `${mark}${sel || kind}${mark}`;
  }
  ta.value = val.slice(0, start) + rep + val.slice(end);
  ta.focus();
  ta.selectionStart = start; ta.selectionEnd = start + rep.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ============================================================
   EON LANGUAGE SKILLS — spelling, grammar & writing fixes (client-side).
   A curated common-typo map + safe rule-based grammar fixes + near-miss
   correction against YOUR own vocabulary. Powers the gentle blur hint
   (spellAssist) and the toolbar "Fix" button (proofread).
   ============================================================ */

/* High-frequency English misspellings → correction (lowercase keys). */
const COMMON_TYPOS = {
  // articles / glue words & finger-slips
  teh: 'the', thn: 'then', adn: 'and', nad: 'and', taht: 'that', wiht: 'with', hte: 'the', ot: 'to',
  fo: 'of', fro: 'for', og: 'of', anf: 'and', ahve: 'have', wnat: 'want', jsut: 'just',
  knwo: 'know', konw: 'know', wokr: 'work', wroking: 'working', liek: 'like', becuse: 'because',
  // -ei-/-ie- and double letters
  recieve: 'receive', recieved: 'received', recieving: 'receiving', reciept: 'receipt', beleive: 'believe',
  beleived: 'believed', beleive: 'believe', acheive: 'achieve', acheived: 'achieved', acheiving: 'achieving',
  achievment: 'achievement', achievments: 'achievements', wierd: 'weird', freind: 'friend', freinds: 'friends',
  peice: 'piece', acheivement: 'achievement', concieve: 'conceive', decieve: 'deceive', percieve: 'perceive',
  // common content words
  seperate: 'separate', seperated: 'separated', seperately: 'separately', definately: 'definitely',
  definatly: 'definitely', definetly: 'definitely', occured: 'occurred', occuring: 'occurring',
  untill: 'until', wich: 'which', becuase: 'because', becasue: 'because', thier: 'their', truely: 'truly',
  tommorow: 'tomorrow', tommorrow: 'tomorrow', enviroment: 'environment', goverment: 'government',
  neccessary: 'necessary', necesary: 'necessary', necessery: 'necessary', occassion: 'occasion',
  persue: 'pursue', persued: 'pursued', priviledge: 'privilege', recomend: 'recommend', recomended: 'recommended',
  refered: 'referred', refering: 'referring', relevent: 'relevant', succesful: 'successful',
  successfull: 'successful', sucessful: 'successful', succesfully: 'successfully', sucessfully: 'successfully',
  writting: 'writing', begining: 'beginning', beggining: 'beginning', calender: 'calendar', collegue: 'colleague',
  collegues: 'colleagues', commited: 'committed', commitee: 'committee', completly: 'completely',
  concious: 'conscious', embarass: 'embarrass', embarassing: 'embarrassing', existance: 'existence',
  experiance: 'experience', experianced: 'experienced', familar: 'familiar', finaly: 'finally',
  foriegn: 'foreign', grammer: 'grammar', happend: 'happened', immediatly: 'immediately',
  independant: 'independent', independance: 'independence', knowlege: 'knowledge', maintainance: 'maintenance',
  occassionally: 'occasionally', oppurtunity: 'opportunity', oppertunity: 'opportunity', opportunites: 'opportunities',
  oppurtunities: 'opportunities', posession: 'possession', prefered: 'preferred', publically: 'publicly',
  responsability: 'responsibility', responsibile: 'responsible', similiar: 'similar', strenght: 'strength',
  useable: 'usable', accomodate: 'accommodate', accomodation: 'accommodation', adress: 'address',
  arguement: 'argument', assesment: 'assessment', basicly: 'basically', catagory: 'category',
  curiousity: 'curiosity', dilema: 'dilemma', dissapoint: 'disappoint', dissapointed: 'disappointed',
  enterpreneur: 'entrepreneur', entreprenuer: 'entrepreneur', garantee: 'guarantee', harrass: 'harass',
  harrassment: 'harassment', intresting: 'interesting', interesting: 'interesting', liason: 'liaison',
  millenium: 'millennium', noticable: 'noticeable', occurence: 'occurrence', paralel: 'parallel',
  perseverence: 'perseverance', practise: 'practice', recepient: 'recipient', rythm: 'rhythm',
  scholorship: 'scholarship', scholarhip: 'scholarship', tecnology: 'technology', techology: 'technology',
  unfortunatly: 'unfortunately', volunteeer: 'volunteer', volunter: 'volunteer', certficate: 'certificate',
  certifcate: 'certificate', certificaiton: 'certification', univercity: 'university', univeristy: 'university',
  // academic / career vocabulary (relevant to opportunity-seeking)
  curriculem: 'curriculum', resgistration: 'registration', registeration: 'registration', aplication: 'application',
  applicaton: 'application', aplicant: 'applicant', canditate: 'candidate', acceptence: 'acceptance',
  admited: 'admitted', admissons: 'admissions', deadlne: 'deadline', dedline: 'deadline', interveiw: 'interview',
  intervew: 'interview', particpate: 'participate', participatd: 'participated', particpant: 'participant',
  acheivements: 'achievements', resarch: 'research', reserch: 'research', reasearch: 'research',
  goverment: 'government', interational: 'international', internatonal: 'international', nationaly: 'nationally',
  competion: 'competition', competiton: 'competition', conferance: 'conference', conferene: 'conference',
  fellowhip: 'fellowship', internsip: 'internship', interhsip: 'internship', mentorhip: 'mentorship',
  prefession: 'profession', profesional: 'professional', profesionally: 'professionally', managment: 'management',
  developement: 'development', enviromental: 'environmental', anaylsis: 'analysis', analiysis: 'analysis',
  buisness: 'business', busniess: 'business', leadred: 'leader', leadersihp: 'leadership', leadershp: 'leadership',
  // multi-word fixes (value contains a space)
  alot: 'a lot', infront: 'in front', incase: 'in case', aswell: 'as well', inspite: 'in spite',
  atleast: 'at least', infact: 'in fact', eventhough: 'even though', infrount: 'in front',
};

/* No-apostrophe contractions → with apostrophe (safe set only — words that are
   almost never anything else; "were/lets/its/ill" are intentionally omitted). */
const CONTRACTIONS = {
  dont: "don't", cant: "can't", wont: "won't", isnt: "isn't", arent: "aren't", wasnt: "wasn't",
  werent: "weren't", didnt: "didn't", doesnt: "doesn't", couldnt: "couldn't", shouldnt: "shouldn't",
  wouldnt: "wouldn't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", wouldve: "would've",
  couldve: "could've", shouldve: "should've", im: "I'm", ive: "I've", youre: "you're", youve: "you've",
  youll: "you'll", theyre: "they're", theyve: "they've", theyll: "they'll", weve: "we've",
  thats: "that's", whats: "what's", whos: "who's", heres: "here's", theres: "there's", whens: "when's",
  wheres: "where's",
  // NOTE: "well", "lets", "its", "were", "id", "hes", "shes" are deliberately
  // excluded — they are valid common words, so auto-fixing them causes errors.
};

/* Common phrase-level grammar slips → fix [pattern, replacement, label]. */
const PHRASE_FIXES = [
  [/\b(could|should|would|must|might) of\b/gi, '$1 have', 'grammar'],
  [/\byour welcome\b/gi, "you're welcome", 'grammar'],
  [/\banyways\b/gi, 'anyway', 'grammar'],
  [/\birregardless\b/gi, 'regardless', 'grammar'],
  [/\bsupposably\b/gi, 'supposedly', 'spelling'],
  [/\bfor all intensive purposes\b/gi, 'for all intents and purposes', 'grammar'],
  [/\beach other\b/gi, 'each other', 'grammar'], [/\beachother\b/gi, 'each other', 'spelling'],
  [/\bnowdays\b/gi, 'nowadays', 'spelling'], [/\bcan not\b/g, 'cannot', 'grammar'],
  [/\bi\.e\b(?!\.)/g, 'i.e.', 'grammar'], [/\be\.g\b(?!\.)/g, 'e.g.', 'grammar'],
  [/\bect\b\.?/gi, 'etc.', 'spelling'],
];

/* Words always capitalized. Excludes May/March/August (also common words). */
const PROPER_CAPS = (() => {
  const out = {};
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'april', 'june', 'july', 'september', 'october', 'november', 'december',
    'english', 'bengali', 'bangla', 'arabic', 'spanish', 'french', 'german', 'chinese', 'japanese',
    'i'].forEach(w => { out[w] = w === 'i' ? 'I' : w[0].toUpperCase() + w.slice(1); });
  return out;
})();

/* Preserve the original word's case shape when substituting a correction. */
function matchCase(src, repl) {
  if (src.length > 1 && src === src.toUpperCase()) return repl.toUpperCase();
  if (src[0] === src[0].toUpperCase()) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

/* Rule-based proofread. Returns cleaned text + a list of change labels.
   Deliberately conservative — only fixes near-certain issues, and edits
   words and spacing only (it leaves the bold / underline markers alone). */
function proofread(text) {
  let s = String(text == null ? '' : text);
  const before = s;
  const changes = new Set();
  const note = (k) => changes.add(k);

  // ---- whitespace hygiene ----
  s = s.replace(/[ \t]+$/gm, '');                 // trailing spaces per line
  if (/[ \t]{2,}/.test(s)) { s = s.replace(/[ \t]{2,}/g, ' '); note('extra spaces'); }
  if (/\n{3,}/.test(s)) { s = s.replace(/\n{3,}/g, '\n\n'); note('blank lines'); }
  s = s.trim();

  // ---- phrase-level grammar slips ----
  for (const [re, rep, label] of PHRASE_FIXES) {
    if (re.test(s)) { s = s.replace(re, rep); note(label); }
  }

  // ---- punctuation spacing ----
  if (/\s+([,.!?;:])/.test(s)) { s = s.replace(/\s+([,.!?;:])/g, '$1'); note('punctuation spacing'); }
  if (/([,.!?;:])([A-Za-z])/.test(s)) { s = s.replace(/([,.!?;:])([A-Za-z])/g, '$1 $2'); note('punctuation spacing'); }
  if (/([!?.,]){2,}(?![!?.])/.test(s)) { /* keep intentional !!/?? — only collapse 4+ */ }
  if (/([.,]){2,}/.test(s)) { s = s.replace(/\.{4,}/g, '…').replace(/,{2,}/g, ','); }

  // ---- word-level fixes (spelling, contractions, your terms, proper nouns) ----
  const dict = (typeof Security !== 'undefined' && Security.isOwner && Security.isOwner()) ? buildSpellDict() : new Map();
  s = s.replace(/[A-Za-z][A-Za-z'-]*/g, (w) => {
    const lw = w.toLowerCase();
    if (/^i'(m|ve|ll|d|re)$/i.test(w)) { if (w[0] !== 'I') note('capitalization'); return 'I' + w.slice(1).toLowerCase(); }
    if (CONTRACTIONS[lw]) { const rep = matchCase(w, CONTRACTIONS[lw]); if (rep !== w) note('grammar'); return rep; }
    const typo = COMMON_TYPOS[lw] || LEXICON[lw];     // core map + the big library
    if (typo) { const rep = matchCase(w, typo); if (rep !== w) note('spelling'); return rep; }
    if (PROPER_CAPS[lw] && w !== PROPER_CAPS[lw]) { note('capitalization'); return PROPER_CAPS[lw]; }
    if (lw.length >= 5 && !dict.has(lw)) {
      for (const [term, display] of dict) {
        if (term[0] === lw[0] && Math.abs(term.length - lw.length) <= 1 && editDistance(lw, term, 1) === 1) {
          note('spelling'); return matchCase(w, display);
        }
      }
    }
    return w;
  });

  // ---- standalone "i" → "I" (after contraction handling) ----
  if (/\bi\b/.test(s)) { s = s.replace(/\bi\b/g, 'I'); note('“i” → “I”'); }
  // ---- repeated word (the the) ----
  if (/\b(\w+)\s+\1\b/i.test(s)) { s = s.replace(/\b(\w+)\s+\1\b/gi, '$1'); note('repeated word'); }
  // ---- a → an before a clear vowel-sound word ----
  s = s.replace(/\b([Aa])\s+([aeio]\w+)/g, (m, a, w) => {
    if (/^(one|once|eu)/i.test(w)) return m;       // "a one", "a European"
    note('a → an'); return (a === 'A' ? 'An' : 'an') + ' ' + w;
  });

  // ---- capitalization: sentence starts + the start of each text line ----
  s = s.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, p, c) => { note('capitalization'); return p + c.toUpperCase(); });
  s = s.replace(/(\n[ \t]*)([a-z])/g, (m, p, c) => { note('capitalization'); return p + c.toUpperCase(); });

  if (s === before) changes.clear();
  return { text: s, changes: [...changes] };
}

/* Run proofread on a field, apply the result, and report what changed.
   EON says it aloud for character; a toast lists the fixes. */
function fixField(el) {
  if (!el) return;
  const { text, changes } = proofread(el.value);
  if (!changes.length || text === el.value) { toast('Looks clean already. ✨', 'ok'); return; }
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const summary = changes.slice(0, 4).join(', ');
  toast(`Fixed: ${summary}${changes.length > 4 ? '…' : ''} ✨`, 'ok');
  try { window.EON?.ai?.speak('Tidied that up for you. ✍️', 3200); } catch {}
}

/* The big spelling library (~3.4k misspelling→correction pairs) + a base
   English wordlist live in their own files, fetched once at startup. The
   wordlist powers EON's live "it's not X, it's Y" spotting of any misspelled
   word (not just the curated ones). */
let LEXICON = {};
let WORD_VALID = new Set();        // recognised words (base + inflections) — never flagged
let WORD_TARGETS_BY_CHAR = new Map(); // first-letter → [real words] used as suggestion targets

/* Add a base word plus its likely inflections to the "valid" set. Over-
   generating here is safe: it only prevents false alarms on real words. */
function _addWordForms(set, w) {
  w = w.toLowerCase();
  if (w.length < 2 || !/^[a-z]+$/.test(w)) return;
  set.add(w);
  ['s', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'est', 'ers', 'ment', 'ness', 'ity', 'al', 'ic', 'ful', 'less', 'able', 'ion', 'ions'].forEach(suf => set.add(w + suf));
  if (w.endsWith('e')) { const b = w.slice(0, -1); ['ing', 'ed', 'er', 'est', 'al', 'able', 'ion'].forEach(s => set.add(b + s)); }
  if (w.endsWith('y')) { const b = w.slice(0, -1); ['ies', 'ied', 'ier', 'iest', 'ily', 'iness'].forEach(s => set.add(b + s)); }
  if (/[^aeiou][aeiou][bcdfgklmnprstz]$/.test(w)) { const d = w + w.slice(-1); ['ing', 'ed', 'er'].forEach(s => set.add(d + s)); }
}

async function loadLanguageData() {
  // 1) the misspelling→correction library
  try {
    const res = await fetch('./assets/js/lexicon.json', { cache: 'force-cache' });
    if (res.ok) { const data = await res.json(); delete data._comment; LEXICON = data; }
  } catch { /* offline — core typo map still works */ }

  // 2) the base wordlist → build the valid-set + suggestion targets
  let base = [];
  try {
    const res = await fetch('./assets/js/words.json', { cache: 'force-cache' });
    if (res.ok) base = await res.json();
  } catch { /* offline */ }

  const targets = new Map();   // lowercase → true (dedup), insertion order = priority
  const addTarget = (w) => { const lw = String(w).toLowerCase(); if (/^[a-z]{3,}$/.test(lw)) targets.set(lw, true); };
  base.forEach(w => { _addWordForms(WORD_VALID, w); addTarget(w); });
  // every CORRECT spelling in the library is also a real word + a target
  Object.values(LEXICON).forEach(v => { if (/^[a-z]+$/i.test(v)) { _addWordForms(WORD_VALID, v); addTarget(v); } });
  Object.values(COMMON_TYPOS).forEach(v => { if (/^[a-z]+$/i.test(v)) addTarget(v); });

  WORD_TARGETS_BY_CHAR = new Map();
  for (const w of targets.keys()) {
    const c = w[0]; if (!WORD_TARGETS_BY_CHAR.has(c)) WORD_TARGETS_BY_CHAR.set(c, []);
    WORD_TARGETS_BY_CHAR.get(c).push(w);
  }
  console.info(`[EON] language ready — ${Object.keys(LEXICON).length} corrections, ${WORD_VALID.size} valid forms, ${targets.size} targets.`);
}

/* Nearest correctly-spelled word within edit distance 1 (the suggestion for a
   typed word EON doesn't recognise). Returns null if there's no close match. */
function nearestWord(lw) {
  if (lw.length < 4) return null;
  const bucket = WORD_TARGETS_BY_CHAR.get(lw[0]); if (!bucket) return null;
  for (const w of bucket) {
    if (w === lw || Math.abs(w.length - lw.length) > 1) continue;
    if (editDistance(lw, w, 1) === 1) return w;
  }
  return null;
}

/* ---- EON spell-assist: gentle blur hint. Flags a common English typo or a
   near-miss of one of YOUR own terms (names, skills, orgs, titles…). ---- */
let _spellDict = null, _spellSig = '', _lastSpell = '';
function buildSpellDict() {
  const sig = String((DB.data.reminders || []).length) + ':' +
    ['achievements', 'training', 'volunteering', 'projects', 'research', 'contacts', 'opportunities']
      .map(k => DB.getAll(k).length).join(',');
  if (_spellDict && sig === _spellSig) return _spellDict;
  const map = new Map();
  const add = (s) => String(s || '').split(/[^A-Za-z'-]+/).forEach(w => {
    const lw = w.toLowerCase();
    if (lw.length >= 4 && !map.has(lw)) map.set(lw, w);
  });
  const p = DB.data.profile || {};
  (p.skills || []).forEach(add); (p.interests || []).forEach(add);
  [p.name, p.university, p.department, p.major].forEach(add);
  DB.getAll('achievements').forEach(a => { add(a.title); add(a.competition); add(a.issuer); });
  DB.getAll('training').forEach(t => { add(t.name); add(t.issuer); (t.skills || []).forEach(add); });
  DB.getAll('volunteering').forEach(v => { add(v.title); add(v.organization); add(v.cause); add(v.role); (v.skills || []).forEach(add); });
  DB.getAll('projects').forEach(pr => { add(pr.name); add(pr.technologies); });
  DB.getAll('research').forEach(r => { add(r.title); add(r.field); });
  DB.getAll('contacts').forEach(c => { add(c.name); add(c.organization); });
  DB.getAll('opportunities').forEach(o => { add(o.name); add(o.organizer); add(o.country); });
  _spellDict = map; _spellSig = sig; return map;
}
/* bounded Levenshtein (returns >cap as cap+1 to bail early) */
function editDistance(a, b, cap) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > cap) return cap + 1;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[n];
}
/* EON live spell-watch. As the owner types, EON spots a misspelled word and
   says it in his bubble:  It's not "Tesst", it's "Test".
   Sources, in order of confidence: known typo/contraction → near-miss of one
   of YOUR terms → near-miss of a common English word. Each distinct slip is
   flagged once per field so he never nags. */
const _noticedWords = new WeakMap();   // field → Set of words already flagged
function eonNotice(el) {
  try {
    if (!Security.isOwner() || !el) return;
    const text = String(el.value || ''); if (!text.trim()) return;
    let warned = _noticedWords.get(el);
    if (!warned) { warned = new Set(); _noticedWords.set(el, warned); }
    const dict = buildSpellDict();
    const words = text.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];
    for (const w of words) {
      const lw = w.toLowerCase();
      if (warned.has(lw)) continue;
      if (WORD_VALID.has(lw) || dict.has(lw)) continue;        // recognised word / your own term
      let corr = COMMON_TYPOS[lw] || LEXICON[lw] || CONTRACTIONS[lw];
      if (!corr && lw.length >= 5 && dict.size) {              // near-miss of one of your terms
        for (const [term, display] of dict) {
          if (term[0] === lw[0] && Math.abs(term.length - lw.length) <= 1 && editDistance(lw, term, 1) === 1) { corr = display; break; }
        }
      }
      if (!corr) corr = nearestWord(lw);                       // near-miss of a common word
      if (!corr) continue;
      const fix = matchCase(w, corr);
      if (fix.toLowerCase() === lw) continue;
      warned.add(lw);
      announceFix(w, fix);
      return;                                                  // one at a time
    }
  } catch {}
}
/* Speak/show a single spelling correction in EON's voice. */
function announceFix(wrong, right) {
  const msg = `It's not “${wrong}”, it's “${right}”.`;
  try { window.EON?.ai?.speak(`✍️ ${msg}`, 5000); window.EON?.character?.playEmote?.('think'); } catch {}
  toast(msg, 'ok');
}
/* back-compat alias (older call sites) */
function spellAssist(el) { return eonNotice(el); }

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

/* human-readable file size */
function fmtBytes(n) {
  if (n == null || isNaN(n)) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/* Read an uploaded File as a base64 data URL (so it can live in localStorage). */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/* Cap uploads so a single file can't blow the ~5 MB localStorage budget.
   Bigger files should use the Google Drive / download link fields instead. */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/* small toast notifications (bottom-right) */
function toast(msg, kind = 'ok') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = `toast-note ${kind}`;
  t.innerHTML = `<i class="bi ${kind === 'ok' ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill'}"></i><span>${escapeHtml(msg)}</span>`;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

/* ---- tiny cloud-sync status pill (bottom-left) ----
   Quietly reflects the Firestore sync: "Saving…" while a write is in
   flight, "Synced" when it lands (then auto-fades), "Updated" when a
   change arrives from another device, or "Sync failed" on error
   (which stays until the next successful save). */
let _syncHideTimer = null;
function setSync(state) {
  let el = document.getElementById('syncStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'syncStatus';
    el.className = 'sync-status';
    document.body.appendChild(el);
  }
  clearTimeout(_syncHideTimer);
  const map = {
    saving:        { cls: 'is-saving', ico: 'arrow-repeat',             txt: 'Saving…' },
    synced:        { cls: 'is-synced', ico: 'check-circle-fill',        txt: 'Synced' },
    updated:       { cls: 'is-synced', ico: 'cloud-arrow-down-fill',    txt: 'Updated' },
    error:         { cls: 'is-error',  ico: 'exclamation-triangle-fill', txt: 'Sync failed' },
    'drive-saving':{ cls: 'is-saving', ico: 'cloud-arrow-up',           txt: 'Backing up to Drive…' },
    'drive-done':  { cls: 'is-synced', ico: 'cloud-check-fill',         txt: 'Backed up to Drive' },
    'drive-error': { cls: 'is-error',  ico: 'exclamation-triangle-fill', txt: 'Drive backup failed' }
  };
  const s = map[state] || map.synced;
  el.className = 'sync-status show ' + s.cls;
  el.innerHTML = `<i class="bi bi-${s.ico}"></i><span>${s.txt}</span>`;
  // success / remote-update auto-hide; an error stays put until next save
  if (state === 'synced' || state === 'updated' || state === 'drive-done') {
    _syncHideTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }
}

/* ---- map a status/priority to a colour "tone" class ---- */
function statusTone(status) {
  const s = (status || '').toLowerCase();
  if (['won', 'accepted', 'completed', 'ready', 'updated', 'documents ready', 'writing completed', 'admitted', 'enrolled', 'graduated', 'offer received', 'published', 'current'].includes(s)) return 'green';
  if (['rejected', 'lost', 'cancelled', 'irrelevant', 'declined', 'withdrawn'].includes(s)) return 'red';
  if (['applied', 'shortlisted', 'interview', 'submitted', 'in progress', 'review', 'interviewing', 'deferred'].includes(s)) return 'blue';
  if (['preparing', 'writing', 'waitlisted', 'draft', 'drafting', 'waiting', 'requirements collected', 'planning', 'development', 'testing', 'literature review', 'problem defined'].includes(s)) return 'amber';
  if (['researching', 'new', 'idea', 'need preparation', 'to do', 'considering', 'planning to apply'].includes(s)) return 'slate';
  return 'slate';
}
function priorityTone(p) {
  return ({ Critical: 'red', High: 'amber', Medium: 'blue', Low: 'slate' })[p] || 'slate';
}

/* Where a status sits in the "how much action is left" order, used to rank
   the opportunities list (lower = higher up):
     1 in-progress / pre-submission (New, Researching, Preparing, Documents Ready…)
     2 submitted / awaiting a result (Applied, Waitlisted, Shortlisted, Interview)
     3 closed-positive (Won, Accepted, Completed)
     4 closed-negative (Rejected, Lost, Irrelevant, Withdrawn)
     5 missed deadline (always the very bottom)
   Known statuses map explicitly (so "Writing Completed" stays tier 1, not
   mistaken for "Completed"); custom statuses fall back to keyword matching. */
const OPP_STATUS_TIER = {
  'new': 1, 'researching': 1, 'requirements collected': 1, 'preparing': 1,
  'documents ready': 1, 'writing completed': 1, 'planning to apply': 1,
  'considering': 1, 'need preparation': 1,
  'applied': 2, 'submitted': 2, 'waitlisted': 2, 'shortlisted': 2, 'interview': 2,
  'accepted': 3, 'won': 3, 'completed': 3, 'offer received': 3,
  'rejected': 4, 'lost': 4, 'irrelevant': 4, 'withdrawn': 4, 'declined': 4,
};
function oppStatusRank(status) {
  const s = (status || '').toLowerCase().trim();
  if (/missed/.test(s)) return 5;
  if (s in OPP_STATUS_TIER) return OPP_STATUS_TIER[s];
  if (/reject|lost|irrelevant|withdraw|declin|abandon/.test(s)) return 4;
  if (/won|accept|complete|offer|admitted|enrol/.test(s)) return 3;
  if (/appl|submit|waitlist|shortlist|interview|review|defer/.test(s)) return 2;
  return 1;
}

/* badge + priority pill builders */
function statusChip(status) {
  const tone = statusTone(status);
  return `<span class="chip t-${tone}"><span class="dot"></span>${escapeHtml(status)}</span>`;
}
function prioChip(p) {
  if (!p) return '';
  return `<span class="prio t-${priorityTone(p)}">${escapeHtml(p)}</span>`;
}

/* type icon lookup (for opportunity rows / detail headers) */
function typeIcon(type) {
  const map = {
    Scholarship: 'mortarboard-fill', Competition: 'trophy-fill', 'Leadership Program': 'people-fill',
    'Exchange Program': 'globe-americas', Fellowship: 'award-fill', Conference: 'mic-fill',
    Internship: 'briefcase-fill', Training: 'easel-fill', Volunteer: 'heart-fill', Hackathon: 'code-slash'
  };
  return map[type] || 'stars';
}

/* Build the list of social / contact links the owner has filled in.
   Only links that actually have a value are returned, so the UI never
   shows an empty icon. WhatsApp is turned into a wa.me deep-link. */
function socialLinks(p) {
  p = p || {};
  const out = [];
  if (p.linkedin) out.push({ ico: 'linkedin', label: 'LinkedIn', href: p.linkedin });
  if (p.facebook) out.push({ ico: 'facebook', label: 'Facebook', href: p.facebook });
  if (p.whatsapp) out.push({ ico: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/' + p.whatsapp.replace(/[^\d]/g, '') });
  if (p.github)   out.push({ ico: 'github', label: 'GitHub', href: p.github });
  if (p.website)  out.push({ ico: 'globe', label: 'Website', href: p.website });
  if (p.email)    out.push({ ico: 'envelope-fill', label: 'Email', href: 'mailto:' + p.email });
  return out;
}

/* ==========================================================
   2b. SHARED FOOTER — ownership / copyright notice on every page.
   Injected once. Lands inside .main on app-shell pages so it sits
   below the content column; on the portfolio / landing it appends
   to <body>. The copyright owner is the profile name.
   ========================================================== */
function renderFooter() {
  if (document.getElementById('siteFooter')) return;
  const p = (DB.data && DB.data.profile) || {};
  const owner = escapeHtml(p.name || 'Md Imran Hossain');
  const year = new Date().getFullYear();
  const social = socialLinks(p)
    .map(l => `<a href="${escapeHtml(l.href)}" target="_blank" rel="noopener" title="${l.label}" aria-label="${l.label}"><i class="bi bi-${l.ico}"></i></a>`)
    .join('');

  const foot = document.createElement('footer');
  foot.id = 'siteFooter';
  foot.className = 'site-footer';
  foot.innerHTML = `
    <div class="sf-inner">
      <div class="sf-brand">
        <span class="sf-logo">O</span>
        <div><b>OppTrack</b><small>Digital CV &amp; Opportunity Management System</small></div>
      </div>
      <div class="sf-legal">
        <p class="sf-copy">© ${year} ${owner}. All rights reserved.</p>
        <p class="sf-note">
          <i class="bi bi-c-circle me-1"></i>Designed &amp; developed by ${owner}.
          This project and all of its content are proprietary — no part may be copied,
          reproduced, redistributed or reused in any form without the author's explicit
          written permission.
        </p>
      </div>
      ${social ? `<div class="sf-social">${social}</div>` : ''}
    </div>`;

  (document.querySelector('.main') || document.body).appendChild(foot);
}

/* ==========================================================
   3. SHARED CHROME — sidebar + topbar injected on every page
   ========================================================== */
const NAV = [
  { group: 'Overview', items: [
    { page: 'dashboard', href: 'dashboard.html', icon: 'grid-1x2-fill', label: 'Dashboard' },
    { page: 'accounts',  href: 'accounts.html',  icon: 'wallet-fill', label: 'Accounts', ownerOnly: true }
  ]},
  { group: 'Manage', items: [
    { page: 'opportunities', href: 'opportunities.html', icon: 'compass-fill', label: 'Opportunities', countOf: 'opportunities' },
    { page: 'tasks',         href: 'tasks.html',         icon: 'kanban-fill',  label: 'Task Board',  countOf: 'tasks' },
    { page: 'documents',     href: 'documents.html',     icon: 'folder-fill',  label: 'Documents',   countOf: 'documents' },
    { page: 'achievements',  href: 'achievements.html',  icon: 'trophy-fill',  label: 'Achievements',countOf: 'achievements' },
    { page: 'education',     href: 'education.html',     icon: 'mortarboard-fill',label: 'Education', countOf: 'education' },
    { page: 'training',      href: 'training.html',      icon: 'patch-check-fill',label: 'Training & Certification', countOf: 'training' },
    { page: 'projects',      href: 'projects.html',      icon: 'diagram-3-fill',label: 'Projects',    countOf: 'projects' },
    { page: 'research',      href: 'research.html',      icon: 'lightbulb-fill',label: 'Research Hub', countOf: 'research' },
    { page: 'volunteering',  href: 'volunteering.html',  icon: 'heart-fill',    label: 'Social Activities', countOf: 'volunteering' },
    { page: 'contacts',      href: 'contacts.html',      icon: 'person-rolodex',label: 'Contacts',    countOf: 'contacts' }
  ]},
  { group: 'System', items: [
    /* ownerOnly items are hidden from public visitors (see renderChrome).
       Their pages are also redirect-protected via Security.PROTECTED_PAGES. */
    { page: 'owner',      href: 'owner.html',      icon: 'shield-lock-fill', label: 'Owner Dashboard', ownerOnly: true },
    { page: 'categories', href: 'categories.html', icon: 'sliders', label: 'Category Manager', ownerOnly: true },
    { page: 'profile',    href: 'profile.html',    icon: 'person-badge-fill', label: 'Portfolio & Profile' }
  ]}
];

function renderChrome(activePage, title, sub) {
  const p = DB.data.profile;

  /* ----- Sidebar ----- */
  const navHtml = NAV.map(sec => `
    <div class="nav-section">
      <div class="label">${sec.group}</div>
      <ul class="side-nav">
        ${sec.items.map(it => `
          <li class="${it.ownerOnly ? 'owner-only' : ''}"><a href="${it.href}" class="${it.page === activePage ? 'active' : ''}">
            <i class="bi bi-${it.icon}"></i><span>${it.label}</span>
            ${it.countOf ? `<span class="count">${DB.getAll(it.countOf).length}</span>` : ''}
          </a></li>`).join('')}
      </ul>
    </div>`).join('');

  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="brand">
        <div class="logo">O</div>
        <div><b>OppTrack</b><small>Life OS</small></div>
      </div>
      <div style="flex:1; overflow-y:auto;">${navHtml}</div>
      <div class="side-foot">
        <div class="side-user">
          <div class="av">${initials(p.name)}</div>
          <div style="min-width:0">
            <b>${escapeHtml(p.name)}</b>
            <small>${escapeHtml(p.headline || 'Student')}</small>
          </div>
        </div>
      </div>`;
  }

  /* ----- Topbar ----- */
  const topbar = document.getElementById('topbar');
  if (topbar) {
    topbar.innerHTML = `
      <button class="btn btn-ghost btn-icon menu-btn" id="menuBtn" aria-label="Open menu"><i class="bi bi-list"></i></button>
      <div>
        <h1 class="page-title">${escapeHtml(title)}</h1>
        ${sub ? `<p class="page-sub">${escapeHtml(sub)}</p>` : ''}
      </div>
      <div class="search-box" role="search">
        <i class="bi bi-search"></i>
        <input type="text" id="globalSearch" placeholder="Search opportunities, tasks, contacts…" autocomplete="off">
      </div>
      <div class="topbar-actions">
        <!-- Work Sheet (professional to-do). Owner-only: hidden from visitors by
             CSS, and work.html itself redirects non-owners (PROTECTED_PAGES). -->
        <a class="btn btn-ghost btn-icon owner-only" href="work.html" aria-label="Work sheet" title="Work sheet — professional to-do">
          <i class="bi bi-briefcase-fill"></i>
        </a>
        <!-- Auth control (owner badge + logout, or "Owner login") rendered by Security.renderAuthControl -->
        <div id="authSlot" class="auth-slot d-flex align-items-center gap-2"></div>
        <!-- Backup menu is a management action → owner-only -->
        <div class="dropdown owner-only">
          <button class="btn btn-ghost btn-icon" data-bs-toggle="dropdown" aria-label="Backup &amp; data" title="Backup &amp; data">
            <i class="bi bi-cloud-arrow-down"></i>
          </button>
          <ul class="dropdown-menu dropdown-menu-end shadow">
            <li><h6 class="dropdown-header">Backup &amp; data</h6></li>
            <li><a class="dropdown-item" href="#" id="exportBtn"><i class="bi bi-download me-2"></i>Export full backup (JSON)</a></li>
            <li><a class="dropdown-item" href="#" id="importBtn"><i class="bi bi-upload me-2"></i>Import backup</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-danger" href="#" id="resetBtn"><i class="bi bi-arrow-counterclockwise me-2"></i>Reset to sample data</a></li>
          </ul>
        </div>
        <!-- No global "Add new" here on purpose: every module page carries its
             own Add button (and the dashboard has Quick actions), so a shared
             one in the top bar was just duplicate chrome on every screen. -->
      </div>
      <input type="file" id="importFile" accept="application/json" hidden>`;
    wireChrome();
  }
}

/* wire up the topbar buttons + mobile menu (called once after render) */
function wireChrome() {
  // mobile sidebar toggle
  const menuBtn = document.getElementById('menuBtn');
  const sidebar = document.getElementById('sidebar');
  let scrim = document.querySelector('.scrim');
  if (!scrim) { scrim = document.createElement('div'); scrim.className = 'scrim'; document.body.appendChild(scrim); }
  const closeSide = () => { sidebar.classList.remove('open'); scrim.classList.remove('show'); };
  if (menuBtn) menuBtn.onclick = () => { sidebar.classList.add('open'); scrim.classList.add('show'); };
  scrim.onclick = closeSide;

  // backup / data menu
  document.getElementById('exportBtn').onclick = (e) => { e.preventDefault(); DB.exportJSON(); };
  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').onclick = (e) => { e.preventDefault(); importFile.click(); };
  importFile.onchange = () => { if (importFile.files[0]) DB.importJSON(importFile.files[0]); };
  document.getElementById('resetBtn').onclick = (e) => {
    e.preventDefault();
    if (confirm('Reset everything to the sample data? Your current records will be lost unless you exported a backup.')) {
      DB.resetAll(); location.reload();
    }
  };

  /* No [data-add] wiring here — the top bar no longer carries an "Add new"
     dropdown. The pages that DO use data-add (dashboard Quick actions, Owner
     Dashboard quick-add) wire their own buttons in their initializer, with the
     right after-save callback. */

  // global search → jump to the right list page with a query
  const gs = document.getElementById('globalSearch');
  if (gs) gs.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && gs.value.trim()) {
      location.href = `opportunities.html?q=${encodeURIComponent(gs.value.trim())}`;
    }
  });
}

/* ==========================================================
   4. SCHEMAS — field definitions that drive the shared modal.
   Add/rename a field here and every Add/Edit form updates.
   type: text | textarea | date | select | url | tel | email | number
   opts: a category key (string) OR an array of fixed options
   ========================================================== */
const SCHEMAS = {
  opportunities: {
    label: 'Opportunity', icon: 'compass-fill',
    fields: [
      { key: 'name', label: 'Opportunity name', type: 'text', required: true, span: true },
      { key: 'organizer', label: 'Organizer', type: 'text' },
      { key: 'type', label: 'Type', type: 'select', opts: 'opportunityTypes' },
      { key: 'subType', label: 'Sub-type', type: 'select', opts: 'subTypes' },
      { key: 'country', label: 'Country', type: 'select', opts: 'countries' },
      { key: 'mode', label: 'Mode', type: 'select', opts: 'modes' },
      { key: 'fundingType', label: 'Funding', type: 'select', opts: 'fundingTypes' },
      { key: 'priority', label: 'Priority', type: 'select', opts: 'priorities' },
      { key: 'status', label: 'Status', type: 'select', opts: 'statuses' },
      { key: 'link', label: 'Official link', type: 'url' },
      { key: 'openDate', label: 'Open date', type: 'date' },
      { key: 'deadline', label: 'Deadline', type: 'date' },
      { key: 'eventDate', label: 'Event date', type: 'date' },
      { key: 'nextAction', label: 'Next step', type: 'text', span: true, hint: 'The one thing to do next — EON nudges this' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true },
      { key: 'image', label: 'Cover image URL', type: 'url', span: true },
      { key: 'gallery', label: 'Image URLs', type: 'images', span: true },
      { key: 'photos', label: 'Upload images', type: 'photos', span: true },
      { key: 'files', label: 'Upload files (PDF, slides, data…)', type: 'files', span: true },
      { key: 'featured', label: 'Portfolio', type: 'checkbox', span: true, hint: 'Show this on the public portfolio (under Wins)' }
    ]
  },
  tasks: {
    label: 'Task', icon: 'check2-square',
    fields: [
      { key: 'title', label: 'Task title', type: 'text', required: true, span: true },
      { key: 'status', label: 'Status', type: 'select', opts: 'taskStatuses' },
      { key: 'priority', label: 'Priority', type: 'select', opts: 'priorities' },
      { key: 'category', label: 'Category', type: 'select', opts: 'taskCategories' },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { key: 'owedTo', label: 'Promised to', type: 'text', hint: 'A person you committed this to — EON tracks it separately' },
      { key: 'linkedOpportunity', label: 'Linked opportunity', type: 'select', opts: '@opportunities' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true }
    ]
  },
  documents: {
    label: 'Document', icon: 'folder',
    fields: [
      { key: 'name', label: 'Document name', type: 'text', required: true, span: true },
      { key: 'category', label: 'Category', type: 'select', opts: 'documentCategories' },
      { key: 'status', label: 'Status', type: 'select', opts: 'documentStatuses' },
      { key: 'file', label: 'Upload file (PDF, DOCX, image…)', type: 'file', span: true },
      { key: 'updatedDate', label: 'Last updated', type: 'date' },
      { key: 'expiryDate', label: 'Expiry date', type: 'date' },
      { key: 'driveLink', label: 'Google Drive link', type: 'url', span: true },
      { key: 'downloadLink', label: 'Download link', type: 'url', span: true }
    ]
  },
  achievements: {
    label: 'Achievement', icon: 'trophy',
    fields: [
      { key: 'title', label: 'Title / award name', type: 'text', required: true, span: true },
      { key: 'position', label: 'Position / placement', type: 'text', hint: 'e.g. Champion, Runner-up, 1st' },
      { key: 'competition', label: 'Competition / programme', type: 'text' },
      { key: 'issuer', label: 'Issuer / organization', type: 'text', span: true },
      { key: 'category', label: 'Category', type: 'select', opts: 'achievementCategories' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'image', label: 'Cover image URL', type: 'url' },
      { key: 'certLink', label: 'Certificate link', type: 'url' },
      { key: 'description', label: 'Description', type: 'textarea', span: true },
      { key: 'gallery', label: 'Image URLs', type: 'images', span: true },
      { key: 'photos', label: 'Upload images', type: 'photos', span: true },
      { key: 'files', label: 'Upload files / certificate', type: 'files', span: true },
      { key: 'featured', label: 'Portfolio', type: 'checkbox', span: true, hint: 'Show this on the public portfolio' }
    ]
  },
  contacts: {
    label: 'Contact', icon: 'person-plus',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', required: true },
      { key: 'type', label: 'Type', type: 'select', opts: 'contactTypes' },
      { key: 'organization', label: 'Organization', type: 'text' },
      { key: 'designation', label: 'Designation', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'linkedin', label: 'LinkedIn', type: 'url', span: true },
      { key: 'notes', label: 'Notes', type: 'textarea', span: true }
    ]
  },
  research: {
    label: 'Research idea', icon: 'lightbulb',
    fields: [
      { key: 'title', label: 'Idea / title', type: 'text', required: true, span: true },
      { key: 'subtitle', label: 'Subtitle / tagline', type: 'text', span: true },
      { key: 'field', label: 'Field of study', type: 'select', opts: 'subTypes' },
      { key: 'topic', label: 'Specific topic', type: 'text', hint: 'The precise question you are exploring' },
      { key: 'researchType', label: 'Research type', type: 'select', opts: ['Empirical', 'Theoretical', 'Applied', 'Experimental', 'Qualitative', 'Quantitative', 'Mixed-methods', 'Review / Survey', 'Case Study'] },
      { key: 'stage', label: 'Stage', type: 'select', opts: ['Idea', 'Literature Review', 'Problem Defined', 'In Progress', 'Data Collection', 'Analysis', 'Drafting', 'Under Review', 'Published'] },
      { key: 'aspects', label: 'Key aspects / angles', type: 'tags', span: true, hint: 'The dimensions you are examining — comma separated' },
      { key: 'technologies', label: 'Tools & technologies', type: 'tags', hint: 'Python, R, SPSS, TensorFlow…' },
      { key: 'methods', label: 'Methods / techniques', type: 'tags', hint: 'Survey, regression, NLP, interviews…' },
      { key: 'skills', label: 'Skills applied', type: 'tags', span: true, hint: 'Added to your portfolio skills automatically' },
      { key: 'keywords', label: 'Keywords', type: 'tags', span: true, hint: 'Searchable terms for this work' },
      { key: 'collaborators', label: 'Collaborators / supervisor', type: 'text', span: true },
      { key: 'abstract', label: 'Abstract', type: 'textarea', span: true },
      { key: 'problem', label: 'Problem statement', type: 'textarea', span: true },
      { key: 'hypothesis', label: 'Hypothesis / research question', type: 'textarea', span: true },
      { key: 'outcome', label: 'Expected outcome / impact', type: 'textarea', span: true },
      { key: 'references', label: 'References / links', type: 'textarea', span: true },
      { key: 'link', label: 'Paper / publication link', type: 'url', span: true },
      { key: 'image', label: 'Cover image URL', type: 'url', span: true },
      { key: 'gallery', label: 'Image URLs', type: 'images', span: true },
      { key: 'photos', label: 'Upload images / charts', type: 'photos', span: true },
      { key: 'files', label: 'Upload files (PDF, data, slides…)', type: 'files', span: true },
      { key: 'featured', label: 'Portfolio', type: 'checkbox', span: true, hint: 'Show this on the public portfolio' }
    ]
  },
  projects: {
    label: 'Project', icon: 'diagram-3',
    fields: [
      { key: 'name', label: 'Project name', type: 'text', required: true, span: true },
      { key: 'subtitle', label: 'Subtitle / tagline', type: 'text', span: true },
      { key: 'category', label: 'Category', type: 'select', opts: 'subTypes' },
      { key: 'status', label: 'Status', type: 'select', opts: 'projectStatuses' },
      { key: 'technologies', label: 'Technologies', type: 'text' },
      { key: 'team', label: 'Team members', type: 'text' },
      { key: 'link', label: 'Repo / demo link', type: 'url', span: true },
      { key: 'abstract', label: 'Abstract / summary', type: 'textarea', span: true },
      { key: 'description', label: 'Description', type: 'textarea', span: true },
      { key: 'image', label: 'Cover image URL', type: 'url', span: true },
      { key: 'gallery', label: 'Image URLs', type: 'images', span: true },
      { key: 'photos', label: 'Upload images', type: 'photos', span: true },
      { key: 'files', label: 'Upload files (PDF, slides, data…)', type: 'files', span: true },
      { key: 'featured', label: 'Portfolio', type: 'checkbox', span: true, hint: 'Show this on the public portfolio' }
    ]
  },
  training: {
    label: 'Training / certification', icon: 'mortarboard',
    fields: [
      { key: 'name', label: 'Training / certificate name', type: 'text', required: true, span: true },
      { key: 'issuer', label: 'Issuer / institute', type: 'text' },
      { key: 'type', label: 'Type', type: 'select', opts: ['Course', 'Certification', 'Workshop', 'Bootcamp', 'Training', 'Diploma', 'Nanodegree'] },
      { key: 'date', label: 'Date completed', type: 'date' },
      { key: 'length', label: 'Length / duration', type: 'text', hint: 'e.g. 8 weeks, 40 hours' },
      { key: 'skills', label: 'Skills / topics gained', type: 'tags', span: true, hint: 'Added to your portfolio skills automatically' },
      { key: 'certLink', label: 'Certificate link', type: 'url' },
      { key: 'credentialId', label: 'Credential ID', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea', span: true },
      { key: 'gallery', label: 'Image URLs', type: 'images', span: true },
      { key: 'photos', label: 'Upload images', type: 'photos', span: true },
      { key: 'files', label: 'Upload files / certificate', type: 'files', span: true },
      { key: 'featured', label: 'Portfolio', type: 'checkbox', span: true, hint: 'Show this on the public portfolio' }
    ]
  },
  reminders: {
    label: 'Reminder', icon: 'alarm',
    fields: [
      { key: 'title', label: 'Remind me to…', type: 'text', required: true, span: true },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'time', label: 'Time', type: 'time' },
      { key: 'status', label: 'Status', type: 'select', opts: ['active', 'done'] },
      { key: 'note', label: 'Note', type: 'textarea', span: true },
      { key: 'link', label: 'Link (optional)', type: 'url', span: true }
    ]
  },
  volunteering: {
    label: 'Social activity', icon: 'heart',
    fields: [
      { key: 'title', label: 'Activity / title', type: 'text', required: true, span: true },
      { key: 'role', label: 'My role', type: 'text', required: true, hint: 'e.g. Volunteer Lead, Coordinator, Mentor' },
      { key: 'organization', label: 'Organization', type: 'text' },
      { key: 'orgLink', label: 'Organization link', type: 'url', hint: 'Website, page or profile of the org' },
      { key: 'cause', label: 'Cause / focus area', type: 'text' },
      { key: 'commitment', label: 'Commitment', type: 'select', opts: ['One-time', 'Weekly', 'Monthly', 'Seasonal', 'Ongoing', 'Project-based'] },
      { key: 'startDate', label: 'Start date', type: 'date' },
      { key: 'date', label: 'End date', type: 'date' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'hours', label: 'Hours contributed', type: 'text', hint: 'e.g. 40 hours' },
      { key: 'impact', label: 'Impact / outcome', type: 'text', span: true, hint: 'e.g. 200 students reached, $5k raised — shown as a highlight' },
      { key: 'skills', label: 'Skills used', type: 'tags', span: true, hint: 'Added to your portfolio skills automatically' },
      { key: 'links', label: 'Reference links', type: 'images', span: true, hint: 'Articles, certificates or proof — one URL per line' },
      { key: 'description', label: 'Details', type: 'textarea', span: true },
      { key: 'gallery', label: 'Image URLs', type: 'images', span: true },
      { key: 'photos', label: 'Upload images', type: 'photos', span: true },
      { key: 'files', label: 'Upload files', type: 'files', span: true },
      { key: 'featured', label: 'Portfolio', type: 'checkbox', span: true, hint: 'Show this on the public portfolio' }
    ]
  },
  education: {
    label: 'Education', icon: 'mortarboard',
    fields: [
      { key: 'institution', label: 'Institution / university', type: 'text', required: true, span: true },
      { key: 'level', label: 'Level', type: 'select', required: true, opts: ['High School', 'College', 'Diploma', 'Undergraduate', 'Postgraduate', 'Masters', 'MPhil', 'PhD', 'Postdoc', 'Certificate Program', 'Exchange'] },
      { key: 'program', label: 'Degree / program', type: 'text', span: true, hint: 'e.g. B.Sc. in Computer Science' },
      { key: 'fieldOfStudy', label: 'Field of study / major', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', opts: ['Planning to Apply', 'Applied', 'Under Review', 'Interviewing', 'Offer Received', 'Admitted', 'Waitlisted', 'Deferred', 'Rejected', 'Declined', 'Enrolled', 'Graduated'] },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'startDate', label: 'Start date', type: 'date' },
      { key: 'endDate', label: 'End / graduation date', type: 'date' },
      { key: 'appliedDate', label: 'Date applied', type: 'date' },
      { key: 'decisionDate', label: 'Decision date', type: 'date' },
      { key: 'result', label: 'Result / GPA / grade', type: 'text', hint: 'e.g. CGPA 3.92 / 4.00, A Level: AAB' },
      { key: 'scholarship', label: 'Scholarship / funding', type: 'text', hint: 'e.g. Full ride, 50% tuition waiver' },
      { key: 'highlights', label: 'Highlights / honors', type: 'tags', span: true, hint: "Dean's list, thesis topic, key courses…" },
      { key: 'description', label: 'Description / notes', type: 'textarea', span: true },
      { key: 'link', label: 'Program / portal link', type: 'url' },
      { key: 'offerLetter', label: 'Offer / admission letter', type: 'file', span: true, hint: 'Upload the PDF or image of your offer letter' },
      { key: 'gallery', label: 'Image URLs (campus, certificate…)', type: 'images', span: true },
      { key: 'photos', label: 'Upload images', type: 'photos', span: true },
      { key: 'files', label: 'Upload documents (transcript, certificate…)', type: 'files', span: true },
      { key: 'featured', label: 'Portfolio', type: 'checkbox', span: true, hint: 'Show this on the public portfolio' }
    ]
  }
};

/* ==========================================================
   5. ENTITY MODAL — one generic Add/Edit form for all modules
   Built from SCHEMAS so there is only one form to maintain.
   ========================================================== */
function buildField(f, value) {
  // Checkbox / toggle (e.g. "Show on portfolio") — laid out as one inline row.
  if (f.type === 'checkbox') {
    return `<div class="field ${f.span ? 'col-span' : ''}">
      <label class="switch-row">
        <input type="checkbox" name="${f.key}" ${value ? 'checked' : ''}>
        <span>${f.hint || f.label}</span>
      </label>
    </div>`;
  }

  // File upload — shows the currently stored file (if any) with a "remove"
  // option, plus a picker to replace it. Saved as a base64 data URL.
  if (f.type === 'file') {
    const cur = value && value.name
      ? `<div class="file-current">
           <i class="bi bi-paperclip"></i>
           <span class="fc-name">${escapeHtml(value.name)}</span>
           <small class="text-faint">${fmtBytes(value.size)}</small>
           <label class="fc-remove"><input type="checkbox" name="__remove_${f.key}"> remove</label>
         </div>`
      : '';
    return `<div class="field ${f.span ? 'col-span' : ''}">
      <label>${f.label}</label>
      ${cur}
      <input type="file" name="${f.key}" class="file-input">
      <small class="text-faint" style="font-size:11px">Stored privately in your browser. Max ${fmtBytes(MAX_UPLOAD_BYTES)} — use a Drive link for larger files.</small>
    </div>`;
  }

  // Multiple uploads — `photos` (images) or `files` (any). Shows current
  // items with a "remove" checkbox each, plus a multi-file picker to add more.
  if (f.type === 'photos' || f.type === 'files') {
    const isImg = f.type === 'photos';
    const arr = Array.isArray(value) ? value : [];
    const current = arr.map((it, i) => `
      <div class="upl-item">
        ${isImg ? `<span class="upl-thumb"><img src="${escapeHtml(it.data)}" alt=""></span>` : `<span class="upl-thumb file"><i class="bi bi-file-earmark-text"></i></span>`}
        <span class="upl-name">${escapeHtml(it.name || 'file')}</span>
        <small class="text-faint">${fmtBytes(it.size)}</small>
        <label class="upl-rm"><input type="checkbox" name="__rm_${f.key}_${i}"> remove</label>
      </div>`).join('');
    return `<div class="field ${f.span ? 'col-span' : ''}">
      <label>${f.label}</label>
      <div class="upl-list ${isImg ? 'is-img' : ''}">${current || '<span class="text-faint" style="font-size:12px">None yet.</span>'}</div>
      <input type="file" name="${f.key}" class="file-input" ${isImg ? 'accept="image/*"' : ''} multiple>
      <small class="text-faint" style="font-size:11px">Select one or more. Max ${fmtBytes(MAX_UPLOAD_BYTES)} each — stored in your browser.</small>
    </div>`;
  }
  const v = value == null ? '' : value;
  let input;
  if (f.type === 'tags') {
    // comma/newline separated list stored as an array (skills, topics, causes…)
    const txt = Array.isArray(value) ? value.join(', ') : v;
    input = `<input type="text" name="${f.key}" value="${escapeHtml(txt)}" placeholder="${f.label} — comma separated">`;
  } else if (f.type === 'images') {
    // gallery of image URLs, edited one-per-line
    const txt = Array.isArray(value) ? value.join('\n') : v;
    input = `<textarea name="${f.key}" class="img-list" rows="3" placeholder="Paste image URLs — one per line">${escapeHtml(txt)}</textarea>`;
  } else if (f.type === 'textarea') {
    // textareas get a small formatting toolbar (writes a safe Markdown subset)
    input = `<div class="rt-wrap">
      <div class="rt-toolbar" role="toolbar" aria-label="Format">
        <button type="button" class="rt-b" data-rt="bold" title="Bold"><i class="bi bi-type-bold"></i></button>
        <button type="button" class="rt-b" data-rt="italic" title="Italic"><i class="bi bi-type-italic"></i></button>
        <button type="button" class="rt-b" data-rt="underline" title="Underline"><i class="bi bi-type-underline"></i></button>
        <button type="button" class="rt-b" data-rt="list" title="Bullet list"><i class="bi bi-list-ul"></i></button>
        <span class="rt-sep"></span>
        <button type="button" class="rt-b rt-fix" data-rt="fix" title="Fix spelling &amp; grammar (EON)"><i class="bi bi-magic"></i><span>Fix</span></button>
      </div>
      <textarea name="${f.key}" placeholder="${f.label}">${escapeHtml(v)}</textarea>
    </div>`;
  } else if (f.type === 'select') {
    let opts;
    if (typeof f.opts === 'string' && f.opts.startsWith('@')) {
      // dynamic option list pulled from another entity (e.g. opportunities)
      const ent = f.opts.slice(1);
      opts = DB.getAll(ent).map(r => r.name || r.title);
    } else {
      opts = Array.isArray(f.opts) ? f.opts : CATS(f.opts);
    }
    input = `<select name="${f.key}">
      <option value="">— Select —</option>
      ${opts.map(o => `<option ${o === v ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
    </select>`;
  } else {
    input = `<input type="${f.type}" name="${f.key}" value="${escapeHtml(v)}" placeholder="${f.label}">`;
  }
  return `<div class="field ${f.span ? 'col-span' : ''}">
    <label>${f.label}${f.required ? ' <span class="req">*</span>' : ''}${f.type === 'images' ? ' <small class="text-faint">(one URL per line)</small>' : ''}</label>
    ${input}
  </div>`;
}

/* open the modal. entity = key in SCHEMAS, id = existing record id (optional) */
function openEntityModal(entity, id, afterSave, prefill) {
  // Authorization gate: visitors cannot open the add/edit form.
  if (!Security.guard(id ? 'edit this item' : 'add new items')) return;
  const schema = SCHEMAS[entity];
  if (!schema) return;
  const record = id ? DB.get(entity, id) : (prefill || {});
  const isEdit = !!id;

  // remove a previous instance if any
  document.getElementById('entityModal')?.remove();

  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="entityModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <div class="d-flex align-items-center gap-2">
            <span class="stat-ico"><i class="bi bi-${schema.icon}"></i></span>
            <h5 class="modal-title">${isEdit ? 'Edit' : 'Add'} ${schema.label.toLowerCase()}</h5>
          </div>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <form id="entityForm" class="form-grid">
            ${schema.fields.map(f => buildField(f, record[f.key])).join('')}
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="entitySave">
            <i class="bi bi-check-lg me-1"></i>${isEdit ? 'Save changes' : 'Add ' + schema.label.toLowerCase()}
          </button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);

  const modalEl = document.getElementById('entityModal');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());

  // rich-text toolbar buttons (bold / italic / underline / list)
  const formEl = document.getElementById('entityForm');
  formEl.addEventListener('click', (e) => {
    const b = e.target.closest('.rt-b'); if (!b) return;
    e.preventDefault();
    const ta = b.closest('.rt-wrap')?.querySelector('textarea');
    if (!ta) return;
    if (b.dataset.rt === 'fix') fixField(ta);     // EON proofread
    else rtApply(ta, b.dataset.rt);
  });
  // EON live spell-watch: as you type, he spots a misspelling and says
  // "It's not X, it's Y" (debounced so he reacts once you pause, not mid-word).
  formEl.querySelectorAll('input[type="text"], textarea').forEach(el => {
    let t;
    el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => eonNotice(el), 1000); });
    el.addEventListener('blur', () => eonNotice(el));
  });

  document.getElementById('entitySave').onclick = async () => {
    const form = document.getElementById('entityForm');
    const saveBtn = document.getElementById('entitySave');
    const out = id ? { id } : {};
    schema.fields.forEach(f => {
      // namedItem() — NOT form.elements[f.key] — because a field keyed like a
      // reserved collection property ("length", "item", "namedItem") would
      // otherwise return that property (e.g. the element COUNT) instead of the
      // control, and crash on .value.trim(). namedItem always resolves by name.
      const el = form.elements.namedItem(f.key);
      if (!el || f.type === 'file') return; // file fields handled asynchronously below
      if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'images' || f.type === 'tags') out[f.key] = el.value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      else out[f.key] = el.value.trim();
    });

    // validate required (text) fields
    const missing = schema.fields.find(f => f.required && f.type !== 'file' && !out[f.key]);
    if (missing) { toast(`${missing.label} is required.`, 'err'); form.elements.namedItem(missing.key)?.focus(); return; }

    // Uploads (async): read newly picked file(s), honour "remove", else
    // preserve. Keys left off `out` are kept by DB.upsert's merge.
    try {
      saveBtn.disabled = true;

      // single-file fields (e.g. a document)
      for (const f of schema.fields.filter(x => x.type === 'file')) {
        const input = form.querySelector(`input[type="file"][name="${f.key}"]`);
        const file = input && input.files && input.files[0];
        const removeEl = form.elements.namedItem('__remove_' + f.key);
        const remove = removeEl && removeEl.checked;
        if (file) {
          if (file.size > MAX_UPLOAD_BYTES) {
            toast(`“${file.name}” is too large (max ${fmtBytes(MAX_UPLOAD_BYTES)}). Use a Drive link instead.`, 'err');
            saveBtn.disabled = false; return;
          }
          out[f.key] = { name: file.name, type: file.type, size: file.size, data: await readFileAsDataURL(file) };
        } else if (remove) {
          out[f.key] = null;
        }
      }

      // multi-upload fields (photos / files): keep the un-removed existing
      // items, then append any newly selected ones.
      for (const f of schema.fields.filter(x => x.type === 'photos' || x.type === 'files')) {
        const existing = Array.isArray(record[f.key]) ? record[f.key] : [];
        const kept = existing.filter((_, i) => {
          const cb = form.elements.namedItem('__rm_' + f.key + '_' + i);
          return !(cb && cb.checked);
        });
        const input = form.querySelector(`input[type="file"][name="${f.key}"]`);
        const added = [];
        if (input && input.files) {
          for (const file of Array.from(input.files)) {
            if (file.size > MAX_UPLOAD_BYTES) {
              toast(`“${file.name}” is too large (max ${fmtBytes(MAX_UPLOAD_BYTES)}). Skipped.`, 'err');
              continue;
            }
            added.push({ name: file.name, type: file.type, size: file.size, data: await readFileAsDataURL(file) });
          }
        }
        out[f.key] = kept.concat(added);
      }
    } catch (e) {
      saveBtn.disabled = false;
      toast('Could not read the selected file.', 'err');
      return;
    }

    const saved = DB.upsert(entity, out);
    saveBtn.disabled = false;
    if (!saved) return; // guard rejected (not the owner)
    toast(`${schema.label} ${isEdit ? 'updated' : 'added'}.`, 'ok');
    modal.hide();
    if (afterSave) afterSave();
    else refreshCurrentPage();
  };
}

/* confirm + delete helper — looks the record name up internally so we
   never have to inject user text into inline onclick strings. */
function confirmDelete(entity, id, after) {
  if (!Security.guard('delete this item')) return;
  const rec = DB.get(entity, id) || {};
  const name = rec.name || rec.title || 'this item';
  if (confirm(`Delete "${name}"? This cannot be undone.`)) {
    DB.remove(entity, id);
    toast('Deleted.', 'ok');
    (typeof after === 'function' ? after : refreshCurrentPage)();
  }
}

/* re-run the active page's init so lists update after a change */
function refreshCurrentPage() {
  const page = document.body.dataset.page;
  const fn = PAGE_INIT[page];
  if (fn) fn();
  // keep sidebar counts fresh
  renderChrome(page, document.querySelector('.page-title')?.textContent || '', document.querySelector('.page-sub')?.textContent || '');
  // re-apply owner/viewer gating to any freshly rendered controls
  Security.applyMode();
}

/* shared empty-state block.
   ownerOnly=true marks the action button so it is hidden from
   public visitors (used for "Add …" empty states). */
function emptyState(icon, title, text, btnLabel, onClick, ownerOnly = false) {
  const id = uid();
  setTimeout(() => { const b = document.getElementById(id); if (b && onClick) b.onclick = onClick; }, 0);
  return `<div class="empty">
    <div class="e-ico"><i class="bi bi-${icon}"></i></div>
    <b>${title}</b><p>${text}</p>
    ${btnLabel ? `<button class="btn btn-primary ${ownerOnly ? 'owner-only' : ''}" id="${id}"><i class="bi bi-plus-lg me-1"></i>${btnLabel}</button>` : ''}
  </div>`;
}

/* ==========================================================
   6. PAGE INITIALIZERS
   ========================================================== */

/* ---------- DASHBOARD ---------- */
function initDashboard() {
  const opps = DB.getAll('opportunities');
  const tasks = DB.getAll('tasks');
  const docs = DB.getAll('documents');
  const research = DB.getAll('research');
  const projects = DB.getAll('projects');
  const training = DB.getAll('training');

  const countStatus = (s) => opps.filter(o => o.status === s).length;
  const WON = ['Won', 'Accepted', 'Completed'];
  const LOST = ['Lost', 'Rejected'];
  const TERMINAL = [...WON, ...LOST, 'Irrelevant', 'Missed', 'Withdrawn'];
  const oppWon = opps.filter(o => WON.includes(o.status)).length;
  const oppLost = opps.filter(o => LOST.includes(o.status)).length;
  const oppApplied = opps.filter(o => ['Applied', 'Shortlisted'].includes(o.status)).length;
  const oppInProgress = opps.filter(o => !TERMINAL.includes(o.status) && !['Applied', 'Shortlisted'].includes(o.status)).length;
  // missed = deadline passed while never submitted (or explicitly marked missed)
  const oppMissed = opps.filter(o => o.status === 'Missed' || (() => { const d = daysUntil(o.deadline); return d !== null && d < 0 && !['Applied', 'Shortlisted', ...TERMINAL].includes(o.status); })()).length;

  const resDone = research.filter(r => r.stage === 'Published').length;
  const projDone = projects.filter(p => p.status === 'Completed').length;
  const trainDone = training.filter(t => !!t.date).length;

  // Grouped, labelled rows: Opportunities → Research → Projects → Training → Activity.
  const grp = (label) => ({ group: label });
  const cards = [
    grp('Opportunities'),
    { lbl: 'Total', val: opps.length, ico: 'compass-fill', t: 'primary' },
    { lbl: 'Applied', val: oppApplied, ico: 'send-fill', t: 'blue' },
    { lbl: 'Won', val: oppWon, ico: 'trophy-fill', t: 'green' },
    { lbl: 'Lost', val: oppLost, ico: 'x-circle-fill', t: 'red' },
    { lbl: 'In Progress', val: oppInProgress, ico: 'hourglass-split', t: 'amber' },
    { lbl: 'Missed', val: oppMissed, ico: 'slash-circle', t: 'slate' },
    grp('Research · Projects · Training'),
    { lbl: 'Research done', val: resDone, ico: 'lightbulb-fill', t: 'green' },
    { lbl: 'Research ongoing', val: research.length - resDone, ico: 'lightbulb', t: 'blue' },
    { lbl: 'Projects done', val: projDone, ico: 'diagram-3-fill', t: 'green' },
    { lbl: 'Projects ongoing', val: projects.length - projDone, ico: 'diagram-3', t: 'violet' },
    { lbl: 'Training done', val: trainDone, ico: 'mortarboard-fill', t: 'green' },
    { lbl: 'Training ongoing', val: training.length - trainDone, ico: 'mortarboard', t: 'accent' },
    grp('Activity'),
    { lbl: 'Documents Ready', val: docs.filter(d => d.status === 'Ready' || d.status === 'Updated').length, ico: 'folder-check', t: 'accent' },
    { lbl: 'Active Tasks', val: tasks.filter(t => !['Completed', 'Cancelled'].includes(t.status)).length, ico: 'list-task', t: 'amber' },
    { lbl: 'Completed Tasks', val: tasks.filter(t => t.status === 'Completed').length, ico: 'check2-circle', t: 'green' },
    { lbl: 'Upcoming Deadlines', val: opps.filter(o => { const d = daysUntil(o.deadline); return d !== null && d >= 0 && d <= 30; }).length, ico: 'alarm-fill', t: 'red' }
  ];
  document.getElementById('statGrid').innerHTML = cards.map(c => c.group
    ? `<div class="stat-group">${c.group}</div>`
    : `<div class="stat">
      <div class="ico t-${c.t}"><i class="bi bi-${c.ico}"></i></div>
      <div class="val">${c.val}</div>
      <div class="lbl">${c.lbl}</div>
    </div>`).join('');

  /* deadline alert widget — buckets by day threshold */
  const withDeadlines = opps
    .filter(o => { const d = daysUntil(o.deadline); return d !== null && d >= 0 && !['Won', 'Lost', 'Rejected', 'Accepted', 'Completed', 'Irrelevant'].includes(o.status); })
    .sort((a, b) => daysUntil(a.deadline) - daysUntil(b.deadline));
  const lvl = (d) => d <= 3 ? 3 : d <= 7 ? 7 : d <= 14 ? 14 : 30;
  const alertHtml = withDeadlines.filter(o => daysUntil(o.deadline) <= 30).slice(0, 6).map(o => {
    const d = daysUntil(o.deadline);
    return `<a class="alert-row lv-${lvl(d)}" href="opportunity-details.html?id=${o.id}">
      <div class="countdown">${d}d</div>
      <div class="ar-name"><b>${escapeHtml(o.name)}</b><small>${escapeHtml(o.type || '')} · ${fmtDate(o.deadline)}</small></div>
    </a>`;
  }).join('');
  document.getElementById('deadlineAlerts').innerHTML = alertHtml ||
    `<p class="text-soft mb-0" style="font-size:13px">No deadlines within 30 days. Nicely on top of things.</p>`;

  /* notifications panel — deadlines, overdue tasks, missing docs */
  const notes = [];
  withDeadlines.slice(0, 3).forEach(o => notes.push({ ico: 'alarm', t: 'amber', title: `${o.name}`, sub: `Deadline ${relDays(o.deadline)}` }));
  tasks.filter(t => { const d = daysUntil(t.dueDate); return d !== null && d < 0 && !['Completed', 'Cancelled'].includes(t.status); })
    .slice(0, 3).forEach(t => notes.push({ ico: 'exclamation-triangle', t: 'red', title: t.title, sub: `Task overdue ${relDays(t.dueDate)}` }));
  docs.filter(d => d.status === 'Need Preparation').slice(0, 2)
    .forEach(d => notes.push({ ico: 'folder-x', t: 'blue', title: d.name, sub: 'Document needs preparation' }));
  tasks.filter(t => t.status === 'Waiting').slice(0, 2)
    .forEach(t => notes.push({ ico: 'hourglass-split', t: 'slate', title: t.title, sub: 'Waiting / follow-up needed' }));

  document.getElementById('notifPanel').innerHTML = notes.length ? notes.map(n => `
    <div class="feed-item">
      <div class="fi-ico t-${n.t}"><i class="bi bi-${n.ico}"></i></div>
      <div class="fi-body"><b>${escapeHtml(n.title)}</b><span>${escapeHtml(n.sub)}</span></div>
    </div>`).join('') : `<div class="feed-item"><div class="fi-ico t-green"><i class="bi bi-check2-all"></i></div><div class="fi-body"><b>All clear</b><span>No pending alerts right now.</span></div></div>`;

  /* quick actions */
  const qa = [
    { add: 'opportunities', ico: 'compass', t: 'primary', label: 'Opportunity' },
    { add: 'tasks', ico: 'check2-square', t: 'amber', label: 'Task' },
    { add: 'documents', ico: 'folder', t: 'accent', label: 'Document' },
    { add: 'achievements', ico: 'trophy', t: 'green', label: 'Achievement' },
    { add: 'contacts', ico: 'person-plus', t: 'violet', label: 'Contact' },
    { add: 'research', ico: 'lightbulb', t: 'blue', label: 'Research idea' }
  ];
  const qaWrap = document.getElementById('quickActions');
  qaWrap.innerHTML = qa.map(q => `
    <button class="qa" data-add="${q.add}">
      <i class="t-${q.t} bi bi-${q.ico}"></i><b>${q.label}</b>
    </button>`).join('');
  qaWrap.querySelectorAll('[data-add]').forEach(b => b.onclick = () => openEntityModal(b.dataset.add));

  /* recent opportunities mini-table */
  const recent = [...opps].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 5);
  document.getElementById('recentOpps').innerHTML = recent.length ? recent.map(o => `
    <tr onclick="location.href='opportunity-details.html?id=${o.id}'" style="cursor:pointer">
      <td class="name-cell"><b>${escapeHtml(o.name)}</b><small>${escapeHtml(o.organizer || '')}</small></td>
      <td>${statusChip(o.status)}</td>
      <td class="date-cell">${o.deadline ? fmtDate(o.deadline) : '—'}</td>
    </tr>`).join('') : `<tr><td colspan="3" class="text-soft text-center py-4">No opportunities yet.</td></tr>`;

  /* signal radar + productivity layer (read-only derived intelligence) */
  try { computeSignals(); renderSignalPanel(); } catch {}
  try { computeProductivity(); renderRealisticDay(); renderTracksPanel(); renderPulsePanel(); } catch {}

  /* calendar widget + reminder list */
  renderCalendar();
  renderReminderList();
  const addRemBtn = document.getElementById('addReminderBtn');
  if (addRemBtn) addRemBtn.onclick = () => openReminderModal(null);
}

/* ---------- CALENDAR (dashboard widget) ---------- */
/* ==========================================================
   REMINDERS — one model shared by the calendar, the list panel
   and EON. A reminder fires at `date` + `time` (time defaults to
   09:00). The watcher (startReminderWatcher) speaks through EON,
   raises a toast and a desktop notification when one comes due.
   ========================================================== */

/* canonical fire time (ms) for a reminder — date + time (09:00 default) */
function reminderFireMs(r) {
  if (!r || !r.date) return NaN;
  const key = `${r.date}T${(r.time && /^\d{1,2}:\d{2}$/.test(r.time)) ? r.time : '09:00'}`;
  return Date.parse(key);
}
function reminderFireKey(r) { return `${r.date}T${r.time || '09:00'}`; }

/* Normalize an old/loose reminder shape into the unified model.
   Migrates the legacy {date, text} records in place. */
function normalizeReminders() {
  const list = DB.data.reminders || [];
  let changed = false;
  list.forEach(r => {
    if (r.text && !r.title) { r.title = r.text; delete r.text; changed = true; }
    if (!r.status) { r.status = 'active'; changed = true; }
    if (r.title == null) { r.title = '(reminder)'; changed = true; }
  });
  return changed;
}

/* Public reminder API — EON and the app both go through this so there is
   a single source of truth that shows on the calendar AND really fires. */
window.AppReminders = {
  list() { return (DB.data.reminders || []).slice().sort((a, b) => reminderFireMs(a) - reminderFireMs(b)); },
  create(data) {
    // Accept either {date,time} or a precise {remindAt} ISO (used by EON).
    const out = { id: uid(), status: 'active', source: data.source || 'me', createdAt: new Date().toISOString() };
    out.title = (data.title || data.text || 'Reminder').toString().trim();
    if (data.remindAt && !Number.isNaN(Date.parse(data.remindAt))) {
      const d = new Date(data.remindAt);
      out.date = d.toISOString().slice(0, 10);
      out.time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } else {
      out.date = data.date || new Date().toISOString().slice(0, 10);
      out.time = data.time || '';
    }
    out.note = data.note || '';
    out.link = data.link || '';
    (DB.data.reminders = DB.data.reminders || []).push(out);
    DB.save();
    ensureNotifyPermission();
    if (document.body.dataset.page === 'dashboard') { renderCalendar(); renderReminderList(); }
    return out;
  },
  update(id, patch) {
    const r = (DB.data.reminders || []).find(x => x.id === id); if (!r) return null;
    Object.assign(r, patch);
    if (patch.date || patch.time) r.firedKey = '';   // rescheduled → allow it to fire again
    DB.save();
    if (document.body.dataset.page === 'dashboard') { renderCalendar(); renderReminderList(); }
    return r;
  },
  remove(id) {
    DB.data.reminders = (DB.data.reminders || []).filter(x => x.id !== id);
    DB.save();
    if (document.body.dataset.page === 'dashboard') { renderCalendar(); renderReminderList(); }
  },
  toggle(id) {
    const r = (DB.data.reminders || []).find(x => x.id === id); if (!r) return;
    this.update(id, { status: r.status === 'done' ? 'active' : 'done' });
  }
};

/* Ask for desktop-notification permission once (owner only, on first use). */
function ensureNotifyPermission() {
  try {
    if (!('Notification' in window) || !Security.isOwner()) return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch {}
}

/* The watcher: fires due reminders through EON + toast + desktop notify.
   Runs only for the owner. A reminder fires once per (date+time) value, so
   editing the time lets it fire again. Very-old due reminders (>24h late,
   e.g. on first load) are shown in the list but not popped up. */
let _reminderWatch = null;
function startReminderWatcher() {
  if (_reminderWatch) return;
  const tick = () => {
    try {
      if (!Security.isOwner()) return;
      const now = Date.now();
      (DB.data.reminders || []).forEach(r => {
        if (r.status === 'done') return;
        const fireMs = reminderFireMs(r);
        if (Number.isNaN(fireMs) || fireMs > now) return;
        const key = reminderFireKey(r);
        if (r.firedKey === key) return;             // already announced this time
        if (now - fireMs > 24 * 3600 * 1000) { r.firedKey = key; return; }   // too old → don't pop
        r.firedKey = key; DB.save();
        fireReminder(r);
      });
    } catch {}
  };
  _reminderWatch = setInterval(tick, 15000);
  setTimeout(tick, 4000);   // an early check after load
}

/* Deliver one reminder: EON speaks it, a toast shows, and (if granted) a
   real desktop notification pops — so it reaches the owner even in another tab. */
function fireReminder(r) {
  const msg = r.title || 'Reminder';
  try { window.EON?.ai?.speak(`⏰ Reminder: ${msg}`, 8000); } catch {}
  try { window.EON?.character?.playEmote?.('point'); } catch {}
  toast(`⏰ Reminder: ${msg}`, 'ok');
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('EON reminder ⏰', { body: msg, tag: r.id });
      n.onclick = () => { try { window.focus(); } catch {}; if (r.link) location.href = r.link; };
    }
  } catch {}
}

let calRef = new Date();
function renderCalendar() {
  const host = document.getElementById('calendar');
  if (!host) return;
  const y = calRef.getFullYear(), m = calRef.getMonth();
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const monthName = calRef.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // per-date events: opportunity deadlines (one marker) + each reminder (its own dot).
  // Reminders are private — only the owner sees their dots.
  const isOwner = Security.isOwner();
  const deadlines = {}, reminders = {};
  DB.getAll('opportunities').forEach(o => { if (o.deadline) deadlines[o.deadline] = (deadlines[o.deadline] || 0) + 1; });
  if (isOwner) DB.getAll('reminders').forEach(r => { if (r.date) reminders[r.date] = (reminders[r.date] || 0) + 1; });

  const todayStr = new Date().toISOString().slice(0, 10);
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell muted"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = ds === todayStr;
    const nRem = reminders[ds] || 0, hasDl = !!deadlines[ds];
    // up to 3 reminder dots + a distinct deadline dot
    let dots = '';
    for (let k = 0; k < Math.min(nRem, 3); k++) dots += '<span class="ev-dot rem"></span>';
    if (hasDl) dots += '<span class="ev-dot dl"></span>';
    cells += `<div class="cal-cell ${isToday ? 'today' : ''} ${nRem || hasDl ? 'has-ev' : ''}" data-date="${ds}" title="${ds}${nRem ? ` · ${nRem} reminder${nRem > 1 ? 's' : ''}` : ''}">
      <span class="cd-n">${d}</span>${dots ? `<span class="cd-dots">${dots}</span>` : ''}
    </div>`;
  }

  host.innerHTML = `
    <div class="cal-head">
      <b>${monthName}</b>
      <div class="cal-nav">
        <button class="btn btn-ghost btn-sm" id="calPrev"><i class="bi bi-chevron-left"></i></button>
        <button class="btn btn-ghost btn-sm" id="calToday">Today</button>
        <button class="btn btn-ghost btn-sm" id="calNext"><i class="bi bi-chevron-right"></i></button>
      </div>
    </div>
    <div class="cal-grid">
      ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>`;

  document.getElementById('calPrev').onclick = () => { calRef.setMonth(m - 1); renderCalendar(); };
  document.getElementById('calNext').onclick = () => { calRef.setMonth(m + 1); renderCalendar(); };
  document.getElementById('calToday').onclick = () => { calRef = new Date(); renderCalendar(); };
  host.querySelectorAll('.cal-cell[data-date]').forEach(c => c.onclick = () => openDayReminders(c.dataset.date));
}

/* Reminder list panel beside the calendar — full CRUD + status toggle. */
function renderReminderList() {
  const host = document.getElementById('reminderList');
  if (!host) return;
  if (!Security.isOwner()) { host.innerHTML = ''; return; }   // reminders are private
  const now = Date.now();
  const items = (DB.data.reminders || []).slice().sort((a, b) => (reminderFireMs(a) || 0) - (reminderFireMs(b) || 0));
  if (!items.length) {
    host.innerHTML = `<p class="text-soft mb-0" style="font-size:13px">No reminders yet. Click a date or “Add”, or just ask EON: “remind me in 5 minutes to…”.</p>`;
    return;
  }
  host.innerHTML = items.map(r => {
    const fire = reminderFireMs(r);
    const overdue = r.status !== 'done' && fire && fire < now;
    const when = r.date ? `${fmtDate(r.date)}${r.time ? ' · ' + r.time : ''}` : 'No date';
    return `<div class="rem-row ${r.status === 'done' ? 'done' : ''}">
      <button class="rem-check ${r.status === 'done' ? 'on' : ''}" title="Toggle done" onclick="AppReminders.toggle('${r.id}')"><i class="bi bi-${r.status === 'done' ? 'check-circle-fill' : 'circle'}"></i></button>
      <div class="rem-body">
        <b>${escapeHtml(r.title || 'Reminder')}</b>
        <small class="num ${overdue ? 'text-danger' : 'text-faint'}"><i class="bi bi-clock me-1"></i>${when}${overdue ? ' · overdue' : ''}${r.source === 'eon' ? ' · set by EON' : ''}</small>
      </div>
      <div class="rem-tools owner-only">
        <button title="Edit" onclick="openReminderModal('${r.id}')"><i class="bi bi-pencil"></i></button>
        <button class="del" title="Delete" onclick="AppReminders.remove('${r.id}')"><i class="bi bi-trash3"></i></button>
      </div>
    </div>`;
  }).join('');
  Security.applyMode();
}

/* Open the add/edit reminder modal (reuses the generic entity modal). */
function openReminderModal(id, date) {
  const after = () => { renderCalendar(); renderReminderList(); ensureNotifyPermission(); };
  if (id) { openEntityModal('reminders', id, after); return; }
  openEntityModal('reminders', null, after, { date: date || new Date().toISOString().slice(0, 10), status: 'active' });
}

/* Day popover: list every reminder on a date + add a new one for that day. */
function openDayReminders(date) {
  const items = (Security.isOwner() ? (DB.data.reminders || []) : []).filter(r => r.date === date)
    .sort((a, b) => (reminderFireMs(a) || 0) - (reminderFireMs(b) || 0));
  const dls = DB.getAll('opportunities').filter(o => o.deadline === date);
  document.getElementById('entityModal')?.remove();
  const wrap = document.createElement('div');
  const rowsHtml = items.map(r => `
    <div class="rem-row ${r.status === 'done' ? 'done' : ''}">
      <button class="rem-check ${r.status === 'done' ? 'on' : ''}" onclick="AppReminders.toggle('${r.id}');openDayReminders('${date}')"><i class="bi bi-${r.status === 'done' ? 'check-circle-fill' : 'circle'}"></i></button>
      <div class="rem-body"><b>${escapeHtml(r.title || 'Reminder')}</b><small class="num text-faint">${r.time ? '<i class=\"bi bi-clock me-1\"></i>' + r.time : 'All day'}${r.source === 'eon' ? ' · EON' : ''}</small></div>
      <div class="rem-tools owner-only">
        <button onclick="bootstrap.Modal.getInstance(document.getElementById('entityModal'))?.hide();openReminderModal('${r.id}')"><i class="bi bi-pencil"></i></button>
        <button class="del" onclick="AppReminders.remove('${r.id}');openDayReminders('${date}')"><i class="bi bi-trash3"></i></button>
      </div>
    </div>`).join('');
  const dlHtml = dls.map(o => `<a class="rem-row" href="opportunity-details.html?id=${o.id}"><span class="rem-check" style="color:var(--red)"><i class="bi bi-flag-fill"></i></span><div class="rem-body"><b>${escapeHtml(o.name)}</b><small class="text-faint">Deadline</small></div></a>`).join('');
  wrap.innerHTML = `
  <div class="modal fade" id="entityModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content">
    <div class="modal-header">
      <div class="d-flex align-items-center gap-2"><span class="stat-ico"><i class="bi bi-calendar-event"></i></span>
        <h5 class="modal-title">${fmtDate(date)}</h5></div>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">
      ${dlHtml}${rowsHtml || (dlHtml ? '' : '<p class="text-soft">Nothing on this day yet.</p>')}
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Close</button>
      <button type="button" class="btn btn-primary owner-only" id="dayAddRem"><i class="bi bi-plus-lg me-1"></i>Add reminder</button>
    </div>
  </div></div></div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('entityModal');
  const modal = new bootstrap.Modal(modalEl); modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());
  Security.applyMode();
  const addBtn = document.getElementById('dayAddRem');
  if (addBtn) addBtn.onclick = () => { modal.hide(); openReminderModal(null, date); };
}

/* ---------- OPPORTUNITIES (list + filters) ---------- */
function initOpportunities() {
  // read ?q= from global search if present
  const params = new URLSearchParams(location.search);
  const presetQ = params.get('q') || '';

  const tb = document.getElementById('oppToolbar');
  tb.innerHTML = `
    <div class="search-box grow" style="max-width:none">
      <i class="bi bi-search"></i>
      <input type="text" id="oppSearch" placeholder="Search by name or organizer…" value="${escapeHtml(presetQ)}">
    </div>
    <select class="filter-select" id="fType"><option value="">All types</option>${CATS('opportunityTypes').map(t => `<option>${t}</option>`).join('')}</select>
    <select class="filter-select" id="fStatus"><option value="">All statuses</option>${CATS('statuses').map(s => `<option>${s}</option>`).join('')}</select>
    <select class="filter-select" id="fPriority"><option value="">All priorities</option>${CATS('priorities').map(p => `<option>${p}</option>`).join('')}</select>
    <select class="filter-select" id="fSort">
      <option value="deadline">Sort: Deadline</option>
      <option value="added">Sort: Recently added</option>
      <option value="priority">Sort: Priority</option>
      <option value="name">Sort: Name</option>
    </select>
    <button class="btn btn-primary owner-only" id="oppAdd"><i class="bi bi-plus-lg me-1"></i>Add</button>`;

  const draw = () => {
    const q = document.getElementById('oppSearch').value.toLowerCase();
    const ft = document.getElementById('fType').value;
    const fs = document.getElementById('fStatus').value;
    const fp = document.getElementById('fPriority').value;
    const sort = document.getElementById('fSort').value;
    const prioRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };

    let rows = DB.getAll('opportunities').filter(o =>
      (!q || (o.name + ' ' + (o.organizer || '')).toLowerCase().includes(q)) &&
      (!ft || o.type === ft) && (!fs || o.status === fs) && (!fp || o.priority === fp));

    // "Missed Deadline" is a closed chapter — always sink those to the
    // bottom regardless of the chosen sort, so the live opportunities stay
    // at the top of the list.
    const isMissed = (o) => /missed/i.test(o.status || '');
    rows.sort((a, b) => {
      const ma = isMissed(a), mb = isMissed(b);
      if (ma !== mb) return ma ? 1 : -1;                 // missed always last
      if (sort === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sort === 'added') return (b.createdAt || '').localeCompare(a.createdAt || '');
      if (sort === 'priority') return (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9);
      // default: group by status tier so the ones still needing work
      // (Researching, Preparing…) sit above already-submitted ones (Applied,
      // Shortlisted…), then closed; within a tier, nearest deadline first,
      // then newly added (and for opportunities with no deadline set).
      const ra = oppStatusRank(a.status), rb = oppStatusRank(b.status);
      if (ra !== rb) return ra - rb;
      const da = daysUntil(a.deadline), db = daysUntil(b.deadline);
      const byDeadline = (da == null ? 99999 : da) - (db == null ? 99999 : db);
      if (byDeadline !== 0) return byDeadline;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    document.getElementById('oppCount').textContent = `${rows.length} shown`;
    const card = document.getElementById('oppTableCard');
    if (!rows.length) { card.innerHTML = emptyState('compass', 'No opportunities match', 'Try clearing filters, or add your first opportunity.', 'Add opportunity', () => openEntityModal('opportunities'), true); return; }

    // rebuild the whole table each draw so the tbody always exists
    card.innerHTML = `<table class="dt"><thead><tr>
      <th>Opportunity</th><th>Type</th><th>Priority</th><th>Status</th><th>Deadline</th><th></th>
    </tr></thead><tbody id="oppRows"></tbody></table>`;
    document.getElementById('oppRows').innerHTML = rows.map(o => {
      const d = daysUntil(o.deadline);
      const dCell = o.deadline
        ? `<span class="${d != null && d < 0 ? 'text-danger' : ''}">${fmtDate(o.deadline)}<br><small class="text-soft">${relDays(o.deadline)}</small></span>`
        : '—';
      return `<tr>
        <td class="name-cell">
          <div class="d-flex align-items-center gap-2">
            <span class="stat-ico-sm t-${statusTone(o.status)}"><i class="bi bi-${typeIcon(o.type)}"></i></span>
            <div><b><a href="opportunity-details.html?id=${o.id}">${escapeHtml(o.name)}</a></b>${o.featured ? ' <i class="bi bi-star-fill" style="color:var(--amber);font-size:11px" title="Shown on portfolio"></i>' : ''}
            <small>${escapeHtml(o.organizer || '')}${o.country ? ' · ' + escapeHtml(o.country) : ''}</small></div>
          </div>
        </td>
        <td><span class="chip chip-outline">${escapeHtml(o.type || '—')}</span></td>
        <td>${prioChip(o.priority)}</td>
        <td>${statusChip(o.status)}</td>
        <td class="date-cell">${dCell}</td>
        <td><div class="row-actions">
          <button title="View" onclick="location.href='opportunity-details.html?id=${o.id}'"><i class="bi bi-eye"></i></button>
          <button class="owner-only" title="Edit" onclick="openEntityModal('opportunities','${o.id}')"><i class="bi bi-pencil"></i></button>
          <button class="del owner-only" title="Delete" onclick="confirmDelete('opportunities','${o.id}')"><i class="bi bi-trash3"></i></button>
        </div></td>
      </tr>`;
    }).join('');
  };

  ['oppSearch', 'fType', 'fStatus', 'fPriority', 'fSort'].forEach(id =>
    document.getElementById(id).addEventListener('input', draw));
  document.getElementById('oppAdd').onclick = () => openEntityModal('opportunities');
  draw();
}

/* ---------- OPPORTUNITY DETAILS ---------- */
/* ---- opportunity activity log (worklog of what you actually did) ----
   Each entry is a real "touch": it timestamps progress AND feeds the Signal
   Layer's cadence/decay so EON knows when a deal is genuinely going quiet. */
const ACT_KINDS = [
  { v: 'worked', label: 'Worked on it', ico: 'pencil-fill' },
  { v: 'submitted', label: 'Submitted', ico: 'send-fill' },
  { v: 'email', label: 'Emailed', ico: 'envelope-fill' },
  { v: 'call', label: 'Call / meeting', ico: 'telephone-fill' },
  { v: 'followup', label: 'Followed up', ico: 'arrow-repeat' },
  { v: 'note', label: 'Note', ico: 'sticky-fill' },
];
function logActivity(oppId, kind, note) {
  if (!Security.guard('log activity')) return;
  const o = DB.get('opportunities', oppId); if (!o) return;
  note = String(note || '').trim();
  if (!note) { toast('Write what you did first.', 'err'); return; }
  o.activities = Array.isArray(o.activities) ? o.activities : [];
  const at = new Date().toISOString();
  o.activities.push({ id: uid(), at, kind: kind || 'worked', note });
  (DB.data._events = DB.data._events || []).push({ opp: oppId, type: 'touch', from: null, to: kind || 'worked', at });
  DB.save();
  try { computeSignals(); } catch {}
  toast('Logged. ✍️', 'ok');
  initOpportunityDetails();
}
function addActivityFromForm(oppId) {
  const note = document.getElementById('actNote');
  const kind = document.getElementById('actKind');
  if (note) logActivity(oppId, kind ? kind.value : 'worked', note.value);
}
function setNextAction(oppId) {
  if (!Security.guard('set the next step')) return;
  const el = document.getElementById('nextInput'); if (!el) return;
  const o = DB.get('opportunities', oppId); if (!o) return;
  o.nextAction = String(el.value || '').trim();
  DB.save(); try { computeSignals(); } catch {}
  toast(o.nextAction ? 'Next step set. 🎯' : 'Next step cleared.', 'ok');
  initOpportunityDetails();
}

/* ---- opportunity PHASES (milestones on the application timeline) ----
   Owner adds named phases with a target date between "Added" and the
   deadline; each can be ticked done. Phases live on the opportunity record
   (o.phases) so they sync to the cloud like everything else. */
function addPhase(oppId) {
  if (!Security.guard('add a phase')) return;
  const o = DB.get('opportunities', oppId); if (!o) return;
  const tEl = document.getElementById('phaseTitle');
  const dEl = document.getElementById('phaseDate');
  const title = String(tEl ? tEl.value : '').trim();
  if (!title) { toast('Name the phase first.', 'err'); tEl?.focus(); return; }
  const at = (dEl && dEl.value) ? dEl.value : new Date().toISOString().slice(0, 10);
  o.phases = Array.isArray(o.phases) ? o.phases : [];
  o.phases.push({ id: uid(), title, at, done: false, doneAt: null });
  DB.save(); try { computeSignals(); } catch {}
  toast('Phase added. 🧭', 'ok');
  initOpportunityDetails();
}
function togglePhase(oppId, phaseId) {
  if (!Security.guard('update a phase')) return;
  const o = DB.get('opportunities', oppId); if (!o || !Array.isArray(o.phases)) return;
  const p = o.phases.find(x => x.id === phaseId); if (!p) return;
  p.done = !p.done; p.doneAt = p.done ? new Date().toISOString() : null;
  DB.save(); try { computeSignals(); } catch {}
  initOpportunityDetails();
}
function removePhase(oppId, phaseId) {
  if (!Security.guard('remove a phase')) return;
  const o = DB.get('opportunities', oppId); if (!o || !Array.isArray(o.phases)) return;
  o.phases = o.phases.filter(x => x.id !== phaseId);
  DB.save(); try { computeSignals(); } catch {}
  initOpportunityDetails();
}

/* Build the animated timeline: fixed milestones (Added / Opens / Deadline /
   Event) interleaved with the owner's custom phases, ordered by date. The
   connecting line "fills" up to the last completed node. */
function oppTimelineHtml(o) {
  const today = new Date().toISOString().slice(0, 10);
  const day = (s) => (s ? String(s).slice(0, 10) : '');
  const phases = (Array.isArray(o.phases) ? [...o.phases] : [])
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));

  const nodes = [];
  nodes.push({ label: 'Added to tracker', at: day(o.createdAt || o.openDate), fixed: true, done: true });
  if (o.openDate) nodes.push({ label: 'Opens', at: day(o.openDate), fixed: true, done: day(o.openDate) <= today });
  phases.forEach(p => nodes.push({ id: p.id, label: p.title, at: day(p.at), done: !!p.done, phase: true }));
  if (o.deadline) nodes.push({ label: 'Application deadline', at: day(o.deadline), fixed: true, deadline: true, done: false });
  if (o.eventDate) nodes.push({ label: 'Event date', at: day(o.eventDate), fixed: true, done: day(o.eventDate) <= today });

  // the "next" node is the first not-done milestone still ahead of today
  const nextIdx = nodes.findIndex(n => !n.done && (!n.at || n.at >= today));
  const total = phases.length;
  const donePhases = phases.filter(p => p.done).length;
  const pct = total ? Math.round((donePhases / total) * 100) : 0;

  const rows = nodes.map((n, i) => {
    const missed = !n.done && n.at && n.at < today;      // date passed, not ticked
    const cls = [n.done ? 'is-done' : '', i === nextIdx ? 'is-next' : '', missed ? 'is-missed' : '', n.deadline ? 'is-deadline' : ''].filter(Boolean).join(' ');
    const ico = n.done ? 'check-lg' : (n.deadline ? 'flag-fill' : (missed ? 'exclamation' : ''));
    const controls = n.phase ? `
      <span class="etl-actions owner-only">
        <button title="${n.done ? 'Mark not done' : 'Mark done'}" onclick="togglePhase('${o.id}','${n.id}')"><i class="bi bi-${n.done ? 'arrow-counterclockwise' : 'check2'}"></i></button>
        <button title="Remove phase" class="etl-del" onclick="removePhase('${o.id}','${n.id}')"><i class="bi bi-x-lg"></i></button>
      </span>` : '';
    return `<div class="etl-node ${cls}">
      <span class="etl-dot">${ico ? `<i class="bi bi-${ico}"></i>` : ''}</span>
      <div class="etl-body">
        <b>${escapeHtml(n.label)}</b>
        <small>${n.at ? fmtDate(n.at) : 'no date'}${missed ? ' · missed' : (i === nextIdx ? ' · up next' : '')}</small>
        ${controls}
      </div>
    </div>`;
  }).join('');

  return `
    <div class="section-title d-flex align-items-center">
      <span>Application timeline</span>
      ${total ? `<span class="etl-progress ms-auto" title="${donePhases}/${total} phases done">${pct}%</span>` : ''}
    </div>
    <div class="etl" style="--etl-fill:${pct}%">
      <div class="etl-track"></div>
      ${rows}
    </div>
    <div class="etl-add owner-only">
      <input id="phaseTitle" placeholder="Add a phase (e.g. Draft essay)" onkeydown="if(event.key==='Enter')addPhase('${o.id}')">
      <input id="phaseDate" type="date">
      <button class="btn btn-primary btn-sm" onclick="addPhase('${o.id}')"><i class="bi bi-plus-lg"></i></button>
    </div>`;
}

function initOpportunityDetails() {
  const id = new URLSearchParams(location.search).get('id');
  const o = id && DB.get('opportunities', id);
  const host = document.getElementById('detailHost');
  if (!o) { host.innerHTML = emptyState('compass', 'Opportunity not found', 'It may have been deleted.', 'Back to list', () => location.href = 'opportunities.html'); return; }

  const d = daysUntil(o.deadline);

  // EON's read on THIS deal (Signal Layer), owner-only
  const sig = (window.EonSignals && window.EonSignals.get) ? window.EonSignals.get(o.id) : null;
  const REC = { press: ['green', 'Press now', 'lightning-charge-fill'], intervene: ['amber', 'Intervene', 'exclamation-triangle-fill'], revive: ['red', 'Revive', 'arrow-counterclockwise'], watch: ['slate', 'Watch', 'eye'] };
  const sigBanner = sig ? (() => { const r = REC[sig.recommend] || REC.watch; return `
    <div class="sig-banner owner-only t-${r[0]}">
      <i class="bi bi-${r[2]}"></i>
      <div class="sb-body"><b>EON: ${r[1]}</b><span>${escapeHtml(sig.why.join(' '))}</span></div>
      <span class="sb-conf" title="confidence">${Math.round(sig.confidence * 100)}%</span>
    </div>`; })() : '';

  // activity log (most recent first)
  const acts = Array.isArray(o.activities) ? [...o.activities].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : [];
  const kindOf = (v) => ACT_KINDS.find(k => k.v === v) || ACT_KINDS[0];

  host.innerHTML = `
    ${sigBanner}
    <div class="card card-pad mb-3">
      <div class="detail-head">
        <div class="dh-ico t-${statusTone(o.status)}"><i class="bi bi-${typeIcon(o.type)}"></i></div>
        <div class="flex-grow-1">
          <h2>${escapeHtml(o.name)}</h2>
          <div class="d-flex flex-wrap gap-2 align-items-center">
            ${statusChip(o.status)} ${prioChip(o.priority)}
            <span class="chip chip-outline">${escapeHtml(o.type || '—')}</span>
            ${o.subType ? `<span class="chip chip-outline">${escapeHtml(o.subType)}</span>` : ''}
          </div>
        </div>
        <div class="text-end">
          ${o.deadline ? `<div class="num" style="font-size:30px;font-weight:700;color:${d < 0 ? 'var(--red)' : 'var(--primary-700)'}">${d}d</div><small class="text-soft">${d < 0 ? 'overdue' : 'until deadline'}</small>` : ''}
        </div>
      </div>
      <div class="mt-3 d-flex gap-2">
        ${o.link ? `<a class="btn btn-soft btn-sm" href="${escapeHtml(o.link)}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right me-1"></i>Official page</a>` : ''}
        <button class="btn btn-ghost btn-sm owner-only" onclick="openEntityModal('opportunities','${o.id}', () => location.reload())"><i class="bi bi-pencil me-1"></i>Edit</button>
        <button class="btn btn-ghost btn-sm owner-only" id="oppAddLinkedTask"><i class="bi bi-plus-lg me-1"></i>Add linked task</button>
      </div>
      <div class="next-step mt-3">
        <i class="bi bi-flag-fill"></i>
        <input id="nextInput" value="${escapeHtml(o.nextAction || '')}" placeholder="Next step — the one thing to do next…" ${Security.isOwner() ? '' : 'disabled'}>
        <button class="btn btn-primary btn-sm owner-only" onclick="setNextAction('${o.id}')">Set</button>
      </div>
    </div>

    <div class="grid-2">
      <div class="card card-pad">
        <div class="section-title">Details</div>
        <dl class="kv">
          <dt>Organizer</dt><dd>${escapeHtml(o.organizer || '—')}</dd>
          <dt>Country</dt><dd>${escapeHtml(o.country || '—')}</dd>
          <dt>Mode</dt><dd>${escapeHtml(o.mode || '—')}</dd>
          <dt>Funding</dt><dd>${escapeHtml(o.fundingType || '—')}</dd>
          <dt>Sub-type</dt><dd>${escapeHtml(o.subType || '—')}</dd>
          <dt>Open date</dt><dd class="num">${fmtDate(o.openDate)}</dd>
          <dt>Deadline</dt><dd class="num">${fmtDate(o.deadline)}</dd>
          <dt>Event date</dt><dd class="num">${fmtDate(o.eventDate)}</dd>
        </dl>
        ${o.notes ? `<div class="divider"></div><div class="section-title">Notes</div><p style="font-size:13.5px;white-space:pre-wrap">${escapeHtml(o.notes)}</p>` : ''}
      </div>

      <div class="stack-16">
        <div class="card card-pad">
          ${oppTimelineHtml(o)}
        </div>

        <div class="card card-pad">
          <div class="section-title">Activity log (${acts.length})</div>
          <div class="act-add owner-only">
            <select id="actKind">${ACT_KINDS.map(k => `<option value="${k.v}">${k.label}</option>`).join('')}</select>
            <input id="actNote" placeholder="What did you do? (e.g. finished essay 2)" onkeydown="if(event.key==='Enter')addActivityFromForm('${o.id}')">
            <button class="btn btn-primary btn-sm" onclick="addActivityFromForm('${o.id}')"><i class="bi bi-plus-lg"></i></button>
          </div>
          <div class="act-list">
            ${acts.length ? acts.map(a => { const k = kindOf(a.kind); return `
              <div class="act-item">
                <span class="act-ico"><i class="bi bi-${k.ico}"></i></span>
                <div class="act-body"><b>${escapeHtml(a.note)}</b><small>${k.label} · ${fmtDate(a.at)}</small></div>
              </div>`; }).join('') : `<p class="text-soft mb-0" style="font-size:13px">No activity logged yet. Each entry tells EON the deal is alive — and sharpens his "going quiet" radar.</p>`}
          </div>
        </div>
      </div>
    </div>

    <div class="card card-pad mt-3" id="oppTaskBoard">
      <div class="d-flex align-items-center gap-2 mb-3">
        <div class="section-title mb-0">Task board</div>
        <span class="text-soft" style="font-size:12.5px">Tasks here are linked to this opportunity and mirror to the main board.</span>
        <button class="btn btn-primary btn-sm ms-auto owner-only" id="oppTaskAdd"><i class="bi bi-plus-lg me-1"></i>Add task</button>
      </div>
      <div id="oppKanban" class="kanban"></div>
    </div>`;

  // Opportunity's own kanban: the SAME task board, filtered to this
  // opportunity's linked tasks. Adds prefill the link so a new task lands
  // here AND on the main board; drag/edit/delete stay in sync via the store.
  const oppBoard = document.getElementById('oppKanban');
  const drawBoard = () => renderKanbanBoard(
    oppBoard,
    DB.getAll('tasks').filter(t => t.linkedOpportunity === o.name),
    drawBoard,
    { showLink: false }
  );
  drawBoard();
  // Both "Add task" (board) and "Add linked task" (header) prefill the link,
  // wired in JS so the opportunity name is never inlined into HTML (names can
  // contain quotes/apostrophes that would break an inline onclick attribute).
  const addLinked = () => openEntityModal('tasks', null, initOpportunityDetails, { linkedOpportunity: o.name });
  const addBtn = document.getElementById('oppTaskAdd');
  if (addBtn) addBtn.onclick = addLinked;
  const addBtn2 = document.getElementById('oppAddLinkedTask');
  if (addBtn2) addBtn2.onclick = addLinked;

  // freshly injected owner-only controls need the current mode applied
  try { Security.applyMode(); } catch {}
}

/* ---------- TASK BOARD (Kanban + drag & drop) ----------
   The board renderer is shared: the main Task Board page draws EVERY task,
   while an opportunity's detail page draws the SAME board filtered to just
   that opportunity's linked tasks. Both go through one set of helpers so a
   status change (drag), edit or delete stays consistent and synced. */
const TASK_COL_DOT = { 'To Do': 'var(--slate)', 'In Progress': 'var(--blue)', 'Waiting': 'var(--amber)', 'Review': 'var(--violet)', 'Completed': 'var(--green)', 'Cancelled': 'var(--red)' };

/* One task card. showLink=false hides the "linked opportunity" chip (redundant
   on an opportunity's own board where every card belongs to it). */
function taskCardHtml(t, showLink = true) {
  const d = daysUntil(t.dueDate);
  // Cards are only draggable for the owner; visitors get a read-only board.
  return `<div class="kcard" draggable="${Security.isOwner()}" data-id="${t.id}">
    <div class="kc-top">
      <div class="kc-title">${escapeHtml(t.title)}</div>
      <button class="btn-sm btn btn-ghost ms-auto p-1 owner-only" style="line-height:1" onclick="openEntityModal('tasks','${t.id}')" title="Edit"><i class="bi bi-pencil"></i></button>
      <button class="btn-sm btn btn-ghost p-1 owner-only text-danger" style="line-height:1" onclick="confirmDelete('tasks','${t.id}')" title="Delete"><i class="bi bi-trash3"></i></button>
    </div>
    <div class="kc-meta">
      ${prioChip(t.priority)}
      ${t.category ? `<span class="chip chip-outline">${escapeHtml(t.category)}</span>` : ''}
      ${t.dueDate ? `<span class="kc-due ${d != null && d < 0 ? 'overdue' : ''}"><i class="bi bi-calendar3"></i>${fmtDate(t.dueDate)}</span>` : ''}
    </div>
    ${showLink && t.linkedOpportunity ? `<div class="mt-2"><span class="kc-link"><i class="bi bi-link-45deg"></i> ${escapeHtml(t.linkedOpportunity)}</span></div>` : ''}
  </div>`;
}

/* Render a kanban into boardEl from a task list, then wire drag & drop.
   redraw() is called after a status change so the board (and any mirror,
   e.g. the main board when editing from an opportunity) stays current. */
function renderKanbanBoard(boardEl, tasks, redraw, { showLink = true } = {}) {
  if (!boardEl) return;
  const cols = CATS('taskStatuses');
  boardEl.innerHTML = cols.map(col => {
    const items = tasks.filter(t => (t.status || 'To Do') === col);
    return `<div class="kcol" data-col="${escapeHtml(col)}">
      <div class="kcol-head"><span class="k-dot" style="background:${TASK_COL_DOT[col] || 'var(--slate)'}"></span><b>${escapeHtml(col)}</b><span class="k-count">${items.length}</span></div>
      <div class="kcol-body" data-col="${escapeHtml(col)}">
        ${items.map(t => taskCardHtml(t, showLink)).join('')}
      </div>
    </div>`;
  }).join('');
  wireKanbanBoard(boardEl, redraw);
}

function wireKanbanBoard(boardEl, redraw) {
  let dragId = null;
  boardEl.querySelectorAll('.kcard').forEach(card => {
    card.addEventListener('dragstart', () => { dragId = card.dataset.id; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  boardEl.querySelectorAll('.kcol-body').forEach(zone => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('drag-over');
      if (!dragId) return;
      if (!Security.guard('move tasks')) return; // owner-only status change
      const task = DB.get('tasks', dragId);
      if (task && task.status !== zone.dataset.col) {
        // route through upsert so cloud sync + productivity signals fire
        DB.upsert('tasks', { id: task.id, status: zone.dataset.col });
        toast(`Moved to “${zone.dataset.col}”.`, 'ok');
      }
      if (typeof redraw === 'function') redraw();
    });
  });
}

function initTasks() {
  const board = document.getElementById('kanban');
  const draw = () => renderKanbanBoard(board, DB.getAll('tasks'), draw);
  document.getElementById('taskAdd').onclick = () => openEntityModal('tasks', null, draw);
  draw();
}

/* Download a document's stored file (data URL → file on disk). */
function downloadDoc(id) {
  const d = DB.get('documents', id);
  if (!d || !d.file) { toast('No file attached to this document.', 'err'); return; }
  const a = document.createElement('a');
  a.href = d.file.data;
  a.download = d.file.name || 'document';
  document.body.appendChild(a); a.click(); a.remove();
}

/* Open a document's stored file in a new tab. Converts the data URL to a
   short-lived blob URL so browsers reliably preview PDFs / images. */
function viewDoc(id) {
  const d = DB.get('documents', id);
  if (!d || !d.file) { toast('No file attached to this document.', 'err'); return; }
  fetch(d.file.data)
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    })
    .catch(() => toast('Could not open the file.', 'err'));
}

/* ---------- DOCUMENTS ---------- */
function initDocuments() {
  const host = document.getElementById('docHost');
  const draw = () => {
    const docs = DB.getAll('documents');
    if (!docs.length) { host.innerHTML = emptyState('folder', 'No documents yet', 'Track passports, CVs, SOPs, transcripts and their status.', 'Add document', () => openEntityModal('documents', null, draw), true); return; }
    host.innerHTML = `<div class="card table-card"><table class="dt"><thead><tr>
        <th>Document</th><th>Category</th><th>Status</th><th>Updated</th><th>Expiry</th><th>File / Links</th><th></th>
      </tr></thead><tbody>${docs.map(dc => {
        const exp = daysUntil(dc.expiryDate);
        const linkBits = [];
        if (dc.file) {
          linkBits.push(`<a href="#" title="Download ${escapeHtml(dc.file.name)} (${fmtBytes(dc.file.size)})" onclick="event.preventDefault();downloadDoc('${dc.id}')"><i class="bi bi-download"></i></a>`);
          linkBits.push(`<a href="#" title="Open ${escapeHtml(dc.file.name)}" onclick="event.preventDefault();viewDoc('${dc.id}')"><i class="bi bi-eye"></i></a>`);
        }
        if (dc.driveLink) linkBits.push(`<a href="${escapeHtml(dc.driveLink)}" target="_blank" rel="noopener" title="Drive"><i class="bi bi-google text-soft"></i></a>`);
        if (dc.downloadLink) linkBits.push(`<a href="${escapeHtml(dc.downloadLink)}" target="_blank" rel="noopener" title="Download link"><i class="bi bi-link-45deg text-soft"></i></a>`);
        return `<tr>
          <td class="name-cell"><b>${escapeHtml(dc.name)}</b>${dc.file ? ` <i class="bi bi-paperclip text-soft" title="${escapeHtml(dc.file.name)} · ${fmtBytes(dc.file.size)}"></i>` : ''}</td>
          <td><span class="chip chip-outline">${escapeHtml(dc.category || '—')}</span></td>
          <td>${statusChip(dc.status)}</td>
          <td class="date-cell">${fmtDate(dc.updatedDate)}</td>
          <td class="date-cell ${exp != null && exp < 60 ? 'text-danger' : ''}">${fmtDate(dc.expiryDate)}</td>
          <td><div class="doc-links">${linkBits.length ? linkBits.join('') : '<span class="text-faint">—</span>'}</div></td>
          <td><div class="row-actions">
            <button class="owner-only" onclick="openEntityModal('documents','${dc.id}')"><i class="bi bi-pencil"></i></button>
            <button class="del owner-only" onclick="confirmDelete('documents','${dc.id}')"><i class="bi bi-trash3"></i></button>
          </div></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  };
  document.getElementById('docAdd').onclick = () => openEntityModal('documents', null, draw);
  draw();
}

/* ==========================================================
   SHARED CARD BUILDERS — one compact "achievement-style" card per
   entity, reused by BOTH the management page and the public portfolio
   so every section has identical card width & height. Each card is
   click-to-expand (data-detail → openPortfolioDetail) with the full
   text revealed in the detail modal.
   ========================================================== */

/* Owner edit/delete tools shown inside a card foot (hidden from visitors). */
function cardFootTools(entity, id) {
  return `<span class="ach-tools">
    <button class="btn btn-ghost btn-sm owner-only" title="Edit" onclick="event.stopPropagation();openEntityModal('${entity}','${id}')"><i class="bi bi-pencil"></i></button>
    <button class="btn btn-ghost btn-sm text-danger owner-only" title="Delete" onclick="event.stopPropagation();confirmDelete('${entity}','${id}')"><i class="bi bi-trash3"></i></button>
  </span>`;
}
function tagRow(arr, max = 4) {
  const a = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (!a.length) return '';
  return `<div class="ach-tags">${a.slice(0, max).map(s => `<span class="chip chip-mini">${escapeHtml(s)}</span>`).join('')}${a.length > max ? `<span class="chip chip-mini">+${a.length - max}</span>` : ''}</div>`;
}

/* SOCIAL ACTIVITY card — role shown as a prominent badge, an impact
   highlight callout, organization link, cause and skills. */
function volCardHtml(v, photoBadge, withTools) {
  const skills = Array.isArray(v.skills) ? v.skills : [];
  const dates = [fmtDate(v.startDate), fmtDate(v.date)].filter(d => d && d !== '—');
  const when = dates.length === 2 && dates[0] !== dates[1] ? `${dates[0]} – ${dates[1]}` : (dates[0] || '');
  const topBits = [
    v.commitment ? `<span class="chip chip-outline ach-pos">${escapeHtml(v.commitment)}</span>` : '',
    v.hours ? `<span class="chip chip-mini"><i class="bi bi-clock me-1"></i>${escapeHtml(v.hours)}</span>` : '',
    when ? `<small class="text-faint num ms-auto">${escapeHtml(when)}</small>` : ''
  ].filter(Boolean).join('');
  return `
  <div class="gal-card ach-card vol-card pf-clickable" data-detail="volunteering:${v.id}">
    <div class="gc-media">${mediaCollage(v, 'heart-fill')}${photoBadge ? photoBadge(v) : ''}${v.featured ? '<span class="pf-feat-badge"><i class="bi bi-star-fill"></i>Portfolio</span>' : ''}<span class="vol-tag"><i class="bi bi-heart-fill"></i>Social impact</span></div>
    <div class="gc-body">
      ${topBits ? `<div class="d-flex align-items-center gap-2 mb-1">${topBits}</div>` : ''}
      <b class="ach-title">${escapeHtml(v.title)}</b>
      ${v.role ? `<div class="ach-role">${escapeHtml(v.role)}</div>` : ''}
      ${(v.organization || v.location) ? `<div class="ach-meta ach-sub">${[v.organization, v.location].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
      ${v.cause ? `<div class="vol-cause"><i class="bi bi-tag-fill"></i><span>${escapeHtml(v.cause)}</span></div>` : ''}
      ${v.impact ? `<div class="ach-impact"><i class="bi bi-graph-up-arrow"></i><span>${escapeHtml(v.impact)}</span></div>` : ''}
      ${skills.length ? tagRow(skills) : (v.description ? `<p class="ach-desc">${escapeHtml(mdStrip(v.description))}</p>` : '')}
      <div class="ach-foot">
        <span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span>
        ${v.orgLink ? `<a class="btn btn-ghost btn-sm" title="Organization" href="${escapeHtml(v.orgLink)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
        ${withTools ? cardFootTools('volunteering', v.id) : ''}
      </div>
    </div>
  </div>`;
}

/* RESEARCH card — field + stage chips, topic line, aspects/tech tags. */
function researchCardHtml(r, photoBadge, withTools, compact) {
  const tags = [...(Array.isArray(r.aspects) ? r.aspects : []), ...(Array.isArray(r.technologies) ? r.technologies : [])];
  return `
  <div class="gal-card ach-card pf-clickable${compact ? ' ach-cap' : ''}" data-detail="research:${r.id}">
    <div class="gc-media">${mediaCollage(r, 'lightbulb-fill')}${photoBadge ? photoBadge(r) : ''}${r.featured ? '<span class="pf-feat-badge"><i class="bi bi-star-fill"></i>Portfolio</span>' : ''}</div>
    <div class="gc-body">
      <div class="d-flex align-items-center gap-2 mb-1">
        ${r.field ? `<span class="chip t-blue">${escapeHtml(r.field)}</span>` : '<span class="chip t-blue">Research</span>'}
        ${r.stage ? `<span class="chip t-${statusTone(r.stage)} ach-pos">${escapeHtml(r.stage)}</span>` : ''}
        ${r.researchType ? `<small class="text-faint num ms-auto">${escapeHtml(r.researchType)}</small>` : ''}
      </div>
      <b class="ach-title">${escapeHtml(r.title)}</b>
      ${(r.topic || r.subtitle) ? `<div class="ach-meta ach-sub">${escapeHtml(r.topic || r.subtitle)}</div>` : ''}
      ${(r.abstract || r.problem) ? `<p class="ach-desc">${escapeHtml(mdStrip(r.abstract || r.problem))}</p>` : ''}
      ${tagRow(tags)}
      <div class="ach-foot">
        <span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span>
        ${r.link ? `<a class="btn btn-ghost btn-sm" title="Publication" href="${escapeHtml(r.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="bi bi-file-earmark-text"></i></a>` : ''}
        ${withTools ? `<span class="ach-tools"><button class="btn btn-ghost btn-sm owner-only" title="Content studio" onclick="event.stopPropagation();openContentStudio('research','${r.id}', refreshCurrentPage)"><i class="bi bi-easel"></i></button><button class="btn btn-ghost btn-sm owner-only" title="Edit" onclick="event.stopPropagation();openEntityModal('research','${r.id}')"><i class="bi bi-pencil"></i></button><button class="btn btn-ghost btn-sm text-danger owner-only" title="Delete" onclick="event.stopPropagation();confirmDelete('research','${r.id}')"><i class="bi bi-trash3"></i></button></span>` : ''}
      </div>
    </div>
  </div>`;
}

/* PROJECT card — order: name → subtitle → technology → description. */
function projectCardHtml(p, photoBadge, withTools, compact) {
  return `
  <div class="gal-card ach-card pf-clickable${compact ? ' ach-cap' : ''}" data-detail="projects:${p.id}">
    <div class="gc-media">${mediaCollage(p, 'diagram-3-fill')}${photoBadge ? photoBadge(p) : ''}${p.featured ? '<span class="pf-feat-badge"><i class="bi bi-star-fill"></i>Portfolio</span>' : ''}</div>
    <div class="gc-body">
      <div class="d-flex align-items-center gap-2 mb-1">
        <span class="chip t-${statusTone(p.status)}"><span class="dot"></span>${escapeHtml(p.status || 'Idea')}</span>
        ${p.category ? `<span class="chip chip-outline ach-pos">${escapeHtml(p.category)}</span>` : ''}
      </div>
      <b class="ach-title">${escapeHtml(p.name)}</b>
      ${p.subtitle ? `<div class="ach-meta ach-sub">${escapeHtml(p.subtitle)}</div>` : ''}
      ${p.technologies ? `<div class="ach-tech"><i class="bi bi-cpu"></i><span>${escapeHtml(p.technologies)}</span></div>` : ''}
      ${(p.abstract || p.description) ? `<p class="ach-desc">${escapeHtml(mdStrip(p.abstract || p.description))}</p>` : ''}
      <div class="ach-foot">
        <span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span>
        ${p.link ? `<a class="btn btn-ghost btn-sm" title="Open" href="${escapeHtml(p.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
        ${withTools ? `<span class="ach-tools"><button class="btn btn-ghost btn-sm owner-only" title="Content studio" onclick="event.stopPropagation();openContentStudio('projects','${p.id}', refreshCurrentPage)"><i class="bi bi-easel"></i></button><button class="btn btn-ghost btn-sm owner-only" title="Edit" onclick="event.stopPropagation();openEntityModal('projects','${p.id}')"><i class="bi bi-pencil"></i></button><button class="btn btn-ghost btn-sm text-danger owner-only" title="Delete" onclick="event.stopPropagation();confirmDelete('projects','${p.id}')"><i class="bi bi-trash3"></i></button></span>` : ''}
      </div>
    </div>
  </div>`;
}

/* EDUCATION card — admissions/enrolment status pipeline + offer-letter badge. */
function educationCardHtml(ed, photoBadge, withTools) {
  const hasOffer = ed.offerLetter && ed.offerLetter.data;
  const when = [fmtDate(ed.startDate), ed.status === 'Graduated' || ed.endDate ? fmtDate(ed.endDate) : ''].filter(d => d && d !== '—');
  const period = when.length === 2 ? `${when[0]} – ${when[1]}` : (when[0] || '');
  return `
  <div class="gal-card ach-card pf-clickable" data-detail="education:${ed.id}">
    <div class="gc-media">${mediaCollage(ed, 'mortarboard-fill')}${photoBadge ? photoBadge(ed) : ''}${ed.featured ? '<span class="pf-feat-badge"><i class="bi bi-star-fill"></i>Portfolio</span>' : ''}${hasOffer ? '<span class="pf-feat-badge offer"><i class="bi bi-envelope-paper-fill"></i>Offer letter</span>' : ''}</div>
    <div class="gc-body">
      <div class="d-flex align-items-center gap-2 mb-1">
        <span class="chip t-primary">${escapeHtml(ed.level || 'Education')}</span>
        ${ed.status ? `<span class="chip t-${statusTone(ed.status)} ach-pos"><span class="dot"></span>${escapeHtml(ed.status)}</span>` : ''}
        ${period ? `<small class="text-faint num ms-auto">${escapeHtml(period)}</small>` : ''}
      </div>
      <b class="ach-title">${escapeHtml(ed.institution)}</b>
      ${(ed.program || ed.fieldOfStudy) ? `<div class="ach-meta">${[ed.program, ed.fieldOfStudy].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
      ${(ed.result || ed.scholarship) ? `<div class="ach-impact"><i class="bi bi-patch-check-fill"></i><span>${[ed.result, ed.scholarship].filter(Boolean).map(escapeHtml).join(' · ')}</span></div>` : ''}
      ${tagRow(ed.highlights)}
      <div class="ach-foot">
        <span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span>
        ${ed.link ? `<a class="btn btn-ghost btn-sm" title="Program" href="${escapeHtml(ed.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
        ${withTools ? cardFootTools('education', ed.id) : ''}
      </div>
    </div>
  </div>`;
}

/* EDUCATION timeline row — the CV-style "where I studied" layout (Part 1).
   A connected node per institution, newest at the top. */
function educationTimelineHtml(ed, withTools) {
  const hasOffer = ed.offerLetter && ed.offerLetter.data;
  const when = [fmtDate(ed.startDate), ed.status === 'Graduated' || ed.endDate ? fmtDate(ed.endDate) : (ed.status === 'Enrolled' ? 'Present' : '')].filter(d => d && d !== '—');
  const period = when.length === 2 ? `${when[0]} – ${when[1]}` : (when[0] || '');
  return `
  <div class="edu-tl pf-clickable" data-detail="education:${ed.id}">
    <span class="edu-tl-node"><i class="bi bi-mortarboard-fill"></i></span>
    <div class="edu-tl-card">
      <div class="edu-tl-head">
        <b>${escapeHtml(ed.institution)}</b>
        ${ed.status ? `<span class="chip t-${statusTone(ed.status)} ach-pos"><span class="dot"></span>${escapeHtml(ed.status)}</span>` : ''}
        ${period ? `<small class="text-faint num ms-auto">${escapeHtml(period)}</small>` : ''}
      </div>
      ${(ed.program || ed.fieldOfStudy || ed.level) ? `<div class="edu-tl-prog">${[ed.program || ed.level, ed.fieldOfStudy].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
      ${ed.location ? `<div class="ach-meta">${escapeHtml(ed.location)}</div>` : ''}
      ${(ed.result || ed.scholarship) ? `<div class="ach-impact"><i class="bi bi-patch-check-fill"></i><span>${[ed.result, ed.scholarship].filter(Boolean).map(escapeHtml).join(' · ')}</span></div>` : ''}
      ${tagRow(ed.highlights, 6)}
      <div class="ach-foot">
        <span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span>
        ${hasOffer ? '<span class="chip chip-mini" style="background:#0a7d4b;color:#fff"><i class="bi bi-envelope-paper-fill me-1"></i>Offer letter</span>' : ''}
        ${ed.link ? `<a class="btn btn-ghost btn-sm" title="Program" href="${escapeHtml(ed.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
        ${withTools ? cardFootTools('education', ed.id) : ''}
      </div>
    </div>
  </div>`;
}

/* One compact "got-in" row — for the public portfolio, where many admissions
   shouldn't each eat a full card. Single line: Got-in tag · institution ·
   subject · status · year, click for full details. */
function educationRowHtml(ed, withTools) {
  const yr = (ed.startDate || ed.decisionDate || ed.appliedDate || '').slice(0, 4);
  const subject = ed.fieldOfStudy || ed.program || ed.level || '';
  const hasOffer = ed.offerLetter && ed.offerLetter.data;
  return `
  <div class="edu-row pf-clickable" data-detail="education:${ed.id}">
    <span class="edu-row-tag"><i class="bi bi-check-circle-fill"></i>Got in</span>
    <div class="edu-row-main">
      <b>${escapeHtml(ed.institution)}</b>
      ${subject ? `<span>${escapeHtml(subject)}</span>` : ''}
    </div>
    ${hasOffer ? '<span class="edu-row-offer" title="Offer letter on file"><i class="bi bi-envelope-paper-fill"></i></span>' : ''}
    ${ed.status ? `<span class="chip t-${statusTone(ed.status)} edu-row-st">${escapeHtml(ed.status)}</span>` : ''}
    ${yr ? `<small class="num edu-row-yr">${escapeHtml(yr)}</small>` : ''}
    ${withTools ? `<span class="edu-row-tools owner-only">
      <button class="btn btn-ghost btn-sm" title="Edit" onclick="event.stopPropagation();openEntityModal('education','${ed.id}', refreshCurrentPage)"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-ghost btn-sm text-danger" title="Delete" onclick="event.stopPropagation();confirmDelete('education','${ed.id}', refreshCurrentPage)"><i class="bi bi-trash3"></i></button></span>` : ''}
    <i class="bi bi-chevron-right edu-row-cta"></i>
  </div>`;
}

/* Split education into its two parts and render each with its own layout:
   Part 1 "My Academic Journey" (studied / studying) → vertical timeline.
   Part 2 "Admissions & Offers" (got in, may not have attended) → cards, OR
   compact rows when admitsAsRows is set (the public portfolio, to stay tidy
   when there are many). Classification is by status, so it just works as the
   owner updates a record from "Offer Received" → "Enrolled". */
function educationGroups(items, badge, withTools, withPipeline, admitsAsRows) {
  const STUDIED = ['enrolled', 'graduated'];
  const isJourney = (e) => !e.status || STUDIED.includes((e.status || '').toLowerCase());
  const dkey = (e) => e.startDate || e.endDate || e.decisionDate || e.appliedDate || '';
  const journey = items.filter(isJourney).sort((a, b) => dkey(b).localeCompare(dkey(a)));
  const admits = items.filter(e => !isJourney(e)).sort((a, b) => (b.decisionDate || b.appliedDate || '').localeCompare(a.decisionDate || a.appliedDate || ''));

  const groupHead = (ico, tone, title, sub) => `<div class="edu-group-h">
    <span class="edu-group-ic t-${tone}"><i class="bi bi-${ico}"></i></span>
    <div><b>${title}</b><small>${sub}</small></div></div>`;

  let html = withPipeline ? admissionsPipeline(items) : '';
  if (journey.length) {
    html += `<div class="edu-group">${groupHead('mortarboard-fill', 'primary', 'My Academic Journey', "Where I've studied &amp; study now")}
      <div class="edu-timeline">${journey.map(e => educationTimelineHtml(e, withTools)).join('')}</div></div>`;
  }
  if (admits.length) {
    const inner = admitsAsRows
      ? `<div class="edu-rows">${admits.map(e => educationRowHtml(e, withTools)).join('')}</div>`
      : `<div class="gal-grid gal-grid--4">${admits.map(e => educationCardHtml(e, badge, withTools)).join('')}</div>`;
    html += `<div class="edu-group">${groupHead('envelope-paper-fill', 'green', 'Admissions &amp; Offers', 'Where I got in — click any for details')}${inner}</div>`;
  }
  return html;
}

/* Academic profile block — the owner's current university / department / major
   / degree, shown at the top of the Education section on the portfolio (this is
   the info-row design that used to live under "About"). */
function academicProfileBlock(p) {
  const rows = [
    ['mortarboard-fill', 'University', p.university],
    ['building', 'Department', p.department],
    ['cpu-fill', 'Major', p.major],
    ['award-fill', 'Degree', p.degree]
  ].filter(([, , v]) => v);
  if (!rows.length) return '';
  return `<div class="edu-group">
    <div class="edu-group-h"><span class="edu-group-ic t-primary"><i class="bi bi-person-vcard-fill"></i></span>
      <div><b>Academic profile</b><small>My field, department &amp; degree right now</small></div></div>
    <div class="pf-info-grid">${rows.map(([ico, label, v]) => `
      <div class="pf-info-row"><span class="pf-info-ico"><i class="bi bi-${ico}"></i></span>
        <div><small>${label}</small><b>${escapeHtml(v)}</b></div></div>`).join('')}</div>
  </div>`;
}

/* ACHIEVEMENT card — placement first (big & bold), then the title beneath it
   (smaller), then "By: issuer", a divider, then the rest. The placement is
   plain text (never a clipped chip) so it's always fully readable. When no
   placement was entered (older records typed into the description), the title
   is the headline instead. */
function achievementCardHtml(a, photoBadge, withTools) {
  const hasPlace = !!a.position;
  return `
  <div class="gal-card ach-card pf-clickable" data-detail="achievements:${a.id}">
    <div class="gc-media">${mediaCollage(a, typeIcon(a.category) || 'trophy-fill')}${photoBadge ? photoBadge(a) : ''}${a.featured ? '<span class="pf-feat-badge"><i class="bi bi-star-fill"></i>Portfolio</span>' : ''}</div>
    <div class="gc-body">
      <div class="d-flex align-items-center gap-2 mb-1">
        <span class="chip t-${statusTone(a.category)}">${escapeHtml(a.category || 'Achievement')}</span>
        <small class="text-faint num ms-auto">${fmtDate(a.date)}</small>
      </div>
      ${hasPlace
        ? `<b class="ach-title">${escapeHtml(a.position)}</b><div class="ach-subtitle">${escapeHtml(a.title)}</div>`
        : `<b class="ach-title">${escapeHtml(a.title)}</b>`}
      ${a.issuer ? `<div class="ach-by"><span>By</span>${escapeHtml(a.issuer)}</div>` : ''}
      ${(a.competition || a.description) ? `<hr class="ach-div">` : ''}
      ${a.competition ? `<div class="ach-comp"><i class="bi bi-trophy-fill"></i><span>${escapeHtml(a.competition)}</span></div>` : ''}
      ${a.description ? `<p class="ach-desc">${escapeHtml(mdStrip(a.description))}</p>` : ''}
      <div class="ach-foot">
        <span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span>
        ${a.certLink ? `<a class="btn btn-ghost btn-sm" title="Certificate" href="${escapeHtml(a.certLink)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="bi bi-patch-check"></i></a>` : ''}
        ${withTools ? cardFootTools('achievements', a.id) : ''}
      </div>
    </div>
  </div>`;
}

/* ---------- ACHIEVEMENTS (gallery) ---------- */
function initAchievements() {
  const host = document.getElementById('achHost');
  const draw = () => {
    const items = DB.getAll('achievements');
    if (!items.length) { host.innerHTML = emptyState('trophy', 'No achievements yet', 'Showcase competitions, awards, certifications and leadership roles.', 'Add achievement', () => openEntityModal('achievements', null, draw), true); return; }
    host.innerHTML = `<div class="gal-grid gal-grid--4">${items.map(a => achievementCardHtml(a, galPhotoBadge, true)).join('')}</div>`;
    host.onclick = portfolioDetailDelegate;
  };
  document.getElementById('achAdd').onclick = () => openEntityModal('achievements', null, draw);
  draw();
}

/* ---------- TRAINING & CERTIFICATION ---------- */
function initTraining() {
  const host = document.getElementById('trainHost');
  const draw = () => {
    const items = DB.getAll('training');
    if (!items.length) { host.innerHTML = emptyState('mortarboard', 'No training yet', 'Add courses, certifications, workshops and bootcamps — their skills flow into your portfolio.', 'Add training', () => openEntityModal('training', null, draw), true); return; }
    const photoBadge = (item) => {
      const np = collectImages(item).length, nf = collectFiles(item).length;
      return `${np ? `<span class="pf-photo-count"><i class="bi bi-images"></i>${np}</span>` : ''}${nf ? `<span class="pf-photo-count file"><i class="bi bi-paperclip"></i>${nf}</span>` : ''}`;
    };
    host.innerHTML = `<div class="gal-grid gal-grid--4">${items.map(t => {
      const meta = [t.issuer, t.length].filter(Boolean).map(escapeHtml).join(' · ');
      const skills = Array.isArray(t.skills) ? t.skills : [];
      return `
      <div class="gal-card ach-card pf-clickable" data-detail="training:${t.id}">
        <div class="gc-media">${mediaCollage(t, 'mortarboard-fill')}${photoBadge(t)}${t.featured ? '<span class="pf-feat-badge"><i class="bi bi-star-fill"></i>Portfolio</span>' : ''}</div>
        <div class="gc-body">
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="chip t-${statusTone(t.type)}">${escapeHtml(t.type || 'Training')}</span>
            <small class="text-faint num ms-auto">${fmtDate(t.date)}</small>
          </div>
          <b class="ach-title">${escapeHtml(t.name)}</b>
          ${meta ? `<div class="ach-meta">${meta}</div>` : ''}
          ${skills.length ? `<div class="ach-tags">${skills.slice(0, 4).map(s => `<span class="chip chip-mini">${escapeHtml(s)}</span>`).join('')}${skills.length > 4 ? `<span class="chip chip-mini">+${skills.length - 4}</span>` : ''}</div>` : (t.description ? `<p class="ach-desc">${escapeHtml(mdStrip(t.description))}</p>` : '')}
          <div class="ach-foot">
            <span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span>
            <span class="ach-tools">
              ${t.certLink ? `<a class="btn btn-ghost btn-sm" title="Certificate" href="${escapeHtml(t.certLink)}" target="_blank" rel="noopener"><i class="bi bi-patch-check"></i></a>` : ''}
              <button class="btn btn-ghost btn-sm owner-only" title="Edit" onclick="event.stopPropagation();openEntityModal('training','${t.id}')"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-ghost btn-sm text-danger owner-only" title="Delete" onclick="event.stopPropagation();confirmDelete('training','${t.id}')"><i class="bi bi-trash3"></i></button>
            </span>
          </div>
        </div>
      </div>`; }).join('')}</div>`;
    host.onclick = portfolioDetailDelegate;
  };
  document.getElementById('trainAdd').onclick = () => openEntityModal('training', null, draw);
  draw();
}

/* ---------- SOCIAL ACTIVITIES / VOLUNTEERING ---------- */
function initVolunteering() {
  const host = document.getElementById('volHost');
  const draw = () => {
    const items = DB.getAll('volunteering');
    if (!items.length) { host.innerHTML = emptyState('heart', 'No social activities yet', 'Add volunteering and community work — your role, cause, impact and the skills you used.', 'Add activity', () => openEntityModal('volunteering', null, draw), true); return; }
    host.innerHTML = `<div class="gal-grid gal-grid--4">${items.map(v => volCardHtml(v, galPhotoBadge, true)).join('')}</div>`;
    host.onclick = portfolioDetailDelegate;
  };
  document.getElementById('volAdd').onclick = () => openEntityModal('volunteering', null, draw);
  draw();
}

/* ---------- CONTACTS ---------- */
function initContacts() {
  const host = document.getElementById('contactHost');
  const draw = () => {
    const items = DB.getAll('contacts');
    if (!items.length) { host.innerHTML = emptyState('person-rolodex', 'No contacts yet', 'Keep professors, mentors, alumni and industry contacts in one place.', 'Add contact', () => openEntityModal('contacts', null, draw), true); return; }
    host.innerHTML = `<div class="gal-grid">${items.map(c => `
      <div class="card card-pad card-glow">
        <div class="d-flex align-items-center gap-3 mb-2">
          <div class="av" style="width:46px;height:46px;border-radius:12px;background:var(--primary-soft);color:var(--primary-700);display:grid;place-items:center;font-weight:700;font-family:var(--font-display)">${initials(c.name)}</div>
          <div class="min-w-0"><b style="font-size:14.5px">${escapeHtml(c.name)}</b><div class="text-soft" style="font-size:12.5px">${escapeHtml(c.designation || '')}${c.organization ? ' · ' + escapeHtml(c.organization) : ''}</div></div>
        </div>
        ${c.type ? `<span class="chip chip-outline mb-2 d-inline-flex">${escapeHtml(c.type)}</span>` : ''}
        <div class="stack-contact" style="font-size:13px">
          ${c.email ? `<div class="text-soft"><i class="bi bi-envelope me-2"></i><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>` : ''}
          ${c.phone ? `<div class="text-soft"><i class="bi bi-telephone me-2"></i>${escapeHtml(c.phone)}</div>` : ''}
          ${c.linkedin ? `<div class="text-soft"><i class="bi bi-linkedin me-2"></i><a href="${escapeHtml(c.linkedin)}" target="_blank" rel="noopener">Profile</a></div>` : ''}
        </div>
        <div class="d-flex gap-2 mt-3 owner-only">
          <button class="btn btn-ghost btn-sm" onclick="openEntityModal('contacts','${c.id}')"><i class="bi bi-pencil me-1"></i>Edit</button>
          <button class="btn btn-ghost btn-sm text-danger" onclick="confirmDelete('contacts','${c.id}')"><i class="bi bi-trash3"></i></button>
        </div>
      </div>`).join('')}</div>`;
  };
  document.getElementById('contactAdd').onclick = () => openEntityModal('contacts', null, draw);
  draw();
}

/* photo/file count badge shared by the gallery pages */
function galPhotoBadge(item) {
  const np = collectImages(item).length, nf = collectFiles(item).length;
  return `${np ? `<span class="pf-photo-count"><i class="bi bi-images"></i>${np}</span>` : ''}${nf ? `<span class="pf-photo-count file"><i class="bi bi-paperclip"></i>${nf}</span>` : ''}`;
}

/* ---------- RESEARCH HUB ---------- */
function initResearch() {
  const host = document.getElementById('researchHost');
  const draw = () => {
    const items = DB.getAll('research');
    if (!items.length) { host.innerHTML = emptyState('lightbulb', 'No research ideas yet', 'Capture problem statements, topics, aspects, methods and references.', 'Add research idea', () => openEntityModal('research', null, draw), true); return; }
    host.innerHTML = `<div class="gal-grid gal-grid--4">${items.map(r => researchCardHtml(r, galPhotoBadge, true)).join('')}</div>`;
    host.onclick = portfolioDetailDelegate;
  };
  document.getElementById('researchAdd').onclick = () => openEntityModal('research', null, draw);
  draw();
}

/* ---------- PROJECTS ---------- */
function initProjects() {
  const host = document.getElementById('projectHost');
  const draw = () => {
    const items = DB.getAll('projects');
    if (!items.length) { host.innerHTML = emptyState('diagram-3', 'No projects yet', 'Track project ideas and active builds with their tech stack.', 'Add project', () => openEntityModal('projects', null, draw), true); return; }
    host.innerHTML = `<div class="gal-grid gal-grid--4">${items.map(p => projectCardHtml(p, galPhotoBadge, true)).join('')}</div>`;
    host.onclick = portfolioDetailDelegate;
  };
  document.getElementById('projectAdd').onclick = () => openEntityModal('projects', null, draw);
  draw();
}

/* Creative: a horizontal "admissions pipeline" — at a glance, how many
   applications are out, how many offers landed, and where you enrolled.
   Counts cascade (an Enrolled record also counts as an Offer), so it reads
   like a funnel from "applied" down to "enrolled / graduated". */
function admissionsPipeline(items) {
  const has = (st, list) => items.filter(e => list.includes((e.status || '').toLowerCase())).length;
  const offers = has('offer', ['offer received', 'admitted', 'enrolled', 'graduated']);
  const stages = [
    ['mortarboard-fill', 'Institutions', items.length, 'primary'],
    ['send-fill', 'Applications', items.filter(e => e.appliedDate || ['applied', 'under review', 'interviewing', 'offer received', 'admitted', 'waitlisted', 'deferred', 'rejected', 'declined', 'enrolled', 'graduated'].includes((e.status || '').toLowerCase())).length, 'blue'],
    ['envelope-paper-fill', 'Offers received', offers, 'amber'],
    ['check-circle-fill', 'Admitted / Enrolled', has('', ['admitted', 'enrolled', 'graduated']), 'green'],
    ['patch-check-fill', 'Graduated', has('grad', ['graduated']), 'green']
  ];
  return `<div class="edu-pipeline">${stages.map(([ico, label, n, tone]) => `
    <div class="edu-pl-stage">
      <span class="edu-pl-ico t-${tone}"><i class="bi bi-${ico}"></i></span>
      <div><div class="edu-pl-n num">${n}</div><div class="edu-pl-l">${label}</div></div>
    </div>`).join('<span class="edu-pl-sep"><i class="bi bi-chevron-right"></i></span>')}</div>`;
}

/* ---------- EDUCATION (academic journey + admissions tracker) ---------- */
function initEducation() {
  const host = document.getElementById('eduHost');
  const draw = () => {
    const items = DB.getAll('education');
    if (!items.length) { host.innerHTML = emptyState('mortarboard', 'No education added yet', 'Add your schools, colleges and universities. Places you studied appear as a timeline; places you got into (offers & admissions) appear as a showcase grid.', 'Add education', () => openEntityModal('education', null, draw), true); return; }
    host.innerHTML = educationGroups(items, galPhotoBadge, true, true);
    host.onclick = portfolioDetailDelegate;
  };
  document.getElementById('eduAdd').onclick = () => openEntityModal('education', null, draw);
  draw();
}

/* ---------- CATEGORY MANAGER ---------- */
/* Editable lists that feed every dropdown across the system. */
const CATEGORY_GROUPS = [
  { key: 'opportunityTypes', label: 'Opportunity Types', icon: 'compass' },
  { key: 'subTypes', label: 'Sub Types', icon: 'tags' },
  { key: 'statuses', label: 'Opportunity Statuses', icon: 'flag' },
  { key: 'priorities', label: 'Priorities', icon: 'exclamation-diamond' },
  { key: 'countries', label: 'Countries', icon: 'globe' },
  { key: 'fundingTypes', label: 'Funding Types', icon: 'cash-coin' },
  { key: 'taskCategories', label: 'Task Categories', icon: 'list-task' },
  { key: 'taskStatuses', label: 'Task Statuses (board columns)', icon: 'kanban' },
  { key: 'documentCategories', label: 'Document Categories', icon: 'folder' },
  { key: 'documentStatuses', label: 'Document Statuses', icon: 'file-check' },
  { key: 'projectStatuses', label: 'Project Statuses', icon: 'diagram-3' },
  { key: 'contactTypes', label: 'Contact Types', icon: 'person-rolodex' },
  { key: 'achievementCategories', label: 'Achievement Categories', icon: 'trophy' }
];
function initCategories() {
  const host = document.getElementById('catHost');
  const draw = () => {
    host.innerHTML = `<div class="gal-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${CATEGORY_GROUPS.map(g => `
      <div class="card card-pad" data-group="${g.key}">
        <div class="d-flex align-items-center gap-2 mb-3"><span class="stat-ico t-primary"><i class="bi bi-${g.icon}"></i></span><b>${g.label}</b></div>
        <div class="d-flex flex-wrap gap-2 mb-3">
          ${CATS(g.key).map((v, i) => `<span class="chip chip-outline" style="padding-right:4px">${escapeHtml(v)}
            <button class="btn p-0 ms-1" style="line-height:0;color:var(--text-faint)" onclick="removeCat('${g.key}',${i})" title="Remove"><i class="bi bi-x"></i></button></span>`).join('') || '<span class="text-faint" style="font-size:12px">No items.</span>'}
        </div>
        <div class="input-group">
          <input type="text" class="form-control" placeholder="Add new…" id="add-${g.key}" style="border-radius:10px 0 0 10px;border:1px solid var(--line)">
          <button class="btn btn-soft" onclick="addCat('${g.key}')" style="border-radius:0 10px 10px 0"><i class="bi bi-plus-lg"></i></button>
        </div>
      </div>`).join('')}</div>`;
    host.querySelectorAll('input[id^="add-"]').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') addCat(inp.id.replace('add-', '')); }));
  };
  window.addCat = (key) => {
    if (!Security.guard('add categories')) return;
    const inp = document.getElementById('add-' + key);
    const v = inp.value.trim();
    if (!v) return;
    if (CATS(key).includes(v)) { toast('That value already exists.', 'err'); return; }
    DB.data.categories[key].push(v); DB.save(); toast('Added.', 'ok'); draw();
  };
  window.removeCat = (key, i) => {
    if (!Security.guard('remove categories')) return;
    DB.data.categories[key].splice(i, 1); DB.save(); toast('Removed.', 'ok'); draw();
  };
  draw();
}

/* ---------- PROFILE / PORTFOLIO (Digital CV) ---------- */
function initProfile() {
  const p = DB.data.profile;
  const opps = DB.getAll('opportunities');
  const projects = DB.getAll('projects');
  const research = DB.getAll('research');
  const wins = opps.filter(o => ['Won', 'Accepted', 'Completed'].includes(o.status));
  const stats = {
    opportunities: opps.length,
    applied: opps.filter(o => !['New', 'Researching'].includes(o.status)).length,
    wins: wins.length,
    projects: projects.length,
    research: research.length,
    training: DB.getAll('training').length,
    education: DB.getAll('education').length
  };

  // hero + about
  const experience = Array.isArray(p.experience) ? p.experience : [];
  const current = experience.find(e => e.current);
  document.getElementById('pfName').textContent = p.name;
  document.getElementById('pfHeadline').textContent = p.headline || '';
  document.getElementById('pfBio').textContent = p.bio || '';
  document.getElementById('pfPhoto').innerHTML = p.photo ? `<img src="${escapeHtml(imgSrc(p.photo))}" alt="${escapeHtml(p.name)}">` : initials(p.name);
  document.getElementById('pfMeta').innerHTML = `${escapeHtml(p.degree || '')}${p.university ? ' · ' + escapeHtml(p.university) : ''}`;
  const eyebrowEl = document.querySelector('.pf-hero .eyebrow');
  if (eyebrowEl) eyebrowEl.textContent = p.eyebrow || 'Digital CV & Portfolio';
  // current role badge under the headline
  const roleEl = document.getElementById('pfCurrentRole');
  if (roleEl) roleEl.innerHTML = current
    ? `<span class="pf-role-badge"><i class="bi bi-briefcase-fill me-1"></i>${escapeHtml(current.role)}${current.company ? ' · ' + escapeHtml(current.company) : ''}</span>` : '';

  // skills + interests
  // Skills = profile skills + every skill gained from training & social work
  // (deduped, case-insensitive). Training/volunteering skills flow in here
  // automatically so the portfolio stays in sync with what was logged.
  const skillSet = new Map();
  const addSkills = (arr) => (arr || []).forEach(s => { const k = String(s).trim().toLowerCase(); if (k && !skillSet.has(k)) skillSet.set(k, String(s).trim()); });
  addSkills(p.skills);
  DB.getAll('training').forEach(t => addSkills(t.skills));
  DB.getAll('volunteering').forEach(v => addSkills(v.skills));
  DB.getAll('research').forEach(r => addSkills(r.skills));
  document.getElementById('pfSkills').innerHTML = [...skillSet.values()].map(s => `<span class="chip t-primary">${escapeHtml(s)}</span>`).join('');
  document.getElementById('pfInterests').innerHTML = (p.interests || []).map(s => `<span class="chip chip-outline">${escapeHtml(s)}</span>`).join('');

  // hero social buttons
  const heroSocial = document.getElementById('pfSocial');
  if (heroSocial) heroSocial.innerHTML = socialLinks(p)
    .map(l => `<a class="pf-soc" href="${escapeHtml(l.href)}" target="_blank" rel="noopener"><i class="bi bi-${l.ico}"></i><span>${l.label}</span></a>`).join('');

  // "Beyond the work" — the person behind the portfolio + how to reach me.
  // Academic info has moved to the Education section; this keeps the human
  // facts (where I am, languages, what I'm into right now) and contact.
  const aboutEl = document.getElementById('pfAbout');
  if (aboutEl) {
    const langs = Array.isArray(p.languages) ? p.languages.join(', ') : (p.languages || '');
    const rows = [
      ['geo-alt-fill', 'Based in', p.location],
      ['translate', 'Languages', langs],
      ['lightning-charge-fill', 'Currently', p.currentFocus],
      ['compass-fill', 'Open to', p.availability],
      ['whatsapp', 'WhatsApp', p.whatsapp],
      ['envelope-fill', 'Email', p.email],
      ['telephone-fill', 'Phone', p.phone]
    ].filter(([, , v]) => v);
    aboutEl.innerHTML = rows.map(([ico, label, v]) => `
      <div class="pf-info-row">
        <span class="pf-info-ico"><i class="bi bi-${ico}"></i></span>
        <div><small>${label}</small><b>${escapeHtml(v)}</b></div>
      </div>`).join('') || '<p class="text-soft">Add a few personal details from Edit.</p>';
  }

  // stats row — each card is clickable and opens the list behind the number
  const statEl = document.getElementById('pfStats');
  statEl.innerHTML = [
    ['Opportunities', stats.opportunities, 'opportunities'], ['Applied', stats.applied, 'applied'], ['Wins', stats.wins, 'wins'],
    ['Education', stats.education, 'education'], ['Projects', stats.projects, 'projects'], ['Research', stats.research, 'research'], ['Training', stats.training, 'training']
  ].map(([l, v, k]) => `<button type="button" class="pf-stat" data-stat="${k}"><div class="v">${v}</div><div class="l">${l}</div><span class="pf-stat-cue"><i class="bi bi-arrow-right-short"></i></span></button>`).join('');
  statEl.querySelectorAll('[data-stat]').forEach(b => b.onclick = () => openStatList(b.dataset.stat));

  // experience timeline
  const expEl = document.getElementById('pfExperience');
  if (expEl) expEl.innerHTML = experience.length ? experience.map(e => `
    <div class="pf-exp">
      <div class="pf-exp-dot"></div>
      <div class="pf-exp-body">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <b>${escapeHtml(e.role || '')}</b>
          ${e.current ? '<span class="chip t-green" style="font-size:11px"><span class="dot"></span>Current</span>' : ''}
        </div>
        <div class="pf-exp-meta">${escapeHtml(e.company || '')}${e.location ? ' · ' + escapeHtml(e.location) : ''}</div>
        ${(e.start || e.end || e.current) ? `<div class="pf-exp-dates num">${escapeHtml(e.start || '')}${(e.start && (e.end || e.current)) ? ' — ' : ''}${e.current ? 'Present' : escapeHtml(e.end || '')}</div>` : ''}
        ${e.summary ? `<p class="pf-exp-summary">${escapeHtml(e.summary)}</p>` : ''}
      </div>
    </div>`).join('') : '<p class="text-soft">No experience added yet.</p>';

  // Owner-only edit/delete controls for a portfolio card. `initProfile`
  // is passed as the after-save / after-delete callback so the page
  // refreshes in place. Hidden from visitors by the `.owner-only` class.
  const cardTools = (entity, id) => `
    <div class="pf-tools owner-only">
      <button title="Edit" onclick="event.stopPropagation();openEntityModal('${entity}','${id}', initProfile)"><i class="bi bi-pencil"></i></button>
      <button class="del" title="Delete" onclick="event.stopPropagation();confirmDelete('${entity}','${id}', initProfile)"><i class="bi bi-trash3"></i></button>
    </div>`;

  // little badges showing how many photos / files a card carries
  const photoCount = (item) => (item.image ? 1 : 0) + (Array.isArray(item.gallery) ? item.gallery.length : 0) + (Array.isArray(item.photos) ? item.photos.length : 0);
  const fileCount = (item) => (Array.isArray(item.files) ? item.files.length : 0);
  const photoBadge = (item) => {
    const np = photoCount(item), nf = fileCount(item);
    return `${np ? `<span class="pf-photo-count"><i class="bi bi-images"></i>${np}</span>` : ''}${nf ? `<span class="pf-photo-count file"><i class="bi bi-paperclip"></i>${nf}</span>` : ''}`;
  };
  const coverOf = (item) => item.image || (Array.isArray(item.gallery) && item.gallery[0]) || (Array.isArray(item.photos) && item.photos[0] && item.photos[0].data) || '';
  // Portfolio media badge = photo/file counts + owner edit/delete overlay,
  // so public showcase cards reuse the SAME compact builders as the manage pages.
  const pfBadge = (entity) => (item) => `${photoBadge(item)}${cardTools(entity, item.id)}`;

  // Featured selection: show only items the owner marked "Show on portfolio".
  // If NONE are marked in a collection, fall back to showing them all so the
  // portfolio is never empty by default.
  const featured = (list, max) => {
    const flagged = list.filter(x => x.featured);
    const out = flagged.length ? flagged : list;
    return (max && !flagged.length) ? out.slice(0, max) : out;
  };

  // showcase: achievements
  document.getElementById('pfAchievements').innerHTML =
    featured(DB.getAll('achievements'), 6).map(a => achievementCardHtml(a, pfBadge('achievements'), false)).join('')
    || '<p class="text-soft">No achievements to show yet.</p>';

  // showcase: training & certifications
  const trainEl = document.getElementById('pfTraining');
  if (trainEl) trainEl.innerHTML = featured(DB.getAll('training'), 6).map(t => {
    const skills = Array.isArray(t.skills) ? t.skills : [];
    return `
    <div class="gal-card ach-card pf-clickable" data-detail="training:${t.id}">
      <div class="gc-media">${mediaCollage(t, 'mortarboard-fill')}${photoBadge(t)}${cardTools('training', t.id)}</div>
      <div class="gc-body">
        <div class="d-flex align-items-center gap-2 mb-1"><span class="chip t-${statusTone(t.type)}">${escapeHtml(t.type || 'Training')}</span><small class="text-faint num ms-auto">${fmtDate(t.date)}</small></div>
        <b class="ach-title">${escapeHtml(t.name)}</b>
        ${t.issuer ? `<div class="ach-meta">${escapeHtml(t.issuer)}</div>` : ''}
        ${skills.length ? `<div class="ach-tags">${skills.slice(0, 4).map(s => `<span class="chip chip-mini">${escapeHtml(s)}</span>`).join('')}${skills.length > 4 ? `<span class="chip chip-mini">+${skills.length - 4}</span>` : ''}</div>` : ''}
        <div class="ach-foot"><span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span></div>
      </div>
    </div>`; }).join('') || '<p class="text-soft">No training to show yet.</p>';

  // wins & recognition (won / accepted / completed opportunities)
  const winsEl = document.getElementById('pfWins');
  if (winsEl) { const w = featured(wins); winsEl.innerHTML = w.length ? w.map(o => `
    <div class="pf-win pf-clickable" data-detail="opportunities:${o.id}">
      ${collectImages(o).length
        ? `<span class="pf-win-ico pf-win-thumb"><img src="${escapeHtml(imgSrc(collectImages(o)[0]))}" loading="lazy" alt=""></span>`
        : `<span class="pf-win-ico t-green"><i class="bi bi-${typeIcon(o.type)}"></i></span>`}
      <div class="flex-grow-1">
        <b>${escapeHtml(o.name)}</b>
        <small>${escapeHtml(o.organizer || '')}${o.country ? ' · ' + escapeHtml(o.country) : ''}</small>
      </div>
      <div class="pf-win-meta">
        <span class="chip chip-outline">${escapeHtml(o.type || '')}</span>
        ${o.eventDate || o.deadline ? `<small class="num text-faint">${fmtDate(o.eventDate || o.deadline)}</small>` : ''}
        ${photoBadge(o)}
      </div>
      ${cardTools('opportunities', o.id)}
    </div>`).join('') : '<p class="text-soft">No wins recorded yet.</p>'; }

  // showcase: education — split into "My Academic Journey" (timeline) and
  // "Admissions & Offers" (grid), same two-part layout as the manage page.
  const eduEl = document.getElementById('pfEducation');
  if (eduEl) {
    const eds = featured(DB.getAll('education'));
    // academic profile (univ/dept/major/degree) sits up top, then my journey
    // timeline, then "got in" admissions as compact rows.
    eduEl.innerHTML = academicProfileBlock(p)
      + (eds.length ? educationGroups(eds, galPhotoBadge, true, false, true) : '<p class="text-soft">No education entries yet.</p>');
  }

  // showcase: projects (ongoing first, then the rest)
  const ordered = featured([...projects].sort((a, b) =>
    (a.status === 'Completed' ? 1 : 0) - (b.status === 'Completed' ? 1 : 0)));
  document.getElementById('pfProjects').innerHTML =
    ordered.map(pr => projectCardHtml(pr, pfBadge('projects'), false, true)).join('') || '<p class="text-soft">No projects to show yet.</p>';

  // research
  const resEl = document.getElementById('pfResearch');
  if (resEl) { const rs = featured(research); resEl.innerHTML = rs.length
    ? rs.map(r => researchCardHtml(r, pfBadge('research'), false, true)).join('')
    : '<p class="text-soft">No research to show yet.</p>'; }

  // showcase: social activities / volunteering
  const volEl = document.getElementById('pfVolunteering');
  if (volEl) volEl.innerHTML = featured(DB.getAll('volunteering'), 6)
    .map(v => volCardHtml(v, pfBadge('volunteering'), false)).join('') || '<p class="text-soft">No social activities to show yet.</p>';

  // make portfolio cards open a detail view (ignoring clicks on owner tools / links)
  ['pfAchievements', 'pfTraining', 'pfEducation', 'pfWins', 'pfProjects', 'pfResearch', 'pfVolunteering'].forEach(cid => {
    const c = document.getElementById(cid);
    if (c) c.onclick = portfolioDetailDelegate;
  });

  // references / testimonials
  const refsEl = document.getElementById('pfReferences');
  const refs = p.references || [];
  if (refsEl) refsEl.innerHTML = refs.length ? refs.map(r => `
    <div class="pf-ref">
      <div class="pf-ref-quote"><i class="bi bi-quote"></i>${escapeHtml(r.quote || '')}</div>
      <div class="pf-ref-who">
        <div class="pf-ref-av">${r.photo ? `<img src="${escapeHtml(imgSrc(r.photo))}" alt="${escapeHtml(r.name)}">` : initials(r.name)}</div>
        <div class="min-w-0">
          <b>${escapeHtml(r.name)}</b>
          <small>${escapeHtml(r.position || '')}${r.institute ? ' · ' + escapeHtml(r.institute) : ''}</small>
        </div>
      </div>
    </div>`).join('') : '<p class="text-soft">No references added yet.</p>';

  // contact section
  const contactEl = document.getElementById('pfContact');
  if (contactEl) {
    const links = socialLinks(p);
    contactEl.innerHTML = links.length
      ? links.map(l => `<a class="pf-soc lg" href="${escapeHtml(l.href)}" target="_blank" rel="noopener"><i class="bi bi-${l.ico}"></i><span>${l.label}</span></a>`).join('')
      : '<p class="text-soft">No contact links added yet.</p>';
  }

  // owner-only edit hooks
  const editBtn = document.getElementById('pfEdit');
  if (editBtn) editBtn.onclick = openProfileEditor;
  const beyondBtn = document.getElementById('pfEditBeyond');
  if (beyondBtn) beyondBtn.onclick = openProfileEditor;
  const refBtn = document.getElementById('pfManageRefs');
  if (refBtn) refBtn.onclick = openReferencesEditor;
  const expBtn = document.getElementById('pfManageExp');
  if (expBtn) expBtn.onclick = openExperienceEditor;

  // owner-only "Add" buttons per section (open the same guarded modals,
  // then re-render the portfolio in place).
  const addHooks = {
    pfAddWin: 'opportunities', pfAddAch: 'achievements', pfAddTrain: 'training',
    pfAddEdu: 'education', pfAddProj: 'projects', pfAddRes: 'research', pfAddVol: 'volunteering'
  };
  Object.entries(addHooks).forEach(([id, entity]) => {
    const b = document.getElementById(id);
    if (b) b.onclick = () => openEntityModal(entity, null, initProfile);
  });
}

function openProfileEditor() {
  if (!Security.guard('edit the profile')) return;
  const p = DB.data.profile;
  document.getElementById('entityModal')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="entityModal" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">Edit profile</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body"><form id="pfForm" class="form-grid">
      <div class="field col-span">
        <label>Profile photo</label>
        ${p.photo ? `<div class="pf-photo-edit"><img src="${escapeHtml(p.photo)}" alt="current photo"><label class="fc-remove"><input type="checkbox" name="photoRemove"> remove</label></div>` : ''}
        <input type="file" name="photoFile" accept="image/*" class="file-input">
        <input name="photo" class="mt-2" placeholder="…or paste an image URL" value="${escapeHtml(p.photo && p.photo.startsWith('data:') ? '' : (p.photo || ''))}">
        <small class="text-faint" style="font-size:11px">Upload from your device or paste a URL. Max ${fmtBytes(MAX_UPLOAD_BYTES)}.</small>
      </div>
      <div class="field col-span"><label>Full name</label><input name="name" value="${escapeHtml(p.name)}"></div>
      <div class="field col-span"><label>Eyebrow (small label above name)</label><input name="eyebrow" value="${escapeHtml(p.eyebrow || '')}" placeholder="Digital CV &amp; Portfolio"></div>
      <div class="field col-span"><label>Headline</label><input name="headline" value="${escapeHtml(p.headline || '')}"></div>
      <div class="field col-span"><label>Biography</label><textarea name="bio">${escapeHtml(p.bio || '')}</textarea></div>

      <div class="field col-span"><div class="section-title mb-0 mt-1">Academic</div></div>
      <div class="field"><label>Degree</label><input name="degree" value="${escapeHtml(p.degree || '')}"></div>
      <div class="field"><label>University</label><input name="university" value="${escapeHtml(p.university || '')}"></div>
      <div class="field"><label>Department</label><input name="department" value="${escapeHtml(p.department || '')}"></div>
      <div class="field"><label>Major</label><input name="major" value="${escapeHtml(p.major || '')}"></div>

      <div class="field col-span"><div class="section-title mb-0 mt-1">Skills &amp; interests</div></div>
      <div class="field col-span"><label>Skills (comma separated)</label><input name="skills" value="${escapeHtml((p.skills || []).join(', '))}"></div>
      <div class="field col-span"><label>Interests (comma separated)</label><input name="interests" value="${escapeHtml((p.interests || []).join(', '))}"></div>

      <div class="field col-span"><div class="section-title mb-0 mt-1">Beyond the work <small class="text-faint" style="font-weight:500">— the personal section at the end of your portfolio</small></div></div>
      <div class="field"><label>Based in</label><input name="location" value="${escapeHtml(p.location || '')}" placeholder="City, Country"></div>
      <div class="field"><label>Languages (comma separated)</label><input name="languages" value="${escapeHtml((Array.isArray(p.languages) ? p.languages : []).join(', '))}" placeholder="Bangla (Native), English (Fluent)"></div>
      <div class="field col-span"><label>Currently</label><input name="currentFocus" value="${escapeHtml(p.currentFocus || '')}" placeholder="What you're building or learning right now"></div>
      <div class="field col-span"><label>Open to</label><input name="availability" value="${escapeHtml(p.availability || '')}" placeholder="Research, internships, collaborations…"></div>

      <div class="field col-span"><div class="section-title mb-0 mt-1">Contact &amp; social</div></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${escapeHtml(p.email || '')}"></div>
      <div class="field"><label>WhatsApp</label><input name="whatsapp" value="${escapeHtml(p.whatsapp || '')}"></div>
      <div class="field"><label>Phone</label><input name="phone" value="${escapeHtml(p.phone || '')}"></div>
      <div class="field"><label>LinkedIn URL</label><input name="linkedin" type="url" value="${escapeHtml(p.linkedin || '')}"></div>
      <div class="field"><label>Facebook URL</label><input name="facebook" type="url" value="${escapeHtml(p.facebook || '')}"></div>
      <div class="field"><label>GitHub URL</label><input name="github" type="url" value="${escapeHtml(p.github || '')}"></div>
      <div class="field"><label>Website URL</label><input name="website" type="url" value="${escapeHtml(p.website || '')}"></div>
    </form></div>
    <div class="modal-footer"><button class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary" id="pfSave"><i class="bi bi-check-lg me-1"></i>Save profile</button></div>
  </div></div></div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('entityModal');
  const modal = new bootstrap.Modal(modalEl); modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());
  document.getElementById('pfSave').onclick = async () => {
    const f = document.getElementById('pfForm');
    const btn = document.getElementById('pfSave'); btn.disabled = true;
    // Photo: a newly uploaded file wins, then a typed URL, then "remove",
    // otherwise keep the existing one.
    let photo = p.photo || '';
    try {
      const file = f.photoFile && f.photoFile.files && f.photoFile.files[0];
      const typed = f.photo.value.trim();
      if (file) {
        if (file.size > MAX_UPLOAD_BYTES) { toast(`Image too large (max ${fmtBytes(MAX_UPLOAD_BYTES)}).`, 'err'); btn.disabled = false; return; }
        photo = await readFileAsDataURL(file);
      } else if (f.photoRemove && f.photoRemove.checked) {
        photo = '';
      } else if (typed) {
        photo = typed;
      }
    } catch (e) { toast('Could not read the image.', 'err'); btn.disabled = false; return; }
    Object.assign(p, {
      name: f.name.value.trim(), eyebrow: f.eyebrow.value.trim(), headline: f.headline.value.trim(),
      degree: f.degree.value.trim(), university: f.university.value.trim(), department: f.department.value.trim(),
      major: f.major.value.trim(), photo, bio: f.bio.value.trim(),
      email: f.email.value.trim(), whatsapp: f.whatsapp.value.trim(), phone: f.phone.value.trim(),
      location: f.location.value.trim(), currentFocus: f.currentFocus.value.trim(), availability: f.availability.value.trim(),
      languages: f.languages.value.split(',').map(s => s.trim()).filter(Boolean),
      linkedin: f.linkedin.value.trim(), facebook: f.facebook.value.trim(),
      github: f.github.value.trim(), website: f.website.value.trim(),
      skills: f.skills.value.split(',').map(s => s.trim()).filter(Boolean),
      interests: f.interests.value.split(',').map(s => s.trim()).filter(Boolean)
    });
    DB.save(); toast('Profile saved.', 'ok'); btn.disabled = false; modal.hide(); initProfile();
  };
}

/* ---------- EXPERIENCE EDITOR (owner-only) ----------
   profile.experience = [{role,company,location,start,end,current,summary}].
   Edits the whole list at once, like the references editor. */
function openExperienceEditor() {
  if (!Security.guard('manage experience')) return;
  const p = DB.data.profile;
  let working = JSON.parse(JSON.stringify(p.experience || []));

  document.getElementById('entityModal')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="entityModal" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">Experience</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <p class="text-soft" style="font-size:13px">Add roles with company, dates and a short summary. Tick “current” for your present role.</p>
      <div id="expRows" class="stack-16"></div>
      <button class="btn btn-soft btn-sm mt-3" id="expAdd"><i class="bi bi-plus-lg me-1"></i>Add role</button>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary" id="expSave"><i class="bi bi-check-lg me-1"></i>Save experience</button></div>
  </div></div></div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('entityModal');
  const modal = new bootstrap.Modal(modalEl); modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());
  const rowsEl = document.getElementById('expRows');

  const rowHtml = (r, i) => `
    <div class="card card-pad exp-edit" data-i="${i}">
      <div class="d-flex align-items-center mb-2">
        <b style="font-size:13px">Role ${i + 1}</b>
        <button class="btn btn-ghost btn-sm text-danger ms-auto" data-del="${i}"><i class="bi bi-trash3"></i></button>
      </div>
      <div class="form-grid">
        <div class="field col-span"><label>Role / title</label><input data-f="role" value="${escapeHtml(r.role || '')}"></div>
        <div class="field"><label>Company</label><input data-f="company" value="${escapeHtml(r.company || '')}"></div>
        <div class="field"><label>Location</label><input data-f="location" value="${escapeHtml(r.location || '')}"></div>
        <div class="field"><label>Start (e.g. Apr 2023)</label><input data-f="start" value="${escapeHtml(r.start || '')}"></div>
        <div class="field"><label>End (blank if current)</label><input data-f="end" value="${escapeHtml(r.end || '')}"></div>
        <div class="field col-span"><label class="switch-row"><input type="checkbox" data-f="current" ${r.current ? 'checked' : ''}> <span>This is my current role</span></label></div>
        <div class="field col-span"><label>Summary</label><textarea data-f="summary">${escapeHtml(r.summary || '')}</textarea></div>
      </div>
    </div>`;

  const syncFromDom = () => rowsEl.querySelectorAll('.exp-edit').forEach(row => {
    const i = +row.dataset.i; if (!working[i]) return;
    row.querySelectorAll('[data-f]').forEach(inp => {
      working[i][inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
    });
  });
  const render = () => {
    rowsEl.innerHTML = working.length ? working.map(rowHtml).join('')
      : '<p class="text-faint" style="font-size:13px">No roles yet. Add one below.</p>';
    rowsEl.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { syncFromDom(); working.splice(+b.dataset.del, 1); render(); });
  };
  render();
  document.getElementById('expAdd').onclick = () => { syncFromDom(); working.push({ role: '', company: '', location: '', start: '', end: '', current: false, summary: '' }); render(); };
  document.getElementById('expSave').onclick = () => {
    syncFromDom();
    p.experience = working.filter(r => r.role || r.company);
    DB.save(); toast('Experience saved.', 'ok'); modal.hide(); initProfile();
  };
}

/* ---------- REFERENCES / TESTIMONIALS EDITOR (owner-only) ----------
   References live on profile.references = [{name,position,institute,photo,quote}].
   This modal edits the whole list at once: add rows, fill them, delete
   rows, then Save writes them back through the guarded DB.save(). */
function openReferencesEditor() {
  if (!Security.guard('manage references')) return;
  const p = DB.data.profile;
  let working = JSON.parse(JSON.stringify(p.references || []));

  document.getElementById('entityModal')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="entityModal" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">References &amp; testimonials</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <p class="text-soft" style="font-size:13px">Add teachers, mentors or bosses with their role, institute, photo and a short quote.</p>
      <div id="refRows" class="stack-16"></div>
      <button class="btn btn-soft btn-sm mt-3" id="refAdd"><i class="bi bi-plus-lg me-1"></i>Add reference</button>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary" id="refSave"><i class="bi bi-check-lg me-1"></i>Save references</button></div>
  </div></div></div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('entityModal');
  const modal = new bootstrap.Modal(modalEl); modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());

  const rowsEl = document.getElementById('refRows');

  const rowHtml = (r, i) => `
    <div class="card card-pad ref-edit" data-i="${i}">
      <div class="d-flex align-items-center mb-2">
        <b style="font-size:13px">Reference ${i + 1}</b>
        <button class="btn btn-ghost btn-sm text-danger ms-auto" data-del="${i}"><i class="bi bi-trash3"></i></button>
      </div>
      <div class="form-grid">
        <div class="field"><label>Name</label><input data-f="name" value="${escapeHtml(r.name || '')}"></div>
        <div class="field"><label>Position</label><input data-f="position" value="${escapeHtml(r.position || '')}"></div>
        <div class="field"><label>Institute / company</label><input data-f="institute" value="${escapeHtml(r.institute || '')}"></div>
        <div class="field"><label>Photo URL</label><input data-f="photo" value="${escapeHtml(r.photo || '')}"></div>
        <div class="field col-span"><label>Quote / what they say</label><textarea data-f="quote">${escapeHtml(r.quote || '')}</textarea></div>
      </div>
    </div>`;

  // Pull the current DOM inputs back into `working` so re-renders don't lose edits.
  const syncFromDom = () => {
    rowsEl.querySelectorAll('.ref-edit').forEach(row => {
      const i = +row.dataset.i;
      if (!working[i]) return;
      row.querySelectorAll('[data-f]').forEach(inp => { working[i][inp.dataset.f] = inp.value.trim(); });
    });
  };

  const render = () => {
    rowsEl.innerHTML = working.length ? working.map(rowHtml).join('')
      : '<p class="text-faint" style="font-size:13px">No references yet. Add one below.</p>';
    rowsEl.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      syncFromDom();
      working.splice(+b.dataset.del, 1);
      render();
    });
  };
  render();

  document.getElementById('refAdd').onclick = () => {
    syncFromDom();
    working.push({ name: '', position: '', institute: '', photo: '', quote: '' });
    render();
  };

  document.getElementById('refSave').onclick = () => {
    syncFromDom();
    p.references = working.filter(r => r.name); // drop blank rows (no name)
    DB.save(); toast('References saved.', 'ok'); modal.hide(); initProfile();
  };
}

/* ---------- STAT LIST (click a portfolio stat → see what's behind it) ----------
   Opens a modal listing the records counted by a stat card. Each row opens
   that item's detail view. Public-visible (read-only). */
function openStatList(kind) {
  const opps = DB.getAll('opportunities');
  const CFG = {
    opportunities: { title: 'Opportunities', entity: 'opportunities', icon: 'compass-fill', items: opps },
    applied: { title: 'Applied & in progress', entity: 'opportunities', icon: 'send-fill',
      items: opps.filter(o => !['New', 'Researching'].includes(o.status)) },
    wins: { title: 'Wins & recognition', entity: 'opportunities', icon: 'trophy-fill',
      items: opps.filter(o => ['Won', 'Accepted', 'Completed'].includes(o.status)) },
    projects: { title: 'Projects', entity: 'projects', icon: 'diagram-3-fill', items: DB.getAll('projects') },
    certs: { title: 'Certifications', entity: 'achievements', icon: 'patch-check-fill',
      items: DB.getAll('achievements').filter(a => a.category === 'Certification') },
    training: { title: 'Training & certifications', entity: 'training', icon: 'patch-check-fill', items: DB.getAll('training') },
    education: { title: 'Education', entity: 'education', icon: 'mortarboard-fill', items: DB.getAll('education') },
    research: { title: 'Research', entity: 'research', icon: 'lightbulb-fill', items: DB.getAll('research') }
  }[kind];
  if (!CFG) return;

  const rows = CFG.items.map(it => {
    const name = it.name || it.title || it.institution || 'Untitled';
    const sub = it.organizer || it.category || it.field || it.technologies || it.program || it.level || '';
    const meta = it.status || it.stage || (it.date ? fmtDate(it.date) : '');
    return `<button type="button" class="stat-row" data-open="${CFG.entity}:${it.id}">
      <span class="stat-row-ic"><i class="bi bi-${CFG.icon}"></i></span>
      <span class="stat-row-body"><b>${escapeHtml(name)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>
      ${meta ? `<span class="chip chip-outline">${escapeHtml(meta)}</span>` : ''}
      <i class="bi bi-chevron-right text-faint"></i>
    </button>`;
  }).join('');

  document.getElementById('entityModal')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="entityModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">
    <div class="modal-header">
      <div class="d-flex align-items-center gap-2"><span class="stat-ico"><i class="bi bi-${CFG.icon}"></i></span>
        <h5 class="modal-title">${CFG.title} <span class="text-faint num">(${CFG.items.length})</span></h5></div>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">${rows || '<p class="text-soft mb-0">Nothing here yet.</p>'}</div>
  </div></div></div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('entityModal');
  const modal = new bootstrap.Modal(modalEl); modal.show();
  let nextAction = null;
  modalEl.addEventListener('hidden.bs.modal', () => { wrap.remove(); if (nextAction) { const a = nextAction; nextAction = null; a(); } });
  modalEl.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
    const [entity, id] = b.dataset.open.split(':');
    nextAction = () => openPortfolioDetail(entity, id);
    modal.hide();
  });
}

/* Click handler shared by every portfolio card grid. Opens the read-only
   detail view unless the click landed on an owner tool, link or button. */
function portfolioDetailDelegate(e) {
  if (e.target.closest('.pf-tools') || e.target.closest('a') || e.target.closest('button')) return;
  const card = e.target.closest('[data-detail]');
  if (!card) return;
  const [entity, id] = card.dataset.detail.split(':');
  openPortfolioDetail(entity, id);
}

/* ---- helpers shared by the detail view ---- */

/* Every image for an item: cover URL + gallery URLs + uploaded photos. */
function collectImages(item) {
  return [item.image, ...(item.gallery || []), ...((item.photos || []).map(p => p && p.data))].filter(Boolean);
}
/* Uploaded files attached to an item. */
function collectFiles(item) { return Array.isArray(item.files) ? item.files : []; }

/* Normalize an image URL so it actually renders inside an <img src>.
   - Uploaded photos (data: URLs) and ordinary direct links pass through.
   - Google Drive "share" links (…/file/d/<id>/view, open?id=<id>, uc?id=<id>)
     are NOT directly embeddable, so they are rewritten to Drive's thumbnail
     endpoint which serves the actual image bytes. Set the file's sharing to
     "Anyone with the link" for this to work. */
function imgSrc(url) {
  if (typeof url !== 'string' || !url) return url || '';
  if (url.startsWith('data:')) return url;
  if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
    const m = url.match(/\/d\/([\w-]+)/) || url.match(/[?&]id=([\w-]+)/);
    if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600`;
  }
  return url;
}

/* A photo collage for a card's media area.
   Shows 1, 2 or 3 image tiles depending on how many images the item carries;
   4+ images still show 3 tiles, with a "+N" overlay on the last one to hint
   that more are revealed in the detail view. Falls back to a single centered
   icon when the item has no images at all. */
function mediaCollage(item, fallbackIcon) {
  const imgs = collectImages(item);
  if (!imgs.length) return `<i class="bi bi-${fallbackIcon}"></i>`;
  const shown = imgs.slice(0, 3);
  const extra = imgs.length - shown.length;
  const tiles = shown.map((src, i) =>
    `<span class="cc-tile"><img src="${escapeHtml(imgSrc(src))}" loading="lazy" alt="">${
      (extra && i === shown.length - 1) ? `<span class="cc-more">+${extra}</span>` : ''
    }</span>`).join('');
  return `<div class="cc-collage cc-${shown.length}">${tiles}</div>`;
}

/* A downloadable file card for an uploaded file (data URL). */
function fileCardHtml(f) {
  const ext = (f.name || '').includes('.') ? (f.name.split('.').pop() || '').toUpperCase() : '';
  return `<a class="pf-file" href="${escapeHtml(f.data)}" download="${escapeHtml(f.name || 'file')}">
    <span class="pf-file-ic"><i class="bi bi-${f._label ? 'envelope-paper' : 'file-earmark-arrow-down'}"></i></span>
    <span class="pf-file-meta"><b>${escapeHtml(f._label || f.name || 'File')}</b><small>${f._label && f.name ? escapeHtml(f.name) + ' · ' : ''}${ext ? ext + ' · ' : ''}${fmtBytes(f.size)}</small></span>
  </a>`;
}

/* Render the ordered rich-content blocks of a project / research item. */
function renderContentBlocks(blocks) {
  return (blocks || []).map(b => {
    if (b.type === 'heading') return b.text ? `<h3 class="cb-h">${escapeHtml(b.text)}</h3>` : '';
    if (b.type === 'text')    return b.text ? `<p class="cb-p">${escapeHtml(b.text)}</p>` : '';
    if (b.type === 'code')    return b.code ? `<div class="cb-code"><div class="cb-code-bar"><i class="bi bi-code-slash me-1"></i>${escapeHtml(b.lang || 'code')}</div><pre><code>${escapeHtml(b.code)}</code></pre></div>` : '';
    if (b.type === 'image') {
      return b.src ? `<figure class="cb-img"><img src="${escapeHtml(imgSrc(b.src))}" alt="${escapeHtml(b.caption || '')}" loading="lazy" data-zoom="${escapeHtml(imgSrc(b.src))}">${b.caption ? `<figcaption>${escapeHtml(b.caption)}</figcaption>` : ''}</figure>` : '';
    }
    if (b.type === 'file') {
      const href = b.data || b.url; if (!href) return '';
      return `<a class="pf-file" href="${escapeHtml(href)}" ${b.data ? `download="${escapeHtml(b.name || 'file')}"` : 'target="_blank" rel="noopener"'}>
        <span class="pf-file-ic"><i class="bi bi-paperclip"></i></span>
        <span class="pf-file-meta"><b>${escapeHtml(b.label || b.name || 'File')}</b><small>${b.size ? fmtBytes(b.size) : (b.url ? 'external link' : '')}</small></span></a>`;
    }
    return '';
  }).join('');
}

/* ---------- PORTFOLIO DETAIL (read-only "see everything") ----------
   An engaging modal: hero image → title/subtitle → abstract → body →
   rich content blocks → contributors → gallery → files → details.
   Public can view everything; the owner gets Edit + Content studio. */
function openPortfolioDetail(entity, id) {
  const item = DB.get(entity, id);
  if (!item) return;
  const rich = entity === 'projects' || entity === 'research';

  const titleOf = item.name || item.title || item.institution || 'Details';
  const join = (v) => Array.isArray(v) ? v.filter(Boolean).join(', ') : v;
  const skillsStr = join(item.skills);
  const icon = entity === 'projects' ? 'diagram-3-fill'
    : entity === 'research' ? 'lightbulb-fill'
      : entity === 'achievements' ? 'trophy-fill'
        : entity === 'training' ? 'patch-check-fill'
          : entity === 'education' ? 'mortarboard-fill'
            : entity === 'volunteering' ? 'heart-fill' : typeIcon(item.type);

  const chipsArr = entity === 'projects' ? [item.status, item.category]
    : entity === 'research' ? [item.field, item.stage, item.researchType]
      : entity === 'achievements' ? [item.category, fmtDate(item.date)]
        : entity === 'training' ? [item.type, fmtDate(item.date)]
          : entity === 'education' ? [item.level, item.status]
            : entity === 'volunteering' ? [item.cause, item.commitment, fmtDate(item.date)]
              : [item.status, item.type, item.subType];
  const chips = chipsArr.filter(c => c && c !== '—').map(c => `<span class="chip chip-outline">${escapeHtml(c)}</span>`).join('');

  const rowsArr = entity === 'projects' ? [['Technologies', item.technologies], ['Team', item.team]]
    : entity === 'research' ? [['Field', item.field], ['Topic', item.topic], ['Research type', item.researchType], ['Stage', item.stage], ['Aspects', join(item.aspects)], ['Tools & tech', join(item.technologies)], ['Methods', join(item.methods)], ['Skills', skillsStr], ['Keywords', join(item.keywords)], ['Collaborators', item.collaborators], ['Hypothesis', item.hypothesis], ['Expected outcome', item.outcome], ['References', item.references]]
      : entity === 'opportunities' ? [['Organizer', item.organizer], ['Country', item.country], ['Funding', item.fundingType], ['Deadline', fmtDate(item.deadline)], ['Event', fmtDate(item.eventDate)]]
        : entity === 'training' ? [['Issuer', item.issuer], ['Type', item.type], ['Length', item.length], ['Credential ID', item.credentialId], ['Skills', skillsStr], ['Date', fmtDate(item.date)]]
          : entity === 'education' ? [['Level', item.level], ['Program', item.program], ['Field of study', item.fieldOfStudy], ['Status', item.status], ['Location', item.location], ['Result / GPA', item.result], ['Scholarship', item.scholarship], ['Highlights', join(item.highlights)], ['Started', fmtDate(item.startDate)], ['Ended', fmtDate(item.endDate)], ['Applied', fmtDate(item.appliedDate)], ['Decision', fmtDate(item.decisionDate)]]
            : entity === 'volunteering' ? [['Role', item.role], ['Organization', item.organization], ['Cause', item.cause], ['Commitment', item.commitment], ['Hours', item.hours], ['Impact', item.impact], ['Location', item.location], ['Skills', skillsStr], ['Started', fmtDate(item.startDate)], ['Ended', fmtDate(item.date)]]
              : [['Position', item.position], ['Competition', item.competition], ['Issuer', item.issuer], ['Date', fmtDate(item.date)]];
  const rows = rowsArr.filter(([, v]) => v && v !== '—').map(([l, v]) => `<dt>${l}</dt><dd>${escapeHtml(v)}</dd>`).join('');

  const linksArr = (entity === 'achievements' || entity === 'training') ? [[item.certLink, 'Certificate', 'patch-check']]
    : entity === 'volunteering' ? [[item.orgLink, 'Organization', 'box-arrow-up-right'], ...((item.links || []).map((u, i) => [u, 'Reference ' + (i + 1), 'link-45deg']))]
      : entity === 'research' ? [[item.link, 'Publication', 'file-earmark-text']]
        : entity === 'education' ? [[item.link, 'Program page', 'box-arrow-up-right']]
          : [[item.link, entity === 'opportunities' ? 'Official page' : 'Open link', 'box-arrow-up-right']];
  const links = linksArr.filter(([href]) => href).map(([href, label, ico]) => `<a class="btn btn-soft btn-sm" href="${escapeHtml(href)}" target="_blank" rel="noopener"><i class="bi bi-${ico} me-1"></i>${label}</a>`).join('');

  const images = collectImages(item);
  // education stores the offer/admission letter as a single uploaded file —
  // surface it alongside any other attached documents in the Files section.
  const files = collectFiles(item).concat(item.offerLetter && item.offerLetter.data ? [Object.assign({ _label: 'Offer / admission letter' }, item.offerLetter)] : []);
  const hero = images[0] || '';
  const rest = images.slice(1);
  const body = item.description || item.notes || item.problem || '';
  const contributors = (Array.isArray(item.contributors) ? item.contributors : []).filter(c => c && c.name);
  const blocksHtml = renderContentBlocks(item.blocks);

  const section = (title, inner) => `<div class="pf-detail-section"><div class="section-title">${title}</div>${inner}</div>`;
  const galleryHtml = rest.length
    ? section('Gallery', `<div class="pf-detail-gallery">${rest.map((src, i) => `<button type="button" class="pf-thumb" data-i="${i + 1}"><img src="${escapeHtml(imgSrc(src))}" loading="lazy" alt=""></button>`).join('')}</div>`)
    : '';
  const filesHtml = files.length ? section('Files', `<div class="pf-files">${files.map(fileCardHtml).join('')}</div>`) : '';
  const contribHtml = contributors.length
    ? section('Contributors', `<div class="pf-contributors">${contributors.map(c => `<div class="pf-contrib"><span class="pf-contrib-av">${initials(c.name)}</span><div class="min-w-0"><b>${escapeHtml(c.name)}</b>${c.role ? `<small>${escapeHtml(c.role)}</small>` : ''}</div></div>`).join('')}</div>`)
    : '';
  const empty = !images.length && !files.length && !blocksHtml && !body && !item.abstract && !rows;

  document.getElementById('entityModal')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="entityModal" tabindex="-1"><div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable"><div class="modal-content pf-detail">
    <button type="button" class="btn-close pf-detail-x" data-bs-dismiss="modal" aria-label="Close"></button>
    ${hero ? `<button type="button" class="pf-hero-img" data-i="0"><img src="${escapeHtml(imgSrc(hero))}" alt="${escapeHtml(titleOf)}"><span class="pf-hero-zoom"><i class="bi bi-arrows-fullscreen"></i></span></button>` : ''}
    <div class="modal-body pf-detail-body">
      <div class="pf-detail-head">
        <span class="stat-ico"><i class="bi bi-${icon}"></i></span>
        <div class="min-w-0">
          <h2 class="pf-detail-title">${escapeHtml(titleOf)}</h2>
          ${item.subtitle ? `<p class="pf-detail-sub">${escapeHtml(item.subtitle)}</p>` : ''}
        </div>
      </div>
      ${chips ? `<div class="d-flex flex-wrap gap-2 mt-3 mb-1">${chips}</div>` : ''}
      ${item.abstract ? `<p class="pf-detail-abstract">${escapeHtml(item.abstract)}</p>` : ''}
      ${body ? `<div class="pf-detail-text rt-render">${mdToHtml(body)}</div>` : ''}
      ${blocksHtml ? `<div class="pf-blocks">${blocksHtml}</div>` : ''}
      ${contribHtml}
      ${galleryHtml}
      ${filesHtml}
      ${rows ? section('Details', `<dl class="kv">${rows}</dl>`) : ''}
      ${empty ? '<p class="text-faint" style="font-size:13px"><i class="bi bi-info-circle me-1"></i>No extra details added yet.</p>' : ''}
    </div>
    <div class="modal-footer">
      ${links}
      ${rich ? `<button type="button" class="btn btn-ghost owner-only" id="pfDetailStudio"><i class="bi bi-easel me-1"></i>Content studio</button>` : ''}
      <button type="button" class="btn btn-ghost owner-only" id="pfDetailEdit"><i class="bi bi-pencil me-1"></i>Edit</button>
      <button type="button" class="btn btn-primary" data-bs-dismiss="modal">Close</button>
    </div>
  </div></div></div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('entityModal');
  const modal = new bootstrap.Modal(modalEl); modal.show();

  // Chain follow-up actions to fire only AFTER this modal fully hides, so
  // bootstrap cleans up its backdrop before the next modal opens.
  let nextAction = null;
  modalEl.addEventListener('hidden.bs.modal', () => { wrap.remove(); if (nextAction) { const a = nextAction; nextAction = null; a(); } });

  const reopen = () => setTimeout(() => {
    if (document.body.dataset.page === 'profile') initProfile();
    openPortfolioDetail(entity, id);
  }, 60);

  const ed = document.getElementById('pfDetailEdit');
  if (ed) ed.onclick = () => { nextAction = () => openEntityModal(entity, id, reopen); modal.hide(); };
  const st = document.getElementById('pfDetailStudio');
  if (st) st.onclick = () => { nextAction = () => openContentStudio(entity, id, reopen); modal.hide(); };

  // lightbox: hero (data-i=0) + gallery thumbs index into the full image list
  modalEl.querySelectorAll('[data-i]').forEach(el => el.onclick = () => openLightbox(images, +el.dataset.i));
  // zoom inline content-block images
  modalEl.querySelectorAll('[data-zoom]').forEach(el => el.onclick = () => openLightbox([el.dataset.zoom], 0));
}

/* Full-screen image viewer with keyboard + arrow navigation. */
function openLightbox(photos, index) {
  if (!photos || !photos.length) return;
  let i = index || 0;
  document.getElementById('pfLightbox')?.remove();
  const box = document.createElement('div');
  box.id = 'pfLightbox';
  box.className = 'pf-lightbox';

  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
  const step = (d) => { i = (i + d + photos.length) % photos.length; render(); };
  // Capture-phase handler: when the lightbox sits on top of a bootstrap
  // modal, stopPropagation keeps Esc / arrows from reaching the modal
  // underneath (so Esc closes only the lightbox, not the detail view).
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft' && photos.length > 1) { e.stopPropagation(); step(-1); }
    else if (e.key === 'ArrowRight' && photos.length > 1) { e.stopPropagation(); step(1); }
  };
  const render = () => {
    box.innerHTML = `
      <button class="lb-close" aria-label="Close"><i class="bi bi-x-lg"></i></button>
      ${photos.length > 1 ? `<button class="lb-nav lb-prev" aria-label="Previous"><i class="bi bi-chevron-left"></i></button>` : ''}
      <img src="${escapeHtml(imgSrc(photos[i]))}" alt="Photo ${i + 1}">
      ${photos.length > 1 ? `<button class="lb-nav lb-next" aria-label="Next"><i class="bi bi-chevron-right"></i></button>` : ''}
      ${photos.length > 1 ? `<div class="lb-count">${i + 1} / ${photos.length}</div>` : ''}`;
    box.querySelector('.lb-close').onclick = (e) => { e.stopPropagation(); close(); };
    const prev = box.querySelector('.lb-prev'); if (prev) prev.onclick = (e) => { e.stopPropagation(); step(-1); };
    const next = box.querySelector('.lb-next'); if (next) next.onclick = (e) => { e.stopPropagation(); step(1); };
  };
  box.onclick = (e) => { if (e.target === box) close(); }; // click backdrop to close
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
  render();
}

/* ---------- CONTENT STUDIO (owner-only rich editor) ----------
   A block-based builder for projects & research. Manages an ordered list
   of content blocks (heading / text / code / image / file) plus a list of
   contributors. Images and files can be uploaded (stored as data URLs) or
   linked by URL. Everything it produces renders publicly in the detail view. */
function openContentStudio(entity, id, afterSave) {
  if (!Security.guard('manage content')) return;
  const item = DB.get(entity, id);
  if (!item) return;
  let blocks = JSON.parse(JSON.stringify(item.blocks || []));
  let contributors = JSON.parse(JSON.stringify(item.contributors || []));

  document.getElementById('entityModal')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="entityModal" tabindex="-1"><div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">
    <div class="modal-header">
      <h5 class="modal-title"><i class="bi bi-easel me-2"></i>Content studio — ${escapeHtml(item.name || item.title || '')}</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">
      <div class="section-title">Contributors</div>
      <div id="csContrib"></div>
      <button class="btn btn-soft btn-sm mt-2" id="csAddContrib"><i class="bi bi-person-plus me-1"></i>Add contributor</button>
      <hr class="my-4">
      <div class="d-flex align-items-center mb-3">
        <div class="section-title mb-0">Content blocks</div>
        <div class="dropdown ms-auto">
          <button class="btn btn-primary btn-sm" data-bs-toggle="dropdown"><i class="bi bi-plus-lg me-1"></i>Add block</button>
          <ul class="dropdown-menu dropdown-menu-end shadow">
            <li><a class="dropdown-item" href="#" data-add="heading"><i class="bi bi-type-h1 me-2"></i>Heading</a></li>
            <li><a class="dropdown-item" href="#" data-add="text"><i class="bi bi-text-paragraph me-2"></i>Text</a></li>
            <li><a class="dropdown-item" href="#" data-add="code"><i class="bi bi-code-slash me-2"></i>Code</a></li>
            <li><a class="dropdown-item" href="#" data-add="image"><i class="bi bi-image me-2"></i>Image</a></li>
            <li><a class="dropdown-item" href="#" data-add="file"><i class="bi bi-paperclip me-2"></i>File</a></li>
          </ul>
        </div>
      </div>
      <div id="csBlocks" class="stack-16"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
      <button class="btn btn-primary" id="csSave"><i class="bi bi-check-lg me-1"></i>Save content</button>
    </div>
  </div></div></div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('entityModal');
  const modal = new bootstrap.Modal(modalEl); modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());

  const blocksEl = document.getElementById('csBlocks');
  const contribEl = document.getElementById('csContrib');
  const blockIcon = { heading: 'type-h1', text: 'text-paragraph', code: 'code-slash', image: 'image', file: 'paperclip' };

  const blockBody = (b) => {
    if (b.type === 'heading') return `<input data-bf="text" placeholder="Heading text" value="${escapeHtml(b.text || '')}">`;
    if (b.type === 'text') return `<textarea data-bf="text" rows="3" placeholder="Write text… (line breaks are kept)">${escapeHtml(b.text || '')}</textarea>`;
    if (b.type === 'code') return `<input data-bf="lang" placeholder="Language (e.g. python)" value="${escapeHtml(b.lang || '')}"><textarea data-bf="code" rows="5" class="img-list mt-2" placeholder="Paste code…">${escapeHtml(b.code || '')}</textarea>`;
    if (b.type === 'image') return `
      ${b.src ? `<div class="cs-prev"><img src="${escapeHtml(imgSrc(b.src))}" alt=""></div>` : ''}
      <input type="file" data-file accept="image/*" class="file-input">
      <input data-bf="src" class="mt-2" placeholder="…or paste an image URL" value="${escapeHtml(b.src && b.src.startsWith('data:') ? '' : (b.src || ''))}">
      <input data-bf="caption" class="mt-2" placeholder="Caption (optional)" value="${escapeHtml(b.caption || '')}">`;
    if (b.type === 'file') return `
      ${b.name ? `<div class="cs-fileinfo"><i class="bi bi-paperclip me-1"></i>${escapeHtml(b.name)} <small class="text-faint">${b.size ? fmtBytes(b.size) : ''}</small></div>` : ''}
      <input type="file" data-file class="file-input">
      <input data-bf="url" class="mt-2" placeholder="…or paste a file URL" value="${escapeHtml(b.url || '')}">
      <input data-bf="label" class="mt-2" placeholder="Label (optional)" value="${escapeHtml(b.label || '')}">`;
    return '';
  };
  const blockRow = (b, i) => `
    <div class="card card-pad cs-block" data-i="${i}">
      <div class="d-flex align-items-center gap-2 mb-2">
        <span class="chip chip-outline"><i class="bi bi-${blockIcon[b.type] || 'square'} me-1"></i>${b.type}</span>
        <div class="ms-auto cs-tools">
          <button data-mv="-1" title="Move up"><i class="bi bi-arrow-up"></i></button>
          <button data-mv="1" title="Move down"><i class="bi bi-arrow-down"></i></button>
          <button data-del class="del" title="Delete"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
      ${blockBody(b)}
    </div>`;
  const contribRow = (c, i) => `
    <div class="d-flex gap-2 mb-2 cs-contrib" data-i="${i}">
      <input data-cf="name" placeholder="Name" value="${escapeHtml(c.name || '')}" style="flex:1.2">
      <input data-cf="role" placeholder="Role / contribution" value="${escapeHtml(c.role || '')}" style="flex:1">
      <button class="btn btn-ghost btn-sm text-danger" data-delc title="Remove"><i class="bi bi-x-lg"></i></button>
    </div>`;

  const syncContrib = () => contribEl.querySelectorAll('.cs-contrib').forEach(row => {
    const i = +row.dataset.i; if (!contributors[i]) return;
    row.querySelectorAll('[data-cf]').forEach(inp => { contributors[i][inp.dataset.cf] = inp.value.trim(); });
  });

  // Sync DOM → blocks model. Async: file inputs are read into data URLs here
  // so that reordering / adding never loses a freshly picked file.
  async function syncBlocks() {
    for (const row of blocksEl.querySelectorAll('.cs-block')) {
      const i = +row.dataset.i; const b = blocks[i]; if (!b) continue;
      row.querySelectorAll('[data-bf]').forEach(inp => { if (inp.dataset.bf === 'src') return; b[inp.dataset.bf] = inp.value; });
      const fi = row.querySelector('input[type="file"][data-file]');
      let uploaded = null, upFile = null;
      if (fi && fi.files && fi.files[0]) {
        upFile = fi.files[0];
        if (upFile.size > MAX_UPLOAD_BYTES) { toast(`“${upFile.name}” too large (max ${fmtBytes(MAX_UPLOAD_BYTES)}).`, 'err'); upFile = null; }
        else uploaded = await readFileAsDataURL(upFile);
      }
      if (b.type === 'image') {
        const typed = (row.querySelector('[data-bf="src"]') || {}).value;
        if (uploaded) b.src = uploaded;
        else if (typed && typed.trim()) b.src = typed.trim();
      } else if (b.type === 'file') {
        if (uploaded) { b.data = uploaded; b.name = upFile.name; b.size = upFile.size; b.ftype = upFile.type; }
      }
    }
  }
  const sync = async () => { await syncBlocks(); syncContrib(); };

  const renderContrib = () => {
    contribEl.innerHTML = contributors.length ? contributors.map(contribRow).join('')
      : '<p class="text-faint" style="font-size:12.5px">No contributors yet.</p>';
    contribEl.querySelectorAll('[data-delc]').forEach(b => b.onclick = () => { syncContrib(); contributors.splice(+b.closest('.cs-contrib').dataset.i, 1); renderContrib(); });
  };
  const renderBlocks = () => {
    blocksEl.innerHTML = blocks.length ? blocks.map(blockRow).join('')
      : '<p class="text-faint" style="font-size:13px">No blocks yet — use “Add block” to build the page.</p>';
    blocksEl.querySelectorAll('[data-del]').forEach(btn => btn.onclick = async () => { await sync(); blocks.splice(+btn.closest('.cs-block').dataset.i, 1); renderBlocks(); });
    blocksEl.querySelectorAll('[data-mv]').forEach(btn => btn.onclick = async () => {
      await sync();
      const i = +btn.closest('.cs-block').dataset.i, j = i + (+btn.dataset.mv);
      if (j < 0 || j >= blocks.length) return;
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      renderBlocks();
    });
  };
  renderContrib(); renderBlocks();

  wrap.querySelectorAll('[data-add]').forEach(a => a.onclick = async (e) => { e.preventDefault(); await sync(); blocks.push({ type: a.dataset.add }); renderBlocks(); });
  document.getElementById('csAddContrib').onclick = () => { syncContrib(); contributors.push({ name: '', role: '' }); renderContrib(); };

  document.getElementById('csSave').onclick = async () => {
    const btn = document.getElementById('csSave'); btn.disabled = true;
    await sync();
    const cleanBlocks = blocks.filter(b => {
      if (b.type === 'heading' || b.type === 'text') return (b.text || '').trim();
      if (b.type === 'code') return (b.code || '').trim();
      if (b.type === 'image') return !!b.src;
      if (b.type === 'file') return !!(b.data || b.url);
      return false;
    });
    const saved = DB.upsert(entity, { id, blocks: cleanBlocks, contributors: contributors.filter(c => c.name) });
    btn.disabled = false;
    if (!saved) return;
    toast('Content saved.', 'ok'); modal.hide();
    if (afterSave) afterSave();
  };
}

/* ---------- OWNER DASHBOARD (protected management hub) ---------- */
/* Reached only by an authenticated owner — security.js redirects
   everyone else to the login page before this ever runs. */
function initOwner() {
  // Defensive: never render management UI without a valid session.
  if (!Security.isOwner()) { location.replace(Security.LOGIN_PAGE); return; }

  // Session info pill — shows the signed-in owner account
  const si = document.getElementById('sessionInfo');
  if (si) si.innerHTML = `<i class="bi bi-person-badge"></i> ${escapeHtml(Security.userEmail() || 'Owner')}`;

  // Content counts
  const entities = [
    { key: 'opportunities', label: 'Opportunities', ico: 'compass-fill', t: 'primary', href: 'opportunities.html' },
    { key: 'tasks',         label: 'Tasks',          ico: 'kanban-fill',  t: 'amber',   href: 'tasks.html' },
    { key: 'documents',     label: 'Documents',      ico: 'folder-fill',  t: 'accent',  href: 'documents.html' },
    { key: 'achievements',  label: 'Achievements',   ico: 'trophy-fill',  t: 'green',   href: 'achievements.html' },
    { key: 'projects',      label: 'Projects',       ico: 'diagram-3-fill',t: 'violet',  href: 'projects.html' },
    { key: 'research',      label: 'Research',       ico: 'lightbulb-fill',t: 'blue',    href: 'research.html' },
    { key: 'contacts',      label: 'Contacts',       ico: 'person-rolodex',t: 'slate',   href: 'contacts.html' }
  ];
  document.getElementById('ownerStats').innerHTML = entities.map(e => `
    <div class="stat">
      <div class="ico t-${e.t}"><i class="bi bi-${e.ico}"></i></div>
      <div class="val">${DB.getAll(e.key).length}</div>
      <div class="lbl">${e.label}</div>
    </div>`).join('');

  // Manage each module (jump to its list page)
  document.getElementById('ownerManage').innerHTML =
    `<a class="qa" href="accounts.html"><i class="t-green bi bi-wallet-fill"></i><b>Accounts <span class="text-faint" style="font-weight:500;font-size:11px">· private</span></b></a>`
    + entities.map(e => `
    <a class="qa" href="${e.href}"><i class="t-${e.t} bi bi-${e.ico}"></i><b>${e.label}</b></a>`).join('')
    + `<a class="qa" href="categories.html"><i class="t-primary bi bi-sliders"></i><b>Categories</b></a>
       <a class="qa" href="profile.html"><i class="t-violet bi bi-person-badge-fill"></i><b>Profile</b></a>`;

  // Quick add (uses the same guarded modal as everywhere else)
  const adds = [
    { add: 'opportunities', ico: 'compass', t: 'primary', label: 'Opportunity' },
    { add: 'tasks', ico: 'check2-square', t: 'amber', label: 'Task' },
    { add: 'documents', ico: 'folder', t: 'accent', label: 'Document' },
    { add: 'achievements', ico: 'trophy', t: 'green', label: 'Achievement' },
    { add: 'projects', ico: 'diagram-3', t: 'violet', label: 'Project' },
    { add: 'research', ico: 'lightbulb', t: 'blue', label: 'Research idea' },
    { add: 'contacts', ico: 'person-plus', t: 'slate', label: 'Contact' }
  ];
  const qa = document.getElementById('ownerQuickAdd');
  qa.innerHTML = adds.map(a => `<button class="qa" data-add="${a.add}"><i class="t-${a.t} bi bi-${a.ico}"></i><b>${a.label}</b></button>`).join('');
  qa.querySelectorAll('[data-add]').forEach(b => b.onclick = () => openEntityModal(b.dataset.add, null, () => initOwner()));

  // Backup / restore / reset (all guarded inside DB)
  document.getElementById('ownerExport').onclick = () => DB.exportJSON();
  const file = document.getElementById('ownerImportFile');
  document.getElementById('ownerImport').onclick = () => file.click();
  file.onchange = () => { if (file.files[0]) DB.importJSON(file.files[0]); };
  document.getElementById('ownerReset').onclick = () => {
    if (confirm('Reset everything to sample data? Export a backup first if unsure.')) {
      DB.resetAll(); location.reload();
    }
  };

  // ---- Google Drive backup controls ----
  const dConnect = document.getElementById('driveConnect');
  const dBackup = document.getElementById('driveBackupNow');
  const dStatus = document.getElementById('driveStatus');
  const dOpen = document.getElementById('driveOpen');
  const hasDrive = typeof Drive !== 'undefined' && Drive;

  const renderDriveStatus = () => {
    if (!dStatus) return;
    const connected = hasDrive && Drive.isConnected();
    dStatus.innerHTML = connected
      ? '<span class="chip t-green"><span class="dot"></span>Connected — backups run automatically</span>'
      : '<span class="chip t-amber"><span class="dot"></span>Not connected — click “Connect Drive” once</span>';
    if (dConnect) dConnect.style.display = connected ? 'none' : '';
    const link = hasDrive ? Drive.fileLink() : '';
    if (dOpen) { if (link) { dOpen.href = link; dOpen.hidden = false; } else { dOpen.hidden = true; } }
  };

  if (dConnect) dConnect.onclick = async () => {
    if (!hasDrive) return;
    try { await Drive.connect(); toast('Google Drive connected.', 'ok'); renderDriveStatus(); }
    catch (e) { toast('Could not connect Google Drive.', 'err'); }
  };
  if (dBackup) dBackup.onclick = async () => {
    if (!hasDrive) return;
    try { await Drive.backupNow(JSON.stringify(DB.data)); toast('Backed up to Drive.', 'ok'); renderDriveStatus(); }
    catch (e) { toast('Drive backup failed — connect Drive first.', 'err'); }
  };

  renderDriveStatus();
  // a silent reconnect may finish after first paint → refresh the badge, then
  // catch Drive up if it fell behind Firestore (edits made where Drive was off)
  if (hasDrive) Drive.trySilentConnect().then((connected) => {
    renderDriveStatus();
    if (connected) Drive.catchUp(JSON.stringify(DB.data));
  });
}

/* ---------- INDEX / LANDING ---------- */
function initIndex() {
  // Public-first: visitors land on the portfolio (Digital CV). The owner's
  // private command-centre landing is shown only after sign-in.
  if (!Security.isOwner()) { location.replace('profile.html'); return; }

  const opps = DB.getAll('opportunities');
  const p = DB.data.profile;
  document.getElementById('lgName').textContent = p.name.split(' ')[0];
  const mini = [
    { ico: 'compass-fill', t: 'primary', l: 'Opportunities tracked', v: opps.length },
    { ico: 'trophy-fill', t: 'green', l: 'Wins & acceptances', v: opps.filter(o => ['Won', 'Accepted', 'Completed'].includes(o.status)).length },
    { ico: 'alarm-fill', t: 'red', l: 'Deadlines in 30 days', v: opps.filter(o => { const d = daysUntil(o.deadline); return d != null && d >= 0 && d <= 30; }).length },
    { ico: 'check2-circle', t: 'amber', l: 'Active tasks', v: DB.getAll('tasks').filter(t => !['Completed', 'Cancelled'].includes(t.status)).length }
  ];
  document.getElementById('lgStats').innerHTML = mini.map(m => `
    <div class="mini-stat"><div class="ms-ico t-${m.t}"><i class="bi bi-${m.ico}"></i></div>
      <div><div style="font-size:13.5px;font-weight:600">${m.l}</div></div>
      <div class="ms-v">${m.v}</div></div>`).join('');
}

/* ==========================================================
   6.5  SIGNAL LAYER — read-only derived intelligence
   A separate tier that models each opportunity as a TRAJECTORY through
   time (not a row) and emits scored signals with a confidence and a
   plain-English "why". It never writes to or alters anything else; the
   dashboard panel + EON read the signals it publishes on window.EonSignals.
   Toggle: localStorage 'eon-signals' = 'off' makes it inert.

   Fuel = an append-only event stream of opportunity state-changes
   (DB.data._events), logged on every save. Each signal is a transparent
   function over that stream — explainable today, learnable later.
   ========================================================== */

const SIGNAL_THRESHOLD = 0.42;   // confidence below this stays quiet (be silent, not wrong)
function signalsEnabled() { try { return localStorage.getItem('eon-signals') !== 'off'; } catch { return true; } }

// Opportunity status → progress index along the pipeline (the "position").
const OPP_LADDER = ['New', 'Researching', 'Preparing', 'Documents Ready', 'Shortlisted', 'Applied', 'Interview', 'Won'];
const OPP_WIN = ['Won', 'Accepted', 'Completed'];
const OPP_LOSS = ['Lost', 'Rejected', 'Irrelevant', 'Missed', 'Withdrawn'];
// Any status containing "missed" (e.g. "Missed Deadline") is a deliberate,
// resolved outcome — treat it as terminal-loss so EON never coaches/revives it.
const isMissedStatus = (s) => /missed/i.test(s || '');
function stageIndex(status) {
  if (OPP_WIN.includes(status)) return OPP_LADDER.length - 1;     // 7 = closed-won
  if (OPP_LOSS.includes(status) || isMissedStatus(status)) return -1;   // terminal-loss
  const i = OPP_LADDER.indexOf(status);
  return i >= 0 ? i : 0;
}
const isClosed = (s) => OPP_WIN.includes(s) || OPP_LOSS.includes(s) || isMissedStatus(s);
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

/* ---- event sourcing: append state-changes to the stream ---- */
function logOppEvents(before, after) {
  if (!after) return;
  const ev = (DB.data._events = DB.data._events || []);
  const at = new Date().toISOString();
  const push = (type, from, to) => ev.push({ opp: after.id, type, from: from ?? null, to: to ?? null, at });
  if (!before) { push('created', null, after.status || 'New'); }
  else {
    if ((before.status || '') !== (after.status || '')) push('status', before.status || '', after.status || '');
    if ((before.deadline || '') !== (after.deadline || '')) push('deadline', before.deadline || '', after.deadline || '');
    if ((before.priority || '') !== (after.priority || '')) push('priority', before.priority || '', after.priority || '');
  }
  if (ev.length > 3000) DB.data._events = ev.slice(-3000);
}
/* Seed a baseline 'created' event for any opportunity that predates the
   event log, so its trajectory has a start point (low confidence until real
   changes accumulate). */
function ensureOppBaseline() {
  const ev = (DB.data._events = DB.data._events || []);
  const have = new Set(ev.filter(e => e.type === 'created').map(e => e.opp));
  let added = false;
  DB.getAll('opportunities').forEach(o => {
    if (have.has(o.id)) return;
    ev.push({ opp: o.id, type: 'created', from: null, to: 'New', at: o.createdAt || o.openDate || new Date().toISOString() });
    added = true;
  });
  return added;
}

/* ---- the single computation pass (per load / per save) ---- */
let _signalsTimer = null;
function computeSignals() {
  if (!signalsEnabled()) { window.EonSignals = { enabled: false, ranked: [], byId: {}, coefficients: null, at: Date.now() }; return; }
  const opps = DB.getAll('opportunities');
  const events = (DB.data._events || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const evByOpp = {};
  events.forEach(e => (evByOpp[e.opp] = evByOpp[e.opp] || []).push(e));

  // ----- personal coefficients (learned from closed deals) -----
  const closed = opps.filter(o => isClosed(o.status));
  const wins = closed.filter(o => OPP_WIN.includes(o.status));
  const coeff = {
    sampleClosed: closed.length,
    winRate: closed.length ? wins.length / closed.length : null,
    winRateByType: {}, leakStage: null, medianTimeToCloseDays: null,
  };
  // win-rate by type
  const byType = {};
  closed.forEach(o => { const t = o.type || 'Other'; (byType[t] = byType[t] || { w: 0, n: 0 }); byType[t].n++; if (OPP_WIN.includes(o.status)) byType[t].w++; });
  Object.entries(byType).forEach(([t, v]) => { if (v.n >= 2) coeff.winRateByType[t] = v.w / v.n; });
  // leak stage: the stage most lost deals were last in before loss
  const leak = {};
  closed.filter(o => OPP_LOSS.includes(o.status)).forEach(o => {
    const hist = evByOpp[o.id] || []; const lastStatus = [...hist].reverse().find(e => e.type === 'status' && !OPP_LOSS.includes(e.to));
    const st = lastStatus ? lastStatus.to : 'Applied'; leak[st] = (leak[st] || 0) + 1;
  });
  coeff.leakStage = Object.entries(leak).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  // median time-to-close for wins (created → won)
  const ttc = wins.map(o => { const h = evByOpp[o.id] || []; const c = h.find(e => e.type === 'created'); return c ? daysBetween(c.at, o.eventDate || (h[h.length - 1] || c).at) : null; }).filter(x => x != null && x >= 0).sort((a, b) => a - b);
  if (ttc.length) coeff.medianTimeToCloseDays = Math.round(ttc[Math.floor(ttc.length / 2)]);

  // ----- dwell distribution per stage (across all opps) -----
  const dwellByStage = {};
  opps.forEach(o => {
    const h = evByOpp[o.id] || [];
    for (let i = 0; i < h.length; i++) {
      if (h[i].type !== 'status' && h[i].type !== 'created') continue;
      const stage = h[i].to, start = h[i].at;
      const next = h.slice(i + 1).find(e => e.type === 'status');
      const end = next ? next.at : new Date().toISOString();
      const d = daysBetween(start, end);
      if (d >= 0 && stage) (dwellByStage[stage] = dwellByStage[stage] || []).push(d);
    }
  });
  const percentileOf = (arr, x) => { if (!arr || arr.length < 4) return null; const s = [...arr].sort((a, b) => a - b); let c = 0; for (const v of s) if (v <= x) c++; return c / s.length; };

  // ----- winning signature (for resonance) -----
  const winSig = (() => {
    const vels = [], ttcs = ttc;
    wins.forEach(o => { const h = evByOpp[o.id] || []; const c = h.find(e => e.type === 'created'); const lastIdx = stageIndex('Won'); if (c) { const span = Math.max(1, daysBetween(c.at, (h[h.length - 1] || c).at)); vels.push(lastIdx / span); } });
    const med = (a) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
    return { velocity: med(vels), ttc: med(ttcs), n: wins.length };
  })();

  // ----- per-opportunity signals -----
  const now = Date.now();
  const out = {};
  const ranked = [];
  for (const o of opps) {
    if (isClosed(o.status)) continue;                 // only live deals get coached
    const h = evByOpp[o.id] || [];
    const idx = stageIndex(o.status);
    const created = h.find(e => e.type === 'created');
    const ageDays = created ? Math.max(0, daysBetween(created.at, new Date(now).toISOString())) : null;

    // velocity = stages advanced per day; acceleration = recent vs earlier velocity
    const statusEv = h.filter(e => e.type === 'status' || e.type === 'created');
    let velocity = null, acceleration = null;
    if (created && ageDays > 0) velocity = idx / ageDays;
    if (statusEv.length >= 3) {
      const mid = statusEv[statusEv.length - 2];
      const recentSpan = Math.max(0.5, daysBetween(mid.at, new Date(now).toISOString()));
      const recentVel = (stageIndex(o.status) - stageIndex(mid.to)) / recentSpan;
      const earlySpan = Math.max(0.5, daysBetween(created.at, mid.at));
      const earlyVel = (stageIndex(mid.to) - stageIndex(created.to)) / earlySpan;
      acceleration = recentVel - earlyVel;
    }
    const momentum = velocity == null ? 0 : Math.max(0, Math.min(1, velocity / 0.25));

    // dwell anomaly: how long in current stage vs the stage's own distribution
    const lastStatusEv = [...statusEv].reverse()[0];
    const dwellDays = lastStatusEv ? daysBetween(lastStatusEv.at, new Date(now).toISOString()) : (ageDays || 0);
    const dwellPct = percentileOf(dwellByStage[o.status], dwellDays);
    const dwellAnomaly = dwellPct != null && dwellPct >= 0.9;

    // decay proxy: days since last touch vs typical cadence (median inter-event gap)
    const gaps = []; for (let i = 1; i < h.length; i++) gaps.push(daysBetween(h[i - 1].at, h[i].at));
    const cadence = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
    const lastTouch = h.length ? h[h.length - 1].at : (created?.at || null);
    const daysSinceTouch = lastTouch ? daysBetween(lastTouch, new Date(now).toISOString()) : null;
    const cadenceDev = (cadence && daysSinceTouch != null) ? daysSinceTouch / cadence : null;
    const cooling = cadenceDev != null && cadenceDev >= 1.8;

    // deadline pressure
    const dl = daysUntil(o.deadline);
    const deadlineClose = dl != null && dl >= 0 && dl <= 10;

    // resonance: similarity of this deal's velocity to the winning signature
    let resonance = 0;
    if (winSig.velocity && velocity != null) resonance = Math.max(0, 1 - Math.abs(velocity - winSig.velocity) / (winSig.velocity + 0.0001));
    resonance = Math.max(0, Math.min(1, resonance));

    // inflection: acceleration crossed below zero (was advancing, now slowing)
    const inflection = acceleration != null && acceleration < -0.02;

    // effort-yield: priority × (resonance + momentum) ÷ stages-remaining
    const prW = { Critical: 1.6, High: 1.3, Medium: 1.0, Low: 0.7 }[o.priority] || 1.0;
    const stagesLeft = Math.max(1, (OPP_LADDER.length - 1) - Math.max(0, idx));
    const effortYield = prW * (0.45 + 0.55 * resonance + 0.5 * momentum) / stagesLeft * (deadlineClose ? 1.3 : 1);

    // confidence: grows with evidence (events, dwell sample, won sample)
    const evConf = Math.min(1, statusEv.length / 4);
    const dwellConf = dwellByStage[o.status] ? Math.min(1, dwellByStage[o.status].length / 6) : 0;
    const resConf = Math.min(1, winSig.n / 3);
    const confidence = Math.max(evConf * 0.5 + dwellConf * 0.3 + resConf * 0.2, deadlineClose ? 0.5 : 0);

    // recommendation + plain-English why
    const why = [];
    let recommend = 'watch';
    if (deadlineClose) { recommend = 'press'; why.push(`Deadline in ${dl} day${dl === 1 ? '' : 's'}.`); }
    if (resonance >= 0.6 && resConf >= 0.5) { recommend = 'press'; why.push(`Looks like the ones you close (${Math.round(resonance * 100)}% match).`); }
    if (cooling) { recommend = recommend === 'press' ? 'press' : 'revive'; why.push(`${cadenceDev.toFixed(1)}× past its own healthy cadence.`); }
    if (dwellAnomaly) { recommend = recommend === 'watch' ? 'intervene' : recommend; why.push(`In "${o.status}" longer than ${Math.round(dwellPct * 100)}% of your deals.`); }
    if (inflection) { recommend = recommend === 'watch' ? 'intervene' : recommend; why.push('Momentum just turned down — an inflection point.'); }
    if (coeff.medianTimeToCloseDays && ageDays > coeff.medianTimeToCloseDays * 1.3 && resConf >= 0.5) why.push(`Older than your typical ${coeff.medianTimeToCloseDays}-day close.`);
    if (!why.length) why.push(momentum > 0.4 ? 'Moving at a healthy clip.' : 'Quietly sitting — could use a touch.');
    if (o.nextAction) why.unshift(`Next: ${o.nextAction}.`);   // the specific move to make

    const sig = {
      id: o.id, name: o.name, status: o.status, stageIdx: idx,
      velocity, acceleration, momentum, resonance,
      dwellDays: Math.round(dwellDays), dwellAnomaly, cooling, cadenceDev,
      daysSinceTouch: daysSinceTouch == null ? null : Math.round(daysSinceTouch),
      deadlineDays: dl, inflection, effortYield, confidence, recommend, why,
      pointTo: `opportunity-details.html?id=${o.id}`,
    };
    out[o.id] = sig;
    if (confidence >= SIGNAL_THRESHOLD) ranked.push(sig);
  }
  ranked.sort((a, b) => b.effortYield - a.effortYield);

  window.EonSignals = {
    enabled: true, at: Date.now(), byId: out, ranked, coefficients: coeff,
    get(id) { return out[id] || null; },
    top(n = 1) { return ranked.slice(0, n); },
  };
  return window.EonSignals;
}

/* Owner-only dashboard consumer: "Signal radar" — today's highest-return
   moves, each with the plain-English why + a confidence bar + Open. */
function renderSignalPanel() {
  const host = document.getElementById('signalPanel');
  if (!host) return;
  if (!Security.isOwner() || !signalsEnabled()) { host.closest('.card')?.style.setProperty('display', 'none'); return; }
  const S = window.EonSignals;
  if (!S || !S.ranked) { host.innerHTML = '<p class="text-soft mb-0" style="font-size:13px">Signals warming up…</p>'; return; }
  const REC = {
    press: { t: 'green', ico: 'lightning-charge-fill', label: 'Press now' },
    intervene: { t: 'amber', ico: 'exclamation-triangle-fill', label: 'Intervene' },
    revive: { t: 'red', ico: 'arrow-counterclockwise', label: 'Revive' },
    watch: { t: 'slate', ico: 'eye', label: 'Watch' },
  };
  const top = S.ranked.slice(0, 4);
  const co = S.coefficients || {};
  const edge = [];
  if (co.winRate != null && co.sampleClosed >= 2) edge.push(`${Math.round(co.winRate * 100)}% win rate`);
  if (co.leakStage) edge.push(`deals leak at "${co.leakStage}"`);
  if (co.medianTimeToCloseDays) edge.push(`~${co.medianTimeToCloseDays}d to close`);

  host.innerHTML = `
    ${top.length ? top.map(s => {
      const r = REC[s.recommend] || REC.watch;
      const conf = Math.round(s.confidence * 100);
      return `<a class="sig-row" href="${s.pointTo}">
        <span class="chip t-${r.t} sig-rec"><i class="bi bi-${r.ico} me-1"></i>${r.label}</span>
        <span class="sig-body"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.why[0] || '')}</small></span>
        <span class="sig-conf" title="confidence ${conf}%"><span style="width:${conf}%"></span></span>
        <i class="bi bi-chevron-right text-faint"></i>
      </a>`;
    }).join('') : '<p class="text-soft mb-0" style="font-size:13px">No strong signals yet — they sharpen as your opportunities move through stages.</p>'}
    ${edge.length ? `<div class="sig-edge"><i class="bi bi-graph-up-arrow me-1"></i>Your edge: ${edge.join(' · ')}.</div>` : ''}`;
}

/* ==========================================================
   6.6  PRODUCTIVITY SIGNAL LAYER — your work as a trajectory
   Read-only derived intelligence over TASKS and "tracks" (categories).
   One pass per load/save over an append-only task event stream
   (DB.data._taskEvents) emits: follow-through, rot/aging, drift, promise
   ledger, unstick prompts, multi-track/neglect/balance, momentum/streak,
   time-of-day fingerprint, load/capacity, a realistic day, personal
   coefficients, a counterfactual, and a weekly retro — all on
   window.EonProductivity, confidence-gated and quiet by default.
   Shares the 'eon-signals' toggle. Touches nothing else.
   ========================================================== */

const TASK_DONE = 'Completed';
const TASK_DEAD = ['Cancelled', 'Dropped'];
const isTaskDone = (s) => s === TASK_DONE;
const isTaskDead = (s) => TASK_DEAD.includes(s);
const isTaskActive = (s) => !isTaskDone(s) && !isTaskDead(s);
const median = (a) => { if (!a || !a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const dayKey = (iso) => String(iso).slice(0, 10);

function logTaskEvents(before, after) {
  if (!after) return;
  const ev = (DB.data._taskEvents = DB.data._taskEvents || []);
  const at = new Date().toISOString();
  const push = (type, from, to) => ev.push({ task: after.id, type, from: from ?? null, to: to ?? null, at });
  if (!before) push('created', null, after.status || 'To Do');
  else {
    if ((before.status || '') !== (after.status || '')) push('status', before.status || '', after.status || '');
    if ((before.dueDate || '') !== (after.dueDate || '')) push('due', before.dueDate || '', after.dueDate || '');
  }
  if (ev.length > 4000) DB.data._taskEvents = ev.slice(-4000);
}
function ensureTaskBaseline() {
  const ev = (DB.data._taskEvents = DB.data._taskEvents || []);
  const have = new Set(ev.filter(e => e.type === 'created').map(e => e.task));
  let added = false;
  DB.getAll('tasks').forEach(t => {
    if (have.has(t.id)) return;
    ev.push({ task: t.id, type: 'created', from: null, to: 'To Do', at: t.createdAt || new Date().toISOString() });
    // if a legacy task is already completed, seed that too so streaks/history exist
    if (isTaskDone(t.status)) ev.push({ task: t.id, type: 'status', from: 'To Do', to: TASK_DONE, at: t.createdAt || new Date().toISOString() });
    added = true;
  });
  return added;
}
function celebrateIfCompleted(before, after) {
  if (!after || !before) return;
  if (before.status !== TASK_DONE && after.status === TASK_DONE) {
    const P = window.EonProductivity, st = (P && P.streak) ? P.streak.current : 0;
    const line = st > 1 ? `Done! 🎉 ${st}-day streak — keep it alive!` : 'Done! 🎉 One down — nice work.';
    try { window.EON?.ai?.speak(line, 4200); window.EON?.character?.playEmote?.('cheer'); } catch {}
    toast('✅ Task complete!', 'ok');
  }
}

function computeProductivity() {
  if (!signalsEnabled()) { window.EonProductivity = { enabled: false }; return; }
  const tasks = DB.getAll('tasks');
  const ev = (DB.data._taskEvents || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const byTask = {}; ev.forEach(e => (byTask[e.task] = byTask[e.task] || []).push(e));
  const now = Date.now(), nowIso = new Date(now).toISOString();
  const trackOf = (t) => t.category || 'General';

  // ---- completion history (events) → streak + time-of-day + capacity ----
  const completions = ev.filter(e => e.type === 'status' && e.to === TASK_DONE);
  const compDays = [...new Set(completions.map(e => dayKey(e.at)))].sort();
  // current streak: consecutive days ending today/yesterday
  let streak = 0; {
    const set = new Set(compDays); let d = new Date();
    if (!set.has(dayKey(d.toISOString()))) d.setDate(d.getDate() - 1);   // grace: yesterday still counts
    while (set.has(dayKey(d.toISOString()))) { streak++; d.setDate(d.getDate() - 1); }
  }
  const lastComp = completions.length ? completions[completions.length - 1].at : null;
  const daysSinceComp = lastComp ? Math.floor(daysBetween(lastComp, nowIso)) : null;
  const stalled = daysSinceComp != null && daysSinceComp >= 2;

  // time-of-day fingerprint (hour histogram of completions)
  const hours = new Array(24).fill(0); completions.forEach(e => hours[new Date(e.at).getHours()]++);
  const bestHour = completions.length >= 4 ? hours.indexOf(Math.max(...hours)) : null;
  const beforeNoon = completions.filter(e => new Date(e.at).getHours() < 12).length;
  const afterNoon = completions.length - beforeNoon;

  // capacity: median completions per active day
  const perDay = {}; completions.forEach(e => { const k = dayKey(e.at); perDay[k] = (perDay[k] || 0) + 1; });
  const capacityPerDay = Object.keys(perDay).length >= 3 ? Math.max(1, Math.round(median(Object.values(perDay)))) : null;

  // ---- per-task signals: rot, drift, stuck, unstick ----
  // category time-to-complete distribution (for rot tail)
  const ttcByCat = {};
  tasks.forEach(t => {
    if (!isTaskDone(t.status)) return; const h = byTask[t.id] || []; const c = h.find(e => e.type === 'created');
    const done = [...h].reverse().find(e => e.type === 'status' && e.to === TASK_DONE);
    if (c && done) { const d = daysBetween(c.at, done.at); if (d >= 0) (ttcByCat[trackOf(t)] = ttcByCat[trackOf(t)] || []).push(d); }
  });
  const taskSig = {};
  const guessUnstick = (t, ageDays) => {
    const title = String(t.title || ''); const words = title.split(/\s+/).length;
    if (words >= 8 || /\band\b|,|\//.test(title)) return { reason: 'it\'s too big', step: 'Split it into the first 10-minute slice and do only that.' };
    if (t.status === 'Waiting') return { reason: 'it\'s blocked', step: 'Send one nudge to whoever you\'re waiting on.' };
    if (!t.notes) return { reason: 'it\'s unclear', step: 'Write one line: what does "done" look like?' };
    return { reason: 'it\'s easy to avoid', step: 'Set a 10-minute timer and just start — momentum will carry you.' };
  };
  tasks.forEach(t => {
    if (!isTaskActive(t.status)) return;
    const h = byTask[t.id] || [];
    const created = h.find(e => e.type === 'created');
    const ageDays = created ? Math.floor(daysBetween(created.at, nowIso)) : 0;
    const lastStatusEv = [...h].reverse().find(e => e.type === 'status' || e.type === 'created');
    const dwellDays = lastStatusEv ? Math.floor(daysBetween(lastStatusEv.at, nowIso)) : ageDays;
    const driftCount = h.filter(e => e.type === 'due').length;
    const catTtc = ttcByCat[trackOf(t)];
    const catMed = median(catTtc);
    const rot = catMed != null && catTtc.length >= 3 ? ageDays > catMed * 2 : ageDays > 21;
    const stuck = dwellDays >= 10;
    const sig = { id: t.id, title: t.title, track: trackOf(t), ageDays, dwellDays, driftCount, rot, stuck };
    if (stuck || rot) sig.unstick = guessUnstick(t, ageDays);
    taskSig[t.id] = sig;
  });

  // ---- follow-through index (per track + overall) ----
  const ft = {}; let ftDone = 0, ftTot = 0;
  tasks.forEach(t => { const k = trackOf(t); (ft[k] = ft[k] || { done: 0, tot: 0 }); ft[k].tot++; ftTot++; if (isTaskDone(t.status)) { ft[k].done++; ftDone++; } });
  const followThrough = { overall: ftTot ? ftDone / ftTot : null, byTrack: {} };
  Object.entries(ft).forEach(([k, v]) => { if (v.tot >= 2) followThrough.byTrack[k] = v.done / v.tot; });

  // ---- tracks: open / activity / neglect + week balance ----
  const weekAgo = now - 7 * 86400000;
  const lastActByTrack = {}, openByTrack = {}, weekByTrack = {};
  tasks.forEach(t => {
    const k = trackOf(t);
    if (isTaskActive(t.status)) openByTrack[k] = (openByTrack[k] || 0) + 1;
    const h = byTask[t.id] || []; const last = h.length ? h[h.length - 1].at : t.createdAt;
    if (last && (!lastActByTrack[k] || Date.parse(last) > Date.parse(lastActByTrack[k]))) lastActByTrack[k] = last;
  });
  ev.forEach(e => { if (Date.parse(e.at) >= weekAgo) { const t = tasks.find(x => x.id === e.task); if (t) weekByTrack[trackOf(t)] = (weekByTrack[trackOf(t)] || 0) + 1; } });
  const tracks = [...new Set(tasks.map(trackOf))].map(k => {
    const last = lastActByTrack[k]; const neglectDays = last ? Math.floor(daysBetween(last, nowIso)) : null;
    return { key: k, label: k, open: openByTrack[k] || 0, week: weekByTrack[k] || 0, lastActivity: last, neglectDays, neglected: (openByTrack[k] || 0) > 0 && neglectDays != null && neglectDays >= 9 };
  }).sort((a, b) => b.open - a.open);
  const weekTotal = Object.values(weekByTrack).reduce((a, b) => a + b, 0);

  // ---- load / overcommit ----
  const activeTasks = tasks.filter(t => isTaskActive(t.status));
  const dueToday = activeTasks.filter(t => daysUntil(t.dueDate) === 0).length;
  const overdue = activeTasks.filter(t => { const d = daysUntil(t.dueDate); return d != null && d < 0; });
  const dueWeek = activeTasks.filter(t => { const d = daysUntil(t.dueDate); return d != null && d >= 0 && d <= 7; }).length;
  const overcommit = capacityPerDay != null && dueToday > capacityPerDay;

  // ---- realistic day: overdue → due-today → high-priority, capped at capacity ----
  const prRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const cap = Math.max(3, Math.min(6, capacityPerDay || 4));
  const realisticDay = activeTasks.map(t => ({ t, d: daysUntil(t.dueDate), pr: prRank[t.priority] ?? 2 }))
    .sort((a, b) => {
      const aw = a.d != null && a.d < 0 ? 0 : a.d === 0 ? 1 : 2, bw = b.d != null && b.d < 0 ? 0 : b.d === 0 ? 1 : 2;
      return aw - bw || a.pr - b.pr || ((a.d ?? 99) - (b.d ?? 99));
    }).slice(0, cap).map(x => ({ id: x.t.id, title: x.t.title, due: x.t.dueDate, overdue: x.d != null && x.d < 0, priority: x.t.priority }));

  // ---- promise ledger (commitments to people) ----
  const promises = activeTasks.filter(t => t.owedTo && String(t.owedTo).trim())
    .map(t => ({ id: t.id, title: t.title, who: t.owedTo, due: t.dueDate, overdue: (daysUntil(t.dueDate) ?? 99) < 0 }))
    .sort((a, b) => (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1));

  // ---- coefficients (learned) ----
  const avoided = Object.entries(followThrough.byTrack).filter(([, v]) => v < 0.4).map(([k]) => k);
  const coefficients = { capacityPerDay, bestHour, followThroughByTrack: followThrough.byTrack, avoidedTracks: avoided };

  // ---- counterfactual (from your own data) ----
  let counterfactual = null;
  if (completions.length >= 6 && beforeNoon > afterNoon * 1.5) counterfactual = `You finish ${(beforeNoon / Math.max(1, afterNoon)).toFixed(1)}× more tasks before noon — schedule the hard one for the morning.`;
  else if (bestHour != null) counterfactual = `Your sharpest hour is around ${bestHour}:00 — drop your top task there.`;

  // ---- alerts (the prioritised feed EON + dashboard consume) ----
  const alerts = [];
  if (overdue.length) alerts.push({ type: 'overdue', sev: 5, text: `${overdue.length} task${overdue.length > 1 ? 's' : ''} overdue — clear one?`, pointTo: 'tasks.html' });
  promises.filter(p => p.overdue).slice(0, 1).forEach(p => alerts.push({ type: 'promise', sev: 4.6, text: `You promised "${p.title}" to ${p.who} — it's overdue.`, pointTo: 'tasks.html' }));
  tracks.filter(t => t.neglected).slice(0, 1).forEach(t => alerts.push({ type: 'neglect', sev: 4, text: `You haven't touched "${t.label}" in ${t.neglectDays} days — parked or slipping?`, pointTo: 'tasks.html' }));
  Object.values(taskSig).filter(s => s.driftCount >= 3).slice(0, 1).forEach(s => alerts.push({ type: 'drift', sev: 3.6, text: `"${s.title}" has been rescheduled ${s.driftCount}× — break it down, delegate, or drop it?`, pointTo: 'tasks.html' }));
  Object.values(taskSig).filter(s => s.unstick).slice(0, 1).forEach(s => alerts.push({ type: 'unstick', sev: 3.4, text: `"${s.title}" is stuck — maybe ${s.unstick.reason}. ${s.unstick.step}`, pointTo: 'tasks.html' }));
  if (overcommit) alerts.push({ type: 'overcommit', sev: 3.2, text: `${dueToday} due today but you usually finish ~${capacityPerDay}. Trim the plan?`, pointTo: 'tasks.html' });
  if (stalled && daysSinceComp != null) alerts.push({ type: 'stall', sev: 3, text: `${daysSinceComp} days since your last finish — one quick win restarts momentum.`, pointTo: 'tasks.html' });
  else if (streak >= 2) alerts.push({ type: 'streak', sev: 1.8, text: `${streak}-day streak going — one quick thing keeps it alive! 🔥`, pointTo: 'tasks.html' });
  alerts.sort((a, b) => b.sev - a.sev);

  window.EonProductivity = {
    enabled: true, at: now,
    followThrough, streak: { current: streak, daysSinceCompletion: daysSinceComp, stalled, lastCompletionAt: lastComp },
    bestHour, capacity: { perDay: capacityPerDay, dueToday, dueWeek, overdue: overdue.length, overcommit },
    tracks, balance: { byTrack: weekByTrack, total: weekTotal },
    taskSignals: taskSig, realisticDay, promises, coefficients, counterfactual, alerts,
    topAlert() { return alerts[0] || null; },
  };
  return window.EonProductivity;
}

/* ---- Dashboard consumers ---- */
function renderRealisticDay() {
  const host = document.getElementById('realisticDay'); if (!host) return;
  if (!Security.isOwner() || !signalsEnabled()) { host.closest('.card')?.style.setProperty('display', 'none'); return; }
  const P = window.EonProductivity; if (!P || !P.realisticDay) { host.innerHTML = '<p class="text-soft mb-0" style="font-size:13px">Warming up…</p>'; return; }
  const cap = P.capacity || {};
  const items = P.realisticDay;
  host.innerHTML = `
    <div class="rd-cap">${cap.perDay ? `You usually finish ~<b>${cap.perDay}</b>/day` : 'Top moves for today'}${cap.overcommit ? ` · <span class="text-danger">${cap.dueToday} due — trim it</span>` : ''}${P.bestHour != null ? ` · sharpest ~<b>${P.bestHour}:00</b>` : ''}</div>
    ${items.length ? items.map((t, i) => `<a class="rd-row" href="tasks.html">
        <span class="rd-n">${i + 1}</span>
        <span class="rd-body"><b>${escapeHtml(t.title)}</b>${t.due ? `<small class="${t.overdue ? 'text-danger' : 'text-faint'}">${t.overdue ? 'overdue · ' : 'due '}${fmtDate(t.due)}</small>` : ''}</span>
        ${t.priority ? `<span class="chip chip-outline">${escapeHtml(t.priority)}</span>` : ''}
      </a>`).join('') : '<p class="text-soft mb-0" style="font-size:13px">Nothing pressing — you\'re clear. 🌿</p>'}
    ${P.counterfactual ? `<div class="rd-cf"><i class="bi bi-lightbulb me-1"></i>${escapeHtml(P.counterfactual)}</div>` : ''}`;
}
function renderTracksPanel() {
  const host = document.getElementById('tracksPanel'); if (!host) return;
  if (!Security.isOwner() || !signalsEnabled()) { host.closest('.card')?.style.setProperty('display', 'none'); return; }
  const P = window.EonProductivity; if (!P || !P.tracks) { host.innerHTML = '<p class="text-soft mb-0" style="font-size:13px">Warming up…</p>'; return; }
  const tot = P.balance.total || 0;
  host.innerHTML = P.tracks.length ? P.tracks.map(t => {
    const share = tot ? Math.round((t.week || 0) / tot * 100) : 0;
    return `<div class="trk-row ${t.neglected ? 'neglect' : ''}">
      <div class="trk-head"><b>${escapeHtml(t.label)}</b><span class="trk-meta">${t.open} open${t.neglected ? ` · <span class="text-danger">${t.neglectDays}d quiet</span>` : t.neglectDays != null ? ` · ${t.neglectDays}d ago` : ''}</span></div>
      <div class="trk-bar"><span style="width:${share}%"></span></div>
    </div>`;
  }).join('') : '<p class="text-soft mb-0" style="font-size:13px">Add tasks with categories and your tracks appear here.</p>';
}
function renderPulsePanel() {
  const host = document.getElementById('pulsePanel'); if (!host) return;
  if (!Security.isOwner() || !signalsEnabled()) { host.closest('.card')?.style.setProperty('display', 'none'); return; }
  const P = window.EonProductivity; if (!P) { host.innerHTML = ''; return; }
  const ft = P.followThrough.overall;
  const cells = [
    ['Follow-through', ft != null ? Math.round(ft * 100) + '%' : '—', 'check2-circle'],
    ['Streak', (P.streak.current || 0) + 'd', 'fire'],
    ['Due this week', P.capacity.dueWeek ?? 0, 'calendar-week'],
    ['Best hour', P.bestHour != null ? P.bestHour + ':00' : '—', 'clock'],
  ];
  const promises = P.promises || [];
  host.innerHTML = `
    <div class="pulse-grid">${cells.map(c => `<div class="pulse-cell"><span class="pc-ico"><i class="bi bi-${c[2]}"></i></span><div><div class="pc-v">${c[1]}</div><div class="pc-l">${c[0]}</div></div></div>`).join('')}</div>
    ${promises.length ? `<div class="pulse-promise"><div class="section-title" style="margin:10px 0 6px"><i class="bi bi-hand-thumbs-up me-1"></i>Promise ledger</div>${promises.slice(0, 4).map(p => `<div class="pl-row ${p.overdue ? 'over' : ''}"><b>${escapeHtml(p.title)}</b><small>to ${escapeHtml(p.who)}${p.due ? ' · ' + fmtDate(p.due) : ''}${p.overdue ? ' · overdue' : ''}</small></div>`).join('')}</div>` : ''}`;
}
/* Weekly retrospective — shown once a week on the dashboard. */
function maybeWeeklyRetro() {
  try {
    if (!Security.isOwner() || !signalsEnabled()) return;
    const wk = (() => { const d = new Date(); const onejan = new Date(d.getFullYear(), 0, 1); return d.getFullYear() + '-' + Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7); })();
    if (localStorage.getItem('eon-retro-week') === wk) return;
    const P = window.EonProductivity; if (!P) return;
    const ev = (DB.data._taskEvents || []); const weekAgo = Date.now() - 7 * 86400000;
    const advanced = ev.filter(e => e.type === 'status' && e.to === TASK_DONE && Date.parse(e.at) >= weekAgo).length;
    const slipped = (P.capacity.overdue || 0) + Object.values(P.taskSignals).filter(s => s.driftCount >= 3).length;
    const habit = P.counterfactual || (P.coefficients.avoidedTracks[0] ? `You keep stalling on "${P.coefficients.avoidedTracks[0]}" — try one tiny step there this week.` : 'Protect your sharpest hour for your hardest task.');
    localStorage.setItem('eon-retro-week', wk);
    setTimeout(() => { try { window.EON?.ai?.speak(`Weekly check-in: you advanced ${advanced} task${advanced === 1 ? '' : 's'}, ${slipped} slipped. One habit: ${habit}`, 8000); window.EON?.character?.playEmote?.('ponder'); } catch {} }, 9000);
  } catch {}
}

/* ==========================================================
   6.7  ACCOUNTS — private income / expense intelligence
   ----------------------------------------------------------
   OWNER-ONLY & PRIVATE. Unlike every other module, this data
   NEVER touches the public portfolio document (opptrack/data),
   which any visitor can read. It lives in its own store:
     • localStorage key  `pomls_finance_v1`  (instant, offline)
     • Firestore doc      opptrack/finance    (same project, but a
       SEPARATE document — add the owner-only read+write rule and
       it syncs across devices; without the rule it silently stays
       on this device so nothing ever breaks or leaks).
   The page itself is redirect-protected (Security.PROTECTED_PAGES)
   and hidden from the public nav, so visitors never see it.
   ========================================================== */
const FIN_STORE_KEY = 'pomls_finance_v1';

/* Sensible starting categories — tuned for a Bangladeshi student /
   professional (bKash / Nagad, Zakat, stipend, etc.). Editable. */
const FIN_DEFAULTS = {
  incomeCategories: ['Salary', 'Freelance / Contract', 'Business', 'Scholarship / Stipend',
    'Investment Return', 'Gift / Family', 'Refund / Cashback', 'Other Income'],
  expenseCategories: ['Food & Groceries', 'Dining Out', 'Transport', 'Rent / Housing',
    'Utilities (Gas/Water/Electric)', 'Internet & Mobile', 'Education / Tuition', 'Books & Courses',
    'Health & Medicine', 'Clothing', 'Entertainment', 'Subscriptions', 'Gadgets / Tech',
    'Family Support', 'Charity / Zakat', 'Travel', 'Personal Care',
    'Bank Fees & Charges', 'Other Expense'],
  /* DEPOSITS are money you KEEP, not money you spend — savings, DPS, FDR,
     shares. They are taken out of spendable income instead of counting as
     expense, so they never suppress the savings figures. */
  depositCategories: ['Savings / Investment', 'DPS / Recurring Deposit', 'Fixed Deposit (FDR)',
    'Investment / Shares', 'Emergency Fund', 'Other Deposit'],
  methods: ['Cash', 'bKash', 'Nagad', 'Rocket', 'Debit / Credit Card', 'Bank Transfer', 'Other']
};

/* The legacy expense categories that really were deposits. Used once, by the
   v2 migration, to reclassify records saved before deposits existed. */
const FIN_LEGACY_DEPOSITS = ['savings / investment', 'savings', 'investment', 'dps', 'fdr'];

/* The four "was it worth it?" necessity bands — the heart of the
   spending-quality analysis. Order matters (best → worst). */
const FIN_NEED = [
  { key: 'Essential',     tone: 'green',  ico: 'shield-check',  desc: 'Non-negotiable — rent, food, bills, health' },
  { key: 'Important',     tone: 'blue',   ico: 'star',          desc: 'Real value — education, growth, family' },
  { key: 'Discretionary', tone: 'amber',  ico: 'cup-hot',       desc: 'Nice to have — comfort, leisure, wants' },
  { key: 'Avoidable',     tone: 'red',    ico: 'exclamation-triangle', desc: 'Regret / impulse — could have skipped' }
];
const FIN_NEED_TONE = FIN_NEED.reduce((m, n) => (m[n.key] = n.tone, m), {});

/* ---- FinanceDB : the private storage layer (mirrors DB, isolated) ---- */
const FinanceDB = {
  data: null,
  _clientId: 'f-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
  _unsub: null,
  _doc() {
    if (typeof fbDB === 'undefined' || !fbDB) return null;
    // A SEPARATE top-level collection (not under `opptrack`), so even a
    // wildcard public-read rule on the portfolio collection can never match
    // it. Firestore default-denies this path until the owner adds the rule.
    try { return fbDB.collection('opptrack_private').doc('finance'); } catch { return null; }
  },
  _hydrate(raw) {
    const d = (raw && typeof raw === 'object') ? raw : {};
    if (!Array.isArray(d.tx)) d.tx = [];
    d.categories = Object.assign({}, FIN_DEFAULTS, d.categories || {});
    if (!Array.isArray(d.categories.depositCategories)) d.categories.depositCategories = FIN_DEFAULTS.depositCategories.slice();
    if (typeof d.monthlyBudget !== 'number') d.monthlyBudget = 0;
    if (typeof d.savingsGoal !== 'number') d.savingsGoal = 0;
    /* Month rollover (additive — no record is ever touched):
       openingBalance = cash in hand before your first recorded month;
       carryForward   = roll each month's leftover into the next;
       closes         = saved month reviews, keyed by 'YYYY-MM'. */
    if (typeof d.openingBalance !== 'number') d.openingBalance = 0;
    if (typeof d.carryForward !== 'boolean') d.carryForward = true;
    if (!d.closes || typeof d.closes !== 'object') d.closes = {};

    /* ---- v2 migration: split DEPOSITS out of expenses ----
       Records saved before deposits existed put savings under an expense
       category, which counted money you kept as money you spent. Reclassify
       them once (schema-versioned, so a later deliberate re-tag is respected)
       and drop the deposit names from the expense list. */
    if (!(d._finV >= 2)) {
      const names = new Set([
        ...(d.categories.depositCategories || []).map(x => String(x).toLowerCase()),
        ...FIN_LEGACY_DEPOSITS
      ]);
      let moved = 0;
      d.tx.forEach(t => {
        if (t.type === 'expense' && t.category && names.has(String(t.category).toLowerCase())) {
          t.type = 'deposit'; t.necessity = ''; moved++;
        }
      });
      const before = (d.categories.expenseCategories || []).length;
      d.categories.expenseCategories = (d.categories.expenseCategories || [])
        .filter(c => !names.has(String(c).toLowerCase()));
      d._finV = 2;
      // Tell the caller to persist, so the fix sticks instead of re-running.
      this._didMigrate = moved > 0 || before !== d.categories.expenseCategories.length;
      if (moved) console.info(`[Accounts] migrated ${moved} record(s) from expense → deposit.`);
    }
    return d;
  },
  loadLocal() {
    try {
      const raw = localStorage.getItem(FIN_STORE_KEY);
      this.data = this._hydrate(raw ? JSON.parse(raw) : null);
    } catch { this.data = this._hydrate(null); }
    return this.data;
  },
  async loadCloud() {
    const doc = this._doc();
    if (!doc || !Security.isOwner()) { this._cloudBlocked = true; return this.loadLocal(); }
    try {
      const snap = await doc.get();
      if (snap.exists) {
        const d = snap.data() || {};
        this.data = this._hydrate(d.store || d);
        this._persistLocal();
      } else {
        if (!this.data) this.loadLocal();
        await this._persistCloud();     // seed the private doc from local
      }
    } catch (e) {
      // No rule yet / offline — run privately from this device. Never leaks.
      if (!this.data) this.loadLocal();
      this._cloudBlocked = true;
    }
    return this.data;
  },
  subscribe(onRemote) {
    const doc = this._doc();
    if (!doc || !Security.isOwner()) return;
    if (this._unsub) { this._unsub(); this._unsub = null; }
    try {
      this._unsub = doc.onSnapshot(snap => {
        if (!snap.exists) return;
        const d = snap.data() || {};
        if (d.writer === this._clientId) return;
        this.data = this._hydrate(d.store || d);
        this._persistLocal();
        if (typeof onRemote === 'function') onRemote();
      }, () => {});
    } catch {}
  },
  _persistLocal() { try { localStorage.setItem(FIN_STORE_KEY, JSON.stringify(this.data)); } catch {} },
  async _persistCloud() {
    const doc = this._doc();
    if (!doc || !Security.isOwner()) return;
    try {
      await doc.set({ store: this.data, writer: this._clientId, updatedAt: Date.now() });
      this._cloudBlocked = false;
    } catch (e) { this._cloudBlocked = true; }
  },
  save() {
    if (!Security.guard('save finance data')) return;
    this._persistLocal();
    this._persistCloud();
  },
  all() { return (this.data && this.data.tx) || []; },
  get(id) { return this.all().find(t => t.id === id); },
  upsert(rec) {
    if (!Security.guard('save finance data')) return null;
    const list = this.data.tx;
    if (!rec.id) { rec.id = uid(); rec.createdAt = new Date().toISOString(); list.push(rec); }
    else { const i = list.findIndex(t => t.id === rec.id); if (i > -1) list[i] = Object.assign(list[i], rec); else list.push(rec); }
    this.save();
    return rec;
  },
  remove(id) {
    if (!Security.guard('delete finance data')) return;
    this.data.tx = this.all().filter(t => t.id !== id);
    this.save();
  }
};

/* ---- Money helpers (Bangladeshi ৳ with lakh/crore grouping) ---- */
function fmtBDT(n, withSign) {
  const neg = n < 0;
  n = Math.round(Math.abs(Number(n) || 0));
  let s = String(n), last3 = s.slice(-3), rest = s.slice(0, -3);
  if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',';
  const body = '৳' + rest + last3;
  return (neg ? '−' : (withSign ? '+' : '')) + body;
}
function fmtBDTk(n) {              // compact form for tiny chart labels
  n = Number(n) || 0;
  if (Math.abs(n) >= 10000000) return '৳' + (n / 10000000).toFixed(2).replace(/\.?0+$/, '') + 'Cr';
  if (Math.abs(n) >= 100000)   return '৳' + (n / 100000).toFixed(2).replace(/\.?0+$/, '') + 'L';
  if (Math.abs(n) >= 1000)     return '৳' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return fmtBDT(n);
}
const FIN_CATS = (k) => (FinanceDB.data.categories[k] || []);
const finMonthKey = (iso) => String(iso || '').slice(0, 7);         // 'YYYY-MM'
function finMonthLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function finShiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/* Aggregate one month's transactions into everything the page needs.

   THREE FLOWS, not two:
     income   — money that came in
     deposit  — money you KEPT (savings, DPS, FDR, shares). Comes out of
                spendable income; it is NOT spending, so it never drags the
                savings figures down.
     expense  — money that is actually gone
   net       = income − deposit − expense   (what is still in hand)
   total kept = deposit + net               (what stayed with you) */
function finSummary(monthKey) {
  const tx = FinanceDB.all().filter(t => finMonthKey(t.date) === monthKey);
  const income = tx.filter(t => t.type === 'income');
  const deposit = tx.filter(t => t.type === 'deposit');
  const expense = tx.filter(t => t.type === 'expense');
  const sum = (a) => a.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const bySector = (arr) => {
    const m = {};
    arr.forEach(t => { const k = t.category || 'Uncategorised'; m[k] = (m[k] || 0) + (Number(t.amount) || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  /* Payment-method totals are kept PER FLOW. Summing income and expense into
     one figure per method (as this once did) produces a number that is neither
     what you earned nor what you spent. */
  const byMethodOf = (arr) => {
    const m = {};
    arr.forEach(t => { const k = t.method || 'Other'; m[k] = (m[k] || 0) + (Number(t.amount) || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  /* Necessity bands cover TAGGED spending only. Untagged spend is reported
     separately rather than silently assumed Discretionary — guessing would
     inflate the "could save" figure for records that were never classified. */
  const byNeed = {};
  FIN_NEED.forEach(n => byNeed[n.key] = 0);
  let untagged = 0;
  expense.forEach(t => {
    const amt = Number(t.amount) || 0;
    if (FIN_NEED_TONE[t.necessity]) byNeed[t.necessity] += amt; else untagged += amt;
  });
  const totalIn = sum(income), totalOut = sum(expense), totalDeposit = sum(deposit);
  const net = totalIn - totalDeposit - totalOut;
  const kept = totalDeposit + net;
  return {
    tx, income, expense, deposit,
    totalIn, totalOut, totalDeposit,
    net, kept,
    // "savings rate" = how much of your income you actually kept, i.e. what you
    // deposited plus what is still in hand.
    savingsRate: totalIn > 0 ? kept / totalIn * 100 : 0,
    incomeSectors: bySector(income),
    expenseSectors: bySector(expense),
    depositSectors: bySector(deposit),
    byNeed,
    untagged,
    // the two Avoidable/Discretionary bands in full…
    softSpend: byNeed.Avoidable + byNeed.Discretionary,
    // …and the realistic slice of that you could actually have reclaimed.
    leak: byNeed.Avoidable + byNeed.Discretionary * 0.5,
    byMethodIn: byMethodOf(income),
    byMethodOut: byMethodOf(expense),
    byMethodDep: byMethodOf(deposit),
    count: tx.length
  };
}

/* Human, specific insights — the part that makes people go "whoa". */
function finInsights(monthKey, s) {
  const out = [];
  const prev = finSummary(finShiftMonth(monthKey, -1));
  if (s.totalIn === 0 && s.totalOut === 0 && s.totalDeposit === 0)
    return [{ tone: 'slate', ico: 'info-circle', text: 'No records for this month yet. Add your first income or expense to unlock insights.' }];

  // Savings verdict — measured on what you KEPT (deposits + what's left).
  if (s.totalIn > 0) {
    const split = s.totalDeposit > 0
      ? ` — <b>${fmtBDT(s.totalDeposit)}</b> deposited plus <b>${fmtBDT(s.net)}</b> still in hand`
      : '';
    if (s.savingsRate >= 20) out.push({ tone: 'green', ico: 'piggy-bank', text: `Strong month — you kept <b>${s.savingsRate.toFixed(0)}%</b> of your income (${fmtBDT(s.kept)})${split}. Above the 20% healthy mark.` });
    else if (s.kept >= 0) out.push({ tone: 'amber', ico: 'piggy-bank', text: `You kept <b>${s.savingsRate.toFixed(0)}%</b> (${fmtBDT(s.kept)})${split} this month. Nudging this past 20% builds real cushion.` });
    else out.push({ tone: 'red', ico: 'graph-down-arrow', text: `You spent <b>${fmtBDT(-s.kept)} more than you earned</b> this month. Worth trimming the avoidable spend below.` });
  }
  // Deposit note — the money that is genuinely put away.
  if (s.totalDeposit > 0) {
    const dPct = s.totalIn > 0 ? ` (${(s.totalDeposit / s.totalIn * 100).toFixed(0)}% of income)` : '';
    out.push({ tone: 'violet', ico: 'bank', text: `You moved <b>${fmtBDT(s.totalDeposit)}</b>${dPct} into savings &amp; investment. That is taken out of spendable income, not counted as spending.` });
  }
  // Leak / quality of spend. Two DIFFERENT numbers, stated as such: what sat in
  // those bands, and the realistic slice of it that was reclaimable.
  if (s.softSpend > 0 && s.totalOut > 0) {
    const bandPct = (s.softSpend / s.totalOut * 100).toFixed(0);
    out.push({ tone: 'red', ico: 'scissors', text: `<b>${fmtBDT(s.softSpend)}</b> (${bandPct}% of spending) sat in <b>Avoidable / Discretionary</b>. Realistically about <b>${fmtBDT(s.leak)}</b> of that was reclaimable — half of it would add <b>${fmtBDT(s.leak / 2)}</b> to savings.` });
  }
  // Untagged spend — a nudge, never a silent assumption.
  if (s.untagged > 0) {
    out.push({ tone: 'slate', ico: 'question-circle', text: `<b>${fmtBDT(s.untagged)}</b> of spending has no necessity tag yet, so it sits outside the quality bands. Tag it to sharpen the picture.` });
  }
  // Biggest sector
  if (s.expenseSectors.length) {
    const [cat, amt] = s.expenseSectors[0];
    out.push({ tone: 'blue', ico: 'pie-chart', text: `Your biggest expense was <b>${escapeHtml(cat)}</b> at <b>${fmtBDT(amt)}</b> — ${(amt / s.totalOut * 100).toFixed(0)}% of everything you spent.` });
  }
  // Month-over-month movement
  if (prev.totalOut > 0) {
    const diff = s.totalOut - prev.totalOut;
    const p = Math.abs(diff / prev.totalOut * 100).toFixed(0);
    if (Math.abs(diff) > prev.totalOut * 0.08)
      out.push({ tone: diff > 0 ? 'amber' : 'green', ico: diff > 0 ? 'arrow-up-right' : 'arrow-down-right', text: `Spending is <b>${p}% ${diff > 0 ? 'higher' : 'lower'}</b> than last month (${finMonthLabel(finShiftMonth(monthKey, -1))}).` });
  }
  // Budget check
  if (FinanceDB.data.monthlyBudget > 0) {
    const b = FinanceDB.data.monthlyBudget;
    if (s.totalOut > b) out.push({ tone: 'red', ico: 'flag', text: `You're <b>${fmtBDT(s.totalOut - b)} over</b> your ${fmtBDT(b)} monthly budget.` });
    else out.push({ tone: 'green', ico: 'flag', text: `Within budget — <b>${fmtBDT(b - s.totalOut)}</b> of your ${fmtBDT(b)} budget still unspent.` });
  }
  return out;
}

/* horizontal bar-row helper (sector breakdowns) */
function finBarRow(label, amt, max, tone) {
  const pct = max > 0 ? Math.max(2, amt / max * 100) : 0;
  return `<div class="fin-bar">
    <div class="fin-bar-head"><span class="fin-bar-lbl">${escapeHtml(label)}</span><span class="fin-bar-amt num">${fmtBDT(amt)}</span></div>
    <div class="fin-bar-track"><span class="t-${tone || 'primary'}" style="width:${pct}%"></span></div>
  </div>`;
}

/* ==========================================================
   ACCOUNTS COCKPIT — view state
   The page is one cockpit, not a stack of reports: a sticky command
   bar, a KPI strip you can click (each KPI is a LENS over everything
   below it), the money river, and one tabbed workspace.
   All of this is presentation only — every figure is still derived
   from your transactions, and no record is ever rewritten.
   ========================================================== */
let _finMonth = null;                 // month on screen (YYYY-MM)
let _finLens = '';                    // '', income, deposit, expense, leak, net
let _finTab = 'ledger';               // workspace tab
let _finQ = '';                       // ledger search
let _finDay = '';                     // YYYY-MM-DD, set by clicking a calendar day
let _finScope = 'month';              // ledger source: 'month' | 'all' (every month on file)
let _finFilt = { category: '', necessity: '', method: '' };
let _finSel = new Set();              // bulk-selected transaction ids

/* ---- Carry-forward: what you walked into the month with ----------
   NOTHING IS EVER CLOSED OFF DESTRUCTIVELY. Every record stays filed
   under the month of its own date, forever; July stays July. The
   opening balance is DERIVED by replaying all earlier months, so a
   record you add to July tomorrow still corrects August automatically.

     opening(m) = starting balance + Σ (income − deposit − expense) of months < m
     closing(m) = opening(m) + this month's net          → next month's opening
     vault(m)   = Σ deposits up to and including m       → the pot, never resets  */
function finCarry(monthKey) {
  const d = FinanceDB.data;
  const on = d.carryForward !== false;
  let opening = on ? (Number(d.openingBalance) || 0) : 0;
  let vault = 0;
  FinanceDB.all().forEach(t => {
    const k = finMonthKey(t.date);
    if (!k) return;
    const amt = Number(t.amount) || 0;
    // a deposit and an expense both leave your hand; only income adds to it
    if (on && k < monthKey) opening += (t.type === 'income' ? amt : -amt);
    if (t.type === 'deposit' && k <= monthKey) vault += amt;
  });
  return { on, opening, vault };
}

/* ---- Spend-quality score: the necessity mix as one number ----
   Weighted share of TAGGED spending only — untagged money is never
   guessed at, it just isn't scored (and the page says so). */
const FIN_Q_WEIGHT = { Essential: 1, Important: .85, Discretionary: .45, Avoidable: 0 };
function finQuality(s) {
  const tagged = FIN_NEED.reduce((n, b) => n + (s.byNeed[b.key] || 0), 0);
  if (tagged <= 0) return { score: null, grade: '—', tone: 'slate', tagged: 0 };
  const score = FIN_NEED.reduce((n, b) => n + (s.byNeed[b.key] || 0) * FIN_Q_WEIGHT[b.key], 0) / tagged * 100;
  return {
    score, tagged,
    grade: score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 58 ? 'C' : score >= 45 ? 'D' : 'E',
    tone: score >= 80 ? 'green' : score >= 65 ? 'blue' : score >= 50 ? 'amber' : 'red'
  };
}

/* ---- Recurring radar: repeats already sitting in your ledger ----
   No new data entry — a "repeat" is the same detail line (or category)
   on the same flow seen in 2+ different months. Subscriptions are
   exactly what quietly slips past you. */
function finRecurring(monthKey) {
  const map = new Map();
  FinanceDB.all().forEach(t => {
    if (t.type === 'income') return;
    const k = finMonthKey(t.date);
    if (!k || k > monthKey) return;
    const label = String(t.note || t.category || '').trim();
    if (!label) return;
    const id = t.type + '|' + label.toLowerCase();
    const e = map.get(id) || { label, type: t.type, category: t.category || '', months: new Set(), total: 0, n: 0, last: '' };
    e.months.add(k); e.total += Number(t.amount) || 0; e.n++;
    if (k > e.last) e.last = k;
    map.set(id, e);
  });
  return [...map.values()]
    .filter(e => e.months.size >= 2)
    .map(e => ({ label: e.label, type: e.type, category: e.category, months: e.months.size, avg: e.total / e.n, last: e.last, live: e.last === monthKey }))
    .sort((a, b) => b.avg - a.avg);
}

/* Saved month reviews. A close is a BOOKMARK, never a freeze: it stores
   your note and the figures as they stood, and the live numbers keep
   recomputing underneath if you edit an old record. */
function finCloses() {
  const d = FinanceDB.data;
  if (!d.closes || typeof d.closes !== 'object') d.closes = {};
  return d.closes;
}
/* Every month that has at least one record, oldest first. */
function finAllMonths() {
  return [...new Set(FinanceDB.all().map(t => finMonthKey(t.date)).filter(Boolean))].sort();
}
/* Add several records in one write (bulk actions / bringing recurring
   items forward) — one cloud save instead of one per row. */
function finAddMany(recs) {
  if (!recs.length) return 0;
  if (!Security.guard('add records')) return 0;
  recs.forEach(r => { r.id = uid(); r.createdAt = new Date().toISOString(); FinanceDB.data.tx.push(r); });
  FinanceDB.save();
  return recs.length;
}

function initAccounts() {
  // Hard gate — this page never renders for a visitor.
  if (!Security.isOwner()) { location.replace(Security.LOGIN_PAGE); return; }
  const host = document.getElementById('acctHost');
  if (!host) return;

  host.innerHTML = `<div class="empty"><div class="e-ico"><i class="bi bi-hourglass-split"></i></div><b>Loading your private ledger…</b></div>`;

  const boot = () => {
    if (!_finMonth) _finMonth = finMonthKey(new Date().toISOString());
    // The v2 deposit migration rewrote records in memory — persist it once so it
    // does not have to run again (and so other devices get the corrected data).
    if (FinanceDB._didMigrate) {
      FinanceDB._didMigrate = false;
      FinanceDB.save();
      toast('Savings moved out of expenses into Deposits.', 'ok');
    }
    drawAccounts();
    FinanceDB.subscribe(() => { if (!document.querySelector('.modal.show')) drawAccounts(); });
  };

  // load private store (local instant, then cloud if the rule allows)
  FinanceDB.loadLocal();
  FinanceDB.loadCloud().then(boot);
}

/* The six lenses. Clicking a KPI focuses the whole page on one flow
   instead of opening a dead-end tooltip. */
const FIN_LENS = {
  income:  { label: 'Income',      tone: 'green',   ico: 'arrow-down-left' },
  deposit: { label: 'Deposited',   tone: 'blue',    ico: 'bank' },
  expense: { label: 'Spending',    tone: 'red',     ico: 'arrow-up-right' },
  leak:    { label: 'Could save',  tone: 'amber',   ico: 'scissors' },
  net:     { label: 'Balance',     tone: 'primary', ico: 'piggy-bank' }
};

function drawAccounts() {
  const host = document.getElementById('acctHost');
  if (!host) return;
  const mk = _finMonth;
  const s = finSummary(mk);
  const prev = finSummary(finShiftMonth(mk, -1));
  const carry = finCarry(mk);
  const q = finQuality(s);
  const closing = carry.opening + s.net;
  const months = finAllMonths();
  const closed = finCloses()[mk];

  const cloudNote = FinanceDB._cloudBlocked
    ? `<span class="fin-priv" title="Private to this device — add the finance security rule to sync across devices"><i class="bi bi-hdd"></i> Private · this device</span>`
    : `<span class="fin-priv is-sync" title="Private &amp; synced to your account only"><i class="bi bi-shield-lock-fill"></i> Private · synced</span>`;

  // % movement vs last month, as a small chip. Null when there is no base.
  const delta = (now, was) => {
    if (!(was > 0)) return '';
    const p = (now - was) / was * 100;
    if (Math.abs(p) < 1) return `<span class="fin-delta is-flat">≈ same</span>`;
    return `<span class="fin-delta ${p > 0 ? 'is-up' : 'is-down'}"><i class="bi bi-arrow-${p > 0 ? 'up' : 'down'}-right"></i>${Math.abs(p).toFixed(0)}%</span>`;
  };

  host.innerHTML = `
  ${finRolloverHtml(mk)}

  <!-- ============ Command bar (sticky) ============ -->
  <div class="fin-cmd">
    <div class="fin-priv-wrap">${cloudNote}
      <span class="text-faint fin-cmd-hide" style="font-size:12px"><i class="bi bi-eye-slash me-1"></i>Never shown on your public portfolio</span>
    </div>
    <div class="fin-monthnav">
      <button class="btn btn-ghost btn-icon" id="finPrev" title="Previous month"><i class="bi bi-chevron-left"></i></button>
      <div class="fin-month"><b>${finMonthLabel(mk)}</b>
        <small>${s.count} record${s.count === 1 ? '' : 's'}${closed ? ' · closed' : ''}</small></div>
      <button class="btn btn-ghost btn-icon" id="finNext" title="Next month"><i class="bi bi-chevron-right"></i></button>
      <button class="btn btn-ghost btn-icon" id="finToday" title="Jump to this month"><i class="bi bi-calendar-event"></i></button>
    </div>
    ${finScrubHtml(mk)}
    <div class="fin-search">
      <i class="bi bi-search"></i>
      <input id="finSearch" value="${escapeHtml(_finQ)}"
             placeholder="Search ${_finScope === 'all' ? 'every month' : escapeHtml(finMonthLabel(mk))}…"
             aria-label="Search ${_finScope === 'all' ? 'all records' : 'this month'}">
      ${_finQ ? '<button id="finSearchX" title="Clear"><i class="bi bi-x-lg"></i></button>' : ''}
    </div>
    <div class="fin-actions">
      <button class="btn btn-ghost btn-sm" id="finSettings"><i class="bi bi-sliders me-1"></i><span class="fin-cmd-hide">Categories &amp; budget</span></button>
      <button class="btn btn-primary btn-sm" id="finAdd"><i class="bi bi-plus-lg me-1"></i>Add record</button>
    </div>
  </div>

  <!-- ============ Cockpit: hero balance + clickable KPI lenses ============ -->
  <div class="fin-cockpit">
    <button class="fin-hero ${_finLens === 'net' ? 'on' : ''}" data-lens="net"
            title="What is actually in your hand — last month's leftover plus this month's flow">
      <div class="fh-top">
        <span class="fh-k"><i class="bi bi-wallet2 me-1"></i>In hand at month end</span>
        ${q.score != null ? `<span class="fh-grade t-${q.tone}" title="Spend-quality grade — the weighted necessity mix of your tagged spending">${q.grade}</span>` : ''}
      </div>
      <div class="fh-v num ${closing < 0 ? 'is-neg' : ''}">${fmtBDT(closing)}</div>
      <div class="fh-flow">
        ${carry.on ? `<span title="Carried in from ${escapeHtml(finMonthLabel(finShiftMonth(mk, -1)))}">Opened <b class="num">${fmtBDT(carry.opening)}</b></span><i class="bi bi-chevron-right"></i>` : ''}
        <span class="t-green">+${fmtBDTk(s.totalIn)}</span>
        <span class="t-blue">−${fmtBDTk(s.totalDeposit)}</span>
        <span class="t-red">−${fmtBDTk(s.totalOut)}</span>
      </div>
      <div class="fh-ring" title="Savings rate — the share of income you kept"><span style="width:${Math.max(0, Math.min(100, s.savingsRate))}%"></span></div>
      <div class="fh-foot">
        <span>Kept <b class="num">${fmtBDT(s.kept)}</b> · ${s.savingsRate.toFixed(0)}% of income</span>
        <span class="fh-vault" title="Everything you have deposited to date — savings, DPS, FDR, shares"><i class="bi bi-safe me-1"></i>Vault ${fmtBDTk(carry.vault)}</span>
      </div>
    </button>

    <div class="fin-sats">
      <button class="fin-kpi t-green ${_finLens === 'income' ? 'on' : ''}" data-lens="income">
        <div class="fk-ico"><i class="bi bi-arrow-down-left"></i></div>
        <div class="fk-v num">${fmtBDT(s.totalIn)}</div>
        <div class="fk-l">Income ${delta(s.totalIn, prev.totalIn)}</div>
      </button>
      <button class="fin-kpi t-blue ${_finLens === 'deposit' ? 'on' : ''}" data-lens="deposit"
              title="Money you kept — savings, DPS, FDR, shares. Taken out of spendable income, never counted as spending.">
        <div class="fk-ico"><i class="bi bi-bank"></i></div>
        <div class="fk-v num">${s.totalDeposit > 0 ? '−' + fmtBDT(s.totalDeposit) : fmtBDT(0)}</div>
        <div class="fk-l">Deposited ${delta(s.totalDeposit, prev.totalDeposit)}</div>
      </button>
      <button class="fin-kpi t-red ${_finLens === 'expense' ? 'on' : ''}" data-lens="expense">
        <div class="fk-ico"><i class="bi bi-arrow-up-right"></i></div>
        <div class="fk-v num">${fmtBDT(s.totalOut)}</div>
        <div class="fk-l">Spent ${delta(s.totalOut, prev.totalOut)}</div>
        ${FinanceDB.data.monthlyBudget > 0 ? `<div class="fk-ring" title="${fmtBDT(s.totalOut)} of your ${fmtBDT(FinanceDB.data.monthlyBudget)} budget">
          <span class="${s.totalOut > FinanceDB.data.monthlyBudget ? 'is-over' : ''}" style="width:${Math.min(100, s.totalOut / FinanceDB.data.monthlyBudget * 100)}%"></span></div>` : ''}
      </button>
      <button class="fin-kpi t-amber ${_finLens === 'leak' ? 'on' : ''}" data-lens="leak"
              title="Avoidable spending plus half of discretionary — the realistically reclaimable slice.">
        <div class="fk-ico"><i class="bi bi-scissors"></i></div>
        <div class="fk-v num">${fmtBDT(s.leak)}</div>
        <div class="fk-l">Could save</div>
      </button>
    </div>
  </div>

  ${finRiverHtml(s)}

  ${_finLens ? `<div class="fin-lensbar">
    <span class="fin-lenschip t-${FIN_LENS[_finLens].tone}"><i class="bi bi-${FIN_LENS[_finLens].ico}"></i>
      Focused on <b>${FIN_LENS[_finLens].label}</b></span>
    <span class="text-faint" style="font-size:12px">${_finLens === 'net'
      ? 'The balance rail above is the focus — the ledger still shows the whole month.'
      : 'Everything below is filtered to this flow.'}</span>
    <button class="btn btn-ghost btn-sm ms-auto" id="finLensX"><i class="bi bi-x-lg me-1"></i>Clear focus</button>
  </div>` : ''}

  <!-- ============ Workspace ============ -->
  <div class="card fin-card fin-work" id="finWork"></div>
  `;

  finDrawPanel();

  // ---- command-bar wiring ----
  const go = (mkey) => { _finMonth = mkey; _finDay = ''; _finSel.clear(); drawAccounts(); };
  document.getElementById('finPrev').onclick = () => go(finShiftMonth(mk, -1));
  document.getElementById('finNext').onclick = () => go(finShiftMonth(mk, 1));
  document.getElementById('finToday').onclick = () => go(finMonthKey(new Date().toISOString()));
  document.getElementById('finAdd').onclick = () => openFinanceModal(null);
  document.getElementById('finSettings').onclick = openFinanceSettings;
  host.querySelectorAll('[data-scrub]').forEach(b => b.onclick = () => go(b.dataset.scrub));

  // search redraws only the workspace, so the field never loses focus
  const search = document.getElementById('finSearch');
  if (search) {
    search.oninput = () => { _finQ = search.value; _finTab = 'ledger'; finDrawPanel(); };
    search.onkeydown = (e) => { if (e.key === 'Escape') { _finQ = ''; search.value = ''; finDrawPanel(); } };
  }
  document.getElementById('finSearchX')?.addEventListener('click', () => { _finQ = ''; drawAccounts(); });

  // a KPI is a lens: click to focus, click again to release
  host.querySelectorAll('[data-lens]').forEach(b => b.onclick = () => {
    _finLens = (_finLens === b.dataset.lens) ? '' : b.dataset.lens;
    _finSel.clear();
    drawAccounts();
  });
  document.getElementById('finLensX')?.addEventListener('click', () => { _finLens = ''; drawAccounts(); });

  // money-river segments focus the same way
  host.querySelectorAll('[data-river]').forEach(b => b.onclick = () => {
    const [lens, need] = b.dataset.river.split(':');
    _finLens = lens || '';
    _finFilt.necessity = need || '';
    _finTab = 'ledger';
    drawAccounts();
  });

  // rollover banner
  document.getElementById('finCloseBtn')?.addEventListener('click', (e) => openFinanceClose(e.currentTarget.dataset.m));
  document.getElementById('finRollX')?.addEventListener('click', () => {
    _finRollDismissed = document.getElementById('finRollX').dataset.m;
    drawAccounts();
  });
  document.getElementById('finRollGo')?.addEventListener('click', (e) => go(e.currentTarget.dataset.m));
}

/* ---- 12-month scrub: the year at a glance, click to travel ---- */
function finScrubHtml(mk) {
  const bars = [];
  for (let i = 11; i >= 0; i--) {
    const k = finShiftMonth(mk, -i);
    const t = finSummary(k);
    bars.push({ k, out: t.totalOut, in: t.totalIn });
  }
  const max = Math.max(1, ...bars.flatMap(b => [b.in, b.out]));
  return `<div class="fin-scrub" title="Last 12 months — click any month to travel">
    ${bars.map(b => `<button data-scrub="${b.k}" class="${b.k === mk ? 'on' : ''}"
      title="${escapeHtml(finMonthLabel(b.k))} · in ${fmtBDTk(b.in)} · out ${fmtBDTk(b.out)}">
      <i class="sc-in" style="height:${Math.max(4, b.in / max * 100)}%"></i>
      <i class="sc-out" style="height:${Math.max(4, b.out / max * 100)}%"></i>
    </button>`).join('')}
  </div>`;
}

/* ---- The money river ------------------------------------------------
   One bar that shows the whole month: income splits into what you kept,
   what each necessity band consumed, and what is still in hand. It
   replaces three separate breakdown cards and every segment is a lens. */
function finRiverHtml(s) {
  const outflow = s.totalDeposit + s.totalOut;
  const base = Math.max(1, s.totalIn, outflow);
  const segs = [];
  if (s.totalDeposit > 0) segs.push({ label: 'Deposited', amt: s.totalDeposit, tone: 'blue', go: 'deposit:' });
  FIN_NEED.forEach(n => {
    const amt = s.byNeed[n.key] || 0;
    if (amt > 0) segs.push({ label: n.key, amt, tone: n.tone, go: 'expense:' + n.key });
  });
  if (s.untagged > 0) segs.push({ label: 'Untagged', amt: s.untagged, tone: 'slate', go: 'expense:Untagged' });
  if (s.net > 0) segs.push({ label: 'In hand', amt: s.net, tone: 'primary', go: 'net:' });
  if (!segs.length) return '';

  const over = s.net < 0 ? Math.abs(s.net) : 0;
  return `
  <div class="fin-river">
    <div class="fin-river-head">
      <span class="section-title mb-0"><i class="bi bi-water me-1"></i>Where this month's money went</span>
      <span class="text-faint" style="font-size:11.5px">${fmtBDT(s.totalIn)} in${over ? ` · <b class="t-red">${fmtBDT(over)} beyond income</b>` : ''} — click any band to focus</span>
    </div>
    <div class="fin-river-bar">
      ${segs.map(g => `<button class="fr-seg t-${g.tone}" data-river="${escapeHtml(g.go)}"
        style="flex:${(g.amt / base * 100).toFixed(3)} 1 0"
        title="${escapeHtml(g.label)} · ${fmtBDT(g.amt)} (${(g.amt / base * 100).toFixed(0)}%)">
        <span class="fr-lbl">${escapeHtml(g.label)}</span><span class="fr-amt num">${fmtBDTk(g.amt)}</span>
      </button>`).join('')}
      ${over ? `<button class="fr-seg is-over t-red" data-river="expense:" style="flex:${(over / base * 100).toFixed(3)} 1 0"
        title="Spent beyond this month's income — covered by what you carried in"><span class="fr-lbl">Over</span><span class="fr-amt num">${fmtBDTk(over)}</span></button>` : ''}
    </div>
  </div>`;
}

/* ---- Month rollover ------------------------------------------------
   On the turn of a month the previous one is offered up for review. It
   is only ever an OFFER: your data already rolled over by itself. */
let _finRollDismissed = '';
function finRolloverHtml(mk) {
  const months = finAllMonths();
  if (!months.length) return '';
  const nowKey = finMonthKey(new Date().toISOString());
  // the newest month that has records and is genuinely in the past
  const last = months.filter(k => k < nowKey).pop();
  if (!last || finCloses()[last] || _finRollDismissed === last) return '';
  const t = finSummary(last);
  if (!t.count) return '';
  const c = finCarry(last);
  const closing = c.opening + t.net;
  return `
  <div class="fin-roll">
    <span class="fin-roll-ico"><i class="bi bi-calendar-check"></i></span>
    <div class="fin-roll-txt">
      <b>${escapeHtml(finMonthLabel(last))} is done — ${fmtBDT(t.totalIn)} in, ${fmtBDT(t.totalOut)} spent, ${fmtBDT(t.totalDeposit)} deposited.</b>
      <span>${c.on
        ? `Its <b class="num">${fmtBDT(closing)}</b> leftover already carries into ${escapeHtml(finMonthLabel(finShiftMonth(last, 1)))} — nothing to do. Close it to save a note and keep the month on file.`
        : `Carry-forward is off, so each month starts at zero. Turn it on in <b>Categories &amp; budget</b> to roll leftovers forward.`}</span>
    </div>
    ${mk !== last ? `<button class="btn btn-ghost btn-sm" id="finRollGo" data-m="${last}"><i class="bi bi-box-arrow-in-right me-1"></i>Open ${escapeHtml(finMonthLabel(last).split(' ')[0])}</button>` : ''}
    <button class="btn btn-primary btn-sm" id="finCloseBtn" data-m="${last}"><i class="bi bi-check2-square me-1"></i>Review &amp; close</button>
    <button class="fin-roll-x" id="finRollX" data-m="${last}" title="Not now"><i class="bi bi-x-lg"></i></button>
  </div>`;
}

/* ---- Workspace: tabs + the active panel --------------------------- */
const FIN_TABS = [
  { key: 'ledger',    label: 'Ledger',    ico: 'list-ul' },
  { key: 'calendar',  label: 'Calendar',  ico: 'calendar3' },
  { key: 'breakdown', label: 'Breakdown', ico: 'pie-chart' },
  { key: 'trends',    label: 'Trends',    ico: 'bar-chart-line' },
  { key: 'months',    label: 'Months',    ico: 'archive' },
  { key: 'insights',  label: 'Insights',  ico: 'stars' }
];

function finDrawPanel() {
  const work = document.getElementById('finWork');
  if (!work) return;
  const s = finSummary(_finMonth);
  const rows = finRows(s);
  const body =
    _finTab === 'calendar'  ? finCalendarHtml(s) :
    _finTab === 'breakdown' ? finBreakdownHtml(s) :
    _finTab === 'trends'    ? finTrendsHtml(s) :
    _finTab === 'months'    ? finMonthsHtml() :
    _finTab === 'insights'  ? finInsightsHtml(s) :
                              finLedgerHtml(s, rows);

  work.innerHTML = `
    <div class="fin-tabs" role="tablist">
      ${FIN_TABS.map(t => `<button class="${_finTab === t.key ? 'on' : ''}" data-tab="${t.key}" role="tab">
        <i class="bi bi-${t.ico}"></i>${t.label}${t.key === 'ledger' ? `<span class="fin-tabn">${rows.length}</span>` : ''}</button>`).join('')}
    </div>
    <div class="fin-panel">${body}</div>`;

  work.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { _finTab = b.dataset.tab; finDrawPanel(); });
  finWirePanel(s);
}

/* The ledger rows after lens + filters + search. One place, so every
   tab and the counters can agree on what "showing" means. */
function finRows(s) {
  // 'all' widens the ledger to every month on file — the cockpit above stays
  // month-scoped, because those figures are about the month you are viewing.
  let rows = _finScope === 'all' ? FinanceDB.all().slice() : s.tx.slice();
  if (_finLens === 'income' || _finLens === 'expense' || _finLens === 'deposit') rows = rows.filter(t => t.type === _finLens);
  if (_finLens === 'leak') rows = rows.filter(t => t.type === 'expense' && (t.necessity === 'Avoidable' || t.necessity === 'Discretionary'));
  if (_finDay) rows = rows.filter(t => t.date === _finDay);
  if (_finFilt.category) rows = rows.filter(t => (t.category || '') === _finFilt.category);
  if (_finFilt.necessity) rows = rows.filter(t => (t.necessity || 'Untagged') === _finFilt.necessity);
  if (_finFilt.method) rows = rows.filter(t => (t.method || '') === _finFilt.method);
  const q = _finQ.trim().toLowerCase();
  if (q) rows = rows.filter(t => [t.note, t.category, t.method, t.necessity, t.amount].some(v => String(v == null ? '' : v).toLowerCase().includes(q)));
  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/* ---- Ledger: searchable, filterable, grouped by day, bulk-taggable -- */
function finLedgerHtml(s, rows) {
  const source = _finScope === 'all' ? FinanceDB.all() : s.tx;
  const cats = [...new Set(source.map(t => t.category).filter(Boolean))].sort();
  const methods = [...new Set(source.map(t => t.method).filter(Boolean))].sort();
  const opt = (v, sel) => `<option value="${escapeHtml(v)}" ${v === sel ? 'selected' : ''}>${escapeHtml(v)}</option>`;
  const activeFilters = (_finDay ? 1 : 0) + (_finFilt.category ? 1 : 0) + (_finFilt.necessity ? 1 : 0) + (_finFilt.method ? 1 : 0) + (_finQ ? 1 : 0);

  const bar = `
    <div class="fin-filters">
      <div class="fin-scope" role="group" aria-label="Ledger range">
        <button class="${_finScope === 'month' ? 'on' : ''}" data-scope="month">This month</button>
        <button class="${_finScope === 'all' ? 'on' : ''}" data-scope="all" title="Every record you have ever logged, newest first">All months</button>
      </div>
      <select class="filter-select" id="fltCat"><option value="">All categories</option>${cats.map(c => opt(c, _finFilt.category)).join('')}</select>
      <select class="filter-select" id="fltNeed"><option value="">All necessity</option>${[...FIN_NEED.map(n => n.key), 'Untagged'].map(c => opt(c, _finFilt.necessity)).join('')}</select>
      <select class="filter-select" id="fltMethod"><option value="">All methods</option>${methods.map(c => opt(c, _finFilt.method)).join('')}</select>
      ${_finDay ? `<span class="fin-daychip"><i class="bi bi-calendar3 me-1"></i>${fmtDate(_finDay)}<button id="fltDayX" title="Clear day"><i class="bi bi-x"></i></button></span>` : ''}
      ${activeFilters ? `<button class="btn btn-ghost btn-sm" id="fltClear"><i class="bi bi-x-circle me-1"></i>Clear ${activeFilters} filter${activeFilters === 1 ? '' : 's'}</button>` : ''}
      <span class="ms-auto text-faint" style="font-size:12px">
        ${rows.length} of ${source.length} record${source.length === 1 ? '' : 's'}${_finScope === 'all' ? ' across every month' : ''}${rows.length !== source.length ? ` · ${fmtBDT(rows.reduce((n, t) => n + (Number(t.amount) || 0), 0))} shown` : ''}
      </span>
      <button class="btn btn-soft btn-sm" id="finAdd2"><i class="bi bi-plus-lg me-1"></i>Add</button>
    </div>`;

  if (!rows.length) {
    // An empty month is worth saying out loud when there IS history elsewhere.
    const elsewhere = _finScope === 'month' && !s.tx.length && FinanceDB.all().length;
    return bar + `<div class="empty" style="padding:40px 20px"><div class="e-ico"><i class="bi bi-receipt"></i></div>
      <b>${source.length ? 'Nothing matches those filters' : elsewhere ? 'Nothing recorded this month' : 'No transactions yet'}</b>
      <p>${source.length ? 'Loosen a filter or clear the search to see the rest.'
        : elsewhere ? 'Your earlier months are all still on file — switch to <b>All months</b> above, or open the <b>Months</b> tab.'
        : 'Add your income, deposits and expenses to see the full picture.'}</p></div>`;
  }

  // group by day, newest first, with a per-day net
  const days = [];
  rows.forEach(t => {
    const d = days.find(x => x.date === t.date);
    (d || days[days.push({ date: t.date, items: [] }) - 1]).items.push(t);
  });

  const sel = _finSel;
  const bulk = sel.size ? `
    <div class="fin-bulk">
      <b>${sel.size} selected</b>
      <select class="filter-select" id="bulkNeed"><option value="">Tag necessity…</option>
        ${FIN_NEED.map(n => `<option>${n.key}</option>`).join('')}<option value="__clear">Clear tag</option></select>
      <select class="filter-select" id="bulkCat"><option value="">Set category…</option>${cats.map(c => opt(c, '')).join('')}</select>
      <button class="btn btn-ghost btn-sm text-danger" id="bulkDel"><i class="bi bi-trash me-1"></i>Delete</button>
      <button class="btn btn-ghost btn-sm ms-auto" id="bulkNone">Clear selection</button>
    </div>` : '';

  return bar + bulk + `
  <div class="fin-tablewrap">
  <table class="dt fin-dt"><thead><tr>
    <th style="width:34px"><input type="checkbox" id="selAll" title="Select all shown" ${sel.size && sel.size === rows.length ? 'checked' : ''}></th>
    <th>Detail</th><th style="width:150px">Category</th><th style="width:135px">Necessity</th>
    <th style="width:120px">Method</th><th style="width:120px;text-align:right">Amount</th><th style="width:70px"></th>
  </tr></thead>
  <tbody>
  ${days.map(d => {
    const net = d.items.reduce((n, t) => n + (t.type === 'income' ? 1 : -1) * (Number(t.amount) || 0), 0);
    return `<tr class="fin-dayrow"><td colspan="5"><b>${fmtDate(d.date)}</b>
        <span class="text-faint">${d.items.length} record${d.items.length === 1 ? '' : 's'}</span></td>
      <td colspan="2" style="text-align:right" class="num ${net >= 0 ? 'fin-pos' : 'fin-neg'}">${net >= 0 ? '+' : '−'}${fmtBDT(Math.abs(net))}</td></tr>
    ` + d.items.map(t => {
      const inc = t.type === 'income', dep = t.type === 'deposit';
      const fallback = inc ? 'Income' : dep ? 'Deposit' : 'Expense';
      const amtCls = inc ? 'fin-pos' : dep ? 'fin-dep' : 'fin-neg';
      return `<tr${dep ? ' class="is-deposit"' : ''}${sel.has(t.id) ? ' data-sel="1"' : ''}>
        <td><input type="checkbox" class="fin-rowsel" data-id="${escapeHtml(t.id)}" ${sel.has(t.id) ? 'checked' : ''}></td>
        <td class="name-cell"><b>${escapeHtml(t.note || fallback)}</b>
          ${dep ? '<small><i class="bi bi-bank"></i> deposited — kept, not spent</small>' : ''}
          ${t.recurring && t.recurring !== 'One-time' ? `<small title="Marked as recurring for your reference — it is not added to future months automatically"><i class="bi bi-arrow-repeat"></i> ${escapeHtml(t.recurring)}</small>` : ''}</td>
        <td>${escapeHtml(t.category || '—')}</td>
        <td>${(inc || dep)
          ? '<span class="text-faint">—</span>'
          : `<button class="chip fin-needchip t-${FIN_NEED_TONE[t.necessity] || 'slate'}" data-need="${escapeHtml(t.id)}"
               title="Click to retag — no need to open the record"><span class="dot"></span>${escapeHtml(t.necessity || 'Untagged')}</button>`}</td>
        <td class="text-soft">${escapeHtml(t.method || '—')}</td>
        <td style="text-align:right" class="num ${amtCls}">${inc ? fmtBDT(t.amount, true) : '−' + fmtBDT(t.amount)}</td>
        <td><div class="row-actions"><button title="Edit" data-fe="${escapeHtml(t.id)}"><i class="bi bi-pencil"></i></button>
          <button class="del" title="Delete" data-fd="${escapeHtml(t.id)}"><i class="bi bi-trash"></i></button></div></td>
      </tr>`;
    }).join('');
  }).join('')}
  </tbody></table></div>`;
}

/* ---- Calendar heatmap: the month's rhythm at a glance -------------- */
function finCalendarHtml(s) {
  const [y, m] = _finMonth.split('-').map(Number);
  const daysIn = new Date(y, m, 0).getDate();
  const pad = new Date(y, m - 1, 1).getDay();
  const per = {};
  s.tx.forEach(t => {
    const d = per[t.date] || (per[t.date] = { in: 0, out: 0, dep: 0, n: 0 });
    const amt = Number(t.amount) || 0;
    if (t.type === 'income') d.in += amt; else if (t.type === 'deposit') d.dep += amt; else d.out += amt;
    d.n++;
  });
  const maxOut = Math.max(1, ...Object.values(per).map(d => d.out));
  const todayISO = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < pad; i++) cells.push('<span class="fin-cell is-pad"></span>');
  for (let day = 1; day <= daysIn; day++) {
    const iso = `${_finMonth}-${String(day).padStart(2, '0')}`;
    const d = per[iso];
    const heat = d ? Math.min(1, d.out / maxOut) : 0;
    const tip = d
      ? `${fmtDate(iso)} · ${d.n} record${d.n === 1 ? '' : 's'}${d.in ? ' · in ' + fmtBDTk(d.in) : ''}${d.out ? ' · spent ' + fmtBDTk(d.out) : ''}${d.dep ? ' · deposited ' + fmtBDTk(d.dep) : ''}`
      : `${fmtDate(iso)} · nothing logged`;
    cells.push(`<button class="fin-cell ${d ? 'has' : ''} ${_finDay === iso ? 'on' : ''} ${iso === todayISO ? 'is-today' : ''}"
      data-day="${iso}" style="--heat:${heat.toFixed(3)}" title="${escapeHtml(tip)}">
      <span class="fc-d">${day}</span>
      ${d && d.out ? `<span class="fc-a num">${fmtBDTk(d.out)}</span>` : ''}
      <span class="fc-dots">${d && d.in ? '<i class="t-green"></i>' : ''}${d && d.dep ? '<i class="t-blue"></i>' : ''}</span>
    </button>`);
  }

  const busiest = Object.entries(per).sort((a, b) => b[1].out - a[1].out)[0];
  const spendDays = Object.values(per).filter(d => d.out > 0).length;
  return `
  <div class="fin-calhead">
    <span class="section-title mb-0"><i class="bi bi-calendar3 me-1"></i>${escapeHtml(finMonthLabel(_finMonth))} · daily rhythm</span>
    <span class="text-faint" style="font-size:12px">
      ${spendDays} spending day${spendDays === 1 ? '' : 's'}${busiest ? ` · heaviest ${fmtDate(busiest[0])} at ${fmtBDT(busiest[1].out)}` : ''} — click a day to open it in the ledger</span>
  </div>
  <div class="fin-cal">
    ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<span class="fin-caldow">${d}</span>`).join('')}
    ${cells.join('')}
  </div>
  <div class="fin-legend"><span><i class="dot t-red"></i>Shade = how much you spent</span><span><i class="dot t-green"></i>Income that day</span><span><i class="dot t-blue"></i>Deposit that day</span></div>`;
}

/* ---- Breakdown: the sector + payment-method detail ----------------- */
function finBreakdownHtml(s) {
  const maxIn = Math.max(1, ...s.incomeSectors.map(x => x[1]));
  const maxOut = Math.max(1, ...s.expenseSectors.map(x => x[1]));
  const needMax = Math.max(1, s.totalOut);
  return `
  <div class="fin-split">
    <div>
      <div class="section-title"><i class="bi bi-clipboard-heart me-1"></i>Was it worth it? · Spending quality</div>
      <div class="fin-need">
        ${FIN_NEED.map(n => {
          const amt = s.byNeed[n.key] || 0;
          const pct = s.totalOut > 0 ? (amt / s.totalOut * 100) : 0;
          return `<div class="fin-need-cell">
            <div class="fin-need-top"><span class="stat-ico-sm t-${n.tone}"><i class="bi bi-${n.ico}"></i></span>
              <div><b>${n.key}</b><small>${n.desc}</small></div>
              <span class="fin-need-amt num t-${n.tone}">${fmtBDT(amt)}</span></div>
            <div class="fin-bar-track"><span class="t-${n.tone}" style="width:${Math.max(pct > 0 ? 3 : 0, pct)}%"></span></div>
            <div class="fin-need-pct">${pct.toFixed(0)}% of spend</div>
          </div>`;
        }).join('')}
      </div>
      ${s.untagged > 0 ? `<div class="fin-untagged"><i class="bi bi-question-circle me-1"></i>
        <b>${fmtBDT(s.untagged)}</b> (${(s.untagged / needMax * 100).toFixed(0)}% of spend) has no necessity tag yet, so it is
        counted in your spending but left out of these bands — it is never guessed for you.
        <button class="btn btn-ghost btn-sm" id="finTagGo"><i class="bi bi-tags me-1"></i>Tag them now</button></div>` : ''}
    </div>
    <div>
      <div class="section-title"><i class="bi bi-wallet2 me-1"></i>By payment method</div>
      ${(s.byMethodIn.length || s.byMethodOut.length || s.byMethodDep.length) ? [
        ['Money in', s.byMethodIn, 'green', 'arrow-down-left'],
        ['Money out', s.byMethodOut, 'red', 'arrow-up-right'],
        ['Deposited', s.byMethodDep, 'blue', 'bank']
      ].filter(([, rows]) => rows.length).map(([label, rows, tone, ico]) => `
        <div class="fin-subhead"><i class="bi bi-${ico} me-1"></i>${label}</div>
        ${rows.map(([mm, a]) => finBarRow(mm, a, Math.max(1, ...rows.map(x => x[1])), tone)).join('')}`).join('')
        : '<p class="text-faint" style="font-size:13px">Nothing logged this month.</p>'}
    </div>
  </div>
  <div class="fin-split" style="margin-top:22px">
    <div>
      <div class="section-title"><i class="bi bi-arrow-down-left-circle me-1"></i>Where money came from</div>
      ${s.incomeSectors.length ? s.incomeSectors.map(([c, a]) => finBarRow(c, a, maxIn, 'green')).join('')
        : '<p class="text-faint" style="font-size:13px">No income logged this month.</p>'}
    </div>
    <div>
      <div class="section-title"><i class="bi bi-arrow-up-right-circle me-1"></i>Where money went</div>
      ${s.expenseSectors.length ? s.expenseSectors.map(([c, a]) => finBarRow(c, a, maxOut, 'red')).join('')
        : '<p class="text-faint" style="font-size:13px">No expenses logged this month.</p>'}
      ${s.depositSectors.length ? `
        <div class="fin-subhead"><i class="bi bi-bank me-1"></i>Deposited (not spending)</div>
        ${s.depositSectors.map(([c, a]) => finBarRow(c, a, Math.max(1, ...s.depositSectors.map(x => x[1])), 'blue')).join('')}` : ''}
    </div>
  </div>`;
}

/* ---- Trends: 12 months of flow, with the kept-rate on top ---------- */
function finTrendsHtml(s) {
  const trend = [];
  for (let i = 11; i >= 0; i--) {
    const k = finShiftMonth(_finMonth, -i);
    const t = finSummary(k);
    trend.push({ k, in: t.totalIn, out: t.totalOut, dep: t.totalDeposit, rate: t.savingsRate, count: t.count });
  }
  const max = Math.max(1, ...trend.flatMap(t => [t.in, t.out, t.dep]));
  const anyDep = trend.some(t => t.dep > 0);
  const live = trend.filter(t => t.count);
  const avgOut = live.length ? live.reduce((n, t) => n + t.out, 0) / live.length : 0;
  const avgRate = live.length ? live.reduce((n, t) => n + t.rate, 0) / live.length : 0;
  const budget = FinanceDB.data.monthlyBudget || 0;

  return `
  <div class="fin-calhead">
    <span class="section-title mb-0"><i class="bi bi-bar-chart-line me-1"></i>Last 12 months</span>
    <span class="text-faint" style="font-size:12px">
      Average spend ${fmtBDT(avgOut)} · average kept ${avgRate.toFixed(0)}% — click a month to travel</span>
  </div>
  <div class="fin-trend is-year">
    ${budget > 0 && budget <= max ? `<span class="fin-budgetline" style="bottom:${budget / max * 100}%" title="Monthly budget ${fmtBDT(budget)}"><b>budget</b></span>` : ''}
    ${trend.map(t => `<div class="fin-tcol ${t.k === _finMonth ? 'is-cur' : ''}" data-scrub2="${t.k}" title="${escapeHtml(finMonthLabel(t.k))} · in ${fmtBDTk(t.in)} · out ${fmtBDTk(t.out)}${t.dep ? ' · dep ' + fmtBDTk(t.dep) : ''}">
      <div class="fin-tbars">
        <span class="fin-tbar t-green" style="height:${t.in / max * 100}%"></span>
        <span class="fin-tbar t-red" style="height:${t.out / max * 100}%"></span>
        ${anyDep ? `<span class="fin-tbar t-blue" style="height:${t.dep / max * 100}%"></span>` : ''}
      </div>
      <div class="fin-tlabel">${finMonthLabel(t.k).slice(0, 3)}</div>
    </div>`).join('')}
  </div>
  <div class="fin-legend"><span><i class="dot t-green"></i>Income</span><span><i class="dot t-red"></i>Expense</span>${anyDep ? '<span><i class="dot t-blue"></i>Deposited</span>' : ''}</div>`;
}

/* ---- Months: the archive. Every month you have ever recorded ------- */
function finMonthsHtml() {
  const months = finAllMonths().reverse();
  if (!months.length) return `<div class="empty" style="padding:40px"><div class="e-ico"><i class="bi bi-archive"></i></div><b>No history yet</b><p>Once you record a month it is kept here for good.</p></div>`;
  const closes = finCloses();

  // Every month costed once, then rolled up for the all-time strip and the
  // per-year subtotals — the whole history in one place.
  const rows = months.map(k => ({ k, t: finSummary(k), c: finCarry(k) }));
  const life = rows.reduce((a, r) => ({
    in: a.in + r.t.totalIn, dep: a.dep + r.t.totalDeposit, out: a.out + r.t.totalOut, n: a.n + r.t.count
  }), { in: 0, dep: 0, out: 0, n: 0 });
  const latest = rows[0];                                  // months came in newest-first
  const vault = latest ? latest.c.vault : 0;
  const balance = latest ? latest.c.opening + latest.t.net : 0;
  const spendMonths = rows.filter(r => r.t.totalOut > 0);
  const avgOut = spendMonths.length ? life.out / spendMonths.length : 0;
  const lifeRate = life.in > 0 ? (life.in - life.out) / life.in * 100 : 0;

  return `
  <div class="fin-calhead">
    <span class="section-title mb-0"><i class="bi bi-archive me-1"></i>Month archive</span>
    <span class="text-faint" style="font-size:12px">Every month keeps its own records for good — the leftover of one opens the next.</span>
  </div>

  <div class="fin-lifetime">
    <div><span>Months tracked</span><b class="num">${rows.length}</b><small>${life.n} record${life.n === 1 ? '' : 's'}</small></div>
    <div><span>Earned all time</span><b class="num fin-pos">${fmtBDT(life.in)}</b><small>across every month</small></div>
    <div><span>Deposited all time</span><b class="num fin-dep">${fmtBDT(life.dep)}</b><small>vault now ${fmtBDTk(vault)}</small></div>
    <div><span>Spent all time</span><b class="num">${fmtBDT(life.out)}</b><small>${fmtBDT(avgOut)}/month average</small></div>
    <div><span>Kept all time</span><b class="num">${fmtBDT(life.in - life.out)}</b><small>${lifeRate.toFixed(0)}% of everything earned</small></div>
    <div><span>In hand now</span><b class="num">${fmtBDT(balance)}</b><small>after ${escapeHtml(finMonthLabel(latest ? latest.k : _finMonth))}</small></div>
  </div>

  <div class="fin-tablewrap">
  <table class="dt fin-dt"><thead><tr>
    <th>Month</th><th style="text-align:right">Opened</th><th style="text-align:right">In</th>
    <th style="text-align:right">Deposited</th><th style="text-align:right">Spent</th>
    <th style="text-align:right">Closed with</th><th style="width:78px">Quality</th><th style="width:150px"></th>
  </tr></thead><tbody>
  ${rows.map(({ k, t, c }, i) => {
    const q = finQuality(t);
    const rec = closes[k];
    // a year header + subtotal whenever the year changes going down the list
    const year = k.slice(0, 4);
    const isNewYear = i === 0 || rows[i - 1].k.slice(0, 4) !== year;
    const yr = isNewYear ? rows.filter(r => r.k.slice(0, 4) === year) : null;
    const yearRow = yr ? `<tr class="fin-yearrow">
      <td><b>${year}</b><span class="text-faint">${yr.length} month${yr.length === 1 ? '' : 's'}</span></td>
      <td></td>
      <td style="text-align:right" class="num fin-pos">${fmtBDTk(yr.reduce((n, r) => n + r.t.totalIn, 0))}</td>
      <td style="text-align:right" class="num fin-dep">${fmtBDTk(yr.reduce((n, r) => n + r.t.totalDeposit, 0))}</td>
      <td style="text-align:right" class="num">${fmtBDTk(yr.reduce((n, r) => n + r.t.totalOut, 0))}</td>
      <td colspan="3"></td></tr>` : '';
    return yearRow + `<tr class="${k === _finMonth ? 'is-cur' : ''}">
      <td class="name-cell"><b>${escapeHtml(finMonthLabel(k))}</b>
        <small>${t.count} record${t.count === 1 ? '' : 's'}${rec ? ` · closed ${fmtDate(String(rec.closedAt || '').slice(0, 10))}` : ''}</small>
        ${rec && rec.note ? `<small class="fin-notepeek"><i class="bi bi-sticky me-1"></i>${escapeHtml(rec.note)}</small>` : ''}</td>
      <td style="text-align:right" class="num text-soft">${c.on ? fmtBDT(c.opening) : '—'}</td>
      <td style="text-align:right" class="num fin-pos">${fmtBDTk(t.totalIn)}</td>
      <td style="text-align:right" class="num fin-dep">${fmtBDTk(t.totalDeposit)}</td>
      <td style="text-align:right" class="num">${fmtBDTk(t.totalOut)}</td>
      <td style="text-align:right" class="num"><b>${fmtBDT(c.opening + t.net)}</b></td>
      <td>${q.score != null ? `<span class="fin-gradepill t-${q.tone}">${q.grade}</span>` : '<span class="text-faint">—</span>'}</td>
      <td><div class="d-flex gap-1 justify-content-end">
        <button class="btn btn-ghost btn-sm" data-open="${k}" title="Open this month"><i class="bi bi-box-arrow-in-right"></i></button>
        ${rec
          ? `<button class="btn btn-ghost btn-sm" data-reopen="${k}" title="Reopen — removes the saved review, never the records"><i class="bi bi-unlock"></i></button>`
          : `<button class="btn btn-soft btn-sm" data-close="${k}" title="Review &amp; close"><i class="bi bi-check2-square"></i></button>`}
      </div></td>
    </tr>`;
  }).join('')}
  </tbody></table></div>`;
}

/* ---- Insights: the narrative, the radar and the what-if ------------ */
function finInsightsHtml(s) {
  const insights = finInsights(_finMonth, s);
  const rec = finRecurring(_finMonth);
  const recTotal = rec.filter(r => r.live).reduce((n, r) => n + r.avg, 0);
  const q = finQuality(s);

  return `
  <div class="section-title"><i class="bi bi-stars me-1"></i>What your money is telling you</div>
  <div class="fin-insights">
    ${insights.map(i => `<div class="fin-insight t-${i.tone}"><i class="bi bi-${i.ico}"></i><div>${i.text}</div></div>`).join('')}
    ${q.score != null ? `<div class="fin-insight t-${q.tone}"><i class="bi bi-award"></i><div>
      Spend quality <b>${q.grade}</b> (${q.score.toFixed(0)}/100) — the weighted mix of your <b>${fmtBDT(q.tagged)}</b> of tagged spending.
      Essential and Important lift it; Avoidable drags it to zero.</div></div>` : ''}
  </div>

  <div class="fin-split" style="margin-top:24px">
    <div>
      <div class="section-title"><i class="bi bi-arrow-repeat me-1"></i>Recurring radar</div>
      ${rec.length ? `
        <p class="text-faint" style="font-size:12.5px;margin:-4px 0 12px">
          Found in your own ledger — the same line paid across ${rec.length === 1 ? 'two or more months' : 'multiple months'}.
          ${recTotal > 0 ? `Still live this month: <b>${fmtBDT(recTotal)}/mo</b> ≈ <b>${fmtBDT(recTotal * 12)}/yr</b>.` : ''}
        </p>
        <div class="fin-recs">
          ${rec.slice(0, 8).map(r => `<div class="fin-rec ${r.live ? '' : 'is-past'}">
            <span class="fin-rec-ico t-${r.type === 'deposit' ? 'blue' : 'amber'}"><i class="bi bi-${r.type === 'deposit' ? 'bank' : 'arrow-repeat'}"></i></span>
            <div><b>${escapeHtml(r.label)}</b><small>${r.months} months${r.category ? ' · ' + escapeHtml(r.category) : ''}${r.live ? '' : ' · last seen ' + escapeHtml(finMonthLabel(r.last))}</small></div>
            <span class="num">${fmtBDT(r.avg)}<small>/mo avg</small></span>
          </div>`).join('')}
        </div>` : '<p class="text-faint" style="font-size:13px">Nothing repeats across months yet. Once a line shows up twice it lands here automatically.</p>'}
    </div>
    <div>
      <div class="section-title"><i class="bi bi-sliders2 me-1"></i>What if you trimmed the soft spend?</div>
      ${s.softSpend > 0 ? `
        <p class="text-faint" style="font-size:12.5px;margin:-4px 0 14px">
          <b>${fmtBDT(s.softSpend)}</b> sat in Avoidable + Discretionary this month. Drag to see what cutting part of it is worth.</p>
        <input type="range" class="fin-range" id="finWhatIf" min="0" max="100" step="5" value="30">
        <div class="fin-whatif" id="finWhatIfOut"></div>`
        : '<p class="text-faint" style="font-size:13px">No Avoidable or Discretionary spending tagged this month — nothing to trim.</p>'}
    </div>
  </div>`;
}

/* ---- Panel wiring (re-attached on every panel redraw) -------------- */
function finWirePanel(s) {
  const work = document.getElementById('finWork');
  if (!work) return;
  const redraw = () => finDrawPanel();

  // ledger: filters
  const set = (id, key) => { const el = document.getElementById(id); if (el) el.onchange = () => { _finFilt[key] = el.value; redraw(); }; };
  set('fltCat', 'category'); set('fltNeed', 'necessity'); set('fltMethod', 'method');
  // ledger: this month ⇄ every month (redraws the page so the search box,
  // which lives in the command bar, relabels itself too)
  work.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => {
    if (_finScope === b.dataset.scope) return;
    _finScope = b.dataset.scope; _finDay = ''; _finSel.clear();
    _finTab = 'ledger';
    drawAccounts();
  });
  document.getElementById('fltDayX')?.addEventListener('click', () => { _finDay = ''; redraw(); });
  document.getElementById('fltClear')?.addEventListener('click', () => {
    _finFilt = { category: '', necessity: '', method: '' }; _finDay = ''; _finQ = '';
    const box = document.getElementById('finSearch'); if (box) box.value = '';
    redraw();
  });
  document.getElementById('finAdd2')?.addEventListener('click', () => openFinanceModal(null));
  document.getElementById('finTagGo')?.addEventListener('click', () => {
    _finTab = 'ledger'; _finLens = 'expense'; _finFilt.necessity = 'Untagged'; drawAccounts();
  });

  // ledger: selection + bulk actions
  work.querySelectorAll('.fin-rowsel').forEach(cb => cb.onchange = () => {
    if (cb.checked) _finSel.add(cb.dataset.id); else _finSel.delete(cb.dataset.id);
    redraw();
  });
  const all = document.getElementById('selAll');
  if (all) all.onchange = () => {
    _finSel.clear();
    if (all.checked) finRows(s).forEach(t => _finSel.add(t.id));
    redraw();
  };
  document.getElementById('bulkNone')?.addEventListener('click', () => { _finSel.clear(); redraw(); });
  const bulkApply = (fn, msg) => {
    if (!Security.guard('edit finance data')) return;
    let n = 0;
    FinanceDB.data.tx.forEach(t => { if (_finSel.has(t.id)) { fn(t); n++; } });
    FinanceDB.save(); _finSel.clear();
    toast(`${msg} ${n} record${n === 1 ? '' : 's'}.`, 'ok');
    drawAccounts();
  };
  const bn = document.getElementById('bulkNeed');
  if (bn) bn.onchange = () => {
    const v = bn.value; if (!v) return;
    // deposits and income have no necessity band, so they are skipped
    bulkApply(t => { if (t.type === 'expense') t.necessity = (v === '__clear' ? '' : v); }, 'Retagged');
  };
  const bc = document.getElementById('bulkCat');
  if (bc) bc.onchange = () => { const v = bc.value; if (v) bulkApply(t => { t.category = v; }, 'Recategorised'); };
  document.getElementById('bulkDel')?.addEventListener('click', () => {
    if (!confirm(`Delete ${_finSel.size} selected record(s)? This cannot be undone.`)) return;
    if (!Security.guard('delete finance data')) return;
    FinanceDB.data.tx = FinanceDB.all().filter(t => !_finSel.has(t.id));
    FinanceDB.save(); _finSel.clear();
    toast('Deleted.', 'ok');
    drawAccounts();
  });

  // ledger: inline necessity retag — the fastest way to clear the untagged pile
  work.querySelectorAll('[data-need]').forEach(btn => btn.onclick = () => {
    const t = FinanceDB.get(btn.dataset.need);
    if (!t) return;
    const sel = document.createElement('select');
    sel.className = 'filter-select fin-needsel';
    sel.innerHTML = `<option value="">Untagged</option>` +
      FIN_NEED.map(n => `<option ${n.key === t.necessity ? 'selected' : ''}>${n.key}</option>`).join('');
    btn.replaceWith(sel);
    sel.focus();
    sel.onchange = () => {
      if (!Security.guard('edit finance data')) return;
      t.necessity = sel.value;
      FinanceDB.save();
      toast('Necessity updated.', 'ok');
      drawAccounts();
    };
    sel.onblur = () => redraw();
  });

  // ledger: row edit / delete
  work.querySelectorAll('[data-fe]').forEach(b => b.onclick = () => openFinanceModal(b.dataset.fe));
  work.querySelectorAll('[data-fd]').forEach(b => b.onclick = () => {
    if (!Security.guard('delete finance data')) return;
    if (confirm('Delete this transaction?')) { FinanceDB.remove(b.dataset.fd); toast('Deleted.', 'ok'); drawAccounts(); }
  });

  // calendar: a day opens in the ledger
  work.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    _finDay = (_finDay === b.dataset.day) ? '' : b.dataset.day;
    _finTab = 'ledger';
    redraw();
  });

  // trends: click a column to travel
  work.querySelectorAll('[data-scrub2]').forEach(b => b.onclick = () => {
    _finMonth = b.dataset.scrub2; _finDay = ''; _finSel.clear(); drawAccounts();
  });

  // months archive
  work.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { _finMonth = b.dataset.open; _finDay = ''; drawAccounts(); });
  work.querySelectorAll('[data-close]').forEach(b => b.onclick = () => openFinanceClose(b.dataset.close));
  work.querySelectorAll('[data-reopen]').forEach(b => b.onclick = () => {
    if (!confirm('Reopen this month? Only the saved review note is removed — every transaction stays exactly where it is.')) return;
    if (!Security.guard('edit finance data')) return;
    delete finCloses()[b.dataset.reopen];
    FinanceDB.save();
    toast('Month reopened.', 'ok');
    drawAccounts();
  });

  // insights: what-if slider
  const wi = document.getElementById('finWhatIf');
  if (wi) {
    const out = document.getElementById('finWhatIfOut');
    const paint = () => {
      const pct = Number(wi.value);
      const save = s.softSpend * pct / 100;
      out.innerHTML = `<div class="fw-v num">${fmtBDT(save)}<small>/month</small></div>
        <div class="fw-l">Cutting <b>${pct}%</b> of soft spend puts <b>${fmtBDT(save * 12)}</b> away in a year${
          s.totalIn > 0 ? ` — lifting this month's kept rate to <b>${Math.min(100, (s.kept + save) / s.totalIn * 100).toFixed(0)}%</b>` : ''}.</div>`;
    };
    wi.oninput = paint;
    paint();
  }
}

/* ---- Month close: a saved review, never a lock --------------------
   Closing writes ONE new entry under `closes` (your note + the figures
   as they stood). It does not touch, freeze or move a single record —
   reopening simply deletes that entry. Optionally it copies the lines
   you tick into the next month as brand-new records. */
function openFinanceClose(mk) {
  if (!Security.guard('close a month')) return;
  document.getElementById('finCloseModal')?.remove();
  const s = finSummary(mk);
  const c = finCarry(mk);
  const q = finQuality(s);
  const closing = c.opening + s.net;
  const nextKey = finShiftMonth(mk, 1);
  const prevClose = finCloses()[mk];

  // monthly-tagged lines are the natural candidates to bring forward
  const repeats = s.tx.filter(t => t.recurring === 'Monthly');

  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="finCloseModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <div class="d-flex align-items-center gap-2"><span class="stat-ico"><i class="bi bi-calendar-check"></i></span>
            <h5 class="modal-title">Close ${escapeHtml(finMonthLabel(mk))}</h5></div>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="fin-closegrid">
            <div><span>Income</span><b class="num fin-pos">${fmtBDT(s.totalIn)}</b></div>
            <div><span>Deposited</span><b class="num fin-dep">${fmtBDT(s.totalDeposit)}</b></div>
            <div><span>Spent</span><b class="num">${fmtBDT(s.totalOut)}</b></div>
            <div><span>Kept</span><b class="num">${fmtBDT(s.kept)} · ${s.savingsRate.toFixed(0)}%</b></div>
            <div><span>Quality</span><b>${q.score != null ? q.grade + ' · ' + q.score.toFixed(0) + '/100' : '—'}</b></div>
            <div><span>Vault after</span><b class="num">${fmtBDT(c.vault)}</b></div>
          </div>

          <div class="fin-carrynote">
            <i class="bi bi-arrow-right-circle"></i>
            <div>${c.on
              ? `<b>${fmtBDT(closing)}</b> carries into <b>${escapeHtml(finMonthLabel(nextKey))}</b> as its opening balance
                 (${fmtBDT(c.opening)} opened + ${fmtBDT(s.net)} this month). This happens on its own — closing just files the month.`
              : `Carry-forward is <b>off</b>, so ${escapeHtml(finMonthLabel(nextKey))} starts at zero. Turn it on in <b>Categories &amp; budget</b> if you want leftovers to roll.`}</div>
          </div>

          <div class="field" style="margin-top:16px"><label>Note for the archive <span class="text-faint">(optional)</span></label>
            <input type="text" id="finCloseNote" value="${escapeHtml(prevClose && prevClose.note || '')}" placeholder="e.g. Tuition paid early; travel pushed spend up."></div>

          ${repeats.length ? `
          <div class="card card-pad" style="margin-top:16px">
            <div class="d-flex align-items-center gap-2 mb-2"><span class="stat-ico-sm t-primary"><i class="bi bi-arrow-repeat"></i></span>
              <b>Bring monthly items into ${escapeHtml(finMonthLabel(nextKey))}?</b></div>
            <p class="text-faint" style="font-size:12.5px">These are marked <b>Monthly</b> in ${escapeHtml(finMonthLabel(mk))}. Ticking one creates a
              <b>new</b> record next month — the original is never touched. Amounts stay editable afterwards.</p>
            <div class="fin-repeats">
              ${repeats.map(t => `<label class="fin-repeat"><input type="checkbox" data-rep="${escapeHtml(t.id)}">
                <span><b>${escapeHtml(t.note || t.category || t.type)}</b><small>${escapeHtml(t.category || '—')} · ${fmtDate(t.date)}</small></span>
                <span class="num">${fmtBDT(t.amount)}</span></label>`).join('')}
            </div>
          </div>` : ''}

          <p class="text-faint" style="font-size:12px;margin-top:14px">
            <i class="bi bi-shield-check me-1"></i>Closing is reversible and never edits your records — ${escapeHtml(finMonthLabel(mk))} keeps every
            transaction exactly as it is, and you can still add to it later.</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="finCloseSave"><i class="bi bi-check-lg me-1"></i>Close month</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('finCloseModal');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());

  document.getElementById('finCloseSave').onclick = () => {
    if (!Security.guard('close a month')) return;
    // copy forward only what was ticked — as new records, same day next month
    const picked = [...modalEl.querySelectorAll('[data-rep]:checked')].map(cb => FinanceDB.get(cb.dataset.rep)).filter(Boolean);
    const [ny, nm] = nextKey.split('-').map(Number);
    const lastDay = new Date(ny, nm, 0).getDate();
    const copies = picked.map(t => ({
      type: t.type, amount: t.amount, category: t.category, necessity: t.necessity,
      method: t.method, recurring: t.recurring, note: t.note,
      date: `${nextKey}-${String(Math.min(Number(String(t.date).slice(-2)) || 1, lastDay)).padStart(2, '0')}`
    }));

    finCloses()[mk] = {
      closedAt: new Date().toISOString(),
      note: document.getElementById('finCloseNote').value.trim(),
      // the figures as they stood at close; live numbers keep recomputing
      snapshot: { in: s.totalIn, out: s.totalOut, deposit: s.totalDeposit, net: s.net, opening: c.opening, closing, score: q.score }
    };
    FinanceDB.save();
    const n = finAddMany(copies);
    _finRollDismissed = '';
    toast(`${finMonthLabel(mk)} closed${n ? ` · ${n} item${n === 1 ? '' : 's'} carried into ${finMonthLabel(nextKey)}` : ''}.`, 'ok');
    modal.hide();
    drawAccounts();
  };
}

/* ---- Add / edit a transaction (dedicated private modal) ---- */
function openFinanceModal(id) {
  if (!Security.guard(id ? 'edit this record' : 'add a record')) return;
  const rec = id ? Object.assign({}, FinanceDB.get(id)) : { type: 'expense', date: new Date().toISOString().slice(0, 10), recurring: 'One-time', necessity: 'Essential', method: 'Cash' };
  const isEdit = !!id;
  document.getElementById('finModal')?.remove();

  const catOpts = (type) => type === 'income' ? FIN_CATS('incomeCategories')
    : type === 'deposit' ? FIN_CATS('depositCategories')
      : FIN_CATS('expenseCategories');
  const optionList = (arr, sel) => arr.map(o => `<option ${o === sel ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');

  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="finModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <div class="d-flex align-items-center gap-2">
            <span class="stat-ico"><i class="bi bi-cash-coin"></i></span>
            <h5 class="modal-title">${isEdit ? 'Edit' : 'Add'} transaction</h5>
          </div>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="fin-typetoggle is-3" id="finType">
            <button type="button" data-t="expense" class="${(rec.type || 'expense') === 'expense' ? 'on' : ''}"><i class="bi bi-arrow-up-right"></i> Expense</button>
            <button type="button" data-t="income" class="${rec.type === 'income' ? 'on' : ''}"><i class="bi bi-arrow-down-left"></i> Income</button>
            <button type="button" data-t="deposit" class="${rec.type === 'deposit' ? 'on' : ''}"><i class="bi bi-bank"></i> Deposit</button>
          </div>
          <p class="fin-typehint" id="finTypeHint"></p>
          <form id="finForm" class="form-grid" style="margin-top:16px">
            <div class="field col-span"><label>Amount (৳) <span class="req">*</span></label>
              <input type="number" name="amount" min="0" step="0.01" inputmode="decimal" value="${rec.amount != null ? rec.amount : ''}" placeholder="0"></div>
            <div class="field"><label>Date <span class="req">*</span></label><input type="date" name="date" value="${escapeHtml(rec.date || '')}"></div>
            <div class="field"><label>Category</label><select name="category" id="finCat">
              <option value="">— Select —</option>${optionList(catOpts(rec.type), rec.category)}</select></div>
            <div class="field" id="finNeedField"><label>Necessity — was it worth it?</label><select name="necessity">
              ${FIN_NEED.map(n => `<option ${n.key === rec.necessity ? 'selected' : ''}>${n.key}</option>`).join('')}</select></div>
            <div class="field"><label>Payment method</label><select name="method">${optionList(FIN_CATS('methods'), rec.method)}</select></div>
            <div class="field"><label>Repeats</label><select name="recurring">
              ${['One-time', 'Daily', 'Weekly', 'Monthly', 'Yearly'].map(o => `<option ${o === rec.recurring ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
            <div class="field col-span"><label>Note / detail</label>
              <input type="text" name="note" value="${escapeHtml(rec.note || '')}" placeholder="e.g. Groceries at Shwapno, freelance milestone…"></div>
          </form>
        </div>
        <div class="modal-footer">
          ${isEdit ? '<button type="button" class="btn btn-danger-soft me-auto" id="finDel"><i class="bi bi-trash me-1"></i>Delete</button>' : ''}
          <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="finSave"><i class="bi bi-check-lg me-1"></i>${isEdit ? 'Save changes' : 'Add transaction'}</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('finModal');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());

  const TYPE_HINT = {
    expense: 'Money that is gone. Tag how necessary it was to build your spending-quality picture.',
    income: 'Money that came in.',
    deposit: 'Money you kept — savings, DPS, FDR, shares. Subtracted from spendable income and never counted as spending.'
  };
  let curType = rec.type || 'expense';
  const syncType = () => {
    modalEl.querySelectorAll('#finType button').forEach(b => b.classList.toggle('on', b.dataset.t === curType));
    // refresh category options + show/hide necessity (only expenses have one)
    const catSel = document.getElementById('finCat');
    const cur = catSel.value;
    catSel.innerHTML = `<option value="">— Select —</option>` + optionList(catOpts(curType), cur);
    document.getElementById('finNeedField').style.display = curType === 'expense' ? '' : 'none';
    const hint = document.getElementById('finTypeHint');
    if (hint) hint.textContent = TYPE_HINT[curType] || '';
  };
  syncType();
  modalEl.querySelectorAll('#finType button').forEach(b => b.onclick = () => { curType = b.dataset.t; syncType(); });

  if (isEdit) document.getElementById('finDel').onclick = () => {
    if (confirm('Delete this transaction?')) { FinanceDB.remove(id); toast('Deleted.', 'ok'); modal.hide(); drawAccounts(); }
  };

  document.getElementById('finSave').onclick = () => {
    const f = document.getElementById('finForm');
    const amount = parseFloat(f.elements.namedItem('amount').value);
    if (!(amount > 0)) { toast('Enter an amount greater than zero.', 'err'); f.elements.namedItem('amount').focus(); return; }
    const date = f.elements.namedItem('date').value;
    if (!date) { toast('Pick a date.', 'err'); return; }
    const out = {
      id: id || undefined,
      type: curType,
      amount,
      date,
      category: f.elements.namedItem('category').value,
      // only an expense carries a necessity band
      necessity: curType === 'expense' ? f.elements.namedItem('necessity').value : '',
      method: f.elements.namedItem('method').value,
      recurring: f.elements.namedItem('recurring').value,
      note: f.elements.namedItem('note').value.trim()
    };
    const saved = FinanceDB.upsert(out);
    if (!saved) return;
    toast(`Transaction ${isEdit ? 'updated' : 'added'}.`, 'ok');
    modal.hide();
    drawAccounts();
  };
}

/* ---- Finance settings: edit categories + budget + savings goal ---- */
function openFinanceSettings() {
  if (!Security.guard('manage finance settings')) return;
  document.getElementById('finSetModal')?.remove();
  const d = FinanceDB.data;
  const groups = [
    { key: 'incomeCategories', label: 'Income categories', ico: 'arrow-down-left' },
    { key: 'expenseCategories', label: 'Expense categories', ico: 'arrow-up-right' },
    { key: 'depositCategories', label: 'Deposit categories (money you keep)', ico: 'bank' },
    { key: 'methods', label: 'Payment methods', ico: 'wallet2' }
  ];
  const chips = (key) => FIN_CATS(key).map((v, i) => `<span class="chip chip-outline" style="padding-right:4px">${escapeHtml(v)}
    <button class="btn p-0 ms-1" style="line-height:0;color:var(--text-faint)" data-rmc="${key}" data-i="${i}"><i class="bi bi-x"></i></button></span>`).join('') || '<span class="text-faint" style="font-size:12px">None.</span>';

  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="finSetModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <div class="d-flex align-items-center gap-2"><span class="stat-ico"><i class="bi bi-sliders"></i></span>
            <h5 class="modal-title">Finance settings</h5></div>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="form-grid mb-3">
            <div class="field"><label>Monthly budget (৳)</label><input type="number" id="finBudget" min="0" step="100" value="${d.monthlyBudget || ''}" placeholder="e.g. 30000"></div>
            <div class="field"><label>Monthly savings goal (৳)</label><input type="number" id="finGoal" min="0" step="100" value="${d.savingsGoal || ''}" placeholder="e.g. 8000"></div>
          </div>

          <!-- Month rollover. Every record always stays filed under its own
               month; these two settings only decide how the leftover travels. -->
          <div class="card card-pad mb-3">
            <div class="d-flex align-items-center gap-2 mb-2"><span class="stat-ico-sm t-primary"><i class="bi bi-arrow-right-circle"></i></span>
              <b>Month rollover</b></div>
            <label class="fin-switch">
              <input type="checkbox" id="finCarry" ${d.carryForward !== false ? 'checked' : ''}>
              <span><b>Carry the leftover into the next month</b>
                <small>What is left at the end of a month becomes the next month's opening balance, worked out live from your records — so a late entry still corrects it later.</small></span>
            </label>
            <div class="field" style="margin-top:14px"><label>Starting balance before your first record (৳)</label>
              <input type="number" id="finOpening" step="100" value="${d.openingBalance || ''}" placeholder="0">
              <small class="text-faint" style="font-size:11.5px">Cash you already had when you began tracking. Anchors every opening balance after it.</small></div>
          </div>
          ${groups.map(g => `<div class="card card-pad mb-3" data-grp="${g.key}">
            <div class="d-flex align-items-center gap-2 mb-3"><span class="stat-ico-sm t-primary"><i class="bi bi-${g.ico}"></i></span><b>${g.label}</b></div>
            <div class="d-flex flex-wrap gap-2 mb-3" data-chips="${g.key}">${chips(g.key)}</div>
            <div class="input-group">
              <input type="text" class="form-control" placeholder="Add new…" data-addc="${g.key}" style="border-radius:10px 0 0 10px;border:1px solid var(--line)">
              <button class="btn btn-soft" data-addbtn="${g.key}" style="border-radius:0 10px 10px 0"><i class="bi bi-plus-lg"></i></button>
            </div>
          </div>`).join('')}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Close</button>
          <button type="button" class="btn btn-primary" id="finSetSave"><i class="bi bi-check-lg me-1"></i>Save settings</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('finSetModal');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => { wrap.remove(); drawAccounts(); });

  const redrawChips = (key) => { modalEl.querySelector(`[data-chips="${key}"]`).innerHTML = chips(key); bindChipRemovers(); };
  const addC = (key) => {
    const inp = modalEl.querySelector(`[data-addc="${key}"]`);
    const v = (inp.value || '').trim(); if (!v) return;
    if (FIN_CATS(key).includes(v)) { toast('Already there.', 'err'); return; }
    d.categories[key].push(v); FinanceDB.save(); inp.value = ''; redrawChips(key);
  };
  const bindChipRemovers = () => modalEl.querySelectorAll('[data-rmc]').forEach(b => b.onclick = () => {
    d.categories[b.dataset.rmc].splice(Number(b.dataset.i), 1); FinanceDB.save(); redrawChips(b.dataset.rmc);
  });
  bindChipRemovers();
  modalEl.querySelectorAll('[data-addbtn]').forEach(b => b.onclick = () => addC(b.dataset.addbtn));
  modalEl.querySelectorAll('[data-addc]').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addC(inp.dataset.addc); } }));
  document.getElementById('finSetSave').onclick = () => {
    d.monthlyBudget = parseFloat(document.getElementById('finBudget').value) || 0;
    d.savingsGoal = parseFloat(document.getElementById('finGoal').value) || 0;
    d.carryForward = !!document.getElementById('finCarry').checked;
    d.openingBalance = parseFloat(document.getElementById('finOpening').value) || 0;
    FinanceDB.save(); toast('Settings saved.', 'ok'); modal.hide();
    if (document.getElementById('acctHost')) drawAccounts();
  };
}

/* ==========================================================
   6.8  WORK SHEET — private professional to-do / control sheet
   ----------------------------------------------------------
   OWNER-ONLY & PRIVATE, on the same footing as Accounts: the page
   is redirect-protected (Security.PROTECTED_PAGES), reachable only
   from the owner-only briefcase icon in the top bar.

   WHY THERE IS NO CONTENT IN THIS FILE
   This repository is PUBLIC. Anything hard-coded here is readable
   at github.com/… and /assets/js/app.js even though work.html
   itself is login-gated — a runtime gate cannot hide source code.
   The sheet names people, payroll internals and staff-monitoring
   rules, so only the RENDERER ships. The content lives solely in:
     • localStorage `pomls_work_v1`           (instant, offline)
     • Firestore  opptrack_private/worksheet  (owner-only rule —
       the same `match /opptrack_private/{doc}` rule Accounts uses,
       so no new Firestore rule is needed)
   Load it once via "Import sheet" from a JSON file kept off the
   repo (data/work-seed.json is git-ignored).

   Ticks are stored per month, so each month starts clean while
   previous months stay on file.
   ========================================================== */
const WORK_STORE_KEY = 'pomls_work_v1';

/* ---- WorkDB : the private storage layer (mirrors FinanceDB) ---- */
const WorkDB = {
  data: null,
  _clientId: 'w-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
  _unsub: null,
  _saveTimer: null,
  _doc() {
    if (typeof fbDB === 'undefined' || !fbDB) return null;
    // Same private collection as Accounts — deliberately NOT under
    // `opptrack`, so no public rule on the portfolio doc can ever match.
    try { return fbDB.collection('opptrack_private').doc('worksheet'); } catch { return null; }
  },
  _hydrate(raw) {
    const d = (raw && typeof raw === 'object') ? raw : {};
    if (!Array.isArray(d.workstreams)) d.workstreams = [];
    if (!Array.isArray(d.depts)) d.depts = [];
    if (!Array.isArray(d.cadence)) d.cadence = [];
    if (!Array.isArray(d.close)) d.close = [];
    if (!d.checks || typeof d.checks !== 'object') d.checks = {};
    /* Drive mirror bookkeeping: the target folder and the ids of the docs the
       mirror owns. IDs ONLY — never sheet content, and deliberately not in the
       repo either: a folder id in public source is a live pointer into your
       Drive. Additive with safe defaults, so an older stored sheet simply
       gains an empty map and no stored record is rewritten. */
    if (!d.drive || typeof d.drive !== 'object') d.drive = {};
    if (!d.drive.depts || typeof d.drive.depts !== 'object') d.drive.depts = {};

    /* ---- Fold the imported checklist into sub-tasks ----
       The imported shape was groups → items, rendered as a separate read-only
       checklist below the sub-task list. But those items ARE the sub-tasks, so
       two parallel layers only split the same work in half. Each item becomes a
       real sub-task and its group name becomes the sub-task's PHASE, which means
       every line gets dates, people, a report point, edit and delete.

       Runs whenever any workstream still carries groups (not just on a version
       check), so it self-heals after a re-import — and cannot double up, because
       the groups are removed as they are converted. Tick state is carried across
       from the old position-based keys to the new id-based ones, in every month. */
    const needsFold = d.workstreams.some(w => Array.isArray(w.groups) && w.groups.length);
    if (needsFold) {
      const remap = {};
      d.workstreams.forEach(ws => {
        if (!Array.isArray(ws.groups) || !ws.groups.length) return;
        ws.subtasks = Array.isArray(ws.subtasks) ? ws.subtasks : [];
        ws.groups.forEach((g, gi) => {
          (g.items || []).forEach((it, ii) => {
            const id = uid();
            const st = { id, phase: g.name || '', title: it.t || '' };
            if (it.d) st.day = it.d;
            if (it.who) st.assignTo = it.who;
            if (g.buf) st.buf = true;
            if (it.ticks) st.ticks = it.ticks;
            ws.subtasks.push(st);
            if (it.ticks) {
              for (let t = 0; t < it.ticks; t++) remap[`${ws.id}.${gi}.${ii}.${t}`] = `${ws.id}.sub.${id}.${t}`;
            } else {
              remap[`${ws.id}.${gi}.${ii}`] = `${ws.id}.sub.${id}`;
            }
          });
        });
        delete ws.groups;
      });
      Object.values(d.checks).forEach(month => {
        Object.keys(month).forEach(k => {
          if (remap[k]) { month[remap[k]] = month[k]; delete month[k]; }
        });
      });
      const n = Object.keys(remap).length;
      this._didWkFold = n > 0;
      if (n) console.info(`[Work Sheet] folded ${n} checklist item(s) into sub-tasks.`);
    }
    /* ---- Rhythm + close rows become records with stable ids ----
       Both were plain data — cadence as [day, gate, what] tuples, close as bare
       strings — so neither could be edited or deleted, and their tick keys were
       built from the gate TEXT and the array POSITION. That meant renaming a
       gate or reordering the close list silently orphaned its ticks. Ids fix
       both, and the extra fields make each row carry real information. */
    const oldCadence = d.cadence.some(r => Array.isArray(r));
    const oldClose = d.close.some(r => typeof r === 'string');
    if (oldCadence || oldClose) {
      const remap = {};
      if (oldCadence) {
        d.cadence = d.cadence.map(r => {
          if (!Array.isArray(r)) return r;
          const [day, gate, what] = r;
          const row = { id: uid(), day: day || '', gate: gate || '', what: what || '' };
          for (let n = 1; n <= 6; n++) remap[`cad.${gate}.${n}`] = `cad.${row.id}.${n}`;
          return row;
        });
      }
      if (oldClose) {
        d.close = d.close.map((c, i) => {
          if (typeof c !== 'string') return c;
          const row = { id: uid(), title: c };
          remap[`close.${i}`] = `close.${row.id}`;
          return row;
        });
      }
      Object.values(d.checks).forEach(month => {
        Object.keys(month).forEach(k => {
          if (remap[k]) { month[remap[k]] = month[k]; delete month[k]; }
        });
      });
      this._didWkFold = true;
    }
    // belt-and-braces: never render a row without an id
    d.cadence.forEach(r => { if (r && !r.id) r.id = uid(); });
    d.close.forEach(r => { if (r && !r.id) r.id = uid(); });

    d._wkV = 4;
    return d;
  },
  loadLocal() {
    try {
      const raw = localStorage.getItem(WORK_STORE_KEY);
      this.data = this._hydrate(raw ? JSON.parse(raw) : null);
    } catch { this.data = this._hydrate(null); }
    return this.data;
  },
  async loadCloud() {
    const doc = this._doc();
    if (!doc || !Security.isOwner()) { this._cloudBlocked = true; return this.loadLocal(); }
    try {
      const snap = await doc.get();
      if (snap.exists) {
        const d = snap.data() || {};
        this.data = this._hydrate(d.store || d);
        this._persistLocal();
        this._cloudBlocked = false;
      } else {
        if (!this.data) this.loadLocal();
        // Only seed the cloud once there is something worth seeding.
        if (this.data.workstreams.length) await this._persistCloud();
        else this._cloudBlocked = false;
      }
    } catch (e) {
      // No rule yet / offline — run privately from this device. Never leaks.
      if (!this.data) this.loadLocal();
      this._cloudBlocked = true;
    }
    return this.data;
  },
  subscribe(onRemote) {
    const doc = this._doc();
    if (!doc || !Security.isOwner()) return;
    if (this._unsub) { this._unsub(); this._unsub = null; }
    try {
      this._unsub = doc.onSnapshot(snap => {
        if (!snap.exists) return;
        const d = snap.data() || {};
        if (d.writer === this._clientId) return;   // ignore our own echo
        this.data = this._hydrate(d.store || d);
        this._persistLocal();
        if (typeof onRemote === 'function') onRemote();
      }, () => {});
    } catch {}
  },
  _persistLocal() { try { localStorage.setItem(WORK_STORE_KEY, JSON.stringify(this.data)); } catch {} },
  async _persistCloud() {
    const doc = this._doc();
    if (!doc || !Security.isOwner()) return;
    try {
      await doc.set({ store: this.data, writer: this._clientId, updatedAt: Date.now() });
      this._cloudBlocked = false;
    } catch (e) { this._cloudBlocked = true; }
  },
  /* Ticking a box fires often, so the cloud write is debounced while the
     local cache is written immediately (nothing is ever lost on reload). */
  save() {
    if (!Security.guard('save the work sheet')) return;
    this._persistLocal();
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._persistCloud(), 400);
    this._persistDrive();
  },
  saveNow() {
    if (!Security.guard('save the work sheet')) return;
    this._persistLocal();
    clearTimeout(this._saveTimer);
    this._persistCloud();
    this._persistDrive();
  },
  /* Every change to the sheet passes through save()/saveNow() — adding a main
     task, renaming a phase, deleting a sub-task, ticking a box, importing,
     clearing a month. Hooking the Drive mirror HERE rather than at each call
     site is what makes the docs follow all of it instead of just the ticks.

     The loop guard lives in WorkDrive.schedule() rather than here: the mirror
     finishes by calling saveNow() itself to store the doc ids it just created,
     and that must not count as a change. It used to be a `_busy` check on this
     side, which ALSO threw away every real edit made while a run was in
     flight — a tick during a mirror never reached the doc. schedule() now
     remembers it instead and re-runs. */
  _persistDrive() {
    try {
      if (typeof WorkDrive === 'undefined') return;
      WorkDrive.schedule();
    } catch (e) { /* the mirror is a mirror — never let it break a save */ }
  }
};

/* Safe inline text for sheet content: escape everything first, then re-enable
   a tiny markup subset (`code`, **strong**, *em*) — same discipline as
   mdToHtml, so imported content can never inject HTML. */
function wkText(s) {
  return escapeHtml(s == null ? '' : s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
}

/* Masthead brand line: the group only. Imported sheets often carry a
   longer "Group · Office of the …" string — the office/holder is now shown
   by the identity card on the right, so the eyebrow keeps just the group. */
function wkBrand(org) { return String(org || '').split('·')[0].trim(); }

/* Identity card on the right of the masthead: whose desk this sheet is on.
   Reads the live profile (name + photo) and its current role, so it stays
   right when the profile changes; the sheet may override any field. */
function wkIdentityHtml(d) {
  const p = (typeof DB !== 'undefined' && DB.data && DB.data.profile) || {};
  const job = (p.experience || []).find(e => e.current) || (p.experience || [])[0] || {};
  const name = d.ownerName || p.name || '';
  const role = d.ownerRole || job.role || '';
  const org  = d.ownerOrg  || job.company || '';
  if (!name && !role && !org) return '';
  const photo = d.ownerPhoto || p.photo || '';
  return `
    <div class="wk-ident">
      <div class="wk-ident-txt">
        ${name ? `<b>${escapeHtml(name)}</b>` : ''}
        ${role ? `<span>${escapeHtml(role)}</span>` : ''}
        ${org ? `<span class="wk-ident-org">${escapeHtml(org)}</span>` : ''}
      </div>
      <div class="wk-ident-photo">${photo
        ? `<img src="${escapeHtml(imgSrc(photo))}" alt="${escapeHtml(name)}">`
        : `<span>${escapeHtml(initials(name))}</span>`}</div>
    </div>`;
}

/* Month label ("July 2026") → storage slug ("july-2026"). */
function wkSlug(label) { return String(label || 'current').trim().toLowerCase().replace(/\s+/g, '-'); }
function wkDefaultMonth() {
  const d = new Date();
  return d.toLocaleString('en-GB', { month: 'long' }) + ' ' + d.getFullYear();
}

let _wkMonth = null;          // the month label currently on screen
let _wkOpenWs = null;         // ids of the expanded cards — carried across redraws (null = first draw)
const _wkPinOpen = new Set(); // cards to force open on the next redraw (just added to / edited)

/* Keep a workstream card expanded through the next redraw. Called after adding
   or editing inside a card, so a save leaves you where you were working. */
function wkKeepOpen(wsId) { if (wsId) _wkPinOpen.add(wsId); }

/* Every tickable key for a workstream: rich sub-tasks/phases first, then the
   imported checklist (a `ticks` item expands to N keys).
   Keys are built from the sub-task's own id, so ticks survive reordering,
   editing and phase changes. A sub-task with `ticks: n` (e.g. "10 videos")
   expands to n keys. */
function wkSubKeys(ws, st) {
  if (st.ticks) return Array.from({ length: st.ticks }, (_, t) => `${ws.id}.sub.${st.id}.${t}`);
  return [`${ws.id}.sub.${st.id}`];
}
function wkItemKeys(ws) {
  const out = [];
  (ws.subtasks || []).forEach(st => out.push(...wkSubKeys(ws, st)));
  return out;
}

/* Sub-tasks grouped into their phases, in first-seen order. Sub-tasks with no
   phase collect under a single unnamed group. Returns [[phaseName, items], …] */
function wkPhases(ws) {
  const order = [], byPhase = new Map();
  (ws.subtasks || []).forEach(st => {
    const p = st.phase || '';
    if (!byPhase.has(p)) { byPhase.set(p, []); order.push(p); }
    byPhase.get(p).push(st);
  });
  return order.map(p => [p, byPhase.get(p)]);
}
/* Every distinct phase name across the sheet — powers the datalist in the editor. */
function wkAllPhases() {
  const set = new Set();
  (WorkDB.data.workstreams || []).forEach(w => (w.subtasks || []).forEach(s => { if (s.phase) set.add(s.phase); }));
  return [...set];
}

/* Next free workstream id — WS-01, WS-02, … */
function wkNextId() {
  const nums = (WorkDB.data.workstreams || [])
    .map(w => parseInt(String(w.id || '').replace(/\D+/g, ''), 10))
    .filter(n => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return 'WS-' + String(next).padStart(2, '0');
}

/* ---- Operating-rhythm helpers ----
   How many week columns the month on screen actually has: a month can span 4, 5
   or 6 calendar weeks, and a 4-box row would quietly lose a week's tick. */
function wkWeeksInMonth() {
  const t = Date.parse('1 ' + String(_wkMonth || ''));
  if (isNaN(t)) return 4;
  const d = new Date(t);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const lead = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  return Math.min(6, Math.max(4, Math.ceil((days + lead) / 7)));
}
function wkGateKeys(row, weeks) {
  return Array.from({ length: weeks || wkWeeksInMonth() }, (_, i) => `cad.${row.id}.${i + 1}`);
}
/* Gate kinds — a coloured tag so the rhythm reads at a glance. */
const WK_GATE_KINDS = [
  { key: 'Plan', tone: 'blue', ico: 'calendar-check-fill' },
  { key: 'Stand-up', tone: 'slate', ico: 'people-fill' },
  { key: 'Audit', tone: 'amber', ico: 'search' },
  { key: 'Delivery', tone: 'gold', ico: 'send-fill' },
  { key: 'Review', tone: 'violet', ico: 'clipboard-data-fill' },
  { key: 'Sync', tone: 'green', ico: 'arrow-repeat' }
];
function wkGateKind(k) { return WK_GATE_KINDS.find(x => x.key === k) || null; }
/* Is this gate due today? Matches a weekday name, or anything daily. */
function wkGateDueToday(dayLabel) {
  const s = String(dayLabel || '').toLowerCase();
  if (!s) return false;
  if (/daily|every day/.test(s)) return true;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long' }).toLowerCase();
  return s.includes(today);
}
/* Areas the month-end close groups under. */
const WK_CLOSE_CATS = ['Finance', 'People', 'Operations', 'Marketing', 'Digital', 'Other'];

/* Priority drives the card's left rule: High red · Medium amber · Low green.
   Without a priority the card falls back to its delegation mode (navy/gold). */
const WK_PRIORITIES = [
  { key: 'High', tone: 'red', ico: 'exclamation-triangle-fill' },
  { key: 'Medium', tone: 'amber', ico: 'dash-circle-fill' },
  { key: 'Low', tone: 'green', ico: 'check-circle-fill' }
];
function wkPriority(p) { return WK_PRIORITIES.find(x => x.key === p) || null; }

/* Find a workstream / sub-task by id. */
function wkFind(wsId) { return (WorkDB.data.workstreams || []).find(w => w.id === wsId); }
function wkFindSub(wsId, subId) {
  const ws = wkFind(wsId);
  return ws && (ws.subtasks || []).find(s => s.id === subId);
}
/* A short "12 Aug → 20 Aug" style range (either end may be missing). */
function wkRange(from, to) {
  const a = from ? fmtDate(from) : '', b = to ? fmtDate(to) : '';
  if (a && b) return a === b ? a : `${a} → ${b}`;
  return a || b || '';
}
/* The tick map for the month on screen (created on first write). */
function wkChecks() {
  const slug = wkSlug(_wkMonth);
  const all = WorkDB.data.checks || (WorkDB.data.checks = {});
  return all[slug] || (all[slug] = {});
}
function wkOn(key) { return !!wkChecks()[key]; }

function initWork() {
  // Hard gate — this page never renders for a visitor.
  if (!Security.isOwner()) { location.replace(Security.LOGIN_PAGE); return; }
  const host = document.getElementById('workHost');
  if (!host) return;

  host.innerHTML = `<div class="empty"><div class="e-ico"><i class="bi bi-hourglass-split"></i></div><b>Opening your work sheet…</b></div>`;

  WorkDB.loadLocal();
  WorkDB.loadCloud().then(() => {
    if (!_wkMonth) _wkMonth = WorkDB.data.month || wkDefaultMonth();
    // The checklist→sub-task fold rewrote the sheet in memory (carrying every
    // tick across). Persist it once so it sticks and reaches other devices.
    if (WorkDB._didWkFold) {
      WorkDB._didWkFold = false;
      WorkDB.saveNow();
      toast('Checklist items are now sub-tasks — each one is editable.', 'ok');
    }
    drawWork();
    /* The Drive docs can be behind on arrival — the last ticks may have been
       made on a device with no Drive connection at all. Nothing is written
       unless something genuinely differs. */
    try { WorkDrive.catchUp(); } catch {}
    // Live sync from another device — never redraw over an open dialog.
    WorkDB.subscribe(() => {
      if (!document.querySelector('.modal.show')) drawWork();
      // A tick made on the phone should reach the docs from here, too.
      try { WorkDrive.schedule(); } catch {}
    });
  });
}

/* Full render. Ticking a box does NOT come back through here — wkPaint()
   updates the numbers in place so open sections and scroll position hold. */
function drawWork() {
  const host = document.getElementById('workHost');
  if (!host) return;
  const d = WorkDB.data;

  /* Hold the reader's place. This is a full innerHTML swap, so without the two
     lines below every save threw you back to "first card open, scrolled to the
     top" — even when you were three cards down adding a sub-task. */
  const wasDrawn = !!host.querySelector('details.wk-ws');
  if (wasDrawn) {
    _wkOpenWs = new Set([...host.querySelectorAll('details.wk-ws')]
      .filter(x => x.open).map(x => x.dataset.wsid));
  }
  if (_wkPinOpen.size) {
    _wkOpenWs = _wkOpenWs || new Set();
    _wkPinOpen.forEach(id => _wkOpenWs.add(id));
    _wkPinOpen.clear();
  }
  const keepY = wasDrawn ? window.scrollY : null;
  const priv = WorkDB._cloudBlocked
    ? `<span class="fin-priv" title="Private to this device — add the opptrack_private rule to sync across devices"><i class="bi bi-hdd"></i> Private · this device</span>`
    : `<span class="fin-priv is-sync" title="Private &amp; synced to your account only"><i class="bi bi-shield-lock-fill"></i> Private · synced</span>`;

  const head = `
    <div class="fin-topbar wk-topbar">
      <div class="fin-priv-wrap">${priv}
        <span class="text-faint" style="font-size:12px"><i class="bi bi-eye-slash me-1"></i>Never shown on your public portfolio</span>
      </div>
      <div class="fin-actions">
        <input class="wk-month-input" id="wkMonth" value="${escapeHtml(_wkMonth || '')}" placeholder="Month" aria-label="Month">
        <button class="btn btn-ghost btn-sm" id="wkImport"><i class="bi bi-upload me-1"></i>Import sheet</button>
        <button class="btn btn-ghost btn-sm" id="wkExport"><i class="bi bi-download me-1"></i>Export</button>
        <button class="btn btn-ghost btn-sm" id="wkDriveBtn"><i class="bi bi-cloud-arrow-up me-1"></i>Drive</button>
        <button class="btn btn-ghost btn-sm" id="wkPrint"><i class="bi bi-printer me-1"></i>Print</button>
        <button class="btn btn-ghost btn-sm text-danger" id="wkReset"><i class="bi bi-arrow-counterclockwise me-1"></i>Reset month</button>
      </div>
      <input type="file" id="wkFile" accept="application/json" hidden>
    </div>`;

  // ---- Empty state: nothing imported AND no departments to build under ----
  if (!d.workstreams.length && !d.depts.length) {
    host.innerHTML = head + `
      <div class="card card-pad wk-empty">
        <div class="e-ico"><i class="bi bi-briefcase"></i></div>
        <b>Your work sheet is empty</b>
        <p>
          The sheet's content is deliberately <b>not</b> stored in this site's code — this repository
          is public, so anything in the source would be readable by anyone even though this page is
          login-gated. Your workstreams live only in your private cloud document.
        </p>
        <p class="text-faint" style="font-size:12.5px">
          Click <b>Import sheet</b> and pick <code>data/work-seed.json</code>. It saves to your private
          store and then syncs to every device you sign in on — you only do this once.
        </p>
        <button class="btn btn-primary" id="wkImport2"><i class="bi bi-upload me-1"></i>Import sheet</button>
        <button class="btn btn-ghost" data-wkact="dept-add"><i class="bi bi-plus-lg me-1"></i>Or start from scratch</button>
      </div>`;
    wireWork();
    return;
  }

  /* Every department is rendered, INCLUDING empty ones — otherwise a department
     you have not put work under yet is invisible and unreachable, with no way to
     add its first main task. Each header carries its own + button. */
  const depts = d.depts.length ? d.depts : [{ key: '', label: 'Workstreams', tag: '' }];
  const board = depts.map(dep => {
    const list = d.workstreams.filter(w => (w.dept || '') === (dep.key || ''));
    return `
      <div class="wk-dept">
        <h2>${wkText(dep.label)}</h2>
        <button type="button" class="wk-add" data-wkact="task-add" data-dept="${escapeHtml(dep.key || '')}"
          title="Add a main task under ${escapeHtml(dep.label)}"><i class="bi bi-plus-lg"></i></button>
        <button type="button" class="wk-dept-edit" data-wkact="dept-edit" data-dept="${escapeHtml(dep.key || '')}"
          title="Rename or remove this department"><i class="bi bi-three-dots"></i></button>
        <div class="wk-rule"></div>
        <span class="wk-cnt">${list.length} workstream${list.length === 1 ? '' : 's'}${dep.tag ? ' · ' + wkText(dep.tag) : ''}</span>
      </div>
      ${list.length
        ? list.map((ws, i) => wkWorkstreamHtml(ws, _wkOpenWs ? _wkOpenWs.has(ws.id) : (i === 0 && dep === depts[0]))).join('')
        : `<button type="button" class="wk-dept-empty" data-wkact="task-add" data-dept="${escapeHtml(dep.key || '')}">
             <i class="bi bi-plus-circle-dotted"></i>
             <span><b>Nothing here yet</b>Add the first main task for ${wkText(dep.label)}</span>
           </button>`}`;
  }).join('') + `
    <div class="wk-dept-add-row">
      <button type="button" class="btn btn-ghost btn-sm" data-wkact="dept-add"><i class="bi bi-plus-lg me-1"></i>Add department</button>
    </div>`;

  /* ---- Operating rhythm: recurring gates, ticked once per week ----
     Week boxes are sized to the month actually on screen (a 5- or 6-week month
     gets 5 or 6), rows due today are flagged, and each gate carries who runs it,
     when, and what kind of gate it is. */
  const weeks = wkWeeksInMonth();
  const cadDone = d.cadence.reduce((a, r) => a + wkGateKeys(r, weeks).filter(wkOn).length, 0);
  const cadTotal = d.cadence.length * weeks;
  const cadence = `
    <div class="wk-dept">
      <h2>Operating rhythm</h2>
      <button type="button" class="wk-add" data-wkact="cad-add" title="Add a gate"><i class="bi bi-plus-lg"></i></button>
      <div class="wk-rule"></div>
      <span class="wk-cnt">${d.cadence.length} gate${d.cadence.length === 1 ? '' : 's'} · ${cadDone}/${cadTotal} this month</span>
    </div>
    ${d.cadence.length ? `<div class="wk-panel">
      <table class="wk-table wk-cad">
        <thead><tr>
          <th style="width:120px">Day</th><th style="width:180px">Gate</th><th>What happens</th>
          <th style="width:${Math.max(120, weeks * 22 + 40)}px">Week 1–${weeks}</th><th style="width:64px"></th>
        </tr></thead>
        <tbody>${d.cadence.map(row => {
          const kind = wkGateKind(row.kind);
          const keys = wkGateKeys(row, weeks);
          const n = keys.filter(wkOn).length;
          const due = wkGateDueToday(row.day);
          return `<tr class="${due ? 'is-due' : ''}">
            <td class="wk-d">
              ${wkText(row.day || '—')}
              ${row.time ? `<span class="wk-gate-time">${wkText(row.time)}</span>` : ''}
              ${due ? '<span class="wk-due-flag">today</span>' : ''}
            </td>
            <td>
              <strong>${wkText(row.gate)}</strong>
              ${kind ? `<span class="wk-kind t-${kind.tone}"><i class="bi bi-${kind.ico}"></i>${kind.key}</span>` : ''}
              ${row.owner ? `<span class="wk-gate-owner">${wkText(row.owner)}</span>` : ''}
            </td>
            <td>${wkText(row.what)}</td>
            <td>
              <div class="wk-ticks">${keys.map((k, i) =>
                `<input class="wk-tick" type="checkbox" data-k="${escapeHtml(k)}" ${wkOn(k) ? 'checked' : ''} aria-label="Week ${i + 1}">`).join('')}</div>
              <div class="wk-gate-bar"><i style="width:${weeks ? n / weeks * 100 : 0}%"></i></div>
            </td>
            <td><div class="wk-row-tools">
              <button type="button" data-wkact="cad-edit" data-id="${escapeHtml(row.id)}" title="Edit gate"><i class="bi bi-pencil"></i></button>
              <button type="button" class="del" data-wkact="cad-del" data-id="${escapeHtml(row.id)}" title="Delete gate"><i class="bi bi-trash3"></i></button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : `<button type="button" class="wk-dept-empty" data-wkact="cad-add">
        <i class="bi bi-plus-circle-dotted"></i>
        <span><b>No gates yet</b>Add the rhythm you run the month on — stand-ups, audits, delivery points</span>
      </button>`}`;

  const bossRows = d.workstreams.filter(w => w.boss);
  const register = bossRows.length ? `
    <div class="wk-dept"><h2>Delivery register</h2><div class="wk-rule"></div><span class="wk-cnt">what leaves my desk</span></div>
    <div class="wk-panel">
      <table class="wk-table">
        <thead><tr><th style="width:64px">WS</th><th>Deliverable</th><th style="width:124px">Due</th><th style="width:132px">Built by</th><th style="width:84px">Signed off</th></tr></thead>
        <tbody>${bossRows.map(w => `<tr>
          <td class="wk-d">${wkText(w.id)}</td>
          <td>${wkText(w.bossItem || '')}</td>
          <td class="wk-d">${wkText(w.bossDue || 'Thursday gate')}</td>
          <td class="wk-d">${wkText(w.bossBy || (w.mode === 'self' ? 'Self' : 'Delegated → me'))}</td>
          <td><input class="wk-tick" type="checkbox" data-k="boss.${escapeHtml(w.id)}" ${wkOn('boss.' + w.id) ? 'checked' : ''} aria-label="Signed off"></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : '';

  /* ---- Month-end close: grouped by area, criticals called out ---- */
  const closeDone = d.close.filter(c => wkOn('close.' + c.id)).length;
  const closeCrit = d.close.filter(c => c.critical);
  const critLeft = closeCrit.filter(c => !wkOn('close.' + c.id)).length;
  const closeGroups = (() => {
    const order = [], byCat = new Map();
    d.close.forEach(c => {
      const k = c.category || '';
      if (!byCat.has(k)) { byCat.set(k, []); order.push(k); }
      byCat.get(k).push(c);
    });
    return order.map(k => [k, byCat.get(k)]);
  })();
  const close = `
    <div class="wk-dept">
      <h2>Month-end close</h2>
      <button type="button" class="wk-add" data-wkact="close-add" title="Add a close item"><i class="bi bi-plus-lg"></i></button>
      <div class="wk-rule"></div>
      <span class="wk-cnt" data-wkclosecnt>${closeDone}/${d.close.length} done${critLeft ? ` · ${critLeft} critical left` : (closeCrit.length ? ' · criticals clear' : '')}</span>
    </div>
    ${d.close.length ? `<div class="wk-panel">
      ${critLeft ? `<div class="wk-close-warn"><i class="bi bi-exclamation-triangle-fill"></i>
        The month cannot be called closed — <b>${critLeft}</b> critical item${critLeft === 1 ? '' : 's'} still open.</div>`
        : (closeCrit.length ? `<div class="wk-close-ok"><i class="bi bi-check-circle-fill"></i>
        Every critical item is signed off.</div>` : '')}
      <div class="wk-closebox">
        ${closeGroups.map(([cat, items]) => `
          ${cat ? `<div class="wk-close-cat">${wkText(cat)}<span data-wkclosecat="${escapeHtml(cat)}">${items.filter(c => wkOn('close.' + c.id)).length}/${items.length}</span></div>` : ''}
          ${items.map(c => {
            const on = wkOn('close.' + c.id);
            return `<div class="wk-close-row ${on ? 'is-done' : ''} ${c.critical ? 'is-crit' : ''}" data-wkclose="${escapeHtml(c.id)}">
              <label class="wk-sub-tick"><input type="checkbox" data-k="close.${escapeHtml(c.id)}" ${on ? 'checked' : ''} aria-label="Done"></label>
              <div class="wk-close-body">
                <div class="wk-close-title">${wkText(c.title)}${c.critical ? '<span class="wk-crit">critical</span>' : ''}</div>
                ${(c.owner || c.due || c.notes) ? `<div class="wk-sb-meta">
                  ${c.owner ? `<span class="wk-sb-bit"><i class="bi bi-person-fill"></i>${wkText(c.owner)}</span>` : ''}
                  ${c.due ? `<span class="wk-sb-bit report"><i class="bi bi-calendar3"></i>${wkText(c.due)}</span>` : ''}
                  ${c.notes ? `<span class="wk-sb-bit"><i class="bi bi-sticky"></i>${wkText(c.notes)}</span>` : ''}
                </div>` : ''}
              </div>
              <div class="wk-row-tools">
                <button type="button" data-wkact="close-edit" data-id="${escapeHtml(c.id)}" title="Edit"><i class="bi bi-pencil"></i></button>
                <button type="button" class="del" data-wkact="close-del" data-id="${escapeHtml(c.id)}" title="Delete"><i class="bi bi-trash3"></i></button>
              </div>
            </div>`;
          }).join('')}`).join('')}
      </div>
    </div>` : `<button type="button" class="wk-dept-empty" data-wkact="close-add">
        <i class="bi bi-plus-circle-dotted"></i>
        <span><b>No close list yet</b>Add what must be true before the month can be called closed</span>
      </button>`}`;

  host.innerHTML = head + `
    <div class="wk">
      <header class="wk-mast">
        <div class="wk-mast-main">
          ${wkBrand(d.org) ? `<div class="wk-brand">${wkText(wkBrand(d.org))}</div>` : ''}
          <h1>${wkText(d.title || 'Work Sheet')}</h1>
        </div>
        ${wkIdentityHtml(d)}
      </header>

      <div class="wk-control">
        <div class="wk-cell">
          <div class="wk-k">Month closed</div>
          <div class="wk-v" data-wkpc="all">0%</div>
          <div class="wk-bar gold"><i data-wkbar="all"></i></div>
        </div>
        ${depts.map(dep => `
        <div class="wk-cell">
          <div class="wk-k">${wkText(dep.label)}</div>
          <div class="wk-v" data-wkpc="${escapeHtml(dep.key)}">0%</div>
          <div class="wk-bar"><i data-wkbar="${escapeHtml(dep.key)}"></i></div>
        </div>`).join('')}
        <div class="wk-cell">
          <div class="wk-k">Deliveries signed off</div>
          <div class="wk-v" data-wkpc="boss">0</div>
          <div class="wk-bar gold"><i data-wkbar="boss"></i></div>
        </div>
      </div>

      ${board}
      ${cadence}
      ${register}
      ${close}

      <div class="wk-foot">
        <span>${wkText(d.signature || '')}</span>
        <span id="wkStamp">—</span>
      </div>
    </div>`;

  wireWork();
  wkPaint();
  // Put the page back where it was (twice — once now, once after the browser
  // has laid the new markup out, or a taller/shorter sheet loses the offset).
  if (keepY != null) {
    window.scrollTo(0, keepY);
    requestAnimationFrame(() => window.scrollTo(0, keepY));
  }
}

/* One sub-task row: tick + day marker + title, then its own timeline, the people
   on it, who it is assigned to, and when it gets reported up.
   A sub-task with `ticks: n` shows n small boxes instead of one (e.g. "10
   videos"), and counts as n items toward the total. */
function wkSubtaskHtml(ws, st) {
  const keys = wkSubKeys(ws, st);
  const doneN = keys.filter(wkOn).length;
  const allDone = doneN === keys.length;
  const period = wkRange(st.from, st.to);
  const bits = [
    period ? `<span class="wk-sb-bit"><i class="bi bi-calendar3"></i>${wkText(period)}</span>` : '',
    st.withWhom ? `<span class="wk-sb-bit"><i class="bi bi-people-fill"></i>${wkText(st.withWhom)}</span>` : '',
    st.assignTo ? `<span class="wk-sb-bit assign"><i class="bi bi-person-check-fill"></i>${wkText(st.assignTo)}</span>` : '',
    st.reportOn ? `<span class="wk-sb-bit report"><i class="bi bi-send-fill"></i>Report ${wkText(fmtDate(st.reportOn))}</span>` : ''
  ].filter(Boolean).join('');
  const tick = st.ticks
    ? `<span class="wk-sub-multi">${keys.map((k, i) =>
        `<input class="wk-tick" type="checkbox" data-k="${escapeHtml(k)}" ${wkOn(k) ? 'checked' : ''} aria-label="${escapeHtml(st.title)} ${i + 1}">`).join('')}</span>`
    : `<label class="wk-sub-tick"><input type="checkbox" data-k="${escapeHtml(keys[0])}" ${allDone ? 'checked' : ''} aria-label="Done"></label>`;
  return `
  <div class="wk-sub ${allDone ? 'is-done' : ''} ${st.buf ? 'buf' : ''}" data-wksub="${escapeHtml(ws.id)}|${escapeHtml(st.id)}">
    ${st.ticks ? '<span class="wk-sub-tick placeholder"></span>' : tick}
    <div class="wk-sub-body">
      <div class="wk-sub-title">${st.day ? `<span class="wk-day">${wkText(st.day)}</span>` : ''}${wkText(st.title)}${st.ticks ? `<span class="wk-sub-count" data-wksubn>${doneN}/${st.ticks}</span>` : ''}</div>
      ${st.ticks ? tick : ''}
      ${bits ? `<div class="wk-sb-meta">${bits}</div>` : ''}
      ${st.notes ? `<div class="wk-sb-note">${wkText(st.notes)}</div>` : ''}
    </div>
    <div class="wk-sub-tools">
      <button type="button" data-wkact="sub-edit" data-ws="${escapeHtml(ws.id)}" data-sub="${escapeHtml(st.id)}" title="Edit sub-task"><i class="bi bi-pencil"></i></button>
      <button type="button" class="del" data-wkact="sub-del" data-ws="${escapeHtml(ws.id)}" data-sub="${escapeHtml(st.id)}" title="Delete sub-task"><i class="bi bi-trash3"></i></button>
    </div>
  </div>`;
}

/* One workstream (main task) card. `open` auto-expands the first one. */
function wkWorkstreamHtml(ws, open) {
  const keys = wkItemKeys(ws), done = keys.filter(wkOn).length;
  const pct = keys.length ? done / keys.length * 100 : 0;
  const pr = wkPriority(ws.priority);
  const period = wkRange(ws.start, ws.end);
  const subs = ws.subtasks || [];
  return `
  <details class="wk-ws" data-wsid="${escapeHtml(ws.id)}" data-mode="${escapeHtml(ws.mode || 'self')}" ${pr ? `data-priority="${pr.key}"` : ''} ${open ? 'open' : ''}>
    <summary>
      <div class="wk-ws-row">
        <div class="wk-ws-id">${wkText(ws.id)}</div>
        <div class="wk-ws-main">
          <div class="wk-ws-title">${wkText(ws.title)}</div>
          <div class="wk-ws-meta">
            ${pr ? `<span class="wk-prio t-${pr.tone}"><i class="bi bi-${pr.ico}"></i>${pr.key}</span>` : ''}
            ${ws.modeLabel ? `<span class="wk-stamp mode ${ws.mode === 'deleg' ? 'deleg' : ''}">${wkText(ws.modeLabel)}</span>` : ''}
            ${ws.boss ? `<span class="wk-stamp seal">Delivery</span>` : ''}
            ${period ? `<span class="wk-stamp"><i class="bi bi-calendar3 me-1"></i>${wkText(period)}</span>` : ''}
            ${ws.myRole ? `<span class="wk-stamp">Me: ${wkText(ws.myRole)}</span>` : ''}
            ${ws.devRole ? `<span class="wk-stamp">Dev: ${wkText(ws.devRole)}</span>` : ''}
            ${ws.withWhom ? `<span class="wk-stamp">With: ${wkText(ws.withWhom)}</span>` : ''}
            ${ws.owner ? `<span class="wk-stamp">${wkText(ws.owner)}</span>` : ''}
          </div>
          <div class="wk-bar" style="margin-top:11px"><i style="width:${pct}%" data-wkbar="${escapeHtml(ws.id)}"></i></div>
        </div>
        <div class="wk-ws-num"><b data-wkn="${escapeHtml(ws.id)}">${done}/${keys.length}</b><span>items closed</span></div>
        <div class="wk-ws-tools">
          <button type="button" data-wkact="task-edit" data-ws="${escapeHtml(ws.id)}" title="Edit main task"><i class="bi bi-pencil"></i></button>
          <button type="button" class="del" data-wkact="task-del" data-ws="${escapeHtml(ws.id)}" title="Delete main task"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
    </summary>
    <div class="wk-ws-body">
      ${ws.description ? `<p class="wk-desc">${wkText(ws.description)}</p>` : ''}
      ${ws.note ? `<p class="wk-note">${wkText(ws.note)}</p>` : ''}
      ${ws.boss && ws.bossItem ? `<p class="wk-note deliver"><b>Delivery:</b> ${wkText(ws.bossItem)}${ws.bossDue ? ` · <i>${wkText(ws.bossDue)}</i>` : ''}</p>` : ''}

      <!-- Sub-tasks, grouped into their phases. One system: the imported
           checklist was folded in here, its group names becoming phases. -->
      <div class="wk-subhead">
        <span>Sub-tasks</span><span class="wk-rule"></span>
        <span class="wk-cnt" data-wkcnt="${escapeHtml(ws.id)}">${keys.length} item${keys.length === 1 ? '' : 's'} · ${done} closed</span>
        <button type="button" class="wk-add-sub" data-wkact="sub-add" data-ws="${escapeHtml(ws.id)}" title="Add a sub-task"><i class="bi bi-plus-lg"></i>Add sub-task</button>
      </div>
      ${subs.length ? wkPhases(ws).map(([phase, items]) => `
        <div class="wk-grp">
          <div class="wk-grp-h">
            <span>${phase ? wkText(phase) : 'Ungrouped'}</span><span class="wk-rule"></span>
            <span class="wk-n">${items.length}</span>
            <button type="button" class="wk-add-mini" data-wkact="sub-add" data-ws="${escapeHtml(ws.id)}" data-phase="${escapeHtml(phase)}" title="Add a sub-task to ${escapeHtml(phase || 'this group')}"><i class="bi bi-plus-lg"></i></button>
          </div>
          <div class="wk-subs">${items.map(st => wkSubtaskHtml(ws, st)).join('')}</div>
        </div>`).join('')
        : `<p class="wk-sub-empty">No sub-tasks yet. Break this down — each one gets its own dates, people and report point.</p>`}
    </div>
  </details>`;
}

/* Update every counter + bar from the current tick state (no re-render). */
function wkPaint() {
  const d = WorkDB.data;
  if (!d) return;
  const all = [0, 0], byDept = {};
  const subState = new Map(), wsState = new Map();   // row + header state, keyed for the DOM sweep below
  d.workstreams.forEach(ws => {
    const keys = wkItemKeys(ws), done = keys.filter(wkOn).length;
    (ws.subtasks || []).forEach(st => {
      const sk = wkSubKeys(ws, st);
      subState.set(`${ws.id}|${st.id}`, [sk.filter(wkOn).length, sk.length]);
    });
    wsState.set(ws.id, [done, keys.length]);
    const n = document.querySelector(`[data-wkn="${CSS.escape(ws.id)}"]`);
    if (n) n.textContent = `${done}/${keys.length}`;
    const b = document.querySelector(`[data-wkbar="${CSS.escape(ws.id)}"]`);
    if (b) b.style.width = (keys.length ? done / keys.length * 100 : 0) + '%';
    all[0] += done; all[1] += keys.length;
    const k = ws.dept || '';
    (byDept[k] = byDept[k] || [0, 0])[0] += done;
    byDept[k][1] += keys.length;
  });

  /* Row state — the strike-through, the n/N on a multi-tick sub-task and the
     "x items · y closed" header. Without this a tick only moved the bars and
     the row kept whatever state it was drawn with (a struck title over an
     empty box, until the next full redraw). */
  document.querySelectorAll('[data-wksub]').forEach(el => {
    const s = subState.get(el.dataset.wksub); if (!s) return;
    el.classList.toggle('is-done', s[1] > 0 && s[0] === s[1]);
    const c = el.querySelector('[data-wksubn]');
    if (c) c.textContent = `${s[0]}/${s[1]}`;
  });
  document.querySelectorAll('[data-wkcnt]').forEach(el => {
    const s = wsState.get(el.dataset.wkcnt); if (!s) return;
    el.textContent = `${s[1]} item${s[1] === 1 ? '' : 's'} · ${s[0]} closed`;
  });

  d.close.forEach(c => { all[1]++; if (wkOn('close.' + c.id)) all[0]++; });

  // Same for the month-end close: row state, per-category count, header count.
  document.querySelectorAll('[data-wkclose]').forEach(el =>
    el.classList.toggle('is-done', wkOn('close.' + el.dataset.wkclose)));
  document.querySelectorAll('[data-wkclosecat]').forEach(el => {
    const items = d.close.filter(c => (c.category || '') === el.dataset.wkclosecat);
    el.textContent = `${items.filter(c => wkOn('close.' + c.id)).length}/${items.length}`;
  });
  const cc = document.querySelector('[data-wkclosecnt]');
  if (cc) {
    const cDone = d.close.filter(c => wkOn('close.' + c.id)).length;
    const crit = d.close.filter(c => c.critical);
    const cLeft = crit.filter(c => !wkOn('close.' + c.id)).length;
    cc.textContent = `${cDone}/${d.close.length} done`
      + (cLeft ? ` · ${cLeft} critical left` : (crit.length ? ' · criticals clear' : ''));
  }

  const pc = (a) => (a && a[1] ? Math.round(a[0] / a[1] * 100) : 0);
  const set = (key, text, width) => {
    const t = document.querySelector(`[data-wkpc="${CSS.escape(key)}"]`);
    if (t) t.innerHTML = text;
    const b = document.querySelector(`[data-wkbar="${CSS.escape(key)}"]`);
    if (b) b.style.width = width + '%';
  };
  set('all', pc(all) + '%', pc(all));
  (d.depts.length ? d.depts : [{ key: '' }]).forEach(dep => set(dep.key, pc(byDept[dep.key]) + '%', pc(byDept[dep.key])));

  const boss = d.workstreams.filter(w => w.boss);
  const bossDone = boss.filter(w => wkOn('boss.' + w.id)).length;
  set('boss', `${bossDone}<small>/${boss.length} signed off</small>`, boss.length ? bossDone / boss.length * 100 : 0);
}

/* Wire the sheet: tick delegation, month, import / export / print / reset. */
function wireWork() {
  const host = document.getElementById('workHost');
  if (!host) return;

  // Every checkbox goes through one delegated handler (change bubbles), so a
  // redraw can never stack duplicate listeners.
  host.onchange = (e) => {
    const cb = e.target;
    if (!cb.matches('input[type="checkbox"][data-k]')) return;
    if (!Security.guard('update the work sheet')) { cb.checked = !cb.checked; return; }
    const checks = wkChecks();
    if (cb.checked) checks[cb.dataset.k] = 1; else delete checks[cb.dataset.k];
    wkPaint();
    WorkDB.save();          // carries the Drive mirror with it (_persistDrive)
    const stamp = document.getElementById('wkStamp');
    if (stamp) stamp.textContent = 'Saved ' + new Date().toLocaleString('en-GB');
  };

  /* One delegated click handler for every add / edit / delete control. Buttons
     live inside <summary>, so the default toggle is suppressed for them. */
  host.onclick = (e) => {
    const btn = e.target.closest('[data-wkact]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const { wkact, ws, sub, dept, phase } = btn.dataset;
    if (wkact === 'task-add') openWorkTaskModal(null, dept);
    else if (wkact === 'task-edit') openWorkTaskModal(ws);
    else if (wkact === 'task-del') workDeleteTask(ws);
    else if (wkact === 'sub-add') openWorkSubModal(ws, null, phase || '');
    else if (wkact === 'sub-edit') openWorkSubModal(ws, sub);
    else if (wkact === 'sub-del') workDeleteSub(ws, sub);
    else if (wkact === 'dept-add') openWorkDeptModal(null);
    else if (wkact === 'dept-edit') openWorkDeptModal(dept);
    else if (wkact === 'cad-add') openWorkGateModal(null);
    else if (wkact === 'cad-edit') openWorkGateModal(btn.dataset.id);
    else if (wkact === 'cad-del') workDeleteRow('cadence', btn.dataset.id);
    else if (wkact === 'close-add') openWorkCloseModal(null);
    else if (wkact === 'close-edit') openWorkCloseModal(btn.dataset.id);
    else if (wkact === 'close-del') workDeleteRow('close', btn.dataset.id);
  };

  const month = document.getElementById('wkMonth');
  if (month) month.onchange = () => {
    _wkMonth = month.value.trim() || wkDefaultMonth();
    WorkDB.data.month = _wkMonth;
    WorkDB.saveNow();
    drawWork();       // different month → different tick set
  };

  const file = document.getElementById('wkFile');
  const pick = () => file && file.click();
  const imp1 = document.getElementById('wkImport');
  const imp2 = document.getElementById('wkImport2');
  if (imp1) imp1.onclick = pick;
  if (imp2) imp2.onclick = pick;
  if (file) file.onchange = () => { if (file.files[0]) workImport(file.files[0]); file.value = ''; };

  const exp = document.getElementById('wkExport');
  if (exp) exp.onclick = () => {
    const blob = new Blob([JSON.stringify(WorkDB.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `work-sheet-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Work sheet exported. Keep it out of the public repo.', 'ok');
  };

  const pr = document.getElementById('wkPrint');
  if (pr) pr.onclick = () => {
    document.querySelectorAll('.wk-ws').forEach(x => x.open = true);
    window.print();
  };

  const dv = document.getElementById('wkDriveBtn');
  if (dv) dv.onclick = () => openWorkDriveModal();

  const rs = document.getElementById('wkReset');
  if (rs) rs.onclick = () => {
    if (!Security.guard('reset the work sheet')) return;
    if (!confirm(`Clear every tick for ${_wkMonth}? The workstreams themselves stay.`)) return;
    (WorkDB.data.checks || {})[wkSlug(_wkMonth)] = {};
    WorkDB.saveNow();
    drawWork();
    toast('Month cleared.', 'ok');
  };
}

/* ==========================================================
   6.9  WORK SHEET → GOOGLE DRIVE MIRROR
   ----------------------------------------------------------
   Writes the sheet out as Google Docs: one per department, inside that
   department's own folder, plus a combined doc at the top level. Ticking
   a box in the app rewrites them.

   ONE-WAY, and whole-document. The app is the truth; each doc is replaced
   entire on every sync, so there is no partial state to drift and a doc
   someone edited by hand is corrected rather than half-merged. That is
   also why the marks render as ☐ / ☑ text instead of Google's own
   tickable checklist: a real checkbox in the doc would invite a tick that
   the app never sees and the next sync silently wipes.

   WHERE IT WRITES. "My Drive / OppTracker Backups / Work Sheet" — a
   sub-folder of the backup folder the app already made for itself. That
   choice is what keeps the Google permission at the least-privilege
   `drive.file`: the app can reach folders it created and nothing else.
   Targeting a folder the owner made by hand would have meant the full
   `drive` scope — read/write over their entire Drive — to save a folder.

   PRIVACY. The sheet names people, internal systems and delegation rules
   — the reason its content lives only in the private Firestore document
   and never in this public repository. The mirror's folder is app-created
   and therefore private, but it reads the folder's permissions anyway and
   holds off if it ever finds it shared, until the owner overrides.

   Nothing here is content. Folder and doc IDs live in the private store.
   ========================================================== */

/* Docs has no progress element, so the completion bar is drawn out of
   block characters — it survives conversion, copy-paste and print. */
function wkBarText(pct, width = 24) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const on = Math.round(p / 100 * width);
  return '█'.repeat(on) + '░'.repeat(width - on) + '  ' + p + '%';
}

/* Done / total across one department, from the same tick keys the page
   counts — derived, never stored, so the doc can never disagree with the
   screen. */
function wkDeptStats(deptKey) {
  const list = WorkDB.data.workstreams.filter(w => (w.dept || '') === (deptKey || ''));
  let done = 0, total = 0;
  list.forEach(ws => { const k = wkItemKeys(ws); done += k.filter(wkOn).length; total += k.length; });
  return { list, done, total, pct: total ? done / total * 100 : 0 };
}

/* The body of one department: every main task, its phases and sub-tasks.
   Shared by that department's own doc and by the combined one. */
function wkDeptBodyHtml(dep) {
  const s = wkDeptStats(dep.key);
  const tasks = s.list.map(ws => {
    const keys = wkItemKeys(ws), done = keys.filter(wkOn).length;
    const pr = wkPriority(ws.priority);
    const tags = [
      pr ? pr.key : '', ws.boss ? 'Delivery' : '', wkRange(ws.start, ws.end),
      ws.myRole ? 'Me: ' + ws.myRole : '', ws.devRole ? 'Dev: ' + ws.devRole : '',
      ws.withWhom ? 'With: ' + ws.withWhom : ''
    ].filter(Boolean).join(' · ');
    const phases = wkPhases(ws).map(([phase, items]) => `
      <h3>${phase ? wkText(phase) : 'Ungrouped'}</h3>
      ${items.map(st => {
        const sk = wkSubKeys(ws, st), sd = sk.filter(wkOn).length;
        const all = sd === sk.length;
        const box = st.ticks ? `${all ? '☑' : '☐'} <b>${sd}/${st.ticks}</b>` : (all ? '☑' : '☐');
        const meta = [
          wkRange(st.from, st.to), st.withWhom,
          st.assignTo ? '→ ' + st.assignTo : '',
          st.reportOn ? 'report ' + fmtDate(st.reportOn) : ''
        ].filter(Boolean).join(' · ');
        return `<p>${box} ${st.day ? `<b>${wkText(st.day)}</b> ` : ''}${wkText(st.title)}`
          + `${meta ? ` <i>(${wkText(meta)})</i>` : ''}`
          + `${st.notes ? `<br><i>${wkText(st.notes)}</i>` : ''}</p>`;
      }).join('')}`).join('');
    return `
      <h2>${wkText(ws.id)} · ${wkText(ws.title)}</h2>
      ${tags ? `<p><b>${wkText(tags)}</b></p>` : ''}
      ${ws.description ? `<p>${wkText(ws.description)}</p>` : ''}
      ${ws.note ? `<p><i>${wkText(ws.note)}</i></p>` : ''}
      ${ws.boss && ws.bossItem ? `<p><b>Delivery:</b> ${wkText(ws.bossItem)}${ws.bossDue ? ' · ' + wkText(ws.bossDue) : ''}</p>` : ''}
      <p><b>${wkBarText(keys.length ? done / keys.length * 100 : 0)}</b> — ${done}/${keys.length} items closed</p>
      ${phases}`;
  }).join('<hr>');
  return `
    <p>${escapeHtml(_wkMonth || '')} · ${s.list.length} main task${s.list.length === 1 ? '' : 's'}</p>
    <p><b>${wkBarText(s.pct)}</b> — ${s.done}/${s.total} items closed</p>
    <hr>
    ${tasks || '<p><i>No main tasks in this department yet.</i></p>'}`;
}

/* Wrap a body in the letterhead + the generated-file notice. */
function wkDocShell(title, body) {
  const d = WorkDB.data;
  const brand = wkBrand(d.org);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>
    <h1>${escapeHtml(title)}</h1>
    ${brand ? `<p><i>${escapeHtml(brand)}</i></p>` : ''}
    ${body}
    <hr>
    <p><i>Generated by OppTrack on ${escapeHtml(new Date().toLocaleString('en-GB'))} — this document is rewritten on every sync, so edits made here are replaced. Tick in the app.</i></p>
  </body></html>`;
}

/* The mother doc: the roll-up, then every department in full, then the
   rhythm and the close list — the whole sheet in one file.
   Returns the BODY only. The shell is added at the point of writing, because
   it carries a "generated at" timestamp — folding that in here would make the
   content look different on every single run and defeat the change check that
   decides whether this doc needs rewriting at all. */
function wkMotherDocBody() {
  const d = WorkDB.data;
  const depts = d.depts.length ? d.depts : [{ key: '', label: 'Workstreams' }];
  let done = 0, total = 0;
  depts.forEach(dep => { const s = wkDeptStats(dep.key); done += s.done; total += s.total; });
  const closeDone = d.close.filter(c => wkOn('close.' + c.id)).length;
  const critLeft = d.close.filter(c => c.critical && !wkOn('close.' + c.id)).length;
  const weeks = wkWeeksInMonth();

  const summary = depts.map(dep => {
    const s = wkDeptStats(dep.key);
    return `<p><b>${escapeHtml(dep.label)}</b><br>${wkBarText(s.pct)} — ${s.done}/${s.total}</p>`;
  }).join('');

  const rhythm = d.cadence.length ? `
    <hr><h1>Operating rhythm</h1>
    ${d.cadence.map(row => {
      const keys = wkGateKeys(row, weeks), n = keys.filter(wkOn).length;
      return `<p><b>${wkText(row.day || '—')}${row.time ? ' ' + wkText(row.time) : ''} · ${wkText(row.gate)}</b>`
        + `${row.owner ? ` <i>(${wkText(row.owner)})</i>` : ''}<br>`
        + `${keys.map(k => wkOn(k) ? '☑' : '☐').join(' ')}  ${n}/${weeks}`
        + `${row.what ? `<br>${wkText(row.what)}` : ''}</p>`;
    }).join('')}` : '';

  const close = d.close.length ? `
    <hr><h1>Month-end close</h1>
    <p><b>${wkBarText(d.close.length ? closeDone / d.close.length * 100 : 0)}</b> — ${closeDone}/${d.close.length} signed off`
    + `${critLeft ? ` · <b>${critLeft} critical still open — the month cannot be called closed</b>` : (d.close.some(c => c.critical) ? ' · criticals clear' : '')}</p>
    ${d.close.map(c => `<p>${wkOn('close.' + c.id) ? '☑' : '☐'} ${wkText(c.title)}`
      + `${c.critical ? ' <b>[critical]</b>' : ''}`
      + `${c.category || c.owner || c.due ? ` <i>(${wkText([c.category, c.owner, c.due].filter(Boolean).join(' · '))})</i>` : ''}</p>`).join('')}` : '';

  return `
    <p>${escapeHtml(_wkMonth || '')}</p>
    <p><b>${wkBarText(total ? done / total * 100 : 0)}</b> — ${done}/${total} items closed across ${depts.length} department${depts.length === 1 ? '' : 's'}</p>
    <hr>${summary}
    ${depts.map(dep => `<hr><h1>${escapeHtml(dep.label || 'Workstreams')}</h1>${wkDeptBodyHtml(dep)}`).join('')}
    ${rhythm}${close}`;
}
function wkMotherDocName() { return `${(WorkDB.data.title || 'Work Sheet')} — all departments`; }

const WorkDrive = {
  _timer: null,
  _busy: false,
  _dirty: false,      // the sheet changed while a run was in flight
  _selfSave: false,   // the mirror storing its own doc ids — not a content change
  /* Session memos. Resolving the folder and re-reading its sharing cost three
     round-trips before a single tick could be written; both are cleared on any
     failure, so a folder deleted or shared mid-session is still picked up. */
  _root: null,
  _shareAt: 0,

  cfg() { return (WorkDB.data && WorkDB.data.drive) || {}; },

  /* Should ticks follow through to Drive?
     `on` alone was not enough. The switch used to default to OFF, so the very
     first "Mirror now" — before the owner had ever seen that switch — stored
     on:false and left the docs frozen at that one snapshot. `onSet` marks an
     answer the owner actually gave: without one, a mirror that has already been
     set up (rootId) is taken to be wanted, and a device that never mirrored is
     still left completely alone. */
  autoOn() {
    const c = this.cfg();
    return c.onSet ? !!c.on : !!c.rootId;
  },

  /* Content fingerprint, so a doc that has not moved is not rewritten.
     The letterhead is folded in, not just the body: wkDocShell prints the
     brand line from `org`, so a doc whose body is unchanged still has to be
     rewritten when the group name changes. Only the shell's "generated at"
     stamp is left out — that moves every second and would defeat the check. */
  _sig(s) {
    const brand = wkBrand((WorkDB.data && WorkDB.data.org) || '');
    const str = brand + ' ' + String(s);
    return (typeof Drive !== 'undefined' && Drive._hash) ? Drive._hash(str) : String(str.length);
  },

  /* Called by WorkDB._persistDrive on EVERY change — a task added, a sub-task
     deleted, a box ticked. Short debounce so a burst of edits (or a
     drag-through of ten checkboxes) becomes one rewrite rather than ten, while
     a single change still lands about a second later.

     Never opens a popup: the sheet itself is already saved by the time we get
     here, so nothing is at stake if this does nothing. */
  schedule() {
    if (!this.autoOn()) return;
    if (this._selfSave) return;                 // our own bookkeeping write
    if (typeof Drive === 'undefined') return;
    /* A device that never connected Drive has nothing to do. On one that HAS,
       a stale token is fine — sync() refreshes it silently. Bailing on
       isConnected() alone is what used to stop the mirror dead about an hour
       into a session, with no message, until the page was reloaded. */
    if (!Drive.isConnected() && !Drive.deviceEnabled()) return;
    /* Mid-run: a mirror pass takes seconds (each doc is an HTML→Docs
       conversion), and every tick made during it used to be dropped on the
       floor. Remember it and re-run once the current pass lands. */
    if (this._busy) { this._dirty = true; return; }
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sync({ silent: true }), 1200);
  },

  /* On page load: the docs are behind whenever the last ticks were made
     somewhere Drive was not connected (a phone, another browser). Costs one
     folder lookup when nothing changed, because every doc is change-checked
     before it is written. */
  async catchUp() {
    if (!this.autoOn() || typeof Drive === 'undefined') return;
    if (!Drive.isConnected() && !(await Drive.trySilentConnect())) return;
    this.sync({ silent: true });
  },

  /* force = rewrite every doc even if it looks unchanged. The manual
     "Mirror now" sets it, so a doc someone typed into in Drive can always be
     put back to the truth. */
  async sync({ silent = false, force = false } = {}) {
    if (this._busy) { this._dirty = true; return false; }
    if (!Security.guard('mirror the work sheet to Drive')) return false;
    const d = WorkDB.data;
    const cfg = this.cfg();
    this._busy = true;
    let wrote = 0, skipped = 0, announced = false, changed = false;
    const announce = () => { if (!announced) { announced = true; setSync('drive-saving'); } };
    try {
      if (!Drive.isConnected()) {
        /* Popup-free refresh first — the access token only lives an hour, and
           an afternoon of ticking should not quietly stop reaching Drive. */
        const back = await Drive.trySilentConnect();
        if (!back) {
          if (silent) return false;    // never a popup off the back of a tick
          await Drive.connect();
        }
      }
      /* My Drive / OppTracker Backups / Work Sheet — the app's own folder,
         created on first use. Nothing to configure, and `drive.file` reaches
         it precisely because the app made it. */
      const root = this._root || (this._root = await Drive.workRoot());
      if (d.drive.rootId !== root) { d.drive.rootId = root; changed = true; }
      /* That folder is app-created and private, so this is a safety net rather
         than a gate: it catches the case where it gets shared later. A metadata
         read that simply fails is NOT treated as "shared" — blocking the mirror
         over an unrelated API hiccup would be worse than the risk it covers.
         Re-read at most every ten minutes: a folder does not become public
         between two ticks, and asking each time put a whole round-trip in front
         of every box. "Mirror now" always re-checks. */
      const shareStale = force || (Date.now() - this._shareAt > 600000);
      if (!cfg.allowShared && shareStale) {
        let share = null;
        try { share = await Drive.folderSharing(root); }
        catch (e) { console.warn('[Work Sheet] could not read folder sharing:', e.message); }
        if (share && (share.anyone || share.domain)) {
          if (!silent) wkDriveShareWarning(share);
          else console.warn('[Work Sheet] Drive mirror held: folder is shared.');
          return false;
        }
        this._shareAt = Date.now();
      }
      const depts = d.depts.length ? d.depts : [{ key: '', label: 'Workstreams' }];
      for (const dep of depts) {
        const k = dep.key || '';
        const label = dep.label || 'Workstreams';
        const slot = d.drive.depts[k] || (d.drive.depts[k] = {});
        /* Reuse the folder already made for this department, renaming it if the
           department was renamed. Looking it up by name instead would strand the
           old folder and stand an empty new one beside it on every rename. */
        if (slot.folderId && (force || slot.label !== label)) {
          try { await Drive.renameFile(slot.folderId, label); slot.label = label; changed = true; }
          catch (e) { slot.folderId = null; }   // gone from Drive → make a fresh one
        }
        if (!slot.folderId) { slot.folderId = await Drive.folder(root, label); slot.label = label; changed = true; }

        /* Only rewrite what actually moved. A tick touches ONE department, but
           this used to rewrite every department doc AND the combined one — five
           Docs conversions to record one box, which is exactly why the docs
           read as lagging behind the sheet. */
        const body = wkDeptBodyHtml(dep);
        const sig = this._sig(label + ' ' + body);
        if (!force && slot.docId && slot.hash === sig) { skipped++; continue; }
        announce();
        slot.docId = await Drive.putDoc(slot.folderId, `${label} — to-do`, wkDocShell(label, body), slot.docId);
        slot.hash = sig;
        wrote++;
      }

      const mName = wkMotherDocName();
      const mBody = wkMotherDocBody();
      const mSig = this._sig(mName + ' ' + mBody);
      if (force || !d.drive.motherDocId || d.drive.motherHash !== mSig) {
        announce();
        d.drive.motherDocId = await Drive.putDoc(root, mName, wkDocShell(mName, mBody), d.drive.motherDocId);
        d.drive.motherHash = mSig;
        wrote++;
      } else skipped++;

      /* Store the doc ids and fingerprints we just earned — but ONLY when this
         run actually did something. The flag stops our own write from looking
         like a change to the sheet and sending the mirror round again; the
         `wrote || changed` test stops the other half of the same loop, where
         two connected devices bounce an empty save off each other for ever
         through the live Firestore subscription. */
      if (wrote || changed) {
        if (wrote) d.drive.lastSync = Date.now();
        this._selfSave = true;
        try { WorkDB.saveNow(); } finally { this._selfSave = false; }
      }

      console.info(`[Work Sheet] Drive mirror: ${wrote} written, ${skipped} already current.`);
      if (announced || !silent) setSync('drive-done');
      if (!silent) toast(wrote
        ? `Mirrored to Drive — ${wrote} doc${wrote === 1 ? '' : 's'} rewritten.`
        : 'Drive is already up to date.', 'ok');
      return true;
    } catch (e) {
      // Drop the memos: the next attempt re-resolves the folder and re-reads
      // its sharing rather than retrying against something that may be gone.
      this._root = null; this._shareAt = 0;
      setSync('drive-error');
      console.warn('[Work Sheet] Drive mirror failed:', e);
      if (!silent) toast('Drive mirror failed: ' + e.message, 'err');
      return false;
    } finally {
      this._busy = false;
      // Ticks that landed during the run — mirror them now rather than leaving
      // the docs behind until the owner happens to edit something else.
      if (this._dirty) { this._dirty = false; this.schedule(); }
    }
  }
};

/* Stops before writing anything and says exactly why. */
function wkDriveShareWarning(share) {
  const who = share.anyone ? 'anyone with the link' : 'everyone in your organisation';
  const { modalEl, modal } = wkModal('That folder is not private', 'shield-exclamation', `
    <p><b>${escapeHtml(share.name || 'That folder')}</b> is open to <b>${escapeHtml(who)}</b>.</p>
    <p>The work sheet names people, internal systems and how work is delegated. That content is deliberately kept out of this site's code and out of the public portfolio document — mirroring it into a folder anyone can open would undo all of that in one step.</p>
    <p class="text-faint" style="font-size:12.5px">Set the folder to <b>Restricted</b> in Drive → Share, then mirror again. <b>Nothing has been written.</b></p>`, `
    <a class="btn btn-ghost" href="${escapeHtml(Drive.folderLink(WorkDB.data.drive.rootId))}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right me-1"></i>Open the folder</a>
    <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
    <button type="button" class="btn btn-danger" id="wkDriveAnyway">Mirror anyway</button>`);
  modalEl.querySelector('#wkDriveAnyway').onclick = () => {
    WorkDB.data.drive.allowShared = true;
    WorkDB.saveNow();
    modal.hide();
    WorkDrive.sync({ silent: false, force: true });
  };
}

function openWorkDriveModal() {
  if (!Security.guard('set up the Drive mirror')) return;
  const d = WorkDB.data;
  const cfg = d.drive || {};
  const connected = (typeof Drive !== 'undefined') && Drive.isConnected();
  const last = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString('en-GB') : '';
  const { modalEl, modal } = wkModal('Mirror to Google Drive', 'cloud-arrow-up', `
    <p>The sheet is written out as Google Docs — one per department, plus a combined one — into the backup folder this app already keeps:</p>
    <p><code>My&nbsp;Drive / ${escapeHtml(Drive.FOLDER_NAME)} / ${escapeHtml(Drive.WORK_FOLDER_NAME)}</code></p>
    <p class="text-faint" style="font-size:12.5px">The same folder your JSON backup uses. The app created it, so this needs no extra Google permission and nothing else in your Drive is ever reachable. Ticking a box here rewrites the docs it affects — they are generated, so anything typed into them is replaced on the next sync.</p>
    <form id="wkDriveForm" class="form-grid">
      <div class="field col-span"><label class="switch-row">
        <!-- ON unless it was deliberately turned off. It used to default to
             off, which meant "Mirror now" on a first, unconfigured visit
             SAVED it as off — so the docs were written once and then never
             followed the sheet again. -->
        <input type="checkbox" name="on" ${WorkDrive.autoOn() ? 'checked' : ''}>
        <span>Keep the docs up to date as I tick</span>
      </label>
      <div class="hint">Each change is written about a second after you make it. A Google Doc already open in another tab will not refresh itself — reload that tab to see the update.</div></div>
      <div class="field col-span">
        <label class="switch-row">
          <input type="checkbox" name="allowShared" ${cfg.allowShared ? 'checked' : ''}>
          <span>Mirror even if that folder is shared beyond me</span>
        </label>
        <div class="hint">Off by default. The sheet names people and internal systems, so if that folder ever gets shared to “anyone with the link”, the mirror stops until you say otherwise.</div>
      </div>
      <div class="field col-span">
        <div class="hint">${connected ? 'Drive is connected on this device.' : 'Not connected on this device yet — mirroring opens one Google window.'}${last ? ` Last mirrored ${escapeHtml(last)}.` : ''}</div>
      </div>
    </form>`, `
    ${cfg.motherDocId ? `<a class="btn btn-ghost" href="${escapeHtml(Drive.docLink(cfg.motherDocId))}" target="_blank" rel="noopener"><i class="bi bi-file-earmark-text me-1"></i>Open combined doc</a>` : ''}
    ${cfg.rootId ? `<a class="btn btn-ghost" href="${escapeHtml(Drive.folderLink(cfg.rootId))}" target="_blank" rel="noopener"><i class="bi bi-folder2-open me-1"></i>Open folder</a>` : ''}
    <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Close</button>
    <button type="button" class="btn btn-primary" id="wkDriveGo"><i class="bi bi-cloud-arrow-up me-1"></i>Mirror now</button>`);

  modalEl.querySelector('#wkDriveGo').onclick = async () => {
    const f = modalEl.querySelector('#wkDriveForm');
    d.drive.on = !!f.on.checked;
    d.drive.onSet = true;                 // an answer the owner actually gave
    d.drive.allowShared = !!f.allowShared.checked;
    WorkDB.saveNow();
    modal.hide();
    await WorkDrive.sync({ silent: false, force: true });
  };
}

/* ==========================================================
   WORK SHEET EDITORS — departments, main tasks, phases
   ----------------------------------------------------------
   Dedicated private modals (the generic openEntityModal is wired to the
   PUBLIC store, so it cannot be reused here). Every one is owner-guarded
   and writes through WorkDB.saveNow().
   ========================================================== */

/* Shared modal scaffold: returns { modalEl, modal, close } */
function wkModal(title, icon, bodyHtml, footerHtml) {
  document.getElementById('wkEditModal')?.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="wkEditModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <div class="d-flex align-items-center gap-2">
            <span class="stat-ico"><i class="bi bi-${icon}"></i></span>
            <h5 class="modal-title">${escapeHtml(title)}</h5>
          </div>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-footer">${footerHtml}</div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('wkEditModal');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());
  return { modalEl, modal };
}
const wkVal = (form, name) => {
  const el = form.elements.namedItem(name);
  return el ? (el.type === 'checkbox' ? el.checked : String(el.value || '').trim()) : '';
};

/* ---- Department: add / rename / remove ---- */
function openWorkDeptModal(key) {
  if (!Security.guard('manage departments')) return;
  const isEdit = key != null && key !== undefined && WorkDB.data.depts.some(d => (d.key || '') === key);
  const dep = isEdit ? WorkDB.data.depts.find(d => (d.key || '') === key) : { key: '', label: '', tag: '' };
  const inUse = isEdit ? WorkDB.data.workstreams.filter(w => (w.dept || '') === key).length : 0;

  const { modalEl, modal } = wkModal(
    isEdit ? 'Department' : 'Add department', 'diagram-2',
    `<form id="wkDeptForm" class="form-grid">
      <div class="field col-span"><label>Department name <span class="req">*</span></label>
        <input name="label" value="${escapeHtml(dep.label || '')}" placeholder="e.g. Operations &amp; Admin"></div>
      <div class="field col-span"><label>Sub-label</label>
        <input name="tag" value="${escapeHtml(dep.tag || '')}" placeholder="e.g. my own hands"></div>
      ${isEdit && inUse ? `<div class="field col-span"><p class="text-faint" style="font-size:12.5px;margin:0">
        <i class="bi bi-info-circle me-1"></i>${inUse} main task${inUse === 1 ? '' : 's'} sit under this department, so it cannot be removed until they are moved or deleted.</p></div>` : ''}
    </form>`,
    `${isEdit && !inUse ? '<button type="button" class="btn btn-danger-soft me-auto" id="wkDeptDel"><i class="bi bi-trash me-1"></i>Remove</button>' : ''}
     <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
     <button type="button" class="btn btn-primary" id="wkDeptSave"><i class="bi bi-check-lg me-1"></i>${isEdit ? 'Save' : 'Add department'}</button>`
  );

  const del = document.getElementById('wkDeptDel');
  if (del) del.onclick = () => {
    if (!confirm(`Remove the "${dep.label}" department?`)) return;
    WorkDB.data.depts = WorkDB.data.depts.filter(d => (d.key || '') !== key);
    WorkDB.saveNow(); modal.hide(); drawWork();
    toast('Department removed.', 'ok');
  };

  document.getElementById('wkDeptSave').onclick = () => {
    const f = document.getElementById('wkDeptForm');
    const label = wkVal(f, 'label');
    if (!label) { toast('Give the department a name.', 'err'); f.elements.namedItem('label').focus(); return; }
    const tag = wkVal(f, 'tag');
    if (isEdit) {
      dep.label = label; dep.tag = tag;
    } else {
      // a stable slug key, kept unique; workstreams reference it
      let k = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'dept';
      while (WorkDB.data.depts.some(d => d.key === k)) k += '-2';
      WorkDB.data.depts.push({ key: k, label, tag });
    }
    WorkDB.saveNow(); modal.hide(); drawWork();
    toast(isEdit ? 'Department updated.' : 'Department added.', 'ok');
  };
}

/* ---- Main task (workstream): add / edit ---- */
function openWorkTaskModal(wsId, deptKey) {
  if (!Security.guard(wsId ? 'edit this task' : 'add a task')) return;
  const isEdit = !!wsId;
  const ws = isEdit ? wkFind(wsId) : null;
  if (isEdit && !ws) return;
  const rec = ws || { dept: deptKey || (WorkDB.data.depts[0] || {}).key || '', priority: 'Medium' };
  const depts = WorkDB.data.depts.length ? WorkDB.data.depts : [{ key: '', label: 'Workstreams' }];

  const { modal } = wkModal(
    isEdit ? `Edit ${ws.id}` : 'New main task', 'clipboard-check',
    `<form id="wkTaskForm" class="form-grid">
      <div class="field col-span"><label>Title <span class="req">*</span></label>
        <input name="title" value="${escapeHtml(rec.title || '')}" placeholder="What is this workstream?"></div>
      <div class="field col-span"><label>Description</label>
        <textarea name="description" rows="3" placeholder="What it covers, and what done looks like">${escapeHtml(rec.description || '')}</textarea></div>

      <div class="field"><label>Department</label><select name="dept">
        ${depts.map(d => `<option value="${escapeHtml(d.key || '')}" ${(rec.dept || '') === (d.key || '') ? 'selected' : ''}>${escapeHtml(d.label)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Priority</label><select name="priority">
        <option value="">— none —</option>
        ${WK_PRIORITIES.map(p => `<option ${rec.priority === p.key ? 'selected' : ''}>${p.key}</option>`).join('')}
      </select><small class="text-faint" style="font-size:11px">Colours the card's left rule: High red · Medium amber · Low green.</small></div>

      <div class="field"><label>Timeline — from</label><input type="date" name="start" value="${escapeHtml(rec.start || '')}"></div>
      <div class="field"><label>Timeline — to</label><input type="date" name="end" value="${escapeHtml(rec.end || '')}"></div>

      <div class="field"><label>My role</label><input name="myRole" value="${escapeHtml(rec.myRole || '')}" placeholder="e.g. Spec + monitoring"></div>
      <div class="field"><label>Dev role</label><input name="devRole" value="${escapeHtml(rec.devRole || '')}" placeholder="e.g. Full build"></div>
      <div class="field col-span"><label>Working with / for</label>
        <input name="withWhom" value="${escapeHtml(rec.withWhom || '')}" placeholder="Who you do this with, or who it is for"></div>

      <div class="field col-span"><label class="switch-row">
        <input type="checkbox" name="boss" ${rec.boss ? 'checked' : ''}>
        <span>This is a delivery I report up — show it in the delivery register</span></label></div>
      <div class="field"><label>Deliverable</label><input name="bossItem" value="${escapeHtml(rec.bossItem || '')}" placeholder="What gets handed over"></div>
      <div class="field"><label>Due / gate</label><input name="bossDue" value="${escapeHtml(rec.bossDue || '')}" placeholder="e.g. Thursday gate"></div>

      <div class="field col-span"><label>Note</label>
        <textarea name="note" rows="2" placeholder="Anything to keep front of mind">${escapeHtml(rec.note || '')}</textarea></div>
    </form>`,
    `<button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
     <button type="button" class="btn btn-primary" id="wkTaskSave"><i class="bi bi-check-lg me-1"></i>${isEdit ? 'Save changes' : 'Add main task'}</button>`
  );

  document.getElementById('wkTaskSave').onclick = () => {
    const f = document.getElementById('wkTaskForm');
    const title = wkVal(f, 'title');
    if (!title) { toast('Give the task a title.', 'err'); f.elements.namedItem('title').focus(); return; }
    const start = wkVal(f, 'start'), end = wkVal(f, 'end');
    if (start && end && end < start) { toast('The end date is before the start date.', 'err'); return; }
    const patch = {
      title, description: wkVal(f, 'description'), dept: wkVal(f, 'dept'),
      priority: wkVal(f, 'priority'), start, end,
      myRole: wkVal(f, 'myRole'), devRole: wkVal(f, 'devRole'), withWhom: wkVal(f, 'withWhom'),
      boss: wkVal(f, 'boss'), bossItem: wkVal(f, 'bossItem'), bossDue: wkVal(f, 'bossDue'),
      note: wkVal(f, 'note')
    };
    if (isEdit) {
      Object.assign(ws, patch);
      wkKeepOpen(ws.id);
    } else {
      const fresh = Object.assign({
        id: wkNextId(), mode: patch.devRole ? 'deleg' : 'self', subtasks: [], groups: []
      }, patch);
      WorkDB.data.workstreams.push(fresh);
      wkKeepOpen(fresh.id);   // a brand-new card opens so you can fill it in
    }
    WorkDB.saveNow(); modal.hide(); drawWork();
    toast(isEdit ? 'Task updated.' : 'Main task added.', 'ok');
  };
}

/* ---- Sub-task: add / edit ----
   `phase` groups sub-tasks under a heading inside the card. Typing a new name
   creates that phase; the datalist offers the ones already in use. */
function openWorkSubModal(wsId, subId, phasePrefill) {
  if (!Security.guard(subId ? 'edit this sub-task' : 'add a sub-task')) return;
  const ws = wkFind(wsId);
  if (!ws) return;
  const st = subId ? wkFindSub(wsId, subId) : null;
  if (subId && !st) return;
  const rec = st || { phase: phasePrefill || '' };
  const phases = wkAllPhases();

  const { modal } = wkModal(
    `${st ? 'Edit' : 'Add'} sub-task · ${ws.id}`, 'signpost-split',
    `<form id="wkSubForm" class="form-grid">
      <div class="field col-span"><label>Sub-task <span class="req">*</span></label>
        <input name="title" value="${escapeHtml(rec.title || '')}" placeholder="e.g. Draft the payroll spec"></div>

      <div class="field"><label>Phase / group</label>
        <input name="phase" list="wkPhaseList" value="${escapeHtml(rec.phase || '')}" placeholder="e.g. Week 1 · groundwork">
        <datalist id="wkPhaseList">${phases.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
        <small class="text-faint" style="font-size:11px">Groups it under a heading. Type a new name to start a new phase.</small></div>
      <div class="field"><label>Day marker</label>
        <input name="day" value="${escapeHtml(rec.day || '')}" placeholder="e.g. D3">
        <small class="text-faint" style="font-size:11px">Short tag shown before the title.</small></div>

      <div class="field"><label>From</label><input type="date" name="from" value="${escapeHtml(rec.from || '')}"></div>
      <div class="field"><label>To</label><input type="date" name="to" value="${escapeHtml(rec.to || '')}"></div>
      <div class="field"><label>With whom</label><input name="withWhom" value="${escapeHtml(rec.withWhom || '')}" placeholder="Who you work on it with"></div>
      <div class="field"><label>Assign to</label><input name="assignTo" value="${escapeHtml(rec.assignTo || '')}" placeholder="Who it is handed to"></div>
      <div class="field"><label>Report up on</label><input type="date" name="reportOn" value="${escapeHtml(rec.reportOn || '')}">
        <small class="text-faint" style="font-size:11px">When this gets reported up.</small></div>
      <div class="field"><label>Repeat count</label>
        <input type="number" name="ticks" min="0" max="60" step="1" value="${rec.ticks || ''}" placeholder="e.g. 10">
        <small class="text-faint" style="font-size:11px">For "do this N times" rows — shows N boxes. Leave blank for one.</small></div>
      <div class="field col-span"><label class="switch-row">
        <input type="checkbox" name="buf" ${rec.buf ? 'checked' : ''}>
        <span>Buffer / only-if-needed — shown dimmed</span></label></div>
      <div class="field col-span"><label>Notes</label>
        <textarea name="notes" rows="2" placeholder="Detail, blockers, acceptance">${escapeHtml(rec.notes || '')}</textarea></div>
    </form>`,
    `${st ? '<button type="button" class="btn btn-danger-soft me-auto" id="wkSubDel"><i class="bi bi-trash me-1"></i>Delete</button>' : ''}
     <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
     <button type="button" class="btn btn-primary" id="wkSubSave"><i class="bi bi-check-lg me-1"></i>${st ? 'Save changes' : 'Add sub-task'}</button>`
  );

  const del = document.getElementById('wkSubDel');
  if (del) del.onclick = () => { modal.hide(); workDeleteSub(wsId, subId); };

  document.getElementById('wkSubSave').onclick = () => {
    const f = document.getElementById('wkSubForm');
    const title = wkVal(f, 'title');
    if (!title) { toast('Name the sub-task first.', 'err'); f.elements.namedItem('title').focus(); return; }
    const from = wkVal(f, 'from'), to = wkVal(f, 'to');
    if (from && to && to < from) { toast('"To" is before "From".', 'err'); return; }
    const n = parseInt(wkVal(f, 'ticks'), 10);
    const ticks = (!isNaN(n) && n > 1) ? Math.min(n, 60) : 0;
    const patch = {
      title, phase: wkVal(f, 'phase'), day: wkVal(f, 'day'), from, to,
      withWhom: wkVal(f, 'withWhom'), assignTo: wkVal(f, 'assignTo'),
      reportOn: wkVal(f, 'reportOn'), notes: wkVal(f, 'notes'), buf: wkVal(f, 'buf')
    };
    if (st) {
      // Shrinking the repeat count would orphan the ticks of the dropped boxes.
      if (st.ticks && ticks < st.ticks) {
        wkForgetKeys(wkSubKeys(ws, st).slice(Math.max(ticks, 1)));
      }
      Object.assign(st, patch);
      if (ticks) st.ticks = ticks; else delete st.ticks;
    } else {
      const fresh = Object.assign({ id: uid() }, patch);
      if (ticks) fresh.ticks = ticks;
      (ws.subtasks = ws.subtasks || []).push(fresh);
    }
    wkKeepOpen(wsId);
    WorkDB.saveNow(); modal.hide(); drawWork();
    toast(st ? 'Sub-task updated.' : 'Sub-task added.', 'ok');
  };
}

/* ---- Operating-rhythm gate: add / edit ---- */
function openWorkGateModal(id) {
  if (!Security.guard(id ? 'edit this gate' : 'add a gate')) return;
  const rows = WorkDB.data.cadence;
  const row = id ? rows.find(r => r.id === id) : null;
  if (id && !row) return;
  const rec = row || { day: '', gate: '', what: '', owner: '', time: '', kind: '' };
  const DAYS = ['Daily', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
    'Every 2nd day', 'Every 3rd day', 'Weekly', 'Fortnightly', 'Month-end'];

  const { modal } = wkModal(
    row ? 'Edit gate' : 'Add gate', 'arrow-repeat',
    `<form id="wkGateForm" class="form-grid">
      <div class="field col-span"><label>Gate name <span class="req">*</span></label>
        <input name="gate" value="${escapeHtml(rec.gate || '')}" placeholder="e.g. Mid-week audit"></div>
      <div class="field"><label>When</label>
        <input name="day" list="wkDayList" value="${escapeHtml(rec.day || '')}" placeholder="e.g. Tuesday">
        <datalist id="wkDayList">${DAYS.map(x => `<option value="${x}"></option>`).join('')}</datalist>
        <small class="text-faint" style="font-size:11px">A weekday name (or "Daily") flags the row on the day it is due.</small></div>
      <div class="field"><label>Time</label><input name="time" value="${escapeHtml(rec.time || '')}" placeholder="e.g. 10:00"></div>
      <div class="field"><label>Kind</label><select name="kind">
        <option value="">— none —</option>
        ${WK_GATE_KINDS.map(k => `<option ${rec.kind === k.key ? 'selected' : ''}>${k.key}</option>`).join('')}
      </select></div>
      <div class="field"><label>Who runs it</label><input name="owner" value="${escapeHtml(rec.owner || '')}" placeholder="Who is in the room"></div>
      <div class="field col-span"><label>What happens</label>
        <textarea name="what" rows="3" placeholder="What actually gets done at this gate">${escapeHtml(rec.what || '')}</textarea></div>
    </form>`,
    `${row ? '<button type="button" class="btn btn-danger-soft me-auto" id="wkGateDel"><i class="bi bi-trash me-1"></i>Delete</button>' : ''}
     <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
     <button type="button" class="btn btn-primary" id="wkGateSave"><i class="bi bi-check-lg me-1"></i>${row ? 'Save changes' : 'Add gate'}</button>`
  );

  const del = document.getElementById('wkGateDel');
  if (del) del.onclick = () => { modal.hide(); workDeleteRow('cadence', id); };

  document.getElementById('wkGateSave').onclick = () => {
    const f = document.getElementById('wkGateForm');
    const gate = wkVal(f, 'gate');
    if (!gate) { toast('Name the gate first.', 'err'); f.elements.namedItem('gate').focus(); return; }
    const patch = { gate, day: wkVal(f, 'day'), time: wkVal(f, 'time'), kind: wkVal(f, 'kind'), owner: wkVal(f, 'owner'), what: wkVal(f, 'what') };
    if (row) Object.assign(row, patch);
    else rows.push(Object.assign({ id: uid() }, patch));
    WorkDB.saveNow(); modal.hide(); drawWork();
    toast(row ? 'Gate updated.' : 'Gate added.', 'ok');
  };
}

/* ---- Month-end close item: add / edit ---- */
function openWorkCloseModal(id) {
  if (!Security.guard(id ? 'edit this close item' : 'add a close item')) return;
  const rows = WorkDB.data.close;
  const row = id ? rows.find(r => r.id === id) : null;
  if (id && !row) return;
  const rec = row || { title: '', owner: '', category: '', due: '', critical: false, notes: '' };

  const { modal } = wkModal(
    row ? 'Edit close item' : 'Add close item', 'clipboard-check-fill',
    `<form id="wkCloseForm" class="form-grid">
      <div class="field col-span"><label>What must be true <span class="req">*</span></label>
        <input name="title" value="${escapeHtml(rec.title || '')}" placeholder="e.g. Payroll month closed and reconciled to GL"></div>
      <div class="field"><label>Area</label><select name="category">
        <option value="">— none —</option>
        ${WK_CLOSE_CATS.map(c => `<option ${rec.category === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select><small class="text-faint" style="font-size:11px">Groups the list under headings.</small></div>
      <div class="field"><label>Owner</label><input name="owner" value="${escapeHtml(rec.owner || '')}" placeholder="Who signs it off"></div>
      <div class="field col-span"><label>When</label>
        <input name="due" value="${escapeHtml(rec.due || '')}" placeholder="e.g. Last working day">
        <small class="text-faint" style="font-size:11px">Free text — "last 2 working days", a date, whatever fits.</small></div>
      <div class="field col-span"><label class="switch-row">
        <input type="checkbox" name="critical" ${rec.critical ? 'checked' : ''}>
        <span>Critical — the month cannot be called closed until this is done</span></label></div>
      <div class="field col-span"><label>Note</label>
        <input name="notes" value="${escapeHtml(rec.notes || '')}" placeholder="Anything to remember"></div>
    </form>`,
    `${row ? '<button type="button" class="btn btn-danger-soft me-auto" id="wkCloseDel"><i class="bi bi-trash me-1"></i>Delete</button>' : ''}
     <button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>
     <button type="button" class="btn btn-primary" id="wkCloseSave"><i class="bi bi-check-lg me-1"></i>${row ? 'Save changes' : 'Add item'}</button>`
  );

  const del = document.getElementById('wkCloseDel');
  if (del) del.onclick = () => { modal.hide(); workDeleteRow('close', id); };

  document.getElementById('wkCloseSave').onclick = () => {
    const f = document.getElementById('wkCloseForm');
    const title = wkVal(f, 'title');
    if (!title) { toast('Say what must be true.', 'err'); f.elements.namedItem('title').focus(); return; }
    const patch = { title, category: wkVal(f, 'category'), owner: wkVal(f, 'owner'), due: wkVal(f, 'due'), critical: wkVal(f, 'critical'), notes: wkVal(f, 'notes') };
    if (row) Object.assign(row, patch);
    else rows.push(Object.assign({ id: uid() }, patch));
    WorkDB.saveNow(); modal.hide(); drawWork();
    toast(row ? 'Close item updated.' : 'Close item added.', 'ok');
  };
}

/* ---- Deletes. Ticks for the removed rows are cleared from every month so
   they cannot linger in the counts. ---- */
/* Shared delete for the flat rhythm / close lists. */
function workDeleteRow(list, id) {
  const label = list === 'cadence' ? 'gate' : 'close item';
  if (!Security.guard(`delete this ${label}`)) return;
  const rows = WorkDB.data[list] || [];
  const row = rows.find(r => r.id === id);
  if (!row) return;
  if (!confirm(`Delete the ${label} "${row.gate || row.title}"?`)) return;
  wkForgetKeys(list === 'cadence' ? wkGateKeys(row, 6) : ['close.' + id]);
  WorkDB.data[list] = rows.filter(r => r.id !== id);
  WorkDB.saveNow();
  drawWork();
  toast(`${label[0].toUpperCase() + label.slice(1)} deleted.`, 'ok');
}

function wkForgetKeys(keys) {
  const all = WorkDB.data.checks || {};
  Object.keys(all).forEach(month => keys.forEach(k => { delete all[month][k]; }));
}
function workDeleteTask(wsId) {
  if (!Security.guard('delete this task')) return;
  const ws = wkFind(wsId);
  if (!ws) return;
  const n = (ws.subtasks || []).length;
  if (!confirm(`Delete "${ws.title}"?${n ? ` Its ${n} phase${n === 1 ? '' : 's'} go too.` : ''} This cannot be undone.`)) return;
  wkForgetKeys(wkItemKeys(ws).concat('boss.' + ws.id));
  WorkDB.data.workstreams = WorkDB.data.workstreams.filter(w => w.id !== wsId);
  WorkDB.saveNow();
  drawWork();
  toast('Main task deleted.', 'ok');
}
function workDeleteSub(wsId, subId) {
  if (!Security.guard('delete this phase')) return;
  const ws = wkFind(wsId);
  const st = wkFindSub(wsId, subId);
  if (!ws || !st) return;
  if (!confirm(`Delete the sub-task "${st.title}"?`)) return;
  wkForgetKeys(wkSubKeys(ws, st));   // covers every box of a repeat-count row
  ws.subtasks = (ws.subtasks || []).filter(s => s.id !== subId);
  wkKeepOpen(wsId);
  WorkDB.saveNow();
  drawWork();
  toast('Sub-task deleted.', 'ok');
}

/* Import the sheet content from a JSON file. Existing ticks are preserved
   unless the file brings its own, so re-importing an edited structure never
   wipes the month's progress. */
function workImport(file) {
  if (!Security.guard('import a work sheet')) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (!obj || !Array.isArray(obj.workstreams) || !obj.workstreams.length) {
        throw new Error('No workstreams in that file.');
      }
      // Carry the current ticks in BEFORE hydrating, so the checklist→sub-task
      // fold can remap them. Assigning them afterwards would leave old
      // position-based keys pointing at rows that no longer exist.
      const keepChecks = WorkDB.data && WorkDB.data.checks;
      if (!(obj.checks && Object.keys(obj.checks).length) && keepChecks) obj.checks = keepChecks;
      WorkDB.data = WorkDB._hydrate(obj);
      delete WorkDB.data._comment;
      if (!_wkMonth) _wkMonth = WorkDB.data.month || wkDefaultMonth();
      _wkOpenWs = null;   // a different sheet — fall back to "first card open"
      WorkDB.saveNow();
      drawWork();
      toast(`Sheet loaded — ${WorkDB.data.workstreams.length} workstreams.`, 'ok');
    } catch (e) {
      toast('That file could not be read as a work sheet.', 'err');
    }
  };
  reader.readAsText(file);
}

/* Portfolio scroll-reveal — a gentle, premium fade-up as each section
   enters view. Purely cosmetic: it only adds classes, sections stay
   fully visible if this never runs, and it honours reduced-motion. */
function setupPortfolioReveal() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;
    document.body.classList.add('reveal-on');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.pf-section').forEach(s => io.observe(s));
  } catch {}
}

/* ==========================================================
   7. ROUTER — map page name → initializer, run on load
   ========================================================== */
const PAGE_INIT = {
  dashboard: initDashboard,
  accounts: initAccounts,
  opportunities: initOpportunities,
  'opportunity-details': initOpportunityDetails,
  tasks: initTasks,
  documents: initDocuments,
  achievements: initAchievements,
  education: initEducation,
  training: initTraining,
  volunteering: initVolunteering,
  contacts: initContacts,
  research: initResearch,
  projects: initProjects,
  categories: initCategories,
  profile: initProfile,
  owner: initOwner,
  work: initWork,
  index: initIndex
};

document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;

  /* SECURITY BOOTSTRAP — must run before anything renders.
     1) resolve the Firebase auth state (owner or visitor),
     2) bounce visitors away from owner-only pages,
     3) paint instantly from cache, then load the authoritative
        cloud copy, render, and apply owner/viewer UI gating. */
  await Security.init();
  if (!Security.requireOwner(page)) return; // redirected to login → stop

  DB.loadLocal();        // instant first paint from the local cache
  await DB.loadCloud();  // then the shared cloud copy (source of truth)

  if (normalizeReminders()) DB.save();   // migrate legacy reminder records
  if (Security.isOwner() && (ensureOppBaseline() | ensureTaskBaseline())) DB.save();   // seed event-stream baselines
  try { computeSignals(); } catch {}         // opportunity Signal Layer
  try { computeProductivity(); } catch {}    // productivity Signal Layer
  renderActivePage(page);
  try { maybeWeeklyRetro(); } catch {}       // weekly retrospective (once a week)
  startReminderWatcher();                // owner-only: fire reminders when due
  loadLanguageData();                    // load spelling library + wordlist (async)

  // Live sync: when another device changes the data, re-render — but
  // never yank a form out from under the owner while a modal is open.
  DB.subscribe(() => {
    setSync('updated');
    if (document.querySelector('.modal.show')) return;
    renderActivePage(page);
  });

  // Ownership / copyright footer on every page.
  renderFooter();

  // Portfolio: gentle scroll-reveal for a premium feel.
  if (page === 'profile') setupPortfolioReveal();

  // Show owner tools / hide them from visitors (sets <body> class + auth control)
  Security.applyMode();

  // Owner only: route Drive-backup status to the pill, silently reconnect on
  // a device that already connected Drive, then CATCH UP — push the latest
  // Firestore data to Drive if it changed while Drive wasn't connected (e.g.
  // edits made on another device). Uploads only when something differs; never
  // pops up. No-op on devices where Drive was never connected.
  if (Security.isOwner() && typeof Drive !== 'undefined' && Drive) {
    Drive.onStatus = (st) => setSync(st === 'saving' ? 'drive-saving' : st === 'done' ? 'drive-done' : 'drive-error');
    Drive.trySilentConnect().then((connected) => {
      if (connected) Drive.catchUp(JSON.stringify(DB.data));
    });
  }
});

/* Render (or re-render) the shared chrome + the active page initializer.
   Safe to call repeatedly — used on first load and on every live update. */
function renderActivePage(page) {
  // portfolio + landing run without the app sidebar/topbar
  if (page !== 'profile' && page !== 'index') {
    const titles = {
      dashboard: ['Dashboard', 'Your opportunities, deadlines and tasks at a glance'],
      accounts: ['Accounts', 'Private income, expense & savings intelligence — owner only'],
      opportunities: ['Opportunities', 'Track every scholarship, fellowship and competition'],
      'opportunity-details': ['Opportunity', 'Full record and application timeline'],
      tasks: ['Task Board', 'Drag tasks across stages to update status'],
      documents: ['Documents', 'Passports, CVs, SOPs, transcripts and their status'],
      achievements: ['Achievements', 'Your awards, certifications and leadership roles'],
      education: ['Education', 'Schools, colleges, universities, applications & offer letters'],
      contacts: ['Contacts & Network', 'Professors, mentors, alumni and industry contacts'],
      research: ['Research Hub', 'Ideas, problem statements and references'],
      projects: ['Projects', 'Project ideas and active builds'],
      categories: ['Category Manager', 'Edit the lists used across every dropdown'],
      owner: ['Owner Dashboard', 'Manage all content from one secure place'],
      work: ['Work Sheet', 'Private professional to-do & monthly control sheet — owner only']
    };
    const [t, s] = titles[page] || ['', ''];
    renderChrome(page, t, s);
  }

  const fn = PAGE_INIT[page];
  if (fn) fn();

  // re-apply owner/viewer gating to freshly rendered controls
  Security.applyMode();
}

/* ==========================================================
   8. SEED DATA — sample/dummy records loaded on first run.
   (Kept inside this single JS file as required.) Once the
   user edits anything, their saved data takes over and this
   is never used again unless they "Reset to sample data".
   ========================================================== */
function SEED_DATA() {
  const today = new Date();
  const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  return {
    profile: {
      name: 'Md Imran Hossain',
      eyebrow: 'Digital CV & Portfolio',
      headline: 'Head of AI, Strategy & Research · Business Operations | Tech & Strategy Specialist',
      degree: 'B.Sc. in Computing & Information System',
      department: 'Computing and Information System (CIS)',
      major: 'Artificial Intelligence (AI)',
      university: 'Daffodil International University',
      photo: '',
      bio: 'AI, strategy and operations specialist and Computing & Information System student majoring in Artificial Intelligence at Daffodil International University. I lead AI strategy and research, build practical software, and have hands-on experience across business operations, data analysis and project management — bridging engineering, strategy and execution.',
      skills: ['Strategic Development', 'Project Management', 'Python', 'Machine Learning', 'Data Analysis', 'Flutter / Dart', 'Web Development', 'Operations', 'Leadership'],
      interests: ['Artificial Intelligence', 'Entrepreneurship', 'Robotics', 'Open Source', 'Public Speaking'],
      email: 'me.imran.personal@gmail.com',
      phone: '+8801972037650',
      whatsapp: '+8801641606561',
      location: 'Dhaka, Bangladesh',
      languages: ['Bangla (Native)', 'English (Fluent)', 'Hindi (Conversational)'],
      currentFocus: 'Building EON — a behavioral AI portfolio companion',
      availability: 'Open to research, internships & AI collaborations',
      facebook: 'https://fb.com/msg.imran',
      linkedin: 'https://linkedin.com/in/msgimran',
      github: '',
      website: '',
      experience: [
        { role: 'Head of AI, Strategy & Research', company: 'Epal IT Solutions | Epal Group', location: '', start: '2026', end: '', current: true, summary: 'Leading AI strategy, research and product direction across the group — turning emerging AI into practical, deployable solutions.' },
        { role: 'Trade Documentation & Accounts Executive', company: 'SAS Foodstuff Trading L.L.C.', location: 'Al Qusais, UAE (Remote)', start: 'Sep 2025', end: 'Apr 2026', current: false, summary: 'Managed accounts, invoices and financial records. Prepared export–import and shipment documentation; handled quotations, packing lists and trade paperwork.' },
        { role: 'Operations & Office Management Executive', company: 'Al Manar Properties Ltd.', location: 'Adarsha Sadar, Cumilla', start: 'Sep 2025', end: 'Apr 2026', current: false, summary: 'Managed office operations and administrative activities; assisted management in business planning and coordination; prepared official documents, quotations and correspondence.' },
        { role: 'Data Analyst & Web Content Coordinator', company: 'Fulcrum Care Consulting', location: 'Croydon, Surrey, UK (Remote)', start: 'Apr 2023', end: 'Aug 2024', current: false, summary: 'Analyzed CQC inspection data for care homes; prepared reports and operational insights; designed and maintained care resource directories; updated website content and frontend information.' }
      ],
      references: [
        { name: 'Shah Alam', position: 'Managing Director', institute: 'Al Manar Properties Ltd.', photo: '', quote: 'Imran is dependable, sharp and a genuine problem-solver — he handled our operations and documentation with real ownership and care.' },
        { name: 'Prof. Dr. Aminul Rahman', position: 'Professor, Department of CSE', institute: 'Daffodil International University', photo: '', quote: 'Among the most driven students I have taught — methodical, curious and genuinely passionate about applied AI. He turns ideas into working systems.' }
      ]
    },

    opportunities: [
      { id: 'op-1', createdAt: plus(-20), name: 'NASA Space Apps Challenge 2026', organizer: 'NASA', type: 'Hackathon', subType: 'AI', country: 'Online / Global', mode: 'Hybrid', fundingType: 'Free', priority: 'Critical', status: 'Preparing', link: 'https://www.spaceappschallenge.org', openDate: plus(-15), deadline: plus(6), eventDate: plus(12), notes: 'Form a 4-person team. Decide on the Earth-observation track. Prepare 2-minute pitch + demo video.' },
      { id: 'op-2', createdAt: plus(-40), name: 'Chevening Scholarship 2027', organizer: 'UK Government (FCDO)', type: 'Scholarship', subType: 'Research', country: 'UK', mode: 'Offline', fundingType: 'Fully Funded', priority: 'Critical', status: 'Documents Ready', link: 'https://www.chevening.org', openDate: plus(-30), deadline: plus(19), eventDate: '', notes: 'Need 2 referees + 4 essays. Leadership and networking essays drafted; work experience essay pending review.' },
      { id: 'op-3', createdAt: plus(-12), name: 'Google Developer Student Club Lead', organizer: 'Google', type: 'Leadership Program', subType: 'Software', country: 'Bangladesh', mode: 'Hybrid', fundingType: 'No Funding', priority: 'High', status: 'Applied', link: 'https://developers.google.com/community/gdsc', openDate: plus(-25), deadline: plus(-3), eventDate: plus(20), notes: 'Application submitted. Interview round expected next week.' },
      { id: 'op-4', createdAt: plus(-8), name: 'Heidelberg Laureate Forum', organizer: 'HLFF', type: 'Conference', subType: 'Research', country: 'Germany', mode: 'Offline', fundingType: 'Fully Funded', priority: 'High', status: 'Researching', link: 'https://www.heidelberg-laureate-forum.org', openDate: plus(-5), deadline: plus(27), eventDate: '', notes: 'For young researchers in CS & Maths. Need a strong statement of motivation.' },
      { id: 'op-5', createdAt: plus(-60), name: 'DAAD WISE Internship', organizer: 'DAAD', type: 'Internship', subType: 'Data Science', country: 'Germany', mode: 'Offline', fundingType: 'Paid / Stipend', priority: 'Medium', status: 'Shortlisted', link: 'https://www.daad.de', openDate: plus(-55), deadline: plus(2), eventDate: '', notes: 'Shortlisted! Confirm host professor and finalize research proposal.' },
      { id: 'op-6', createdAt: plus(-90), name: 'Bangladesh ICT Innovation Award', organizer: 'BASIS', type: 'Competition', subType: 'Innovation', country: 'Bangladesh', mode: 'Offline', fundingType: 'No Funding', priority: 'Medium', status: 'Won', link: '', openDate: plus(-120), deadline: plus(-30), eventDate: plus(-10), notes: 'Won Best Student Project. Certificate received.' },
      { id: 'op-7', createdAt: plus(-15), name: 'Mastercard Foundation Scholars', organizer: 'Mastercard Foundation', type: 'Scholarship', subType: 'Entrepreneurship', country: 'Canada', mode: 'Offline', fundingType: 'Fully Funded', priority: 'High', status: 'New', link: '', openDate: plus(2), deadline: plus(45), eventDate: '', notes: 'Opens soon. Prepare transcripts and financial documents early.' },
      { id: 'op-8', createdAt: plus(-70), name: 'Microsoft Imagine Cup', organizer: 'Microsoft', type: 'Competition', subType: 'AI', country: 'Online / Global', mode: 'Online', fundingType: 'Free', priority: 'Low', status: 'Rejected', link: '', openDate: plus(-100), deadline: plus(-50), eventDate: '', notes: 'Did not pass regional round. Good learning — improve the ML model next year.' }
    ],

    tasks: [
      { id: 'tk-1', createdAt: plus(-5), title: 'Form NASA Space Apps team (4 members)', status: 'In Progress', priority: 'Critical', category: 'Application', dueDate: plus(3), linkedOpportunity: 'NASA Space Apps Challenge 2026', notes: 'Reach out to teammates from robotics club.' },
      { id: 'tk-2', createdAt: plus(-5), title: 'Write SOP for Chevening leadership essay', status: 'Review', priority: 'High', category: 'Application', dueDate: plus(10), linkedOpportunity: 'Chevening Scholarship 2027', notes: 'Draft done, needs mentor feedback.' },
      { id: 'tk-3', createdAt: plus(-4), title: 'Collect 2 recommendation letters', status: 'Waiting', priority: 'High', category: 'Application', dueDate: plus(14), linkedOpportunity: 'Chevening Scholarship 2027', notes: 'Asked Prof. Rahman and line manager.' },
      { id: 'tk-4', createdAt: plus(-3), title: 'Finalize DAAD research proposal', status: 'To Do', priority: 'Critical', category: 'Research', dueDate: plus(1), linkedOpportunity: 'DAAD WISE Internship', notes: '' },
      { id: 'tk-5', createdAt: plus(-10), title: 'Update CV with latest project', status: 'Completed', priority: 'Medium', category: 'Personal', dueDate: plus(-2), linkedOpportunity: '', notes: '' },
      { id: 'tk-6', createdAt: plus(-2), title: 'Prepare GDSC interview answers', status: 'To Do', priority: 'High', category: 'Application', dueDate: plus(5), linkedOpportunity: 'Google Developer Student Club Lead', notes: '' },
      { id: 'tk-7', createdAt: plus(-6), title: 'Complete ML course module 8', status: 'In Progress', priority: 'Medium', category: 'Academic', dueDate: plus(7), linkedOpportunity: '', notes: '' },
      { id: 'tk-8', createdAt: plus(-1), title: 'Record 2-min pitch video', status: 'To Do', priority: 'Medium', category: 'Project', dueDate: plus(11), linkedOpportunity: 'NASA Space Apps Challenge 2026', notes: '' }
    ],

    documents: [
      { id: 'dc-1', name: 'Passport', category: 'Identity', status: 'Ready', updatedDate: plus(-200), expiryDate: plus(900), driveLink: '', downloadLink: '' },
      { id: 'dc-2', name: 'National ID (NID)', category: 'Identity', status: 'Ready', updatedDate: plus(-300), expiryDate: '', driveLink: '', downloadLink: '' },
      { id: 'dc-3', name: 'Curriculum Vitae (CV)', category: 'Application', status: 'Updated', updatedDate: plus(-2), expiryDate: '', driveLink: '', downloadLink: '' },
      { id: 'dc-4', name: 'Statement of Purpose (SOP)', category: 'Application', status: 'Draft', updatedDate: plus(-4), expiryDate: '', driveLink: '', downloadLink: '' },
      { id: 'dc-5', name: 'Academic Transcript', category: 'Academic', status: 'Ready', updatedDate: plus(-30), expiryDate: '', driveLink: '', downloadLink: '' },
      { id: 'dc-6', name: 'Medium of Instruction (MOI)', category: 'Academic', status: 'Need Preparation', updatedDate: '', expiryDate: '', driveLink: '', downloadLink: '' },
      { id: 'dc-7', name: 'Recommendation Letter — Prof. Rahman', category: 'Reference', status: 'Need Preparation', updatedDate: '', expiryDate: '', driveLink: '', downloadLink: '' },
      { id: 'dc-8', name: 'IELTS Certificate', category: 'Certificate', status: 'Ready', updatedDate: plus(-90), expiryDate: plus(640), driveLink: '', downloadLink: '' }
    ],

    achievements: [
      { id: 'ac-1', title: 'Best Student Project — ICT Innovation Award', category: 'Award', date: plus(-10), image: '', certLink: '', description: 'Won the national Best Student Project award for an AI-based crop disease detector.' },
      { id: 'ac-2', title: 'Google Data Analytics Certificate', category: 'Certification', date: plus(-120), image: '', certLink: '', description: 'Completed the 8-course professional certificate covering data cleaning, analysis and visualization.' },
      { id: 'ac-3', title: 'Vice President — University Computer Club', category: 'Leadership', date: plus(-200), image: '', certLink: '', description: 'Led a 40-member team, organized 6 workshops and 2 inter-university hackathons.' },
      { id: 'ac-4', title: 'Runner-up — National Hackathon 2025', category: 'Competition', date: plus(-160), image: '', certLink: '', description: 'Built a real-time flood early-warning dashboard in 36 hours.' }
    ],

    training: [
      { id: 'tr-1', name: 'Google Data Analytics Professional Certificate', issuer: 'Google / Coursera', type: 'Certification', date: plus(-120), length: '6 months', skills: ['Data Analysis', 'SQL', 'R', 'Data Visualization', 'Tableau'], certLink: '', credentialId: '', description: 'Eight-course professional certificate covering the full data analysis workflow.', featured: true },
      { id: 'tr-2', name: 'Machine Learning Specialization', issuer: 'DeepLearning.AI / Stanford', type: 'Course', date: plus(-60), length: '3 months', skills: ['Machine Learning', 'Python', 'TensorFlow', 'Neural Networks'], certLink: '', credentialId: '', description: 'Supervised and unsupervised learning, recommender systems and best practices.', featured: true }
    ],

    volunteering: [
      { id: 'vl-1', title: 'STEM Workshop Facilitator', role: 'Lead Facilitator', organization: 'University Computer Club', orgLink: '', cause: 'Education', commitment: 'Seasonal', startDate: plus(-120), date: plus(-90), location: 'Dhaka, Bangladesh', hours: '36 hours', impact: '200+ school students reached across 6 sessions', skills: ['Public Speaking', 'Mentoring', 'Teaching'], description: 'Ran coding and robotics workshops for 200+ school students across 6 sessions.', featured: true }
    ],

    education: [
      { id: 'ed-1', institution: 'Daffodil International University', level: 'Undergraduate', program: 'B.Sc. in Computing & Information System', fieldOfStudy: 'Artificial Intelligence', status: 'Enrolled', location: 'Dhaka, Bangladesh', startDate: plus(-700), endDate: plus(760), appliedDate: plus(-760), decisionDate: plus(-730), result: 'CGPA 3.92 / 4.00', scholarship: 'Merit-based 25% tuition waiver', highlights: ["Dean's List", 'AI Major', 'Research Assistant'], description: 'Majoring in Artificial Intelligence with a focus on machine learning and applied research.', featured: true },
      { id: 'ed-2', institution: 'Dhaka College', level: 'College', program: 'Higher Secondary Certificate (Science)', fieldOfStudy: 'Science', status: 'Graduated', location: 'Dhaka, Bangladesh', startDate: plus(-1800), endDate: plus(-740), result: 'GPA 5.00 / 5.00', highlights: ['Science Olympiad', 'Golden A+'], description: 'Higher secondary education in the science group.', featured: true },
      { id: 'ed-3', institution: 'BRAC University', level: 'Undergraduate', program: 'B.Sc. in Computer Science', fieldOfStudy: 'Computer Science', status: 'Offer Received', location: 'Dhaka, Bangladesh', appliedDate: plus(-790), decisionDate: plus(-755), scholarship: '40% merit scholarship', highlights: ['Merit waiver'], description: 'Received an admission offer with a partial scholarship — chose Daffodil instead.', featured: true },
      { id: 'ed-4', institution: 'TU Munich (DAAD)', level: 'Masters', program: 'M.Sc. in Informatics', fieldOfStudy: 'AI & Machine Learning', status: 'Applied', location: 'Munich, Germany', appliedDate: plus(-20), highlights: ['DAAD scholarship track'], description: 'Master’s application in progress for the upcoming intake.', featured: true }
    ],

    contacts: [
      { id: 'ct-1', name: 'Prof. Dr. Aminul Rahman', type: 'Professor', organization: 'Daffodil International University', designation: 'Professor, CSE', email: 'aminul.rahman@example.edu', phone: '+880 1700 000000', linkedin: '', notes: 'Recommender for Chevening & DAAD. Office hours Sun/Tue.' },
      { id: 'ct-2', name: 'Sadia Islam', type: 'Mentor', organization: 'Chevening Alumni Network', designation: 'Programme Mentor', email: 'sadia@example.com', phone: '', linkedin: 'https://linkedin.com', notes: 'Reviews scholarship essays.' },
      { id: 'ct-3', name: 'Tanvir Ahmed', type: 'Team Member', organization: 'Robotics Club', designation: 'ML Engineer', email: 'tanvir@example.com', phone: '+880 1800 000000', linkedin: '', notes: 'NASA Space Apps teammate.' },
      { id: 'ct-4', name: 'Dr. Lena Fischer', type: 'Industry Professional', organization: 'TU Munich', designation: 'Research Lead', email: 'lena.fischer@example.de', phone: '', linkedin: '', notes: 'Potential DAAD host supervisor.' }
    ],

    research: [
      { id: 'rs-1', title: 'Low-resource Bangla speech recognition', subtitle: 'Closing the dialect gap with self-supervised pretraining', field: 'AI', topic: 'Self-supervised ASR for regional Bangla', researchType: 'Experimental', stage: 'Problem Defined', aspects: ['Dialect variation', 'Data efficiency', 'Transfer learning'], technologies: ['PyTorch', 'wav2vec 2.0', 'Kaldi'], methods: ['Self-supervised pretraining', 'Fine-tuning', 'WER evaluation'], skills: ['Speech Processing', 'Deep Learning'], keywords: ['ASR', 'Bangla', 'low-resource', 'wav2vec'], collaborators: 'Supervised by Prof. Dr. Aminul Rahman', problem: 'Existing ASR models perform poorly on regional Bangla dialects due to limited labelled data. Can self-supervised pretraining close the gap with under 50 hours of labelled audio?', hypothesis: 'Self-supervised pretraining on unlabelled Bangla audio will cut word-error-rate by 30%+ with under 50 hours of labelled data.', outcome: 'A reusable Bangla ASR baseline + a published benchmark for dialectal speech.', references: 'wav2vec 2.0 (Baevski et al., 2020); Common Voice Bangla dataset', featured: true },
      { id: 'rs-2', title: 'AI crop disease detection for smallholder farmers', subtitle: 'Offline, on-device diagnosis from a single leaf photo', field: 'AI', topic: 'Edge ML for agriculture', researchType: 'Applied', stage: 'In Progress', aspects: ['On-device inference', 'Model compression', 'Accessibility'], technologies: ['TensorFlow Lite', 'MobileNetV3', 'Flutter'], methods: ['Transfer learning', 'Quantization', 'Field testing'], skills: ['Computer Vision', 'Mobile ML'], keywords: ['CNN', 'agriculture', 'edge AI'], problem: 'Build a lightweight CNN that runs offline on low-end Android phones to identify common crop diseases from leaf images.', outcome: 'An offline Android app deployed with two farming cooperatives.', references: 'PlantVillage dataset; MobileNetV3 paper', featured: true }
    ],

    projects: [
      { id: 'pj-1', name: 'KrishiAI — Crop Disease Detector', subtitle: 'Offline crop diagnosis for smallholder farmers', category: 'AI', status: 'Development', technologies: 'Python, TensorFlow Lite, Flutter', team: 'Imran, Tanvir', link: '', description: 'Offline mobile app that detects crop diseases from a photo of a leaf and suggests treatment.', featured: true },
      { id: 'pj-2', name: 'OppTrack — Opportunity Manager', subtitle: 'A personal life-OS for opportunities & growth', category: 'Software', status: 'Completed', technologies: 'HTML, CSS, Bootstrap, Vanilla JS', team: 'Imran', link: '', description: 'This very dashboard — a personal system to manage opportunities, tasks and achievements.', featured: true },
      { id: 'pj-3', name: 'FloodWatch BD', subtitle: 'Real-time flood early-warning for Bangladesh', category: 'Data Science', status: 'Testing', technologies: 'Python, Pandas, Leaflet.js', team: 'Hackathon team', link: '', description: 'Real-time flood early-warning dashboard using public water-level data.' }
    ],

    reminders: [
      { id: 'rm-1', date: plus(2), text: 'DAAD proposal final submission' },
      { id: 'rm-2', date: plus(6), text: 'NASA Space Apps registration closes' }
    ],

    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES))
  };
}
