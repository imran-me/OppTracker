/* ============================================================
   EON Brain (Firebase edition) — the engine.
   Reads your data doc, learns it, scans deadlines, raises reminders,
   and publishes a meditation state — all in the browser. The OWNER's
   session computes and persists EON's brain to Firestore; viewers
   simply read the persisted brain. Same functionality as the PHP
   version, no server.
   ============================================================ */

import { discover, extractRecords } from './discovery.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

export class Brain {
  constructor(cfg) {
    this.cfg = cfg;
    this.state = { state: 'idle', progress: 0, section: null, message: null, pointTo: null, lastCycleAt: null };
    this.feed = [];
    this._statuses = {};     // dedupKey -> { status, snoozeUntil }
    this._reminders = [];    // manual reminders
    this._memory = {};
    this._busy = false;
    this._records = [];      // flattened records from the last read (owner only)
    this._data = {};         // raw entity arrays from the last read
    this._entities = {};     // discovered schema per entity
  }

  // ---- firebase handles (compat SDK loaded globally on the page) ----
  _db() { return window.firebase.firestore(); }
  _auth() { return window.firebase.auth(); }
  _brainRef() { return this._db().collection(this.cfg.brainCollection).doc(this.cfg.brainDoc); }
  _sourceRef() { return this._db().collection(this.cfg.sourceCollection).doc(this.cfg.sourceDoc); }
  isOwner() {
    const u = this._auth().currentUser;
    return !!u && String(u.email || '').toLowerCase() === String(this.cfg.ownerEmail).toLowerCase();
  }

  async start() {
    await this._loadStore();                 // viewers + owner both read first
    await this.tick();                        // run/refresh once on load
    this._timer = setInterval(() => this.tick(), this.cfg.intervalMs);
    this._auth().onAuthStateChanged(() => this.tick());   // recompute when owner signs in
  }

  /** Owner → maybe run a cycle; viewer → just refresh from store. */
  async tick() {
    if (!this.isOwner()) { await this._loadStore(); return; }
    const last = this._memory?.lastCycleAt ? Date.parse(this._memory.lastCycleAt) : 0;
    if (Date.now() - last >= this.cfg.intervalMs - 5000) await this.cycle();
  }

  // ---- one meditation cycle (owner only) ----
  async cycle() {
    if (this._busy || !this.isOwner()) return;
    this._busy = true;
    try {
      await this._loadStore();               // keep snooze/dismiss + reminders
      this._setState('meditating', 0);

      const snap = await this._sourceRef().get();
      const doc = snap.exists ? (snap.data() || {}) : {};
      // OppTrack wraps the dataset under `store`; unwrap if configured.
      const data = (this.cfg.sourceRoot && doc[this.cfg.sourceRoot] && typeof doc[this.cfg.sourceRoot] === 'object')
        ? doc[this.cfg.sourceRoot] : doc;
      const entities = discover(data, this.cfg.overrides);
      console.info('[EON brain] meditating — entities found:', Object.keys(entities));

      const records = [];
      const keys = Object.keys(entities);
      for (let i = 0; i < keys.length; i++) {
        const e = keys[i];
        this._setState('reading-section', i / Math.max(1, keys.length), e);
        records.push(...extractRecords(data, e, entities[e]));
        if (this.cfg.meditationPauseMs) await sleep(this.cfg.meditationPauseMs);
      }
      this._memory = { lastCycleAt: nowIso(), entities: keys, learned: records.length };
      this._data = data; this._records = records; this._entities = entities;   // cache for lookups/fetch/ask

      const alerts = this._scanDeadlines(records);
      this.feed = this._buildFeed(alerts);

      const top = this.feed[0];
      if (top) this._setInsight(top); else this._setState('idle', 1);

      console.info(`[EON brain] learned ${records.length} records, ${alerts.length} deadline(s), feed ${this.feed.length}.`,
        top ? `Top: ${top.label} (${top.urgency})` : 'no alerts in window');
      await this._persist();
    } catch (e) {
      console.warn('[EON brain] cycle failed:', e);
    } finally {
      this._busy = false;
    }
  }

