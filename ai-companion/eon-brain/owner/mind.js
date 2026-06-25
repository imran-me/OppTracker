/* ============================================================
   EON — owner/mind.js  ·  "The Mind"
   The intelligence tier that sits on top of the Signal Layers and makes
   EON feel smart: judgment (when/how loudly to speak), learning (he tunes
   to what you accept/dismiss), memory (he consolidates lessons and never
   re-asks settled things), reasoning (a relationship graph + themes), and
   expression (calibrated confidence, adaptive register, one-line whys).

   100% deterministic + grounded: every NUMBER comes from real data; the
   words are templated. The genuinely open-ended language/intent pieces are
   left for the LLM backend. Read-only over your data; persists its own
   small brain in localStorage. Owner-only. Exposed on window.EonMind.
   ============================================================ */

import { OWNER, ownerFirstName } from '../../js/owner-config.js';

const STORE = 'eon-mind-v1';
const DAY = 86400000;
const STOP = new Set('the a an to of and or for in on at by with from is are was were be this that your you i my me it as do done task tasks need needs get got make made new'.split(' '));

export class Mind {
  constructor(ctx) {
    this.ctx = ctx;
    this.m = this._load();
    this.m.weights = this.m.weights || {};
    this.m.lessons = this.m.lessons || {};
    this.m.decisions = this.m.decisions || {};
    this.m.episodes = this.m.episodes || [];
    this._spokeTimes = [];
    this._curiosityAt = 0;
  }

  start() {
    if (typeof window !== 'undefined') window.EonMind = this;
    this._consolidate();      // distil recent activity into durable lessons
  }
  // light tick — used only to keep memory fresh across a long session
  update() {
    if (!this._owner()) return;
    const now = Date.now();
    if (now - (this.m.lastConsolidate || 0) > 6 * 3600000) this._consolidate();
  }

  // ===================== JUDGMENT (§4, §7) =====================
  /** Self-evaluation gate: is this worth saying, right now, this loudly?
      Combines the item's own confidence with what you've taught him. */
  shouldSpeak(item = {}) {
    const now = Date.now();
    const w = this.weight(item.type);
    const conf = item.confidence == null ? 0.6 : item.confidence;
    const score = conf * w * (item.sev ? Math.min(1.4, 0.6 + item.sev * 0.12) : 1);
    if (score < 0.5) return false;                      // not sure / down-weighted → stay silent
    this._spokeTimes = this._spokeTimes.filter(t => now - t < 60000);
    if (this._spokeTimes.length >= 3) return false;     // frequency budget (restraint)
    if (this._dismissedRecently(item)) return false;    // decision memory: don't re-push
    return true;
  }
  noteSpoke() { this._spokeTimes.push(Date.now()); }
  /** Calibrated-confidence prefix — bold when sure, hedged when not. */
  hedge(confidence = 0.6) {
    if (confidence >= 0.8) return '';
    if (confidence >= 0.62) return 'I think ';
    if (confidence >= 0.48) return 'Might be nothing, but ';
    return null;                                        // too unsure → don't say it
  }
  /** Proportionality: how big a reaction this deserves (emote bucket). */
  proportion(sev = 1) { return sev >= 4 ? 'big' : sev >= 2.5 ? 'medium' : 'small'; }
  /** Honesty: a plain "I don't know" when the data isn't there. */
  honest(value, { unit = '' } = {}) { return (value == null || Number.isNaN(value)) ? "I don't have enough to say yet — give it a few days." : `${value}${unit}`; }

