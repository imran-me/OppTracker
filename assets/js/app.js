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
    ['opportunities','tasks','documents','achievements','contacts','research','projects','reminders','training','volunteering']
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
    if (!record.id) {
      record.id = uid();
      record.createdAt = new Date().toISOString();
      list.push(record);
    } else {
      const i = list.findIndex(r => r.id === record.id);
      if (i > -1) list[i] = Object.assign(list[i], record);
      else list.push(record);
    }
    this.save();
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
  if (['won', 'accepted', 'completed', 'ready', 'updated', 'documents ready', 'writing completed'].includes(s)) return 'green';
  if (['rejected', 'lost', 'cancelled', 'irrelevant'].includes(s)) return 'red';
  if (['applied', 'shortlisted', 'interview', 'submitted', 'in progress', 'review'].includes(s)) return 'blue';
  if (['preparing', 'writing', 'waitlisted', 'draft', 'waiting', 'requirements collected', 'planning', 'development', 'testing'].includes(s)) return 'amber';
  if (['researching', 'new', 'idea', 'need preparation', 'to do'].includes(s)) return 'slate';
  return 'slate';
}
function priorityTone(p) {
  return ({ Critical: 'red', High: 'amber', Medium: 'blue', Low: 'slate' })[p] || 'slate';
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
    { page: 'dashboard', href: 'dashboard.html', icon: 'grid-1x2-fill', label: 'Dashboard' }
  ]},
  { group: 'Manage', items: [
    { page: 'opportunities', href: 'opportunities.html', icon: 'compass-fill', label: 'Opportunities', countOf: 'opportunities' },
    { page: 'tasks',         href: 'tasks.html',         icon: 'kanban-fill',  label: 'Task Board',  countOf: 'tasks' },
    { page: 'documents',     href: 'documents.html',     icon: 'folder-fill',  label: 'Documents',   countOf: 'documents' },
    { page: 'achievements',  href: 'achievements.html',  icon: 'trophy-fill',  label: 'Achievements',countOf: 'achievements' },
    { page: 'training',      href: 'training.html',      icon: 'mortarboard-fill',label: 'Training & Certification', countOf: 'training' },
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
        <!-- "Add new" is a management action → owner-only -->
        <div class="dropdown owner-only">
          <button class="btn btn-primary" data-bs-toggle="dropdown"><i class="bi bi-plus-lg me-1"></i>Add new</button>
          <ul class="dropdown-menu dropdown-menu-end shadow">
            <li><a class="dropdown-item" href="#" data-add="opportunities"><i class="bi bi-compass me-2"></i>Opportunity</a></li>
            <li><a class="dropdown-item" href="#" data-add="tasks"><i class="bi bi-check2-square me-2"></i>Task</a></li>
            <li><a class="dropdown-item" href="#" data-add="documents"><i class="bi bi-folder me-2"></i>Document</a></li>
            <li><a class="dropdown-item" href="#" data-add="achievements"><i class="bi bi-trophy me-2"></i>Achievement</a></li>
            <li><a class="dropdown-item" href="#" data-add="training"><i class="bi bi-mortarboard me-2"></i>Training / certification</a></li>
            <li><a class="dropdown-item" href="#" data-add="volunteering"><i class="bi bi-heart me-2"></i>Social activity</a></li>
            <li><a class="dropdown-item" href="#" data-add="contacts"><i class="bi bi-person-plus me-2"></i>Contact</a></li>
            <li><a class="dropdown-item" href="#" data-add="research"><i class="bi bi-lightbulb me-2"></i>Research idea</a></li>
            <li><a class="dropdown-item" href="#" data-add="projects"><i class="bi bi-diagram-3 me-2"></i>Project</a></li>
          </ul>
        </div>
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

  // quick "Add new" dropdown
  document.querySelectorAll('[data-add]').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); openEntityModal(a.dataset.add); };
  });

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
      { key: 'field', label: 'Field', type: 'select', opts: 'subTypes' },
      { key: 'stage', label: 'Stage', type: 'select', opts: ['Idea', 'Literature Review', 'Problem Defined', 'In Progress', 'Drafting', 'Published'] },
      { key: 'abstract', label: 'Abstract', type: 'textarea', span: true },
      { key: 'problem', label: 'Problem statement', type: 'textarea', span: true },
      { key: 'references', label: 'References / links', type: 'textarea', span: true },
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
      { key: 'role', label: 'My role', type: 'text' },
      { key: 'organization', label: 'Organization', type: 'text' },
      { key: 'cause', label: 'Cause / focus area', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'skills', label: 'Skills', type: 'tags', span: true, hint: 'Added to your portfolio skills automatically' },
      { key: 'description', label: 'Details', type: 'textarea', span: true },
      { key: 'gallery', label: 'Image URLs', type: 'images', span: true },
      { key: 'photos', label: 'Upload images', type: 'photos', span: true },
      { key: 'files', label: 'Upload files', type: 'files', span: true },
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
      const el = form.elements[f.key];
      if (!el || f.type === 'file') return; // file fields handled asynchronously below
      if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'images' || f.type === 'tags') out[f.key] = el.value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      else out[f.key] = el.value.trim();
    });

    // validate required (text) fields
    const missing = schema.fields.find(f => f.required && f.type !== 'file' && !out[f.key]);
    if (missing) { toast(`${missing.label} is required.`, 'err'); form.elements[missing.key].focus(); return; }

    // Uploads (async): read newly picked file(s), honour "remove", else
    // preserve. Keys left off `out` are kept by DB.upsert's merge.
    try {
      saveBtn.disabled = true;

      // single-file fields (e.g. a document)
      for (const f of schema.fields.filter(x => x.type === 'file')) {
        const input = form.querySelector(`input[type="file"][name="${f.key}"]`);
        const file = input && input.files && input.files[0];
        const remove = form.elements['__remove_' + f.key] && form.elements['__remove_' + f.key].checked;
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
          const cb = form.elements['__rm_' + f.key + '_' + i];
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

    rows.sort((a, b) => {
      if (sort === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sort === 'added') return (b.createdAt || '').localeCompare(a.createdAt || '');
      if (sort === 'priority') return (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9);
      const da = daysUntil(a.deadline), db = daysUntil(b.deadline);
      return (da == null ? 99999 : da) - (db == null ? 99999 : db);
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
function initOpportunityDetails() {
  const id = new URLSearchParams(location.search).get('id');
  const o = id && DB.get('opportunities', id);
  const host = document.getElementById('detailHost');
  if (!o) { host.innerHTML = emptyState('compass', 'Opportunity not found', 'It may have been deleted.', 'Back to list', () => location.href = 'opportunities.html'); return; }

  const linkedTasks = DB.getAll('tasks').filter(t => t.linkedOpportunity === o.name);
  const d = daysUntil(o.deadline);

  host.innerHTML = `
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
        <button class="btn btn-ghost btn-sm owner-only" onclick="openEntityModal('tasks', null, ()=>location.reload())"><i class="bi bi-plus-lg me-1"></i>Add linked task</button>
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
          <div class="section-title">Application timeline</div>
          <div class="timeline">
            <div class="tl-item"><b>Added to tracker</b><small>${fmtDate(o.createdAt || o.openDate)}</small></div>
            ${o.openDate ? `<div class="tl-item"><b>Opens</b><small>${fmtDate(o.openDate)}</small></div>` : ''}
            ${o.deadline ? `<div class="tl-item"><b>Application deadline</b><small>${fmtDate(o.deadline)}</small></div>` : ''}
            ${o.eventDate ? `<div class="tl-item"><b>Event date</b><small>${fmtDate(o.eventDate)}</small></div>` : ''}
          </div>
        </div>
        <div class="card card-pad">
          <div class="section-title">Linked tasks (${linkedTasks.length})</div>
          ${linkedTasks.length ? linkedTasks.map(t => `
            <div class="d-flex align-items-center gap-2 py-2" style="border-bottom:1px solid var(--line-2)">
              <i class="bi bi-${t.status === 'Completed' ? 'check-circle-fill text-success' : 'circle text-soft'}"></i>
              <span style="font-size:13.5px;${t.status === 'Completed' ? 'text-decoration:line-through;color:var(--text-faint)' : ''}">${escapeHtml(t.title)}</span>
              <span class="ms-auto">${statusChip(t.status)}</span>
            </div>`).join('') : `<p class="text-soft mb-0" style="font-size:13px">No linked tasks yet. Use “Add linked task” above.</p>`}
        </div>
      </div>
    </div>`;
}

/* ---------- TASK BOARD (Kanban + drag & drop) ---------- */
function initTasks() {
  const cols = CATS('taskStatuses');
  const colDot = { 'To Do': 'var(--slate)', 'In Progress': 'var(--blue)', 'Waiting': 'var(--amber)', 'Review': 'var(--violet)', 'Completed': 'var(--green)', 'Cancelled': 'var(--red)' };
  const board = document.getElementById('kanban');

  const draw = () => {
    const tasks = DB.getAll('tasks');
    board.innerHTML = cols.map(col => {
      const items = tasks.filter(t => (t.status || 'To Do') === col);
      return `<div class="kcol" data-col="${escapeHtml(col)}">
        <div class="kcol-head"><span class="k-dot" style="background:${colDot[col] || 'var(--slate)'}"></span><b>${escapeHtml(col)}</b><span class="k-count">${items.length}</span></div>
        <div class="kcol-body" data-col="${escapeHtml(col)}">
          ${items.map(t => taskCard(t)).join('')}
        </div>
      </div>`;
    }).join('');
    wireKanban();
  };

  const taskCard = (t) => {
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
      ${t.linkedOpportunity ? `<div class="mt-2"><span class="kc-link"><i class="bi bi-link-45deg"></i> ${escapeHtml(t.linkedOpportunity)}</span></div>` : ''}
    </div>`;
  };

  function wireKanban() {
    let dragId = null;
    board.querySelectorAll('.kcard').forEach(card => {
      card.addEventListener('dragstart', () => { dragId = card.dataset.id; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    board.querySelectorAll('.kcol-body').forEach(zone => {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('drag-over');
        if (!dragId) return;
        if (!Security.guard('move tasks')) return; // owner-only status change
        const task = DB.get('tasks', dragId);
        if (task && task.status !== zone.dataset.col) {
          task.status = zone.dataset.col; DB.save(); toast(`Moved to “${zone.dataset.col}”.`, 'ok');
        }
        draw();
      });
    });
  }

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

/* ---------- ACHIEVEMENTS (gallery) ---------- */
function initAchievements() {
  const host = document.getElementById('achHost');
  const draw = () => {
    const items = DB.getAll('achievements');
    if (!items.length) { host.innerHTML = emptyState('trophy', 'No achievements yet', 'Showcase competitions, awards, certifications and leadership roles.', 'Add achievement', () => openEntityModal('achievements', null, draw), true); return; }
    const photoBadge = (item) => {
      const np = collectImages(item).length, nf = collectFiles(item).length;
      return `${np ? `<span class="pf-photo-count"><i class="bi bi-images"></i>${np}</span>` : ''}${nf ? `<span class="pf-photo-count file"><i class="bi bi-paperclip"></i>${nf}</span>` : ''}`;
    };
    const metaLine = (a) => [a.competition, a.issuer].filter(Boolean).map(escapeHtml).join(' · ');
    host.innerHTML = `<div class="gal-grid gal-grid--4">${items.map(a => `
      <div class="gal-card ach-card pf-clickable" data-detail="achievements:${a.id}">
        <div class="gc-media">${mediaCollage(a, typeIcon(a.category) || 'trophy-fill')}${photoBadge(a)}${a.featured ? '<span class="pf-feat-badge"><i class="bi bi-star-fill"></i>Portfolio</span>' : ''}</div>
        <div class="gc-body">
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="chip t-${statusTone(a.category)}">${escapeHtml(a.category || 'Achievement')}</span>
            ${a.position ? `<span class="chip chip-outline ach-pos">${escapeHtml(a.position)}</span>` : ''}
            <small class="text-faint num ms-auto">${fmtDate(a.date)}</small>
          </div>
          <b class="ach-title">${escapeHtml(a.title)}</b>
          ${metaLine(a) ? `<div class="ach-meta">${metaLine(a)}</div>` : ''}
          ${a.description ? `<p class="ach-desc">${escapeHtml(mdStrip(a.description))}</p>` : ''}
          <div class="ach-foot">
            <span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span>
            <span class="ach-tools">
              ${a.certLink ? `<a class="btn btn-ghost btn-sm" title="Certificate" href="${escapeHtml(a.certLink)}" target="_blank" rel="noopener"><i class="bi bi-patch-check"></i></a>` : ''}
              <button class="btn btn-ghost btn-sm owner-only" title="Edit" onclick="event.stopPropagation();openEntityModal('achievements','${a.id}')"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-ghost btn-sm text-danger owner-only" title="Delete" onclick="event.stopPropagation();confirmDelete('achievements','${a.id}')"><i class="bi bi-trash3"></i></button>
            </span>
          </div>
        </div>
      </div>`).join('')}</div>`;
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
    if (!items.length) { host.innerHTML = emptyState('heart', 'No social activities yet', 'Add volunteering and community work — your role, cause and the skills you used.', 'Add activity', () => openEntityModal('volunteering', null, draw), true); return; }
    const photoBadge = (item) => {
      const np = collectImages(item).length, nf = collectFiles(item).length;
      return `${np ? `<span class="pf-photo-count"><i class="bi bi-images"></i>${np}</span>` : ''}${nf ? `<span class="pf-photo-count file"><i class="bi bi-paperclip"></i>${nf}</span>` : ''}`;
    };
    host.innerHTML = `<div class="gal-grid gal-grid--4">${items.map(v => {
      const meta = [v.organization, v.location].filter(Boolean).map(escapeHtml).join(' · ');
      const skills = Array.isArray(v.skills) ? v.skills : [];
      return `
      <div class="gal-card ach-card pf-clickable" data-detail="volunteering:${v.id}">
        <div class="gc-media">${mediaCollage(v, 'heart-fill')}${photoBadge(v)}${v.featured ? '<span class="pf-feat-badge"><i class="bi bi-star-fill"></i>Portfolio</span>' : ''}</div>
        <div class="gc-body">
          <div class="d-flex align-items-center gap-2 mb-1">
            ${v.cause ? `<span class="chip t-pink">${escapeHtml(v.cause)}</span>` : '<span class="chip t-pink">Volunteering</span>'}
            ${v.role ? `<span class="chip chip-outline ach-pos">${escapeHtml(v.role)}</span>` : ''}
            <small class="text-faint num ms-auto">${fmtDate(v.date)}</small>
          </div>
          <b class="ach-title">${escapeHtml(v.title)}</b>
          ${meta ? `<div class="ach-meta">${meta}</div>` : ''}
          ${skills.length ? `<div class="ach-tags">${skills.slice(0, 4).map(s => `<span class="chip chip-mini">${escapeHtml(s)}</span>`).join('')}${skills.length > 4 ? `<span class="chip chip-mini">+${skills.length - 4}</span>` : ''}</div>` : (v.description ? `<p class="ach-desc">${escapeHtml(mdStrip(v.description))}</p>` : '')}
          <div class="ach-foot">
            <span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span>
            <span class="ach-tools">
              <button class="btn btn-ghost btn-sm owner-only" title="Edit" onclick="event.stopPropagation();openEntityModal('volunteering','${v.id}')"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-ghost btn-sm text-danger owner-only" title="Delete" onclick="event.stopPropagation();confirmDelete('volunteering','${v.id}')"><i class="bi bi-trash3"></i></button>
            </span>
          </div>
        </div>
      </div>`; }).join('')}</div>`;
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

/* ---------- RESEARCH HUB ---------- */
function initResearch() {
  const host = document.getElementById('researchHost');
  const draw = () => {
    const items = DB.getAll('research');
    if (!items.length) { host.innerHTML = emptyState('lightbulb', 'No research ideas yet', 'Capture problem statements, literature notes and references.', 'Add research idea', () => openEntityModal('research', null, draw), true); return; }
    host.innerHTML = `<div class="stack-16">${items.map(r => `
      <div class="card card-pad card-glow">
        <div class="d-flex align-items-start gap-2">
          <span class="stat-ico t-blue"><i class="bi bi-lightbulb-fill"></i></span>
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2 flex-wrap"><b style="font-size:15px">${escapeHtml(r.title)}</b>
              ${r.field ? `<span class="chip chip-outline">${escapeHtml(r.field)}</span>` : ''}
              ${r.stage ? `<span class="chip t-${statusTone(r.stage)}">${escapeHtml(r.stage)}</span>` : ''}</div>
            ${r.problem ? `<p class="text-soft mt-2 mb-1" style="font-size:13.5px;white-space:pre-wrap">${escapeHtml(r.problem)}</p>` : ''}
            ${r.references ? `<div class="mt-2" style="font-size:12.5px"><b class="text-soft">References:</b> <span class="text-soft" style="white-space:pre-wrap">${escapeHtml(r.references)}</span></div>` : ''}
          </div>
          <div class="row-actions owner-only" style="opacity:1">
            <button title="Content studio" onclick="openContentStudio('research','${r.id}', refreshCurrentPage)"><i class="bi bi-easel"></i></button>
            <button onclick="openEntityModal('research','${r.id}')"><i class="bi bi-pencil"></i></button>
            <button class="del" onclick="confirmDelete('research','${r.id}')"><i class="bi bi-trash3"></i></button>
          </div>
        </div>
      </div>`).join('')}</div>`;
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
    host.innerHTML = `<div class="gal-grid">${items.map(p => `
      <div class="card card-pad card-glow">
        <div class="d-flex align-items-center gap-2 mb-2"><span class="chip t-${statusTone(p.status)}"><span class="dot"></span>${escapeHtml(p.status || 'Idea')}</span>${p.category ? `<span class="chip chip-outline">${escapeHtml(p.category)}</span>` : ''}${p.featured ? '<span class="chip t-amber" title="Shown on portfolio"><i class="bi bi-star-fill"></i></span>' : ''}</div>
        <b style="font-size:15px;display:block">${escapeHtml(p.name)}</b>
        ${p.subtitle ? `<small class="text-soft d-block" style="font-size:12px">${escapeHtml(p.subtitle)}</small>` : ''}
        <p class="text-soft mt-1 mb-2" style="font-size:13px">${escapeHtml(p.abstract || p.description || '')}</p>
        ${p.technologies ? `<div class="mb-1" style="font-size:12px"><i class="bi bi-cpu me-1 text-soft"></i>${escapeHtml(p.technologies)}</div>` : ''}
        ${p.team ? `<div class="mb-2" style="font-size:12px"><i class="bi bi-people me-1 text-soft"></i>${escapeHtml(p.team)}</div>` : ''}
        ${(p.blocks && p.blocks.length) || (p.photos && p.photos.length) || (p.files && p.files.length) ? `<div class="mb-2" style="font-size:11.5px" class="text-faint">${(p.blocks && p.blocks.length) ? `<span class="me-2"><i class="bi bi-layout-text-window me-1"></i>${p.blocks.length} blocks</span>` : ''}${(p.photos && p.photos.length) ? `<span class="me-2"><i class="bi bi-images me-1"></i>${p.photos.length}</span>` : ''}${(p.files && p.files.length) ? `<span><i class="bi bi-paperclip me-1"></i>${p.files.length}</span>` : ''}</div>` : ''}
        <div class="d-flex gap-2 mt-2 flex-wrap">
          ${p.link ? `<a class="btn btn-soft btn-sm" href="${escapeHtml(p.link)}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right me-1"></i>Open</a>` : ''}
          <button class="btn btn-soft btn-sm owner-only" onclick="openContentStudio('projects','${p.id}', refreshCurrentPage)"><i class="bi bi-easel me-1"></i>Studio</button>
          <button class="btn btn-ghost btn-sm owner-only" onclick="openEntityModal('projects','${p.id}')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-ghost btn-sm text-danger owner-only" onclick="confirmDelete('projects','${p.id}')"><i class="bi bi-trash3"></i></button>
        </div>
      </div>`).join('')}</div>`;
  };
  document.getElementById('projectAdd').onclick = () => openEntityModal('projects', null, draw);
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
    training: DB.getAll('training').length
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
  document.getElementById('pfSkills').innerHTML = [...skillSet.values()].map(s => `<span class="chip t-primary">${escapeHtml(s)}</span>`).join('');
  document.getElementById('pfInterests').innerHTML = (p.interests || []).map(s => `<span class="chip chip-outline">${escapeHtml(s)}</span>`).join('');

  // hero social buttons
  const heroSocial = document.getElementById('pfSocial');
  if (heroSocial) heroSocial.innerHTML = socialLinks(p)
    .map(l => `<a class="pf-soc" href="${escapeHtml(l.href)}" target="_blank" rel="noopener"><i class="bi bi-${l.ico}"></i><span>${l.label}</span></a>`).join('');

  // academic / personal info card
  const aboutEl = document.getElementById('pfAbout');
  if (aboutEl) {
    const rows = [
      ['mortarboard-fill', 'University', p.university],
      ['building', 'Department', p.department],
      ['cpu-fill', 'Major', p.major],
      ['award-fill', 'Degree', p.degree],
      ['whatsapp', 'WhatsApp', p.whatsapp],
      ['envelope-fill', 'Email', p.email]
    ].filter(([, , v]) => v);
    aboutEl.innerHTML = rows.map(([ico, label, v]) => `
      <div class="pf-info-row">
        <span class="pf-info-ico"><i class="bi bi-${ico}"></i></span>
        <div><small>${label}</small><b>${escapeHtml(v)}</b></div>
      </div>`).join('');
  }

  // stats row — each card is clickable and opens the list behind the number
  const statEl = document.getElementById('pfStats');
  statEl.innerHTML = [
    ['Opportunities', stats.opportunities, 'opportunities'], ['Applied', stats.applied, 'applied'], ['Wins', stats.wins, 'wins'],
    ['Projects', stats.projects, 'projects'], ['Research', stats.research, 'research'], ['Training', stats.training, 'training']
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

  // Featured selection: show only items the owner marked "Show on portfolio".
  // If NONE are marked in a collection, fall back to showing them all so the
  // portfolio is never empty by default.
  const featured = (list, max) => {
    const flagged = list.filter(x => x.featured);
    const out = flagged.length ? flagged : list;
    return (max && !flagged.length) ? out.slice(0, max) : out;
  };

  // showcase: achievements
  document.getElementById('pfAchievements').innerHTML = featured(DB.getAll('achievements'), 6).map(a => `
    <div class="gal-card ach-card pf-clickable" data-detail="achievements:${a.id}">
      <div class="gc-media">${mediaCollage(a, 'trophy-fill')}${photoBadge(a)}${cardTools('achievements', a.id)}</div>
      <div class="gc-body">
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="chip t-${statusTone(a.category)}">${escapeHtml(a.category || '')}</span>
          ${a.position ? `<span class="chip chip-outline ach-pos">${escapeHtml(a.position)}</span>` : ''}
        </div>
        <b class="ach-title">${escapeHtml(a.title)}</b>
        ${[a.competition, a.issuer].filter(Boolean).length ? `<div class="ach-meta">${[a.competition, a.issuer].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
        ${a.description ? `<p class="ach-desc">${escapeHtml(mdStrip(a.description))}</p>` : ''}
        <div class="ach-foot"><span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span></div>
      </div>
    </div>`).join('') || '<p class="text-soft">No achievements to show yet.</p>';

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

  // showcase: projects (ongoing first, then the rest)
  const ordered = featured([...projects].sort((a, b) =>
    (a.status === 'Completed' ? 1 : 0) - (b.status === 'Completed' ? 1 : 0)));
  document.getElementById('pfProjects').innerHTML = ordered.map(pr => {
    const hasImg = collectImages(pr).length;
    return `<div class="card card-pad card-glow pf-editable pf-clickable" data-detail="projects:${pr.id}">
      ${cardTools('projects', pr.id)}
      ${hasImg ? `<div class="pf-card-media">${mediaCollage(pr, 'diagram-3-fill')}${photoBadge(pr)}</div>` : ''}
      <span class="chip t-${statusTone(pr.status)} mb-2 d-inline-flex"><span class="dot"></span>${escapeHtml(pr.status || '')}</span>
      <b style="display:block;font-size:15px">${escapeHtml(pr.name)}</b>
      ${pr.subtitle ? `<small class="text-soft d-block mb-1" style="font-size:12.5px">${escapeHtml(pr.subtitle)}</small>` : ''}
      <p class="text-soft mt-1 mb-2" style="font-size:13px">${escapeHtml(pr.abstract || pr.description || '')}</p>
      ${pr.technologies ? `<div style="font-size:12px" class="text-soft"><i class="bi bi-cpu me-1"></i>${escapeHtml(pr.technologies)}</div>` : ''}
      <div class="pf-card-cta"><span><i class="bi bi-eye me-1"></i>View details</span>${!hasImg ? photoBadge(pr) : ''}</div>
    </div>`;
  }).join('') || '<p class="text-soft">No projects to show yet.</p>';

  // research
  const resEl = document.getElementById('pfResearch');
  if (resEl) { const rs = featured(research); resEl.innerHTML = rs.length ? rs.map(r => `
    <div class="card card-pad card-glow pf-editable pf-clickable" data-detail="research:${r.id}">
      ${cardTools('research', r.id)}
      ${collectImages(r).length ? `<div class="pf-card-media">${mediaCollage(r, 'lightbulb-fill')}${photoBadge(r)}</div>` : ''}
      <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
        <span class="stat-ico t-blue"><i class="bi bi-lightbulb-fill"></i></span>
        <b style="font-size:15px">${escapeHtml(r.title)}</b>
        ${r.field ? `<span class="chip chip-outline">${escapeHtml(r.field)}</span>` : ''}
        ${r.stage ? `<span class="chip t-${statusTone(r.stage)}">${escapeHtml(r.stage)}</span>` : ''}
        ${photoBadge(r)}
      </div>
      ${r.subtitle ? `<small class="text-soft d-block mb-1" style="font-size:12.5px">${escapeHtml(r.subtitle)}</small>` : ''}
      ${(r.abstract || r.problem) ? `<p class="text-soft mt-1 mb-0" style="font-size:13px;white-space:pre-wrap">${escapeHtml(r.abstract || r.problem)}</p>` : ''}
      <div class="pf-card-cta"><span><i class="bi bi-eye me-1"></i>View details</span></div>
    </div>`).join('') : '<p class="text-soft">No research to show yet.</p>'; }

  // showcase: social activities / volunteering
  const volEl = document.getElementById('pfVolunteering');
  if (volEl) volEl.innerHTML = featured(DB.getAll('volunteering'), 6).map(v => {
    const skills = Array.isArray(v.skills) ? v.skills : [];
    return `
    <div class="gal-card ach-card pf-clickable" data-detail="volunteering:${v.id}">
      <div class="gc-media">${mediaCollage(v, 'heart-fill')}${photoBadge(v)}${cardTools('volunteering', v.id)}</div>
      <div class="gc-body">
        <div class="d-flex align-items-center gap-2 mb-1">${v.cause ? `<span class="chip t-pink">${escapeHtml(v.cause)}</span>` : ''}${v.role ? `<span class="chip chip-outline ach-pos">${escapeHtml(v.role)}</span>` : ''}<small class="text-faint num ms-auto">${fmtDate(v.date)}</small></div>
        <b class="ach-title">${escapeHtml(v.title)}</b>
        ${v.organization ? `<div class="ach-meta">${escapeHtml(v.organization)}</div>` : ''}
        ${skills.length ? `<div class="ach-tags">${skills.slice(0, 4).map(s => `<span class="chip chip-mini">${escapeHtml(s)}</span>`).join('')}${skills.length > 4 ? `<span class="chip chip-mini">+${skills.length - 4}</span>` : ''}</div>` : ''}
        <div class="ach-foot"><span class="ach-more"><i class="bi bi-eye me-1"></i>View details</span></div>
      </div>
    </div>`; }).join('') || '<p class="text-soft">No social activities to show yet.</p>';

  // make portfolio cards open a detail view (ignoring clicks on owner tools / links)
  ['pfAchievements', 'pfTraining', 'pfWins', 'pfProjects', 'pfResearch', 'pfVolunteering'].forEach(cid => {
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
  const refBtn = document.getElementById('pfManageRefs');
  if (refBtn) refBtn.onclick = openReferencesEditor;
  const expBtn = document.getElementById('pfManageExp');
  if (expBtn) expBtn.onclick = openExperienceEditor;

  // owner-only "Add" buttons per section (open the same guarded modals,
  // then re-render the portfolio in place).
  const addHooks = {
    pfAddWin: 'opportunities', pfAddAch: 'achievements', pfAddTrain: 'training',
    pfAddProj: 'projects', pfAddRes: 'research', pfAddVol: 'volunteering'
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

      <div class="field col-span"><div class="section-title mb-0 mt-1">Contact &amp; social</div></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${escapeHtml(p.email || '')}"></div>
      <div class="field"><label>Phone / WhatsApp</label><input name="whatsapp" value="${escapeHtml(p.whatsapp || '')}"></div>
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
      email: f.email.value.trim(), whatsapp: f.whatsapp.value.trim(),
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
    training: { title: 'Training & certifications', entity: 'training', icon: 'mortarboard-fill', items: DB.getAll('training') },
    research: { title: 'Research', entity: 'research', icon: 'lightbulb-fill', items: DB.getAll('research') }
  }[kind];
  if (!CFG) return;

  const rows = CFG.items.map(it => {
    const name = it.name || it.title || 'Untitled';
    const sub = it.organizer || it.category || it.field || it.technologies || '';
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
    <span class="pf-file-ic"><i class="bi bi-file-earmark-arrow-down"></i></span>
    <span class="pf-file-meta"><b>${escapeHtml(f.name || 'File')}</b><small>${ext ? ext + ' · ' : ''}${fmtBytes(f.size)}</small></span>
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

  const titleOf = item.name || item.title || 'Details';
  const skillsStr = Array.isArray(item.skills) ? item.skills.join(', ') : '';
  const icon = entity === 'projects' ? 'diagram-3-fill'
    : entity === 'research' ? 'lightbulb-fill'
      : entity === 'achievements' ? 'trophy-fill'
        : entity === 'training' ? 'mortarboard-fill'
          : entity === 'volunteering' ? 'heart-fill' : typeIcon(item.type);

  const chipsArr = entity === 'projects' ? [item.status, item.category]
    : entity === 'research' ? [item.field, item.stage]
      : entity === 'achievements' ? [item.category, fmtDate(item.date)]
        : entity === 'training' ? [item.type, fmtDate(item.date)]
          : entity === 'volunteering' ? [item.cause, item.role, fmtDate(item.date)]
            : [item.status, item.type, item.subType];
  const chips = chipsArr.filter(c => c && c !== '—').map(c => `<span class="chip chip-outline">${escapeHtml(c)}</span>`).join('');

  const rowsArr = entity === 'projects' ? [['Technologies', item.technologies], ['Team', item.team]]
    : entity === 'research' ? [['Field', item.field], ['Stage', item.stage], ['References', item.references]]
      : entity === 'opportunities' ? [['Organizer', item.organizer], ['Country', item.country], ['Funding', item.fundingType], ['Deadline', fmtDate(item.deadline)], ['Event', fmtDate(item.eventDate)]]
        : entity === 'training' ? [['Issuer', item.issuer], ['Type', item.type], ['Length', item.length], ['Credential ID', item.credentialId], ['Skills', skillsStr], ['Date', fmtDate(item.date)]]
          : entity === 'volunteering' ? [['Role', item.role], ['Organization', item.organization], ['Cause', item.cause], ['Location', item.location], ['Skills', skillsStr], ['Date', fmtDate(item.date)]]
            : [['Position', item.position], ['Competition', item.competition], ['Issuer', item.issuer], ['Date', fmtDate(item.date)]];
  const rows = rowsArr.filter(([, v]) => v && v !== '—').map(([l, v]) => `<dt>${l}</dt><dd>${escapeHtml(v)}</dd>`).join('');

  const linksArr = (entity === 'achievements' || entity === 'training') ? [[item.certLink, 'Certificate', 'patch-check']]
    : [[item.link, entity === 'opportunities' ? 'Official page' : 'Open link', 'box-arrow-up-right']];
  const links = linksArr.filter(([href]) => href).map(([href, label, ico]) => `<a class="btn btn-soft btn-sm" href="${escapeHtml(href)}" target="_blank" rel="noopener"><i class="bi bi-${ico} me-1"></i>${label}</a>`).join('');

  const images = collectImages(item);
  const files = collectFiles(item);
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
  document.getElementById('ownerManage').innerHTML = entities.map(e => `
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
  // a silent reconnect may finish after first paint → refresh the badge
  if (hasDrive) Drive.trySilentConnect().then(renderDriveStatus);
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
   7. ROUTER — map page name → initializer, run on load
   ========================================================== */
const PAGE_INIT = {
  dashboard: initDashboard,
  opportunities: initOpportunities,
  'opportunity-details': initOpportunityDetails,
  tasks: initTasks,
  documents: initDocuments,
  achievements: initAchievements,
  training: initTraining,
  volunteering: initVolunteering,
  contacts: initContacts,
  research: initResearch,
  projects: initProjects,
  categories: initCategories,
  profile: initProfile,
  owner: initOwner,
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
  renderActivePage(page);
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

  // Show owner tools / hide them from visitors (sets <body> class + auth control)
  Security.applyMode();

  // Owner only: route Drive-backup status to the pill and try to
  // reconnect Drive silently so backups keep flowing across pages.
  if (Security.isOwner() && typeof Drive !== 'undefined' && Drive) {
    Drive.onStatus = (st) => setSync(st === 'saving' ? 'drive-saving' : st === 'done' ? 'drive-done' : 'drive-error');
    Drive.trySilentConnect();
  }
});

/* Render (or re-render) the shared chrome + the active page initializer.
   Safe to call repeatedly — used on first load and on every live update. */
function renderActivePage(page) {
  // portfolio + landing run without the app sidebar/topbar
  if (page !== 'profile' && page !== 'index') {
    const titles = {
      dashboard: ['Dashboard', 'Your opportunities, deadlines and tasks at a glance'],
      opportunities: ['Opportunities', 'Track every scholarship, fellowship and competition'],
      'opportunity-details': ['Opportunity', 'Full record and application timeline'],
      tasks: ['Task Board', 'Drag tasks across stages to update status'],
      documents: ['Documents', 'Passports, CVs, SOPs, transcripts and their status'],
      achievements: ['Achievements', 'Your awards, certifications and leadership roles'],
      contacts: ['Contacts & Network', 'Professors, mentors, alumni and industry contacts'],
      research: ['Research Hub', 'Ideas, problem statements and references'],
      projects: ['Projects', 'Project ideas and active builds'],
      categories: ['Category Manager', 'Edit the lists used across every dropdown'],
      owner: ['Owner Dashboard', 'Manage all content from one secure place']
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
      { id: 'vl-1', title: 'STEM Workshop Facilitator', role: 'Lead Facilitator', organization: 'University Computer Club', cause: 'Education', date: plus(-90), location: 'Dhaka, Bangladesh', skills: ['Public Speaking', 'Mentoring', 'Teaching'], description: 'Ran coding and robotics workshops for 200+ school students across 6 sessions.', featured: true }
    ],

    contacts: [
      { id: 'ct-1', name: 'Prof. Dr. Aminul Rahman', type: 'Professor', organization: 'Daffodil International University', designation: 'Professor, CSE', email: 'aminul.rahman@example.edu', phone: '+880 1700 000000', linkedin: '', notes: 'Recommender for Chevening & DAAD. Office hours Sun/Tue.' },
      { id: 'ct-2', name: 'Sadia Islam', type: 'Mentor', organization: 'Chevening Alumni Network', designation: 'Programme Mentor', email: 'sadia@example.com', phone: '', linkedin: 'https://linkedin.com', notes: 'Reviews scholarship essays.' },
      { id: 'ct-3', name: 'Tanvir Ahmed', type: 'Team Member', organization: 'Robotics Club', designation: 'ML Engineer', email: 'tanvir@example.com', phone: '+880 1800 000000', linkedin: '', notes: 'NASA Space Apps teammate.' },
      { id: 'ct-4', name: 'Dr. Lena Fischer', type: 'Industry Professional', organization: 'TU Munich', designation: 'Research Lead', email: 'lena.fischer@example.de', phone: '', linkedin: '', notes: 'Potential DAAD host supervisor.' }
    ],

    research: [
      { id: 'rs-1', title: 'Low-resource Bangla speech recognition', field: 'AI', stage: 'Problem Defined', problem: 'Existing ASR models perform poorly on regional Bangla dialects due to limited labelled data. Can self-supervised pretraining close the gap with under 50 hours of labelled audio?', references: 'wav2vec 2.0 (Baevski et al., 2020); Common Voice Bangla dataset' },
      { id: 'rs-2', title: 'AI crop disease detection for smallholder farmers', field: 'AI', stage: 'In Progress', problem: 'Build a lightweight CNN that runs offline on low-end Android phones to identify common crop diseases from leaf images.', references: 'PlantVillage dataset; MobileNetV3 paper' }
    ],

    projects: [
      { id: 'pj-1', name: 'KrishiAI — Crop Disease Detector', category: 'AI', status: 'Development', technologies: 'Python, TensorFlow Lite, Flutter', team: 'Imran, Tanvir', link: '', description: 'Offline mobile app that detects crop diseases from a photo of a leaf and suggests treatment.' },
      { id: 'pj-2', name: 'OppTrack — Opportunity Manager', category: 'Software', status: 'Completed', technologies: 'HTML, CSS, Bootstrap, Vanilla JS', team: 'Imran', link: '', description: 'This very dashboard — a personal system to manage opportunities, tasks and achievements.' },
      { id: 'pj-3', name: 'FloodWatch BD', category: 'Data Science', status: 'Testing', technologies: 'Python, Pandas, Leaflet.js', team: 'Hackathon team', link: '', description: 'Real-time flood early-warning dashboard using public water-level data.' }
    ],

    reminders: [
      { id: 'rm-1', date: plus(2), text: 'DAAD proposal final submission' },
      { id: 'rm-2', date: plus(6), text: 'NASA Space Apps registration closes' }
    ],

    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES))
  };
}