  // ---- deadline scan ----
  _scanDeadlines(records) {
    const asc = [...new Set((this.cfg.windows || [7, 3, 1, 0]).map(Number))].sort((a, b) => a - b);
    const horizon = asc[asc.length - 1] ?? 7;
    const now = Date.now();
    const out = [];
    for (const r of records) {
      if (!r.deadlineAt) continue;
      const ts = Date.parse(r.deadlineAt);
      if (Number.isNaN(ts)) continue;
      const days = Math.floor((ts - now) / 86400000);
      if (days > horizon) continue;
      const [urgency, severity] = this._classify(days, asc);
      if (!urgency) continue;
      const key = `${r.entity}:${r.id}`;
      out.push({
        type: 'deadline', key, id: 'alert-' + key,
        entity: r.entity, recordId: r.id, label: r.label,
        dueAt: r.deadlineAt, urgency, severity,
        pointTo: this._pointTo(r.entity, r.id, r.label),
      });
    }
    return out;
  }

  _classify(days, asc) {
    if (days < 0) return ['overdue', asc.length + 2];
    for (let i = 0; i < asc.length; i++) {
      if (days <= asc[i]) {
        const label = asc[i] === 0 ? 'due-today' : `within-${asc[i]}d`;
        return [label, asc.length - i + 1];
      }
    }
    return [null, 0];
  }

  _pointTo(entity, id, label) {
    const pat = this.cfg.linkPatterns?.[entity] || this.cfg.linkPatterns?.default || '{entity}.html';
    return pat.replace('{entity}', encodeURIComponent(entity))
              .replace('{id}', encodeURIComponent(id))
              .replace('{label}', encodeURIComponent(label));
  }

  // ---- merge alerts + reminders into the avatar-facing feed ----
  _buildFeed(alerts) {
    const now = Date.now();
    const items = [];
    for (const a of alerts) {
      const st = this._statuses[a.key];
      if (st?.status === 'dismissed') continue;
      if (st?.status === 'snoozed' && st.snoozeUntil && Date.parse(st.snoozeUntil) > now) continue;
      items.push({ ...a, status: st?.status || 'active' });
    }
    for (const r of (this._reminders || [])) {
      if (!['active', 'seen'].includes(r.status)) continue;
      if (Date.parse(r.remindAt) > now) continue;        // not due yet
      items.push({
        type: 'reminder', id: r.id, label: r.title, note: r.note || null,
        urgency: 'reminder', severity: 2, dueAt: r.remindAt, pointTo: r.link || null, status: r.status,
      });
    }
    items.sort((x, y) => (y.severity - x.severity) || String(x.dueAt).localeCompare(String(y.dueAt)));
    return items;
  }

  // ---- state ----
  _setState(s, p, section = null) {
    this.state = { ...this.state, state: s, progress: Math.max(0, Math.min(1, p)), section,
      lastCycleAt: this._memory?.lastCycleAt || this.state.lastCycleAt };
  }
  _setInsight(top) {
    const message = top.type === 'deadline'
      ? `A deadline is approaching: ${top.label} (${top.urgency})`
      : `Reminder: ${top.label}`;
    this.state = { state: 'insight', progress: 1, section: null, message, pointTo: top.pointTo || null,
      insightUntil: Date.now() + this.cfg.insightLingerMs, lastCycleAt: this._memory?.lastCycleAt || null };
  }

  // ---- Firestore persistence ----
  async _loadStore() {
    try {
      const d = await this._brainRef().get();
      if (d.exists) {
        const b = d.data() || {};
        this.state = b.state || this.state;
        this.feed = b.alerts || [];
        this._statuses = b.statuses || {};
        this._reminders = b.reminders || [];
        this._memory = b.memory || {};
      }
    } catch (e) { console.warn('[EON brain] read store failed:', e); }
  }
  async _persist() {
    if (!this.isOwner()) return;
    try {
      await this._brainRef().set({
        state: this.state, alerts: this.feed, statuses: this._statuses,
        reminders: this._reminders, memory: this._memory, updatedAt: nowIso(),
      }, { merge: true });
    } catch (e) { console.warn('[EON brain] persist failed:', e); }
  }

