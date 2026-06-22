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

  _token: null,
  _tokenExp: 0,
  _fileId: null,
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

  /* Silent (re)connect — succeeds only if the owner consented
     before and still has an active Google session. No popup. */
  async trySilentConnect() {
    if (this._tokenIsFresh()) return true;
    try { await this._requestToken(false); return true; }
    catch (e) { return false; }
  },

  /* Interactive connect — MUST be called from a user click. */
  async connect() {
    if (this._tokenIsFresh()) return true;
    await this._requestToken(true);
    return true;
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

  /* Create or overwrite the backup file with the given JSON. */
  async backupNow(jsonString) {
    const token = await this._validToken();
    const fileId = await this._findFileId(token);
    if (!fileId) {
      // First time: create the file (multipart: metadata + media).
      const boundary = 'opptrackbackupboundary';
      const metadata = { name: this.FILE_NAME, mimeType: 'application/json' };
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
        return this.backupNow(jsonString);
      }
      if (!r.ok) throw new Error('Drive update failed: ' + r.status);
    }
    return true;
  },

  /* A Drive link to open/download the current backup file. */
  fileLink() {
    const id = this._fileId || localStorage.getItem(this.FILE_ID_KEY);
    return id ? `https://drive.google.com/file/d/${id}/view` : '';
  },

  /* Debounced backup — called by DB.save() after each change.
     Silently does nothing if Drive isn't connected yet. */
  backup(jsonString) {
    clearTimeout(this._debounce);
    if (this.onStatus) this.onStatus('saving');
    this._debounce = setTimeout(() => {
      this.backupNow(jsonString)
        .then(() => { if (this.onStatus) this.onStatus('done'); })
        .catch(e => { console.warn('Drive backup skipped/failed:', e.message); if (this.onStatus) this.onStatus('error'); });
    }, 1500);
  }
};

window.Drive = Drive;
