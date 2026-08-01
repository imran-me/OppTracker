/* ============================================================
   OppTrack — Google Drive auto-backup layer
   File: assets/js/drive.js
   ------------------------------------------------------------
   Mirrors the whole dataset to a SINGLE file in the owner's
   Google Drive — "opptrack-backup.json" — updated on every save.
   This is a safety net alongside Firebase: if Firestore ever
   fails, the owner still has a current, downloadable copy in
   their own Drive (Owner Dashboard → "Back up now" / import it
   back via Import backup).

   - The live site still READS/DISPLAYS from Firebase. Drive is
     backup only.
   - Uses Google Identity Services (GIS) for a short-lived OAuth
     access token with the least-privilege `drive.file` scope
     (the app can only touch files it created — nothing else in
     the owner's Drive).
   - Only the OWNER ever connects; visitors never see this.
   ============================================================ */

const Drive = {
  /* OAuth Web client ID (from Google Cloud → Credentials).
     Safe to be public; it only identifies the app. */
  CLIENT_ID: '55088480752-ecpsttf4t5i0j6fb3goanhtpeq6nbk3p.apps.googleusercontent.com',
  /* Still the least-privilege per-file scope, and it stays that way.
     The Work Sheet mirror writes its Docs into a sub-folder of the backup
     folder BELOW — which this app created itself, so `drive.file` covers it.
     Pointing the mirror at a folder the owner made by hand would have forced
     the full `drive` scope: a RESTRICTED scope needing a Cloud Console change
     and, to publish past test users, a Google security assessment — for
     read/write over the owner's entire Drive. Not worth it to save a folder. */
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
  API: 'https://www.googleapis.com/drive/v3',
  UPLOAD: 'https://www.googleapis.com/upload/drive/v3',
  /* The mirror's own sub-folder inside FOLDER_NAME, so generated Docs never
     sit loose beside the backup JSON. */
  WORK_FOLDER_NAME: 'Work Sheet',
  FILE_NAME: 'opptrack-backup.json',
  FILE_ID_KEY: 'pomls_drive_backup_id',
  FOLDER_NAME: 'OppTracker Backups',
  FOLDER_ID_KEY: 'pomls_drive_folder_id',
  /* Per-device opt-in flag. Set only after the owner deliberately clicks
     "Connect Drive" on THIS device. Until then, Drive is never touched and
     NO Google sign-in popup can ever appear — Firestore is the always-on
     cross-device store; Drive is just a local extra backup. */
  DEVICE_FLAG: 'pomls_drive_enabled',
  /* Fingerprint of the data last written to Drive (per device). Lets us
     detect when Firestore has newer data than Drive — e.g. edits made on a
     phone where Drive wasn't connected — and catch the Drive copy up. */
  LAST_HASH_KEY: 'pomls_drive_last_hash',
  /* Which Google account granted access on this device.
     The access token only lives in this page's memory, so every reload has to
     ask Google for a fresh one. That is meant to be invisible — but with more
     than one Google account signed in, Google cannot tell which one the app
     means and falls back to the "Choose an account" screen. Passing the
     account back as a hint answers that question before it is asked, and the
     renewal goes through silently again. */
  ACCOUNT_KEY: 'pomls_drive_account',

  _token: null,
  _tokenExp: 0,
  _fileId: null,
  _folderId: null,
  _tokenClient: null,
  _gsiReady: null,
  _debounce: null,

  /* Optional UI hook: set to a function(state) where state is
     'saving' | 'done' | 'error'. Used to drive the status pill. */
  onStatus: null,

  /* ---- Google Identity Services bootstrap ---- */
  _loadGSI() {
    if (this._gsiReady) return this._gsiReady;
    this._gsiReady = new Promise((resolve, reject) => {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load Google Identity Services'));
      document.head.appendChild(s);
    });
    return this._gsiReady;
  },

  async _ensureTokenClient() {
    await this._loadGSI();
    if (!this._tokenClient) {
      this._tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.CLIENT_ID,
        scope: this.SCOPE,
        callback: () => {},      // replaced per-request
        error_callback: () => {} // ditto — see _requestToken
      });
    }
  },

  _tokenIsFresh() { return !!this._token && Date.now() < this._tokenExp - 60000; },

  /* Request an access token. interactive=true shows the Google popup (call
     from a click); false tries silently (no popup).

     THIS PROMISE MUST ALWAYS SETTLE. Google Identity simply does not call back
     on some silent requests — a blocked popup, a browser that refuses the
     third-party cookies the silent flow needs — and the original version then
     stayed pending for ever. Anything awaiting it hung, which is how the Work
     Sheet mirror ended up wedged with its "busy" flag stuck on: the first tick
     after a reload started a sync that never finished, and every tick after it
     was dropped as "a run is already going". A timeout and an error_callback
     turn that silence into an ordinary failure the caller can recover from. */
  _requestToken(interactive) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
      // Interactive waits on a human; silent should be near-instant or not at all.
      timer = setTimeout(() => finish(reject, new Error(interactive
        ? 'Google sign-in timed out'
        : 'Drive silent reconnect got no answer')), interactive ? 120000 : 8000);
      this._ensureTokenClient().then(() => {
        this._tokenClient.callback = (resp) => {
          if (resp && resp.access_token) {
            this._token = resp.access_token;
            this._tokenExp = Date.now() + ((resp.expires_in || 3600) * 1000);
            /* Mark the device HERE, on any token that actually arrives, rather
               than only in connect(): a live token is the honest proof that
               this device is connected. */
            this._markEnabled();
            this._rememberAccount();   // so the next renewal needs no chooser
            finish(resolve, this._token);
          } else {
            finish(reject, new Error(resp && resp.error ? resp.error : 'No access token'));
          }
        };
        this._tokenClient.error_callback = (err) =>
          finish(reject, new Error((err && (err.type || err.message)) || 'Google token request failed'));
        try {
          const hint = this.account();
          /* Once an account is known, even the interactive path asks for
             nothing: consent has already been given, so re-prompting for it on
             every reconnect is a dialog with no question in it. */
          const req = { prompt: interactive && !hint ? 'consent' : '' };
          if (hint) req.hint = hint;
          this._tokenClient.requestAccessToken(req);
        } catch (e) { finish(reject, e); }
      }).catch(e => finish(reject, e));
    });
  },

  isConnected() { return this._tokenIsFresh(); },

  /* Has the owner connected Drive on THIS device before? */
  deviceEnabled() { try { return localStorage.getItem(this.DEVICE_FLAG) === '1'; } catch (e) { return false; } },

  /* Silent (re)connect — refreshes the short-lived token WITHOUT any popup.
     Gated on the per-device flag: on a device that never connected Drive we
     do NOT even ask Google, so no sign-in window can appear. On a connected
     device with a live Google session it refreshes quietly.

     Concurrent callers share ONE request. _requestToken installs its callback
     on the single token client, so two overlapping requests would have the
     second quietly steal the first's answer and leave it to time out. */
  _silentRequest() {
    if (!this._pending) {
      this._pending = this._requestToken(false);
      this._pending.catch(() => {}).then(() => { this._pending = null; });
    }
    return this._pending;
  },
  async trySilentConnect() {
    if (this._tokenIsFresh()) return true;
    if (!this.deviceEnabled()) return false;          // never auto-prompt on a fresh device
    try { await this._silentRequest(); return true; }
    catch (e) { return false; }
  },

  /* ---- Renew inside the owner's own click ----
     THE fix for a mirror that kept needing attention. Google's silent refresh
     opens a hidden window, and browsers only permit that during a user
     gesture. The mirror runs off a debounce timer — never a gesture — so its
     refresh was liable to be blocked, and the token then died every hour.

     Ticking a box IS a gesture. Renewing there, a few minutes before the token
     lapses, means the mirror always finds a live token waiting and the owner
     never sees a thing. Fire-and-forget on purpose: the tick must not wait for
     Google, and a failure is picked up by the mirror's own status. */
  RENEW_BEFORE_MS: 10 * 60 * 1000,
  renewOnGesture() {
    if (!this.deviceEnabled()) return;                       // never connected here
    if (this._token && Date.now() < this._tokenExp - this.RENEW_BEFORE_MS) return;  // plenty left
    /* Straight to the request, NOT through trySilentConnect: that one returns
       early while the token is merely still usable, which is exactly the
       window this renewal exists to get ahead of. */
    this._silentRequest().catch(() => {});
  },

  /* Interactive connect — MUST be called from a user click. This is the ONE
     place a Google popup is allowed, because the owner asked for it. */
  async connect() {
    if (this._tokenIsFresh()) { this._markEnabled(); return true; }
    await this._requestToken(true);
    this._markEnabled();
    return true;
  },

  _markEnabled() { try { localStorage.setItem(this.DEVICE_FLAG, '1'); } catch (e) {} },

  /* Which account is this device connected as. */
  account() { try { return localStorage.getItem(this.ACCOUNT_KEY) || ''; } catch (e) { return ''; } },

  /* Ask Drive whose account the token belongs to and keep it. Deliberately
     fire-and-forget and never awaited: the answer is only needed by the NEXT
     renewal, so nothing should wait on it, and a failure just means one more
     account chooser rather than a broken mirror. Costs one request, once. */
  _rememberAccount() {
    if (this.account() || !this._token) return;
    fetch(`${this.API}/about?fields=user(emailAddress)`, { headers: { Authorization: 'Bearer ' + this._token } })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        const email = j && j.user && j.user.emailAddress;
        if (email) { try { localStorage.setItem(this.ACCOUNT_KEY, email); } catch (e) {} }
      })
      .catch(() => {});
  },

  /* Quick content fingerprint (djb2) — cheap way to tell if the data has
     changed since the last Drive write, without re-reading the file. */
  _hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); },
  _rememberHash(s) { try { localStorage.setItem(this.LAST_HASH_KEY, this._hash(s)); } catch (e) {} },
  _hashMatches(s) { try { return localStorage.getItem(this.LAST_HASH_KEY) === this._hash(s); } catch (e) { return false; } },

  /* Catch-up sync: push the current data to Drive IF this device is connected
     and Drive is behind (data changed since the last Drive write — typically
     because edits were made elsewhere while Drive wasn't connected). Safe to
     call on every page load; it uploads only when something actually changed
     and never shows a popup. */
  catchUp(jsonString) {
    if (!this._tokenIsFresh()) return false;     // not connected on this device → nothing to do
    if (this._hashMatches(jsonString)) return false; // Drive already has this exact data
    this.backup(jsonString);                     // debounced upload (remembers the new hash on success)
    return true;
  },

  /* Turn off Drive backup on this device (clears token + opt-in flag). */
  disconnect() {
    this._token = null; this._tokenExp = 0;
    try { localStorage.removeItem(this.DEVICE_FLAG); } catch (e) {}
    // Forget the account too, or reconnecting would silently pick the old one.
    try { localStorage.removeItem(this.ACCOUNT_KEY); } catch (e) {}
  },

  async _validToken() {
    if (this._tokenIsFresh()) return this._token;
    if (await this.trySilentConnect()) return this._token;
    throw new Error('Drive not connected');
  },

  /* Locate the existing backup file (app-created, so drive.file
     scope can see it), or null if it doesn't exist yet. */
  async _findFileId(token) {
    if (this._fileId) return this._fileId;
    const cached = localStorage.getItem(this.FILE_ID_KEY);
    if (cached) { this._fileId = cached; return cached; }
    const q = encodeURIComponent(`name='${this.FILE_NAME}' and trashed=false`);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.files && j.files.length) {
      this._fileId = j.files[0].id;
      localStorage.setItem(this.FILE_ID_KEY, this._fileId);
      return this._fileId;
    }
    return null;
  },

  /* Find (or create once) the dedicated backup folder, so the file
     lives in "My Drive / OppTracker Backups" rather than the root. */
  async _findOrCreateFolder(token) {
    if (this._folderId) return this._folderId;
    const cached = localStorage.getItem(this.FOLDER_ID_KEY);
    if (cached) { this._folderId = cached; return cached; }
    const q = encodeURIComponent(`name='${this.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (r.ok) {
      const j = await r.json();
      if (j.files && j.files.length) {
        this._folderId = j.files[0].id;
        localStorage.setItem(this.FOLDER_ID_KEY, this._folderId);
        return this._folderId;
      }
    }
    const cr = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!cr.ok) throw new Error('Drive folder create failed: ' + cr.status);
    const cj = await cr.json();
    this._folderId = cj.id;
    localStorage.setItem(this.FOLDER_ID_KEY, cj.id);
    return this._folderId;
  },

  /* Make sure an existing backup file sits inside the folder (moves a
     file that was previously created in the Drive root). */
  async _ensureInFolder(token, fileId, folderId) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return;
    const j = await r.json();
    const parents = j.parents || [];
    if (parents.includes(folderId)) return; // already in place
    const remove = parents.join(',');
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${folderId}${remove ? '&removeParents=' + encodeURIComponent(remove) : ''}&fields=id`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token }
    });
  },

  /* Create or overwrite the backup file with the given JSON.
     silent=true (the auto path) NEVER requests a token: it uploads only if a
     live token is already in memory, otherwise it quietly skips — so an edit
     can never spawn a sign-in popup. silent=false (manual "Back up now") may
     reconnect. */
  async backupNow(jsonString, silent = false) {
    const token = silent ? (this._tokenIsFresh() ? this._token : null) : await this._validToken();
    if (!token) return false;
    const folderId = await this._findOrCreateFolder(token);
    const fileId = await this._findFileId(token);
    if (!fileId) {
      // First time: create the file (multipart: metadata + media) in the folder.
      const boundary = 'opptrackbackupboundary';
      const metadata = { name: this.FILE_NAME, mimeType: 'application/json', parents: [folderId] };
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
        jsonString +
        `\r\n--${boundary}--`;
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      });
      if (!r.ok) throw new Error('Drive create failed: ' + r.status);
      const j = await r.json();
      this._fileId = j.id;
      localStorage.setItem(this.FILE_ID_KEY, j.id);
    } else {
      // Make sure an older root-level file gets moved into the folder.
      try { await this._ensureInFolder(token, fileId, folderId); } catch (e) { /* non-fatal */ }
      // Update the existing file's contents.
      const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: jsonString
      });
      if (r.status === 404) {
        // File was deleted in Drive — forget it and recreate.
        this._fileId = null;
        localStorage.removeItem(this.FILE_ID_KEY);
        return this.backupNow(jsonString, silent);
      }
      if (!r.ok) throw new Error('Drive update failed: ' + r.status);
    }
    this._rememberHash(jsonString);   // Drive now matches this data
    return true;
  },

  /* ============================================================
     Generic file helpers — used by the Work Sheet Drive mirror
     ------------------------------------------------------------
     Everything above deals with one app-created JSON file. These
     work on folders and Docs the OWNER already has in Drive, which
     is why the scope above had to widen. They are deliberately
     content-agnostic: nothing here knows what a workstream is.
     ============================================================ */

  /* Who can open this folder? Counted from the folder's own permissions.
     The mirror calls this BEFORE its first write, because the sheet names
     people and internal systems — copying it into a link-shared folder
     would publish all of it to anyone holding the URL. */
  async folderSharing(folderId) {
    const token = await this._validToken();
    const r = await fetch(`${this.API}/files/${folderId}?fields=id,name,permissions(type,role)&supportsAllDrives=true`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) throw new Error('Could not read that folder (' + r.status + ') — check the ID and that it is your folder.');
    const j = await r.json();
    const perms = j.permissions || [];
    return {
      name: j.name || '',
      anyone: perms.some(p => p.type === 'anyone'),   // "Anyone with the link"
      domain: perms.some(p => p.type === 'domain'),   // whole workspace domain
      people: perms.filter(p => p.type === 'user' || p.type === 'group').length
    };
  },

  /* A direct child of `parentId` with this exact name, or null. */
  async childByName(parentId, name, mimeType) {
    const token = await this._validToken();
    const safe = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let q = `'${parentId}' in parents and name='${safe}' and trashed=false`;
    if (mimeType) q += ` and mimeType='${mimeType}'`;
    const r = await fetch(`${this.API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.files && j.files[0]) ? j.files[0].id : null;
  },

  /* Find or create a sub-folder. Existing folders are ADOPTED by name, so
     department folders already sitting in Drive are reused rather than
     duplicated alongside a second set. */
  async folder(parentId, name) {
    const found = await this.childByName(parentId, name, 'application/vnd.google-apps.folder');
    if (found) return found;
    const token = await this._validToken();
    const r = await fetch(`${this.API}/files?fields=id`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    if (!r.ok) throw new Error('Drive folder create failed: ' + r.status);
    return (await r.json()).id;
  },

  /* Write a Google Doc from HTML. Drive converts on the way in, so headings,
     tables and the tick marks arrive as real Doc formatting without the Docs
     API being involved at all.

     The whole doc is REPLACED every sync. That is the point: there is no
     partial state to drift out of step with the app, and a doc someone edited
     by hand is restored to the truth on the next tick rather than silently
     half-merged. */
  async putDoc(parentId, name, html, docId) {
    const token = await this._validToken();
    const DOC = 'application/vnd.google-apps.document';
    const id = docId || await this.childByName(parentId, name, DOC);
    const boundary = 'opptrackdocboundary';
    /* Metadata AND content in one multipart request, on create and update
       alike. Sending the name every time is what keeps a doc's title correct
       after the department it belongs to is renamed — a content-only update
       would leave it sitting under the old name for ever. */
    const meta = id ? { name } : { name, mimeType: DOC, parents: [parentId] };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` + JSON.stringify(meta) +
      `\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n` + html +
      `\r\n--${boundary}--`;
    const url = id
      ? `${this.UPLOAD}/files/${id}?uploadType=multipart&fields=id`
      : `${this.UPLOAD}/files?uploadType=multipart&fields=id`;
    const r = await fetch(url, {
      method: id ? 'PATCH' : 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    // Trashed or deleted in Drive since we cached the id — forget it, remake it.
    if (id && r.status === 404) return this.putDoc(parentId, name, html, null);
    if (!r.ok) throw new Error(`Drive doc ${id ? 'update' : 'create'} failed: ` + r.status);
    return (await r.json()).id;
  },

  /* Rename a file or folder in place. */
  async renameFile(id, name) {
    const token = await this._validToken();
    const r = await fetch(`${this.API}/files/${id}?fields=id`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!r.ok) throw new Error('Drive rename failed: ' + r.status);
    return id;
  },

  docLink(id) { return id ? `https://docs.google.com/document/d/${id}/edit` : ''; },
  folderLink(id) { return id ? `https://drive.google.com/drive/folders/${id}` : ''; },

  /* "My Drive / OppTracker Backups / Work Sheet" — created on first use.
     Both levels are app-created, which is exactly why `drive.file` is enough
     and no folder ever has to be named or pasted in by hand. */
  async workRoot() {
    const token = await this._validToken();
    const backups = await this._findOrCreateFolder(token);
    return this.folder(backups, this.WORK_FOLDER_NAME);
  },

  /* A Drive link to open/download the current backup file. */
  fileLink() {
    const id = this._fileId || localStorage.getItem(this.FILE_ID_KEY);
    return id ? `https://drive.google.com/file/d/${id}/view` : '';
  },

  /* Debounced backup — called by DB.save() after each change.
     NEVER triggers a sign-in popup: if this device has no live Drive token it
     simply does nothing (Firestore already saved the change). A token is only
     obtained by an explicit "Connect Drive" click or the once-per-load silent
     refresh on an already-connected device. */
  backup(jsonString) {
    if (!this._tokenIsFresh()) return;        // not connected on this device → skip quietly, no popup
    clearTimeout(this._debounce);
    if (this.onStatus) this.onStatus('saving');
    this._debounce = setTimeout(() => {
      this.backupNow(jsonString, true)
        .then((ok) => { if (this.onStatus) this.onStatus(ok ? 'done' : 'error'); })
        .catch(e => { console.warn('Drive backup skipped/failed:', e.message); if (this.onStatus) this.onStatus('error'); });
    }, 1500);
  }
};

window.Drive = Drive;
