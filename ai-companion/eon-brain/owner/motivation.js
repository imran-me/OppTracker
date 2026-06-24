/* ============================================================
   EON — owner/motivation.js
   Momentum & wellbeing (owner-only, spoken). Reads the cached data
   and the clock to:
     • celebrate when a new win / achievement appears (confetti),
     • track a daily visit streak (surfaced when celebrating),
     • nudge rest late at night or after a long session.
   Deliberately quiet — at most one nudge per day, throttled.
   ============================================================ */

import { OWNER, ownerFirstName } from '../../js/owner-config.js';

const KEY = 'eon-motiv';

export class Motivation {
  constructor(ctx) {
    this.ctx = ctx;
    this.s = this._load();
    this._t = 0;
    this._sessionStart = Date.now();
  }
  start() {}

  update() {
    if (!this._owner()) return;
    const now = Date.now();
    if (now - this._t < 6000) return;       // check at most every ~6s
    this._t = now;
    if (this.ctx.drag?.active || this.ctx.focus) return;

    const data = this._data();
    if (!data) { try { window.EonBrain?.ensureData?.(); } catch {} return; }
    const name = this._name();
    const today = this._today();

    // daily streak (silent — surfaced when he celebrates)
    if (this.s.day !== today) {
      this.s.streak = (this.s.day === this._yesterday()) ? (this.s.streak || 1) + 1 : 1;
      this.s.day = today; this.s.restShown = false; this._save();
    }

    // celebrate a new win / achievement
    const wins = this._wins(data);
    if (this.s.wins == null) { this.s.wins = wins; this._save(); }
    else if (wins > this.s.wins) { this.s.wins = wins; this._save(); this._celebrate(name); return; }

    // gentle rest nudge — once per day, at night or after a long session
    const hour = new Date().getHours();
    const longSession = (now - this._sessionStart) > 45 * 60000;
    if ((hour >= 21 || longSession) && !this.s.restShown) {
      this.s.restShown = true; this._save();
      const line = longSession
        ? `You've put in a solid shift, ${name}. Don't forget to rest. 🌙`
        : `Late one, ${name}? Rest well — it'll keep till tomorrow. 🌙`;
      this._say(line, null, 5400);
    }
  }

  _celebrate(name) {
    const streak = (this.s.streak > 1) ? ` ${this.s.streak}-day streak! 🔥` : '';
    try { this.ctx.character.playEmote('cheer'); } catch {}
    try {
      const ch = this.ctx.character, P = this.ctx.particles;
      for (let i = 0; i < 10; i++) P.emote(['🎉', '✨', '🏆', '⭐'][i % 4], ch._worldHead((Math.random() - 0.5) * 0.9, 0.4 + Math.random() * 0.5));
    } catch {}
    this._say(`That's another win, ${name}! 🎉 Proud of you.${streak}`, null, 5200);
  }

  _wins(data) {
    const ach = (data.achievements || []).length;
    const won = (data.opportunities || []).filter((o) => /win|won|accept|success|secured/i.test(String(o.status || o.stage || ''))).length;
    return ach + won;
  }
  _say(line, emote, ttl) {
    if (emote) { try { this.ctx.character.playEmote(emote); } catch {} }
    try { this.ctx.ai?.speak(line, ttl || 4500); } catch {}
  }
  _name() { return ownerFirstName(document.getElementById('pfName')?.textContent) || OWNER.name; }
  _data() { try { const d = window.EonBrain?.getData?.(); return (d && Object.keys(d).length) ? d : null; } catch { return null; } }
  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }
  _today() { return new Date().toISOString().slice(0, 10); }
  _yesterday() { return new Date(Date.now() - 86400000).toISOString().slice(0, 10); }
  _load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch {} }
}
