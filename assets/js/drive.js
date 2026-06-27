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
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
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
        callback: () => {} // replaced per-request
      });
    }
  },

  _tokenIsFresh() { return this._token && Date.now() < this._tokenExp - 60000; },

  /* Request an access token. interactive=true shows the Google
     popup (call from a click); false tries silently (no popup). */
  _requestToken(interactive) {
    return new Promise((resolve, reject) => {
      this._ensureTokenClient().then(() => {
        this._tokenClient.callback = (resp) => {
          if (resp && resp.access_token) {
            this._token = resp.access_token;
            this._tokenExp = Date.now() + ((resp.expires_in || 3600) * 1000);
            resolve(this._token);
          } else {
            reject(new Error(resp && resp.error ? resp.error : 'No access token'));
          }
        };
        try {
          this._tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
        } catch (e) { reject(e); }
      }).catch(reject);
    });
  },

  isConnected() { return this._tokenIsFresh(); },

  /* Has the owner connected Drive on THIS device before? */
  deviceEnabled() { try { return localStorage.getItem(this.DEVICE_FLAG) === '1'; } catch (e) { return false; } },

  /* Silent (re)connect — refreshes the short-lived token WITHOUT any popup.
     Gated on the per-device flag: on a device that never connected Drive we
     do NOT even ask Google, so no sign-in window can appear. On a connected
     device with a live Google session it refreshes quietly. */
  async trySilentConnect() {
    if (this._tokenIsFresh()) return true;
    if (!this.deviceEnabled()) return false;          // never auto-prompt on a fresh device
    try { await this._requestToken(false); return true; }
    catch (e) { return false; }
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
