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

  /* Load from localStorage, or seed on very first visit */
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        this.data = JSON.parse(raw);
        // make sure newly added category keys exist after upgrades
        this.data.categories = Object.assign({}, DEFAULT_CATEGORIES, this.data.categories || {});
        // guarantee every collection exists even if an old backup lacked it
        ['opportunities','tasks','documents','achievements','contacts','research','projects','reminders']
          .forEach(k => { if (!Array.isArray(this.data[k])) this.data[k] = []; });
        if (!this.data.profile) this.data.profile = SEED_DATA().profile;
      } else {
        // First visit: seed the visitor's own sandbox copy (allowed for everyone).
        this.data = SEED_DATA();
        this._persist();
      }
    } catch (e) {
      console.error('Could not read saved data, starting fresh.', e);
      this.data = SEED_DATA();
      this._persist();
    }
    return this.data;
  },

  /* Raw write to localStorage — internal use only (seeding / restore).
     Does NOT check authorization; never call this from a user action. */
  _persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch (e) {
      toast('Storage is full — export a backup and clear space.', 'err');
    }
  },

  /* Autosave — called after every change.
     GUARDED: this is the single persistence chokepoint, so even a
     console call like `DB.save()` is rejected for non-owners. */
  save() {
    if (!Security.guard('save changes')) return;
    this._persist();
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

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

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
    { page: 'projects',      href: 'projects.html',      icon: 'diagram-3-fill',label: 'Projects',    countOf: 'projects' },
    { page: 'research',      href: 'research.html',      icon: 'lightbulb-fill',label: 'Research Hub', countOf: 'research' },
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
      { key: 'notes', label: 'Notes', type: 'textarea', span: true }
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
      { key: 'updatedDate', label: 'Last updated', type: 'date' },
      { key: 'expiryDate', label: 'Expiry date', type: 'date' },
      { key: 'driveLink', label: 'Google Drive link', type: 'url', span: true },
      { key: 'downloadLink', label: 'Download link', type: 'url', span: true }
    ]
  },
  achievements: {
    label: 'Achievement', icon: 'trophy',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, span: true },
      { key: 'category', label: 'Category', type: 'select', opts: 'achievementCategories' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'image', label: 'Image URL', type: 'url' },
      { key: 'certLink', label: 'Certificate link', type: 'url' },
      { key: 'description', label: 'Description', type: 'textarea', span: true }
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
      { key: 'field', label: 'Field', type: 'select', opts: 'subTypes' },
      { key: 'stage', label: 'Stage', type: 'select', opts: ['Idea', 'Literature Review', 'Problem Defined', 'In Progress', 'Drafting', 'Published'] },
      { key: 'problem', label: 'Problem statement', type: 'textarea', span: true },
      { key: 'references', label: 'References / links', type: 'textarea', span: true }
    ]
  },
  projects: {
    label: 'Project', icon: 'diagram-3',
    fields: [
      { key: 'name', label: 'Project name', type: 'text', required: true, span: true },
      { key: 'category', label: 'Category', type: 'select', opts: 'subTypes' },
      { key: 'status', label: 'Status', type: 'select', opts: 'projectStatuses' },
      { key: 'technologies', label: 'Technologies', type: 'text' },
      { key: 'team', label: 'Team members', type: 'text' },
      { key: 'link', label: 'Repo / demo link', type: 'url', span: true },
      { key: 'description', label: 'Description', type: 'textarea', span: true }
    ]
  }
};

/* ==========================================================
   5. ENTITY MODAL — one generic Add/Edit form for all modules
   Built from SCHEMAS so there is only one form to maintain.
   ========================================================== */
