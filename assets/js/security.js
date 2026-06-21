/* ============================================================
   OppTrack — Owner-Only Management & Security Layer
   File: assets/js/security.js
   ------------------------------------------------------------
   PURPOSE
   This module turns the site into a "public to view, owner to
   manage" system. Visitors can browse / search / filter / read
   everything. Only the authenticated owner can add, edit,
   delete, approve, archive, manage categories or restore data.

   It does THREE things:
     1. AUTH      — a password-based owner login + session.
     2. GATING    — hides every management control from visitors
                    (CSS class `viewer-mode` on <body>).
     3. GUARDING  — wraps every data-mutation so that even a call
                    fired from the browser console / dev-tools is
                    rejected unless a valid owner session exists.

   ------------------------------------------------------------
   ⚠️  IMPORTANT SECURITY NOTE (read before you trust this)
   ------------------------------------------------------------
   This is a 100% client-side static site (GitHub Pages +
   localStorage, NO server). On such a site, NO client-only code
   can be made *truly* tamper-proof: a determined person can read
   this source, edit localStorage by hand, or call functions from
   the console. This layer raises the bar a lot (hashed password,
   signed session, guarded writes, redirects) and is the correct,
   practical solution for THIS app because:

       • Data lives in each visitor's OWN browser (localStorage).
         A visitor who bypasses the gate only edits their private
         local copy — it never reaches you or any other visitor.
       • The content you publish is whatever ships in app.js
         (SEED_DATA) or your committed data; visitors cannot alter
         that for anyone but themselves.

   For *cryptographically enforced* multi-user owner-only control
   (where the server rejects unauthorized writes), move the data
   layer to a backend. The README's "Firebase" section shows the
   exact upgrade path — Firebase Auth + Firestore security rules
   enforce ownership on the server, which dev-tools cannot bypass.
   ============================================================ */

