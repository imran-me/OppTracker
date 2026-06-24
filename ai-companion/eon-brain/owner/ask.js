/* ============================================================
   EON — owner/ask.js
   "Ask EON" — a lightweight question→answer over the owner's data.
   No backend / LLM: a rule-based engine that reads the brain's cached
   records (EonBrain.getRecords / ensureData) and answers the common
   things — counts, what's due / overdue / this week, totals & averages,
   list a module, find by name. Answers in his bubble + a small panel,
   and can drop results into the backpack.

   Owner-only. Examples:
     "how many opportunities?"  "what's due this week?"  "overdue"
     "total amount of invoices"  "list my tasks"  "find chevening"
   ============================================================ */

const SYN = {
  opportunities: ['opportunit', 'opps', 'opp'],
  tasks: ['task', 'to-do', 'todo'],
  documents: ['document', 'doc', 'file'],
  contacts: ['contact', 'people', 'person'],
  achievements: ['achiev', 'award', 'certif', 'trophy'],
  projects: ['project'],
  research: ['research', 'paper', 'thesis'],
  reminders: ['reminder'],
};
const AMOUNT_HINTS = ['amount', 'value', 'price', 'cost', 'fee', 'total', 'budget', 'salary', 'paid'];

export class AskEon {
  constructor(ctx) { this.ctx = ctx; this._open = false; }

  start() {
    this._injectStyle();
    this._buildChip();
    this._buildPanel();
    if (typeof window !== 'undefined') window.EonAsk = this;
  }

  update() {
    const show = this._owner();
    if (this._chip) this._chip.style.display = show ? 'flex' : 'none';
    if (!show && this._open) this._toggle(false);
  }

  // ---------------- ask flow ----------------
  async ask(q) {
    q = String(q || '').trim(); if (!q) return;
    this._echo(q);
    this._answerEl.textContent = '…thinking';
    try { this.ctx.character.playEmote('think'); } catch {}
    let res;
    try { res = await this._answer(q); } catch (e) { res = { speak: 'I tripped on that one — try rephrasing?' }; }
    this._lastItems = res.items || null;
    this._answerEl.textContent = res.detail ? `${res.speak}\n${res.detail}` : res.speak;
    this._keepBtn.style.display = (res.items && res.items.length) ? 'inline-block' : 'none';
    try { this.ctx.character.playEmote('point'); } catch {}
    try { this.ctx.ai?.speak(res.speak.slice(0, 140), 5200); } catch {}
  }