function buildField(f, value) {
  const v = value == null ? '' : value;
  let input;
  if (f.type === 'textarea') {
    input = `<textarea name="${f.key}" placeholder="${f.label}">${escapeHtml(v)}</textarea>`;
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
    <label>${f.label}${f.required ? ' <span class="req">*</span>' : ''}</label>
    ${input}
  </div>`;
}

/* open the modal. entity = key in SCHEMAS, id = existing record id (optional) */
function openEntityModal(entity, id, afterSave) {
  // Authorization gate: visitors cannot open the add/edit form.
  if (!Security.guard(id ? 'edit this item' : 'add new items')) return;
  const schema = SCHEMAS[entity];
  if (!schema) return;
  const record = id ? DB.get(entity, id) : {};
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

  document.getElementById('entitySave').onclick = () => {
    const form = document.getElementById('entityForm');
    const out = id ? { id } : {};
    schema.fields.forEach(f => { out[f.key] = form.elements[f.key].value.trim(); });

    // validate required fields
    const missing = schema.fields.find(f => f.required && !out[f.key]);
    if (missing) { toast(`${missing.label} is required.`, 'err'); form.elements[missing.key].focus(); return; }

    DB.upsert(entity, out);
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

  const countStatus = (s) => opps.filter(o => o.status === s).length;
  const cards = [
    { lbl: 'Total Opportunities', val: opps.length, ico: 'compass-fill', t: 'primary' },
    { lbl: 'Applied', val: countStatus('Applied'), ico: 'send-fill', t: 'blue' },
    { lbl: 'Shortlisted', val: countStatus('Shortlisted'), ico: 'star-fill', t: 'violet' },
    { lbl: 'Won', val: countStatus('Won') + countStatus('Accepted'), ico: 'trophy-fill', t: 'green' },
    { lbl: 'Lost', val: countStatus('Lost') + countStatus('Rejected'), ico: 'x-circle-fill', t: 'red' },
    { lbl: 'Researching', val: countStatus('Researching') + countStatus('New'), ico: 'search', t: 'slate' },
    { lbl: 'Documents Ready', val: docs.filter(d => d.status === 'Ready' || d.status === 'Updated').length, ico: 'folder-check', t: 'accent' },
    { lbl: 'Active Tasks', val: tasks.filter(t => !['Completed', 'Cancelled'].includes(t.status)).length, ico: 'list-task', t: 'amber' },
    { lbl: 'Completed Tasks', val: tasks.filter(t => t.status === 'Completed').length, ico: 'check2-circle', t: 'green' },
    { lbl: 'Upcoming Deadlines', val: opps.filter(o => { const d = daysUntil(o.deadline); return d !== null && d >= 0 && d <= 30; }).length, ico: 'alarm-fill', t: 'red' }
  ];
  document.getElementById('statGrid').innerHTML = cards.map(c => `
    <div class="stat">
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

  /* calendar widget */
  renderCalendar();
}

/* ---------- CALENDAR (dashboard widget) ---------- */
let calRef = new Date();
function renderCalendar() {
  const host = document.getElementById('calendar');
  if (!host) return;
  const y = calRef.getFullYear(), m = calRef.getMonth();
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const monthName = calRef.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // collect events: opportunity deadlines + saved reminders
  const events = {};
  DB.getAll('opportunities').forEach(o => { if (o.deadline) (events[o.deadline] = events[o.deadline] || []).push('deadline'); });
  DB.getAll('reminders').forEach(r => { if (r.date) (events[r.date] = events[r.date] || []).push('reminder'); });

  const todayStr = new Date().toISOString().slice(0, 10);
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell muted"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = ds === todayStr;
    cells += `<div class="cal-cell ${isToday ? 'today' : ''}" data-date="${ds}" title="${ds}">
      ${d}${events[ds] ? '<span class="ev-dot"></span>' : ''}
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
  host.querySelectorAll('.cal-cell[data-date]').forEach(c => c.onclick = () => addReminder(c.dataset.date));
}
function addReminder(date) {
  if (!Security.guard('add reminders')) return;
  const text = prompt(`Add a reminder for ${date}:`);
  if (text && text.trim()) {
    DB.data.reminders.push({ id: uid(), date, text: text.trim() });
    DB.save();
    toast('Reminder added.', 'ok');
    renderCalendar();
  }
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
            <div><b><a href="opportunity-details.html?id=${o.id}">${escapeHtml(o.name)}</a></b>
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

/* ---------- DOCUMENTS ---------- */
function initDocuments() {
  const host = document.getElementById('docHost');
  const draw = () => {
    const docs = DB.getAll('documents');
    if (!docs.length) { host.innerHTML = emptyState('folder', 'No documents yet', 'Track passports, CVs, SOPs, transcripts and their status.', 'Add document', () => openEntityModal('documents', null, draw), true); return; }
    host.innerHTML = `<div class="card table-card"><table class="dt"><thead><tr>
        <th>Document</th><th>Category</th><th>Status</th><th>Updated</th><th>Expiry</th><th>Links</th><th></th>
      </tr></thead><tbody>${docs.map(dc => {
        const exp = daysUntil(dc.expiryDate);
        return `<tr>
          <td class="name-cell"><b>${escapeHtml(dc.name)}</b></td>
          <td><span class="chip chip-outline">${escapeHtml(dc.category || '—')}</span></td>
          <td>${statusChip(dc.status)}</td>
          <td class="date-cell">${fmtDate(dc.updatedDate)}</td>
          <td class="date-cell ${exp != null && exp < 60 ? 'text-danger' : ''}">${fmtDate(dc.expiryDate)}</td>
          <td>${dc.driveLink ? `<a href="${escapeHtml(dc.driveLink)}" target="_blank" rel="noopener" title="Drive"><i class="bi bi-google text-soft"></i></a> ` : ''}${dc.downloadLink ? `<a href="${escapeHtml(dc.downloadLink)}" target="_blank" rel="noopener" title="Download"><i class="bi bi-download text-soft"></i></a>` : ''}${(!dc.driveLink && !dc.downloadLink) ? '<span class="text-faint">—</span>' : ''}</td>
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
    host.innerHTML = `<div class="gal-grid">${items.map(a => `
      <div class="gal-card">
        <div class="gc-media">${a.image ? `<img src="${escapeHtml(a.image)}" alt="${escapeHtml(a.title)}">` : `<i class="bi bi-${typeIcon(a.category) || 'trophy-fill'}"></i>`}</div>
        <div class="gc-body">
          <div class="d-flex align-items-center gap-2 mb-1"><span class="chip t-${statusTone(a.category)}">${escapeHtml(a.category || 'Achievement')}</span><small class="text-faint num ms-auto">${fmtDate(a.date)}</small></div>
          <b>${escapeHtml(a.title)}</b>
          <p>${escapeHtml(a.description || '')}</p>
          <div class="d-flex gap-2">
            ${a.certLink ? `<a class="btn btn-soft btn-sm" href="${escapeHtml(a.certLink)}" target="_blank" rel="noopener"><i class="bi bi-patch-check me-1"></i>Certificate</a>` : ''}
            <button class="btn btn-ghost btn-sm owner-only" onclick="openEntityModal('achievements','${a.id}')"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-ghost btn-sm text-danger owner-only" onclick="confirmDelete('achievements','${a.id}')"><i class="bi bi-trash3"></i></button>
          </div>
        </div>
      </div>`).join('')}</div>`;
  };
  document.getElementById('achAdd').onclick = () => openEntityModal('achievements', null, draw);
  draw();
}

/* ---------- CONTACTS ---------- */
function initContacts() {
  const host = document.getElementById('contactHost');
  const draw = () => {
    const items = DB.getAll('contacts');
    if (!items.length) { host.innerHTML = emptyState('person-rolodex', 'No contacts yet', 'Keep professors, mentors, alumni and industry contacts in one place.', 'Add contact', () => openEntityModal('contacts', null, draw), true); return; }
    host.innerHTML = `<div class="gal-grid">${items.map(c => `
      <div class="card card-pad">
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
      <div class="card card-pad">
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
      <div class="card card-pad">
        <div class="d-flex align-items-center gap-2 mb-2"><span class="chip t-${statusTone(p.status)}"><span class="dot"></span>${escapeHtml(p.status || 'Idea')}</span>${p.category ? `<span class="chip chip-outline">${escapeHtml(p.category)}</span>` : ''}</div>
        <b style="font-size:15px;display:block">${escapeHtml(p.name)}</b>
        <p class="text-soft mt-1 mb-2" style="font-size:13px">${escapeHtml(p.description || '')}</p>
        ${p.technologies ? `<div class="mb-1" style="font-size:12px"><i class="bi bi-cpu me-1 text-soft"></i>${escapeHtml(p.technologies)}</div>` : ''}
        ${p.team ? `<div class="mb-2" style="font-size:12px"><i class="bi bi-people me-1 text-soft"></i>${escapeHtml(p.team)}</div>` : ''}
        <div class="d-flex gap-2 mt-2">
          ${p.link ? `<a class="btn btn-soft btn-sm" href="${escapeHtml(p.link)}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right me-1"></i>Open</a>` : ''}
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

/* ---------- PROFILE / PORTFOLIO ---------- */
function initProfile() {
  const p = DB.data.profile;
  const opps = DB.getAll('opportunities');
  const stats = {
    applied: opps.filter(o => !['New', 'Researching'].includes(o.status)).length,
    wins: opps.filter(o => ['Won', 'Accepted', 'Completed'].includes(o.status)).length,
    projects: DB.getAll('projects').length,
    certs: DB.getAll('achievements').filter(a => a.category === 'Certification').length,
    research: DB.getAll('research').length
  };

  // hero + about
  document.getElementById('pfName').textContent = p.name;
  document.getElementById('pfHeadline').textContent = p.headline || '';
  document.getElementById('pfBio').textContent = p.bio || '';
  document.getElementById('pfPhoto').innerHTML = p.photo ? `<img src="${escapeHtml(p.photo)}" alt="${escapeHtml(p.name)}">` : initials(p.name);
  document.getElementById('pfMeta').innerHTML = `${escapeHtml(p.degree || '')}${p.university ? ' · ' + escapeHtml(p.university) : ''}`;

  // skills + interests
  document.getElementById('pfSkills').innerHTML = (p.skills || []).map(s => `<span class="chip t-primary">${escapeHtml(s)}</span>`).join('');
  document.getElementById('pfInterests').innerHTML = (p.interests || []).map(s => `<span class="chip chip-outline">${escapeHtml(s)}</span>`).join('');

  // stats row
  const sEl = document.getElementById('pfStats');
  sEl.innerHTML = [
    ['Applied', stats.applied], ['Wins', stats.wins], ['Projects', stats.projects],
    ['Certifications', stats.certs], ['Research', stats.research]
  ].map(([l, v]) => `<div class="pf-stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  // showcase: achievements
  document.getElementById('pfAchievements').innerHTML = DB.getAll('achievements').slice(0, 6).map(a => `
    <div class="gal-card">
      <div class="gc-media">${a.image ? `<img src="${escapeHtml(a.image)}" alt="">` : `<i class="bi bi-trophy-fill"></i>`}</div>
      <div class="gc-body"><span class="chip t-${statusTone(a.category)} mb-2 d-inline-flex">${escapeHtml(a.category || '')}</span><b>${escapeHtml(a.title)}</b><p>${escapeHtml(a.description || '')}</p></div>
    </div>`).join('') || '<p class="text-soft">No achievements to show yet.</p>';

  // showcase: projects
  document.getElementById('pfProjects').innerHTML = DB.getAll('projects').slice(0, 6).map(pr => `
    <div class="card card-pad">
      <span class="chip t-${statusTone(pr.status)} mb-2 d-inline-flex"><span class="dot"></span>${escapeHtml(pr.status || '')}</span>
      <b style="display:block;font-size:15px">${escapeHtml(pr.name)}</b>
      <p class="text-soft mt-1 mb-2" style="font-size:13px">${escapeHtml(pr.description || '')}</p>
      ${pr.technologies ? `<div style="font-size:12px" class="text-soft"><i class="bi bi-cpu me-1"></i>${escapeHtml(pr.technologies)}</div>` : ''}
      ${pr.link ? `<a class="btn btn-soft btn-sm mt-2" href="${escapeHtml(pr.link)}" target="_blank" rel="noopener">View</a>` : ''}
    </div>`).join('') || '<p class="text-soft">No projects to show yet.</p>';

  // edit profile button
  const editBtn = document.getElementById('pfEdit');
  if (editBtn) editBtn.onclick = openProfileEditor;
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
      <div class="field col-span"><label>Full name</label><input name="name" value="${escapeHtml(p.name)}"></div>
      <div class="field col-span"><label>Headline</label><input name="headline" value="${escapeHtml(p.headline || '')}"></div>
      <div class="field"><label>Degree</label><input name="degree" value="${escapeHtml(p.degree || '')}"></div>
      <div class="field"><label>University</label><input name="university" value="${escapeHtml(p.university || '')}"></div>
      <div class="field col-span"><label>Photo URL</label><input name="photo" value="${escapeHtml(p.photo || '')}"></div>
      <div class="field col-span"><label>Biography</label><textarea name="bio">${escapeHtml(p.bio || '')}</textarea></div>
      <div class="field col-span"><label>Skills (comma separated)</label><input name="skills" value="${escapeHtml((p.skills || []).join(', '))}"></div>
      <div class="field col-span"><label>Interests (comma separated)</label><input name="interests" value="${escapeHtml((p.interests || []).join(', '))}"></div>
    </form></div>
    <div class="modal-footer"><button class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary" id="pfSave"><i class="bi bi-check-lg me-1"></i>Save profile</button></div>
  </div></div></div>`;
  document.body.appendChild(wrap);
  const modalEl = document.getElementById('entityModal');
  const modal = new bootstrap.Modal(modalEl); modal.show();
  modalEl.addEventListener('hidden.bs.modal', () => wrap.remove());
  document.getElementById('pfSave').onclick = () => {
    const f = document.getElementById('pfForm');
    Object.assign(p, {
      name: f.name.value.trim(), headline: f.headline.value.trim(), degree: f.degree.value.trim(),
      university: f.university.value.trim(), photo: f.photo.value.trim(), bio: f.bio.value.trim(),
      skills: f.skills.value.split(',').map(s => s.trim()).filter(Boolean),
      interests: f.interests.value.split(',').map(s => s.trim()).filter(Boolean)
    });
    DB.save(); toast('Profile saved.', 'ok'); modal.hide(); initProfile();
  };
}

/* ---------- OWNER DASHBOARD (protected management hub) ---------- */
/* Reached only by an authenticated owner — security.js redirects
   everyone else to the login page before this ever runs. */
function initOwner() {
  // Defensive: never render management UI without a valid session.
  if (!Security.isOwner()) { location.replace(Security.LOGIN_PAGE); return; }

  // Session info pill
  const si = document.getElementById('sessionInfo');
  if (si) si.innerHTML = `<i class="bi bi-clock-history"></i> Session: ${Security.minutesLeft()} min left`;
  const ttl = document.getElementById('ttlHours');
  if (ttl) ttl.textContent = Security.SESSION_HOURS;

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
}

/* ---------- INDEX / LANDING ---------- */
function initIndex() {
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
     1) validate any existing owner session,
     2) bounce visitors away from owner-only pages,
     3) load data, render, then apply owner/viewer UI gating. */
  await Security.init();
  if (!Security.requireOwner(page)) return; // redirected to login → stop

  DB.load();

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

  // Show owner tools / hide them from visitors (sets <body> class + auth control)
  Security.applyMode();
});

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
      headline: 'CS & Information System Student · AI / Systems',
      degree: 'B.Sc. in Computing & Information System',
      university: 'Daffodil International University',
      photo: '',
      bio: 'Computing & Information System student focused on Artificial Intelligence, data-driven systems and product strategy. I build practical software, compete in hackathons, and actively pursue scholarships, fellowships and research opportunities to grow at the intersection of engineering and innovation.',
      skills: ['Python', 'JavaScript', 'Machine Learning', 'Data Analysis', 'SQL', 'System Design', 'Research', 'Leadership'],
      interests: ['Artificial Intelligence', 'Entrepreneurship', 'Robotics', 'Open Source', 'Public Speaking']
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