  // ===================== LEARNING (§5) =====================
  /** Feedback: act ↑ trust, dismiss ↓ it, per signal type. Also infers
      whether you prefer fewer/quieter nudges (verbosity). */
  record(action, type) {
    const t = type || 'generic';
    const wt = (this.m.weights[t] = this.m.weights[t] || { act: 0, dismiss: 0, lastDismiss: 0 });
    if (action === 'act') { wt.act++; this.m.verbosity = Math.min(1, (this.m.verbosity ?? 0.5) + 0.04); }
    else if (action === 'dismiss') { wt.dismiss++; wt.lastDismiss = Date.now(); this.m.verbosity = Math.max(0, (this.m.verbosity ?? 0.5) - 0.05); }
    this._save();
  }
  /** Learned trust multiplier for a signal type (self-correction lives here). */
  weight(type) {
    const wt = this.m.weights[type || 'generic']; if (!wt) return 1;
    return Math.max(0.25, Math.min(1.8, 1 + 0.22 * wt.act - 0.34 * wt.dismiss));
  }
  _dismissedRecently(item) {
    const wt = this.m.weights[item.type]; if (!wt || !wt.lastDismiss) return false;
    // a freshly-dismissed kind goes quiet for a while; heavily-dismissed kinds longer
    const cool = Math.min(7, 1 + wt.dismiss) * DAY * 0.5;
    return Date.now() - wt.lastDismiss < cool;
  }

  // ===================== EXPRESSION (§6) =====================
  /** Adaptive register from time of day + recent intensity + learned pref. */
  register() {
    const h = new Date().getHours();
    const v = this.m.verbosity ?? 0.5;
    if (v < 0.32) return 'terse';                 // you keep waving him off → minimal
    if (h >= 23 || h < 6) return 'soft';          // late → gentle
    const P = (typeof window !== 'undefined') ? window.EonProductivity : null;
    if (P && P.streak && P.streak.current >= 3) return 'warm';
    return v > 0.66 ? 'warm' : 'plain';
  }
  /** Trim a line to the current register (headline-first; depth only if wanted). */
  fit(text) {
    if (this.register() !== 'terse') return text;
    return String(text).split(/ — | · |\. /)[0].replace(/[.!?]+$/, '') + '.';
  }