const Security = {

  /* ==========================================================
     1. CONFIGURATION  —  ⚙️  CHANGE THESE FOR YOUR DEPLOYMENT
     ========================================================== */

  /* A fixed string mixed into the password before hashing.
     It is NOT a secret (it ships in the source); it only makes
     the stored hash unique to this app so a generic rainbow
     table is useless. You may change it, but if you do you MUST
     regenerate OWNER_HASH below with the same salt. */
  SALT: 'OppTrack::pomls::owner::v1::',

  /* SHA-256 of (SALT + your password). The plain password is
     NEVER stored anywhere — only this hash.

     Default password shipped with the project:  Owner@2026
     👉 CHANGE IT before going live. Two ways:

     OPTION A (recommended): open the site, press F12 → Console,
       run:   await Security.hashFor('your-new-password')
       copy the printed hash, and paste it as OWNER_HASH here.

     OPTION B: keep the salt, hash "(SALT + password)" with any
       SHA-256 tool and paste the result here. */
  OWNER_HASH: '0a044f181889053145b8be654256096b0f12740562f1e750a0fbe836b6ab90b0',

  /* Where the login page lives (used by redirects). */
  LOGIN_PAGE: 'login.html',

  /* Owner-only dashboard (management hub). */
  OWNER_PAGE: 'owner.html',

  /* Pages a visitor must NOT open directly. Opening one without a
     valid session bounces the user to LOGIN_PAGE. Add any future
     owner-only page here. Keys match <body data-page="…">. */
  PROTECTED_PAGES: ['categories', 'owner'],

  /* How long a login stays valid (hours) before it expires. */
  SESSION_HOURS: 8,

  /* localStorage key holding the signed session. */
  SESSION_KEY: 'pomls_owner_session_v1',

  /* ==========================================================
     2. INTERNAL STATE (set once by init(), read synchronously)
     ========================================================== */
  _ready: false,      // has init() finished?
  _sigValid: false,   // did the stored session pass signature check?
  _until: 0,          // session expiry (ms epoch)

  /* ==========================================================
     3. CRYPTO HELPERS  (Web Crypto API — built into the browser)
     ========================================================== */

  /* SHA-256 a string → lowercase hex. */
  async sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /* Console helper: print the OWNER_HASH for a chosen password.
     Usage in dev-tools:  await Security.hashFor('my new pass') */
  async hashFor(password) {
    const h = await this.sha256(this.SALT + password);
    console.log('%cOWNER_HASH =', 'font-weight:bold', h);
    console.log('Paste that value into Security.OWNER_HASH in assets/js/security.js');
    return h;
  },

  /* Signature that binds a session to this build + its expiry.
     Recomputed on every check; if storage was hand-edited the
     signature will not match and the session is rejected. */
  async _sign(until) {
    return this.sha256(`${this.OWNER_HASH}|${until}|${this.SALT}`);
  },

  /* ==========================================================
     4. SESSION LIFECYCLE
     ========================================================== */

  /* Validate (or invalidate) the stored session. Called once at
     startup BEFORE any page renders, so that isOwner() can then
     answer synchronously everywhere else. */
  async init() {
    this._sigValid = false;
    this._until = 0;
    try {
      const raw = localStorage.getItem(this.SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const expected = await this._sign(s.until);
        if (s.sig === expected && Date.now() < s.until) {
          this._sigValid = true;
          this._until = s.until;
        } else {
          localStorage.removeItem(this.SESSION_KEY); // expired / tampered
        }
      }
    } catch (_) {
      localStorage.removeItem(this.SESSION_KEY);
    }
    this._ready = true;
    return this.isOwner();
  },

  /* Attempt a login. Returns true on success and starts a session. */
  async login(password) {
    const h = await this.sha256(this.SALT + (password || ''));
    if (h !== this.OWNER_HASH) return false;
    const until = Date.now() + this.SESSION_HOURS * 3600 * 1000;
    const sig = await this._sign(until);
    localStorage.setItem(this.SESSION_KEY, JSON.stringify({ until, sig }));
    this._sigValid = true;
    this._until = until;
    this._ready = true;
    return true;
  },

  /* End the session. */
  logout() {
    localStorage.removeItem(this.SESSION_KEY);
    this._sigValid = false;
    this._until = 0;
  },

  /* Synchronous owner check — the single source of truth used by
     app.js guards and the UI. Re-checks expiry on every call. */
  isOwner() {
    return this._sigValid && Date.now() < this._until;
  },

  /* Minutes left in the current session (for the UI badge). */
  minutesLeft() {
    return this.isOwner() ? Math.max(0, Math.round((this._until - Date.now()) / 60000)) : 0;
  },

  /* ==========================================================
     5. AUTHORIZATION GUARD  (the gate every write must pass)
     ----------------------------------------------------------
     Call Security.guard() at the TOP of any function that
     changes data. Returns true if allowed; otherwise warns the
     visitor and returns false so the caller aborts. Because the
     guard sits INSIDE the data functions, it also blocks calls
     made from the console / dev-tools, not just button clicks.
     ========================================================== */
  guard(actionLabel) {
    if (this.isOwner()) return true;
    // toast() comes from app.js; fall back to alert if not present.
    const msg = 'Owner sign-in required to ' + (actionLabel || 'manage content') + '.';
    if (typeof toast === 'function') toast(msg, 'err'); else alert(msg);
    return false;
  },

  /* ==========================================================
     6. PAGE PROTECTION  (redirect visitors off owner-only pages)
     ========================================================== */
  requireOwner(page) {
    if (this.PROTECTED_PAGES.includes(page) && !this.isOwner()) {
      // remember where they were heading, then send to login
      const back = encodeURIComponent(location.pathname.split('/').pop() + location.search);
      location.replace(`${this.LOGIN_PAGE}?next=${back}`);
      return false;
    }
    return true;
  },

  /* ==========================================================
     7. UI GATING  (show/hide management chrome)
     ----------------------------------------------------------
     Adds `owner-mode` or `viewer-mode` to <body>. The stylesheet
     hides every element marked `.owner-only` while in viewer
     mode. Also (re)builds the login / logout control in the
     topbar slot `#authSlot` if app.js left one for us.
     ========================================================== */
  applyMode() {
    const owner = this.isOwner();
    document.body.classList.toggle('owner-mode', owner);
    document.body.classList.toggle('viewer-mode', !owner);
    this.renderAuthControl();
  },

  /* Renders the small auth control (badge + login/logout) into any
     element with id="authSlot". Safe to call repeatedly. */
  renderAuthControl() {
    const slot = document.getElementById('authSlot');
    if (!slot) return;
    if (this.isOwner()) {
      slot.innerHTML = `
        <span class="owner-pill" title="Owner session — ${this.minutesLeft()} min left">
          <i class="bi bi-shield-lock-fill"></i> Owner
        </span>
        <a class="btn btn-ghost btn-icon" id="ownerHubBtn" href="${this.OWNER_PAGE}" title="Owner dashboard">
          <i class="bi bi-speedometer2"></i>
        </a>
        <button class="btn btn-ghost btn-icon" id="logoutBtn" title="Log out">
          <i class="bi bi-box-arrow-right"></i>
        </button>`;
      const lo = document.getElementById('logoutBtn');
      if (lo) lo.onclick = () => {
        this.logout();
        if (typeof toast === 'function') toast('Logged out.', 'ok');
        // leave any owner-only page after logout
        if (this.PROTECTED_PAGES.includes(document.body.dataset.page)) {
          location.href = 'index.html';
        } else {
          location.reload();
        }
      };
    } else {
      slot.innerHTML = `
        <a class="btn btn-soft btn-sm" href="${this.LOGIN_PAGE}" title="Owner sign in">
          <i class="bi bi-lock me-1"></i>Owner login
        </a>`;
    }
  }
};

/* Expose globally so app.js, inline handlers and the console
   helper (Security.hashFor) can all reach it. */
window.Security = Security;