  async _answer(q) {
    const B = window.EonBrain;
    await B?.ensureData?.();
    const data = B?.getData?.() || {};
    const records = B?.getRecords?.() || [];
    const keys = Object.keys(data).filter((k) => Array.isArray(data[k]));
    if (!records.length) return { speak: "I can't see your data yet — give the brain a moment, or run a meditation." };

    const nq = q.toLowerCase();
    const now = Date.now();
    const days = (iso) => Math.floor((Date.parse(iso) - now) / 86400000);
    const ent = this._entityIn(nq, keys);
    const recs = ent ? records.filter((r) => r.entity === ent) : records;
    const dl = recs.filter((r) => r.deadlineAt && !Number.isNaN(Date.parse(r.deadlineAt)));

    if (/overdue|past due|missed|late\b/.test(nq)) {
      const od = dl.filter((r) => Date.parse(r.deadlineAt) < now).sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt));
      return this._list(od, `${od.length} overdue${ent ? ' ' + ent : ''}`);
    }
    if (/due today|\btoday\b/.test(nq)) {
      const td = dl.filter((r) => days(r.deadlineAt) === 0);
      return this._list(td, `${td.length} due today`);
    }
    if (/tomorrow/.test(nq)) {
      const tm = dl.filter((r) => days(r.deadlineAt) === 1);
      return this._list(tm, `${tm.length} due tomorrow`);
    }
    if (/next deadline|nearest|soonest|what'?s next/.test(nq)) {
      const fut = dl.filter((r) => Date.parse(r.deadlineAt) >= now).sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt));
      if (!fut.length) return { speak: 'No upcoming deadlines on the radar. 🌿' };
      const f = fut[0]; return { speak: `Next up: "${f.label}" — ${this._date(f.deadlineAt)} (${days(f.deadlineAt)} days).`, items: [f] };
    }
    if (/this week|next 7|upcoming|coming up|\bsoon\b|due\b/.test(nq)) {
      const wk = dl.filter((r) => { const d = days(r.deadlineAt); return d >= 0 && d <= 7; }).sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt));
      return this._list(wk, `${wk.length} due in the next 7 days`);
    }
    if (/how many|number of|count|how much.*have/.test(nq)) {
      if (ent) return { speak: `You have ${recs.length} ${ent}.` };
      return { speak: keys.map((k) => `${data[k].length} ${k}`).join(', ') + '.' };
    }
    if (/total|sum|average|avg|how much/.test(nq)) {
      const field = this._amountField(nq, recs);
      if (field) {
        const vals = recs.map((r) => this._num(r.payload?.[field])).filter((n) => n != null);
        if (!vals.length) return { speak: `No numeric "${field}" to add up.` };
        const s = vals.reduce((a, b) => a + b, 0);
        if (/average|avg/.test(nq)) return { speak: `Average ${field}${ent ? ' of ' + ent : ''}: ${this._fmt(s / vals.length)} (over ${vals.length}).` };
        return { speak: `Total ${field}${ent ? ' of ' + ent : ''}: ${this._fmt(s)} across ${vals.length}.` };
      }
      return { speak: 'Which number should I total? Try e.g. "total amount of opportunities".' };
    }
    if (ent && /list|show|what are|give me|^my |all my/.test(nq)) {
      return this._list(recs.slice(0, 10), `${recs.length} ${ent}`);
    }
    if (/find|search|look ?up|who is|where is/.test(nq)) {
      const term = nq.replace(/.*?(find|search|look ?up|who is|where is)\s+/, '').replace(/[?.!]/g, '').trim();
      if (term.length >= 2) {
        const hits = records.filter((r) => (r.label || '').toLowerCase().includes(term));
        return this._list(hits.slice(0, 10), `${hits.length} match "${term}"`);
      }
    }
    if (ent) return this._list(recs.slice(0, 10), `${recs.length} ${ent}`);
    return { speak: this._help(keys) };
  }

  _list(items, lead) {
    if (!items.length) return { speak: `Nothing there — ${lead.replace(/^\d+\s*/, '')}. 🌿` };
    const detail = items.slice(0, 8).map((r) => `• ${r.label}${r.deadlineAt ? ` — ${this._date(r.deadlineAt)}` : ''}`).join('\n');
    return { speak: `${lead}:`, detail, items };
  }

  // ---------------- helpers ----------------
  _entityIn(nq, keys) {
    for (const k of keys) { const syns = SYN[k] || [k]; if (nq.includes(k) || syns.some((s) => nq.includes(s))) return k; }
    return null;
  }
  _amountField(nq, recs) {
    const fields = [...new Set(recs.flatMap((r) => Object.keys(r.payload || {})))];
    // a field named in the question?
    const named = fields.find((f) => nq.includes(f.toLowerCase()));
    if (named && this._isNumericField(named, recs)) return named;
    // a common money-ish field that actually holds numbers?
    for (const h of AMOUNT_HINTS) { const f = fields.find((x) => x.toLowerCase().includes(h)); if (f && this._isNumericField(f, recs)) return f; }
    return null;
  }
  _isNumericField(f, recs) { return recs.some((r) => this._num(r.payload?.[f]) != null); }
  _num(v) { if (v == null) return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isNaN(n) ? null : n; }
  _fmt(n) { return (Math.round(n * 100) / 100).toLocaleString(); }
  _date(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }
  _help(keys) { return `Ask me things like "how many ${keys[0] || 'tasks'}?", "what's due this week?", "overdue", "find <name>", or "total <field>".`; }
  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }

  // ---------------- DOM ----------------
  _injectStyle() {
    if (document.getElementById('eon-ask-style')) return;
    const s = document.createElement('style'); s.id = 'eon-ask-style';
    s.textContent = `
      #eon-ask-chip{position:fixed;right:16px;bottom:160px;z-index:2147483600;display:none;align-items:center;gap:6px;
        background:#1f6dff;color:#fff;border:0;border-radius:20px;padding:7px 13px;cursor:pointer;
        box-shadow:0 8px 22px rgba(31,109,255,.34);font:700 13px system-ui}
      #eon-ask-chip:hover{background:#1559d8}
      #eon-ask{position:fixed;right:16px;bottom:200px;z-index:2147483600;width:320px;max-width:calc(100vw - 32px);
        background:#fff;color:#10225e;border-radius:14px;border:1.5px solid #1f6dff33;box-shadow:0 16px 44px rgba(16,34,94,.26);
        opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .18s,transform .18s;font:500 13px system-ui;overflow:hidden}
      #eon-ask.show{opacity:1;transform:none;pointer-events:auto}
      #eon-ask .ea-h{display:flex;align-items:center;padding:10px 12px;background:#1f6dff;color:#fff;font-weight:700;font-size:12.5px}
      #eon-ask .ea-x{margin-left:auto;cursor:pointer;opacity:.85;font-size:14px}
      #eon-ask .ea-in{display:flex;gap:6px;padding:10px 12px}
      #eon-ask input{flex:1;border:1.5px solid #e2e7f2;border-radius:9px;padding:8px 10px;font:500 13px system-ui;color:#16203a}
      #eon-ask input:focus{outline:none;border-color:#1f6dff}
      #eon-ask .ea-go{border:0;border-radius:9px;background:#1f6dff;color:#fff;padding:0 12px;cursor:pointer;font:700 13px system-ui}
      #eon-ask .ea-a{padding:0 12px 12px;white-space:pre-wrap;color:#16203a;max-height:42vh;overflow:auto;font-weight:600}
      #eon-ask .ea-keep{display:none;margin:0 12px 12px;border:0;border-radius:9px;background:#eef1f7;color:#10225e;padding:7px 10px;cursor:pointer;font:700 12px system-ui}
      #eon-ask .ea-keep:hover{background:#e2e7f2}
      #eon-ask .ea-ex{padding:2px 12px 10px;color:#8a96ad;font-size:11px}`;
    document.head.appendChild(s);
  }
  _buildChip() {
    if (document.getElementById('eon-ask-chip')) { this._chip = document.getElementById('eon-ask-chip'); return; }
    const b = document.createElement('button'); b.id = 'eon-ask-chip';
    b.innerHTML = '💬 Ask EON'; b.title = 'Ask EON about your data';
    b.onclick = (e) => { e.stopPropagation(); this._toggle(); };
    document.body.appendChild(b); this._chip = b;
  }
  _buildPanel() {
    if (document.getElementById('eon-ask')) { this._panel = document.getElementById('eon-ask'); return; }
    const p = document.createElement('div'); p.id = 'eon-ask';
    p.innerHTML = `
      <div class="ea-h">💬 Ask EON <span class="ea-x" title="Close">✕</span></div>
      <div class="ea-in"><input type="text" placeholder="e.g. what's due this week?" /><button class="ea-go">Ask</button></div>
      <div class="ea-ex">Try: how many tasks · overdue · find &lt;name&gt; · total amount</div>
      <div class="ea-a"></div>
      <button class="ea-keep">🎒 Keep these in the backpack</button>`;
    document.body.appendChild(p);
    this._panel = p;
    this._input = p.querySelector('input');
    this._answerEl = p.querySelector('.ea-a');
    this._keepBtn = p.querySelector('.ea-keep');
    p.querySelector('.ea-x').onclick = (e) => { e.stopPropagation(); this._toggle(false); };
    p.querySelector('.ea-go').onclick = (e) => { e.stopPropagation(); this.ask(this._input.value); };
    this._input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.ask(this._input.value); });
    this._keepBtn.onclick = (e) => {
      e.stopPropagation();
      const items = this._lastItems || [];
      const text = items.map((r) => `${r.label}${r.deadlineAt ? ` — ${this._date(r.deadlineAt)}` : ''}`).join('\n');
      try { window.EonBackpack?.addText(text, `Kept ${items.length} from your question. 🎒`); } catch {}
      this._keepBtn.style.display = 'none';
    };
  }
  _echo(q) { if (this._answerEl) this._answerEl.textContent = ''; if (this._keepBtn) this._keepBtn.style.display = 'none'; }
  _toggle(force) {
    this._open = (force === undefined) ? !this._open : force;
    this._panel.classList.toggle('show', this._open);
    if (this._open) setTimeout(() => this._input?.focus(), 60);
  }
}