  // ---- public API the avatar consumes ----
  getState() {
    const s = { ...this.state };
    if (s.state === 'insight' && s.insightUntil && Date.now() > s.insightUntil) s.state = 'idle';
    return s;
  }
  getAlerts() { return this.feed; }

  // ---- knowledge bridge (owner-only): raw records for fetch/lookups/ask ----
  getRecords() { return this._records || []; }
  getData() { return this._data || {}; }
  getEntities() { return this._entities || {}; }

  /** Ensure the dataset is loaded for lookups, without the full meditation cycle. */
  async ensureData() {
    if (!this.isOwner()) return this._data;
    if (this._records && this._records.length) return this._data;
    try {
      const snap = await this._sourceRef().get();
      const doc = snap.exists ? (snap.data() || {}) : {};
      const data = (this.cfg.sourceRoot && doc[this.cfg.sourceRoot] && typeof doc[this.cfg.sourceRoot] === 'object')
        ? doc[this.cfg.sourceRoot] : doc;
      const entities = discover(data, this.cfg.overrides);
      const records = [];
      for (const e of Object.keys(entities)) records.push(...extractRecords(data, e, entities[e]));
      this._data = data; this._records = records; this._entities = entities;
    } catch (e) { console.warn('[EON brain] ensureData failed:', e); }
    return this._data;
  }

  async meditate() {
    if (!this.isOwner()) { console.warn('[EON brain] meditate() ignored — not signed in as owner.'); return { alerts: 0, owner: false }; }
    await this.cycle();
    return { alerts: this.feed.length, owner: true };
  }

  /** Diagnostics — run EonBrain.status() in the console. */
  status() {
    let owner = false; try { owner = this.isOwner(); } catch {}
    return {
      owner,
      ownerEmail: this.cfg.ownerEmail,
      signedInAs: (() => { try { return this._auth().currentUser?.email || null; } catch { return null; } })(),
      lastCycleAt: this._memory?.lastCycleAt || null,
      entities: this._memory?.entities || [],
      learned: this._memory?.learned || 0,
      alerts: this.feed.length,
      top: this.feed[0]?.label || null,
    };
  }

  async createReminder({ title, note, remindAt, link }) {
    if (!this.isOwner()) throw new Error('Sign in as owner to add reminders.');
    await this._loadStore();
    const id = 'reminder-' + Date.now().toString(36);
    const iso = new Date(remindAt).toISOString();
    this._reminders.push({ id, title, note: note || null, remindAt: iso, link: link || null, status: 'active' });
    await this.cycle();
    return { id, title, remindAt: iso };
  }
  markSeen(id)  { return this._setStatus(id, 'seen'); }
  dismiss(id)   { return this._setStatus(id, 'dismissed'); }
  async snooze(id, minutes = 30) {
    if (!this.isOwner()) return false;
    await this._loadStore();
    const until = new Date(Date.now() + minutes * 60000).toISOString();
    if (id.startsWith('reminder-')) {
      const r = this._reminders.find((x) => x.id === id); if (r) { r.remindAt = until; r.status = 'active'; }
    } else {
      const key = id.replace(/^alert-/, '');
      this._statuses[key] = { status: 'snoozed', snoozeUntil: until };
    }
    await this.cycle();
    return true;
  }
  async _setStatus(id, status) {
    if (!this.isOwner()) return false;
    await this._loadStore();
    if (id.startsWith('reminder-')) {
      const r = this._reminders.find((x) => x.id === id); if (r) r.status = status;
    } else {
      const key = id.replace(/^alert-/, '');
      this._statuses[key] = { ...(this._statuses[key] || {}), status };
    }
    await this.cycle();
    return true;
  }
}
