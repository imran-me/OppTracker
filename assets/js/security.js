/* ============================================================
   OppTrack — Owner-Only Management & Security Layer
   File: assets/js/security.js
   ------------------------------------------------------------
   PURPOSE
   "Public to view, owner to manage." Visitors can browse / search
   / read everything. Only the authenticated OWNER can add, edit,
   delete, manage categories or restore data.

   This version is backed by FIREBASE AUTHENTICATION + FIRESTORE.
   Unlike a pure client-side gate, this is REAL server-enforced
   security: the owner signs in with Firebase, and Firestore
   security rules reject any write that does not come from the
   owner account — even calls fired from the dev-tools console.

   It does THREE things:
     1. AUTH     — Firebase email/password sign-in for the owner.
     2. GATING   — hides every management control from visitors
                   (CSS class `viewer-mode` on <body>).
     3. GUARDING — wraps every data-mutation so non-owners abort
                   client-side too (the server rules are the real
                   wall; this just keeps the UI honest).

   The single owner account is `OWNER_EMAIL` (see firebase-config.js).
   ============================================================ */

const Security = {

  /* ==========================================================
     1. CONFIGURATION
     ========================================================== */

  /* Where the login page lives (used by redirects). */
  LOGIN_PAGE: 'login.html',

  /* Owner-only dashboard (management hub). */
  OWNER_PAGE: 'owner.html',

  /* Pages a visitor must NOT open directly. Opening one without a
     valid owner session bounces the user to LOGIN_PAGE. Keys match
     <body data-page="…">. */
  PROTECTED_PAGES: ['categories', 'owner'],

  /* ==========================================================
     2. INTERNAL STATE
     ========================================================== */
  _ready: false,    // has init() resolved the first auth state?
  _user: null,      // the current Firebase user (or null)

  /* ==========================================================
     3. SESSION LIFECYCLE
     ========================================================== */

  /* Resolve once with the INITIAL auth state, then keep listening
     so a sign-in / sign-out on this or another tab re-gates the UI.
     Called once at startup before any page renders. */
  async init() {
    if (typeof fbAuth === 'undefined' || !fbAuth) {
      // Firebase unavailable (offline / blocked). Run as a viewer.
      this._ready = true;
      this._user = null;
      return false;
    }
    await new Promise(resolve => {
      const off = fbAuth.onAuthStateChanged(u => {
        this._user = u || null;
        this._ready = true;
        off();           // stop this one-shot listener
        resolve();
      });
    });
    // Persistent listener: refresh state + UI on later auth changes.
    fbAuth.onAuthStateChanged(u => {
      this._user = u || null;
      this.applyMode();
    });
    return this.isOwner();
  },

  /* The signed-in user's email (or '' if signed out). */
  userEmail() {
    return (this._user && this._user.email) ? this._user.email : '';
  },

  /* Synchronous owner check — the single source of truth used by
     app.js guards and the UI. The owner is the one account whose
     email matches OWNER_EMAIL. */
  isOwner() {
    const email = this.userEmail().toLowerCase();
    return !!email && typeof OWNER_EMAIL !== 'undefined' &&
           email === OWNER_EMAIL.toLowerCase();
  },

  /* Attempt a login with EMAIL + PASSWORD via Firebase. Returns:
       true        → success, owner session started
       false       → wrong credentials
       'notowner'  → valid account, but NOT the owner (signed back out)
       'locked'    → Firebase temporarily blocked this client (too many tries)
       'offline'   → Firebase unavailable */
  async login(email, password) {
    if (typeof fbAuth === 'undefined' || !fbAuth) return 'offline';
    try {
      const cred = await fbAuth.signInWithEmailAndPassword((email || '').trim(), password || '');
      this._user = cred.user;
      if (!this.isOwner()) {
        // Signed in, but this account is not the owner — deny + sign out.
        await fbAuth.signOut();
        this._user = null;
        return 'notowner';
      }
      return true;
    } catch (e) {
      if (e && e.code === 'auth/too-many-requests') return 'locked';
      if (e && (e.code === 'auth/network-request-failed')) return 'offline';
      return false;
    }
  },

  /* End the session. */
  logout() {
    if (typeof fbAuth === 'undefined' || !fbAuth) return Promise.resolve();
    return fbAuth.signOut().then(() => { this._user = null; });
  },

  /* ==========================================================
     4. AUTHORIZATION GUARD  (client-side UX gate)
     ----------------------------------------------------------
     The REAL enforcement is the Firestore security rule on the
     server. This guard just stops non-owners from firing write
     code that the server would reject anyway, and shows a message.
     ========================================================== */
  guard(actionLabel) {
    if (this.isOwner()) return true;
    const msg = 'Owner sign-in required to ' + (actionLabel || 'manage content') + '.';
    if (typeof toast === 'function') toast(msg, 'err'); else alert(msg);
    return false;
  },

  /* ==========================================================
     5. PAGE PROTECTION  (redirect visitors off owner-only pages)
     ========================================================== */
  requireOwner(page) {
    if (this.PROTECTED_PAGES.includes(page) && !this.isOwner()) {
      const back = encodeURIComponent(location.pathname.split('/').pop() + location.search);
      location.replace(`${this.LOGIN_PAGE}?next=${back}`);
      return false;
    }
    return true;
  },

  /* ==========================================================
     6. UI GATING  (show/hide management chrome)
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
        <span class="owner-pill" title="Signed in as ${this.userEmail()}">
          <i class="bi bi-shield-lock-fill"></i> Owner
        </span>
        <a class="btn btn-ghost btn-icon" id="ownerHubBtn" href="${this.OWNER_PAGE}" title="Owner dashboard">
          <i class="bi bi-speedometer2"></i>
        </a>
        <button class="btn btn-ghost btn-icon" id="logoutBtn" title="Log out">
          <i class="bi bi-box-arrow-right"></i>
        </button>`;
      const lo = document.getElementById('logoutBtn');
      if (lo) lo.onclick = async () => {
        await this.logout();
        if (typeof toast === 'function') toast('Logged out.', 'ok');
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

/* Expose globally so app.js, inline handlers and the login page
   can all reach it. */
window.Security = Security;
