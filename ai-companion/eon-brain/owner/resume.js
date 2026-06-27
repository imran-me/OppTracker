/* ============================================================
   EON — owner/resume.js
   "Where was I?" When the owner comes back after a break, EON offers to
   pick up exactly where they left off — the page/record they last had
   open. He records the spot when leaving (tab hidden / navigating) and,
   on return after a real gap, floats a small "pick up where you left
   off?" card. Owner-only; once per session.
   ============================================================ */

import { OWNER, ownerFirstName } from '../../js/owner-config.js';

const KEY = 'eon-lastspot';
const MIN_GAP = 20 * 60000;        // only offer after a ~20 min break
const MAX_AGE = 3 * 86400000;      // …and only if it's within 3 days

const PAGE_NAMES = {
  opportunities: 'Opportunities', 'opportunity-details': 'an opportunity',
  tasks: 'the Task Board', documents: 'Documents', contacts: 'Contacts',
  achievements: 'Achievements', projects: 'Projects', research: 'the Research Hub',
  education: 'Education', training: 'Training & Certification', volunteering: 'Social Activities',
  dashboard: 'the Dashboard', categories: 'Category Manager', profile: 'your Profile',
};

export class Resume {
  constructor(ctx) {
    this.ctx = ctx;
    this.page = document.body?.getAttribute('data-page') || '';
    this.file = (location.pathname.split('/').pop() || 'index.html');
    this.url = this.file + location.search;
    this._prev = this._load();
    this._offerAt = 0;
    this._done = false;
  }

  start() {
    this._injectStyle();
    this._buildCard();
    // record the spot when the owner leaves this page / tab
    const save = () => this._save();
    addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

    // decide whether to offer "resume"
    const p = this._prev, now = Date.now();
    if (p && p.url && p.url !== this.url && p.ts && (now - p.ts) > MIN_GAP && (now - p.ts) < MAX_AGE
        && !this._sessionDone()) {
      this._offerAt = now + 2500;     // after a short settle, if owner
    }
  }

  update() {
    if (this._done || !this._offerAt || !this._owner()) return;
    if (Date.now() < this._offerAt) { this._position(); return; }
    if (this._otherCardUp()) { this._offerAt = Date.now() + 15000; return; }   // wait — don't stack
    this._done = true; this._setSessionDone();
    this._show(this._prev);
  }
  _otherCardUp() {
    for (const id of ['eon-board', 'eon-nudge', 'eon-go', 'eon-hook', 'eon-ask']) {
      const e = document.getElementById(id); if (e && e.classList.contains('show')) return true;
    }
    return false;
  }

  _show(p) {
    ['eon-nudge', 'eon-go', 'eon-hook'].forEach((id) => document.getElementById(id)?.classList.remove('show')); // never stack
    try { this.ctx.ai.bubble = null; } catch {}            // no speech bubble behind the card
    const name = ownerFirstName(document.getElementById('pfName')?.textContent) || OWNER.name;
    this._title.textContent = `Welcome back, ${name}!`;
    this._line.textContent = `Pick up where you left off — ${p.label}?`;
    this._card.classList.add('show');
    this._position();
    try { this.ctx.character.playEmote('idea'); } catch {}
    this._timeout = setTimeout(() => this._hide(), 13000);   // card is the message (no duplicate bubble)
  }
  _go() { const p = this._prev; this._hide(); if (p?.url) { try { location.href = p.url; } catch {} } }
  _hide() { if (this._timeout) clearTimeout(this._timeout); this._card?.classList.remove('show'); }

  _position() {
    if (!this._card?.classList.contains('show')) return;
    try {
      const h = this.ctx.project(this.ctx.character.headAnchor);
      const ch = this._card.getBoundingClientRect().height || 90;
      this._card.style.left = Math.max(150, Math.min(innerWidth - 150, h.x)) + 'px';
      this._card.style.top = Math.max(ch + 8, Math.min(innerHeight - 8, h.y - 24)) + 'px';
    } catch {}
  }

  // ---- spot record ----
  _save() {
    try {
      const id = new URLSearchParams(location.search).get('id');
      const base = PAGE_NAMES[this.page] || PAGE_NAMES[this.file.replace('.html', '')] || (document.title || 'where you were');
      const label = id ? `${base}` : base;
      localStorage.setItem(KEY, JSON.stringify({ url: this.url, label, ts: Date.now() }));
    } catch {}
  }
  _load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }
  _sessionDone() { try { return sessionStorage.getItem('eon-resume-done') === '1'; } catch { return false; } }
  _setSessionDone() { try { sessionStorage.setItem('eon-resume-done', '1'); } catch {} }

  // ---- dom ----
  _injectStyle() {
    if (document.getElementById('eon-resume-style')) return;
    const s = document.createElement('style'); s.id = 'eon-resume-style';
    s.textContent = `
      #eon-resume{position:fixed;z-index:2147483600;max-width:268px;transform:translate(-50%,-100%);
        background:#fff;color:#10225e;border-radius:14px;padding:11px 13px;box-shadow:0 12px 34px rgba(16,34,94,.24);
        border:1.5px solid #1f6dff44;font:600 13px/1.35 system-ui;opacity:0;pointer-events:none;transition:opacity .18s}
      #eon-resume.show{opacity:1;pointer-events:auto}
      #eon-resume .er-t{font-size:11.5px;color:#1f6dff;font-weight:800}
      #eon-resume .er-l{margin:3px 0 9px;color:#16203a}
      #eon-resume .er-b{display:flex;gap:7px}
      #eon-resume button{flex:1;border:0;border-radius:8px;padding:5px 6px;cursor:pointer;font:700 11px system-ui}
      #eon-resume .er-go{background:#1f6dff;color:#fff}#eon-resume .er-go:hover{background:#1559d8}
      #eon-resume .er-no{background:#eef1f7;color:#52607a}#eon-resume .er-no:hover{background:#e2e7f2}`;
    document.head.appendChild(s);
  }
  _buildCard() {
    if (document.getElementById('eon-resume')) { this._card = document.getElementById('eon-resume'); return; }
    const el = document.createElement('div'); el.id = 'eon-resume';
    el.innerHTML = `<div class="er-t"></div><div class="er-l"></div>
      <div class="er-b"><button class="er-go">Take me there</button><button class="er-no">No thanks</button></div>`;
    document.body.appendChild(el);
    this._card = el; this._title = el.querySelector('.er-t'); this._line = el.querySelector('.er-l');
    el.querySelector('.er-go').onclick = (e) => { e.stopPropagation(); this._go(); };
    el.querySelector('.er-no').onclick = (e) => { e.stopPropagation(); this._hide(); };
  }
}
