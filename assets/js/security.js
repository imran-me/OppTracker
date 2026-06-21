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

  /* A fixed string mixed into the credentials before hashing.
     It is NOT a secret (it ships in the source); it only makes
     the stored hashes unique to this app so a generic rainbow
     table is useless. If you change it you MUST regenerate BOTH
     OWNER_EMAIL_HASH and OWNER_HASH below with the same salt. */
  SALT: 'OppTrack::pomls::owner::v2::',

  /* Owner login now requires EMAIL + PASSWORD (two factors). Neither
     the email nor the password is stored in plain text anywhere —
     only the SHA-256 hashes below. The real credential is the
     combined hash of (SALT + email + "|" + password), so an attacker
     must know BOTH the exact email and the password; learning one is
     useless on its own.

     OWNER_EMAIL_HASH = SHA-256(SALT + lowercased-email)
     OWNER_HASH       = SHA-256(SALT + lowercased-email + "|" + password)

     👉 To change these, open the site, press F12 → Console, run:
          await Security.hashFor('owner@example.com', 'your-new-pass')
        then paste the two printed values here. */
  OWNER_EMAIL_HASH: 'cf1514695c326a35f6229aa7ac79086d2dc6d5343384bbb76538c3e3320243f3',
  OWNER_HASH: '4bf98225f9db89ffe9c861cd909d3e6db4d2adfbfdb447619f0b72512dde518c',

  /* Brute-force throttle: after this many wrong attempts the login
     locks for LOCKOUT_MINUTES (tracked per-browser in localStorage).
     Client-side only — it deters casual guessing, it is not a wall. */
  MAX_ATTEMPTS: 5,
  LOCKOUT_MINUTES: 15,
  ATTEMPTS_KEY: 'pomls_owner_attempts_v1',

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

  /* Console helper: print BOTH hashes for a chosen email + password.
     Usage in dev-tools:
        await Security.hashFor('owner@example.com', 'my new pass') */
  async hashFor(email, password) {
    const e = (email || '').trim().toLowerCase();
    const emailHash = await this.sha256(this.SALT + e);
    const ownerHash = await this.sha256(this.SALT + e + '|' + (password || ''));
    console.log('%cOWNER_EMAIL_HASH =', 'font-weight:bold', emailHash);
    console.log('%cOWNER_HASH       =', 'font-weight:bold', ownerHash);
    console.log('Paste both into assets/js/security.js (OWNER_EMAIL_HASH & OWNER_HASH).');
    return { emailHash, ownerHash };
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

  /* ---- Brute-force lockout helpers (per-browser) ---- */

  /* Returns 0 if not locked, else minutes remaining on the lockout. */
  lockedFor() {
    try {
      const a = JSON.parse(localStorage.getItem(this.ATTEMPTS_KEY) || '{}');
      if (a.lockUntil && Date.now() < a.lockUntil) {
        return Math.max(1, Math.ceil((a.lockUntil - Date.now()) / 60000));
      }
    } catch (_) {}
    return 0;
  },

  _recordFailure() {
    let a;
    try { a = JSON.parse(localStorage.getItem(this.ATTEMPTS_KEY) || '{}'); }
    catch (_) { a = {}; }
    a.count = (a.count || 0) + 1;
    if (a.count >= this.MAX_ATTEMPTS) {
      a.lockUntil = Date.now() + this.LOCKOUT_MINUTES * 60000;
      a.count = 0; // reset counter; the lock now governs
    }
    localStorage.setItem(this.ATTEMPTS_KEY, JSON.stringify(a));
  },

  _clearFailures() {
    localStorage.removeItem(this.ATTEMPTS_KEY);
  },

  /* Attempt a login with EMAIL + PASSWORD. Returns:
       true            → success, session started
       false           → wrong credentials
       'locked'        → too many failures, login temporarily locked
     Both factors are hashed together; neither is compared in clear. */
  async login(email, password) {
    if (this.lockedFor() > 0) return 'locked';
    const e = (email || '').trim().toLowerCase();
    const h = await this.sha256(this.SALT + e + '|' + (password || ''));
    if (h !== this.OWNER_HASH) { this._recordFailure(); return false; }
    this._clearFailures();
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