  // ===================== REASONING (§1, §2) =====================
  /** Relationship graph: how tasks tie to opportunities, people, tracks. */
  graph() {
    const d = this._data();
    const tasks = d.tasks || [], opps = d.opportunities || [];
    const byOpp = {}, byPerson = {}, byTrack = {};
    tasks.forEach(t => {
      if (!this._activeTask(t)) return;
      if (t.linkedOpportunity) (byOpp[t.linkedOpportunity] = byOpp[t.linkedOpportunity] || []).push(t);
      if (t.owedTo) (byPerson[t.owedTo] = byPerson[t.owedTo] || []).push(t);
      const k = t.category || 'General'; (byTrack[k] = byTrack[k] || []).push(t);
    });
    return { byOpp, byPerson, byTrack, opps };
  }
  /** Ripple: completing this task/opportunity unblocks how much else. */
  ripple() {
    const g = this.graph();
    // the opportunity with the most open linked tasks = highest leverage
    let best = null;
    for (const [name, list] of Object.entries(g.byOpp)) if (!best || list.length > best.n) best = { name, n: list.length };
    if (best && best.n >= 2) return { text: `${best.n} of your open tasks tie to "${this._short(best.name)}" — clearing it moves all of them.`, type: 'ripple', confidence: 0.8 };
    // a person you owe several things to
    for (const [who, list] of Object.entries(g.byPerson)) if (list.length >= 2) return { text: `${list.length} open items involve ${this._short(who)} — one message could unblock them together.`, type: 'ripple', confidence: 0.72 };
    return null;
  }
  /** Theme detection: the recurring thread your week is quietly going to. */
  themes() {
    const d = this._data(); const freq = {};
    (d.tasks || []).forEach(t => { if (!this._activeTask(t)) return; String(t.title || '').toLowerCase().split(/[^a-z]+/).forEach(w => { if (w.length >= 4 && !STOP.has(w)) freq[w] = (freq[w] || 0) + 1; }); });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 3) return { text: `A lot of your week is quietly going to "${top[0]}" — worth a focused block?`, type: 'theme', confidence: 0.6 + Math.min(0.25, top[1] * 0.03) };
    return null;
  }

  // ===================== MEMORY (§3) =====================
  /** Consolidation: once a day, snapshot the day + distil a durable lesson.
      Also forgets — old episodes age out so focus stays sharp. */
  _consolidate() {
    if (!this._owner()) return;
    const P = (typeof window !== 'undefined') ? window.EonProductivity : null;
    if (!P || !P.enabled) return;                 // data not ready yet → retry later
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    this.m.episodes = this.m.episodes || [];
    if (!this.m.episodes.some(e => e.date === today)) {
      this.m.episodes.push({ date: today, streak: P.streak?.current || 0, cap: P.capacity?.perDay || null, bestHour: P.bestHour, done: (P.capacity?.dueWeek != null) ? undefined : undefined });
      this.m.episodes = this.m.episodes.filter(e => (now - Date.parse(e.date)) < 60 * DAY).slice(-60);   // forget > ~2 months
      // distil a lesson if a stable pattern shows up
      const hours = this.m.episodes.map(e => e.bestHour).filter(h => h != null);
      if (hours.length >= 4) { const mode = this._mode(hours); this._learnLesson('best-hour', `Your best hours cluster around ${mode}:00 — that's when to schedule the hard one.`); }
      const caps = this.m.episodes.map(e => e.cap).filter(c => c); if (caps.length >= 4) this._learnLesson('capacity', `You realistically finish about ${this._mode(caps)} task${this._mode(caps) === 1 ? '' : 's'} a day — plan to that, not to a wish.`);
    }
    this.m.lastConsolidate = now; this._save();
  }
  _learnLesson(key, text) { this.m.lessons = this.m.lessons || {}; this.m.lessons[key] = { text, at: Date.now() }; }
  /** Recall a relevant, durable lesson (or null). */
  recall() {
    const L = Object.values(this.m.lessons || {}).filter(l => Date.now() - l.at < 45 * DAY);
    if (!L.length) return null;
    const l = L[(Math.random() * L.length) | 0];
    return { text: l.text, type: 'memory', confidence: 0.74 };
  }
  /** Decision memory: remember a settled choice so he won't re-ask. */
  remember(key, value) { this.m.decisions = this.m.decisions || {}; this.m.decisions[key] = { value, at: Date.now() }; this._save(); }
  decided(key) { return (this.m.decisions || {})[key]?.value; }

  // ===================== ACTIVE CURIOSITY (§5) =====================
  /** One good clarifying question that fills a real gap (throttled). */
  curiosity() {
    const now = Date.now();
    if (now - this._curiosityAt < 6 * 3600000) return null;     // at most ~once per few hours
    const d = this._data();
    const noDue = (d.tasks || []).find(t => this._activeTask(t) && !t.dueDate && !this.decided('due:' + t.id));
    if (noDue) { this._curiosityAt = now; return { text: `When does "${this._short(noDue.title)}" actually need to be done? Set a date and I'll guard it.`, type: 'curiosity', confidence: 0.7, key: 'due:' + noDue.id }; }
    const noCat = (d.tasks || []).find(t => this._activeTask(t) && !t.category && !this.decided('cat:' + t.id));
    if (noCat) { this._curiosityAt = now; return { text: `Which area does "${this._short(noCat.title)}" belong to? Tagging it keeps your tracks honest.`, type: 'curiosity', confidence: 0.62, key: 'cat:' + noCat.id }; }
    return null;
  }

  /** The single best "smart" remark right now (already self-evaluated), or null. */
  insight() {
    if (!this._owner()) return null;
    const cands = [this.ripple(), this.recall(), this.themes(), this.curiosity()].filter(Boolean);
    for (const c of cands) {
      if (!this.shouldSpeak(c)) continue;
      const pre = this.hedge(c.confidence); if (pre == null) continue;
      return { text: this.fit(pre + c.text), type: c.type, key: c.key };
    }
    return null;
  }

  // ===================== helpers =====================
  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }
  _data() { try { return window.EonBrain?.getData?.() || {}; } catch { return {}; } }
  _activeTask(t) { return t && !['Completed', 'Cancelled', 'Dropped'].includes(t.status); }
  _mode(arr) { const f = {}; let best = arr[0], bn = 0; arr.forEach(v => { f[v] = (f[v] || 0) + 1; if (f[v] > bn) { bn = f[v]; best = v; } }); return best; }
  _short(t, n = 30) { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  _name() { return ownerFirstName(document.getElementById('pfName')?.textContent) || OWNER.name; }
  _load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
  _save() { try { localStorage.setItem(STORE, JSON.stringify(this.m)); } catch {} }
}
