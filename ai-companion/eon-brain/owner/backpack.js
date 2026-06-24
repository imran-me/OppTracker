/* ============================================================
   EON — owner/backpack.js
   The Backpack (his living clipboard). OWNER-MODE: text catch & paste,
   plus the "smart hands" — tools & transforms over what he carries.

   • Catch — drag selected text onto EON; he grabs it with a "caught it!"
     reaction and tucks it in a pocket.
   • Pockets — a carried history of the last several snippets, persisted
     (he still has them tomorrow). Pin one to a gold pocket.
   • Inventory — tap his 📎 bag to see everything he carries.
   • Paste — click a pocket and it pours into the field you last used
     (or onto the clipboard if no field is focused).

   • Tools — 🧮 Sum every number he carries, 🧺 Bundle into one, 🔤 Sort,
     📥 Fetch your deadlines into the bag.
   • Per-pocket — 🔍 Magnify, 📋 Copy, 📅 → Reminder (date), case transforms.
     Every result becomes a new pocket, so nothing is lost.
   ============================================================ */

const STORE_KEY = 'eon-pockets';
const MAX_POCKETS = 12;          // not counting pinned
const PREVIEW = 48;

export class Backpack {
  constructor(ctx) {
    this.ctx = ctx;
    this.pockets = this._load();          // [{ id, text, pinned, ts }]
    this.lastField = null;                // last focused input/textarea/contenteditable
    this._open = false;
    this._reaching = false;
  }

  start() {
    this._injectStyle();
    this._buildChip();
    this._buildPanel();
    if (typeof window !== 'undefined') window.EonBackpack = this;   // let Ask EON drop results in

    // remember where the owner is typing (so paste knows the target)
    this._onFocus = (e) => {
      const t = e.target;
      if (t && (t.matches?.('input, textarea') || t.isContentEditable)) this.lastField = t;
    };
    document.addEventListener('focusin', this._onFocus, true);

    // catch: only intercept a drop when it lands ON EON, so we never break
    // the app's own drag-and-drop elsewhere.
    this._onDragOver = (e) => {
      if (!this._owner()) return;
      if (this._overEon(e.clientX, e.clientY)) { e.preventDefault(); this._setReach(true); }
      else this._setReach(false);
    };
    this._onDrop = (e) => {
      if (!this._owner() || !this._overEon(e.clientX, e.clientY)) { this._setReach(false); return; }
      const text = (e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('text') || '').trim();
      this._setReach(false);
      if (text) { e.preventDefault(); this._catch(text); }
    };
    this._onDragEnd = () => this._setReach(false);
    document.addEventListener('dragover', this._onDragOver);
    document.addEventListener('drop', this._onDrop);
    document.addEventListener('dragend', this._onDragEnd);

    this._renderChip();
  }

  /** Light refresh from the main loop (owner gating + chip). */
  update() {
    const show = this._owner() && this.pockets.length > 0;
    if (this._chip) this._chip.style.display = show ? 'flex' : 'none';
    if (!this._owner() && this._open) this._togglePanel(false);
  }

  // ---------------- catch ----------------
  _catch(text) {
    const clipped = text.length > 4000 ? text.slice(0, 4000) : text;
    // de-dupe: if identical to the newest, just bump it
    this.pockets = this.pockets.filter((p) => p.text !== clipped);
    this.pockets.unshift({ id: 'p' + Date.now().toString(36), text: clipped, pinned: false, ts: Date.now() });
    this._trim();
    this._save();
    this._renderChip();
    if (this._open) this._renderPanel();

    try { this.ctx.character.playEmote('cheer'); } catch {}
    try { this.ctx.ai?.speak(`Caught it! 🎒 “${this._short(clipped)}”`, 3200); } catch {}
    this._sparkle('🎒');
  }

  _trim() {
    const pinned = this.pockets.filter((p) => p.pinned);
    const rest = this.pockets.filter((p) => !p.pinned).slice(0, MAX_POCKETS);
    this.pockets = [...this.pockets.filter((p) => p.pinned), ...rest]
      .filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i);
    // keep pinned first, then newest rest
    this.pockets.sort((a, b) => (b.pinned - a.pinned) || (b.ts - a.ts));
  }

  // ---------------- paste ----------------
  _paste(p) {
    this._togglePanel(false);
    const el = this._validField(this.lastField);
    if (el) {
      this._pourAnimation(p.text, el);                 // letters drift out of his bag…
      setTimeout(() => {                               // …then the text settles into the field
        this._pasteInto(el, p.text);
        try { this.ctx.character.playEmote('point'); } catch {}
        try { this.ctx.ai?.speak('There you go! ✨', 2200); } catch {}
      }, 620);
    } else {
      this._pasteInto(null, p.text);                   // no field → clipboard
      try { this.ctx.character.playEmote('point'); } catch {}
      try { this.ctx.ai?.speak('Copied it for you — paste anywhere. 📋', 3000); } catch {}
    }
  }

  _validField(el) {
    return (el && el.isConnected && (el.matches?.('input, textarea') || el.isContentEditable)) ? el : null;
  }

  /** Letters drift gently out of his bag, glide along a soft spline with a
      faint comet trail, and settle into the field. Calm — even up close. */
  _pourAnimation(text, el) {
    try {
      const start = this._bagPoint();
      const r = el.getBoundingClientRect();
      const end = { x: r.left + 14 + Math.random() * 8, y: r.top + Math.min(18, r.height / 2) };
      const chars = String(text).replace(/\s+/g, ' ').trim().slice(0, 12).split('');
      if (!chars.length || !start) return;
      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      const lift = Math.max(130, dist * 0.42 + 105);             // a soft loop, enough to read up close

      chars.forEach((ch, i) => {
        if (ch === ' ') return;
        // gentle waypoints: ease up out of the bag → soft apex → over the field → settle
        const side = (i % 2 ? 1 : -1);
        const spread = 24 + Math.random() * 40;
        const launch = { x: start.x + (Math.random() - 0.5) * 26, y: start.y - 18 - Math.random() * 26 };
        const apex   = { x: (start.x + end.x) / 2 + side * spread, y: Math.min(start.y, end.y) - lift * (0.7 + Math.random() * 0.35) };
        const overF  = { x: end.x + (Math.random() - 0.5) * 38, y: end.y - 44 - Math.random() * 24 };
        const pts = [start, launch, apex, overF, end].map((p) => this._clampPt(p));
        const path = this._spline(pts, 9);

        const spin = (Math.random() < 0.5 ? 1 : -1) * (22 + Math.random() * 40);   // gentle tilt, no whirl
        const frames = path.map((p, idx) => {
          const t = idx / (path.length - 1);
          const sc = 0.82 + Math.sin(Math.min(t, 1) * Math.PI) * 0.3;
          return {
            offset: t,
            transform: `translate(${(p.x - start.x).toFixed(1)}px, ${(p.y - start.y).toFixed(1)}px) rotate(${(spin * t).toFixed(1)}deg) scale(${sc.toFixed(3)})`,
            opacity: t < 0.05 ? 0 : (t > 0.92 ? 0 : 0.9),
          };
        });
        const dur = 1150 + Math.random() * 320;
        const delay = i * 72;
        const color = (i % 4 === 2) ? 'rgba(126,217,87,.7)' : '';
        const size = 11 + Math.random() * 3.5;

        // two faint ghosts trail behind the leader → a soft comet tail
        this._flyLetter(ch, start, frames, { dur, delay: delay + 150, easing: 'ease-out', opacityMul: 0.22, size: size * 0.82, color });
        this._flyLetter(ch, start, frames, { dur, delay: delay + 78,  easing: 'ease-out', opacityMul: 0.42, size: size * 0.9,  color });
        this._flyLetter(ch, start, frames, { dur, delay,              easing: 'cubic-bezier(.36,0,.32,1)', opacityMul: 1, size, color });
      });

      setTimeout(() => this._landingPop(end), 560);
    } catch {}
  }

  _flyLetter(ch, start, baseFrames, o) {
    const span = document.createElement('span');
    span.className = 'eon-pour'; span.textContent = ch;
    span.style.left = start.x + 'px'; span.style.top = start.y + 'px';
    span.style.fontSize = o.size.toFixed(1) + 'px';
    if (o.color) span.style.color = o.color;
    document.body.appendChild(span);
    const frames = o.opacityMul === 1 ? baseFrames
      : baseFrames.map((f) => ({ ...f, opacity: +(f.opacity * o.opacityMul).toFixed(3) }));
    const anim = span.animate(frames, { duration: o.dur, delay: o.delay, easing: o.easing, fill: 'forwards' });
    const kill = () => span.remove(); anim.onfinish = kill;
    setTimeout(kill, o.dur + o.delay + 500);
  }

  /** Catmull-Rom spline through the waypoints → smooth screen-space samples. */
  _spline(pts, perSeg) {
    const P = [pts[0], ...pts, pts[pts.length - 1]];
    const out = [];
    for (let i = 1; i < P.length - 2; i++) {
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      for (let j = 0; j < perSeg; j++) {
        const t = j / perSeg, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  _clampPt(p) { return { x: Math.max(6, Math.min(innerWidth - 6, p.x)), y: Math.max(8, Math.min(innerHeight - 6, p.y)) }; }

  /** A soft expanding ring where the letters land. */
  _landingPop(p) {
    try {
      const d = document.createElement('div'); d.className = 'eon-pop';
      d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
      document.body.appendChild(d);
      const a = d.animate(
        [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: .5 }, { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 }],
        { duration: 720, easing: 'ease-out', fill: 'forwards' });
      a.onfinish = () => d.remove();
      setTimeout(() => d.remove(), 800);
    } catch {}
  }

  /** Screen point of his backpack (behind his body). */
  _bagPoint() {
    try { const h = this.ctx.project(this.ctx.character.headAnchor); return { x: h.x - 6, y: h.y + 46 }; }
    catch { return null; }
  }
  _pasteInto(el, text) {
    try {
      if (el && el.isConnected && (el.matches?.('input, textarea') || el.isContentEditable)) {
        el.focus();
        if (el.isContentEditable) { document.execCommand('insertText', false, text); }
        else {
          const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
          el.value = el.value.slice(0, s) + text + el.value.slice(e);
          const pos = s + text.length; try { el.setSelectionRange(pos, pos); } catch {}
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
    } catch {}
    try { navigator.clipboard?.writeText(text); } catch {}
    return false;
  }

  // ---------------- pocket ops ----------------
  _pin(p) { p.pinned = !p.pinned; this._trim(); this._save(); this._renderPanel(); this._renderChip(); }
  _del(p) { this.pockets = this.pockets.filter((x) => x.id !== p.id); this._save(); this._renderPanel(); this._renderChip(); }
  _clear() { this.pockets = this.pockets.filter((p) => p.pinned); this._save(); this._renderPanel(); this._renderChip(); }

  // ---------------- geometry / fx ----------------
  _overEon(x, y) {
    try {
      const h = this.ctx.project(this.ctx.character.headAnchor);
      const dx = x - h.x, dy = y - (h.y + 40);
      return (dx * dx + dy * dy) < (135 * 135);      // generous catch radius around him
    } catch { return false; }
  }
  _setReach(on) {
    if (this._reaching === on) return;
    this._reaching = on;
    if (on) { try { this.ctx.character.setState('curious'); } catch {} }
  }
  _sparkle(glyph) {
    try {
      const ch = this.ctx.character, P = this.ctx.particles;
      for (let i = 0; i < 5; i++) P.emote(glyph, ch._worldHead((Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.3));
    } catch {}
  }

  // ---------------- DOM ----------------
  _injectStyle() {
    if (document.getElementById('eon-bag-style')) return;
    const s = document.createElement('style'); s.id = 'eon-bag-style';
    s.textContent = `
      #eon-bag{position:fixed;right:16px;bottom:118px;z-index:2147483600;display:none;align-items:center;gap:6px;
        background:#10225e;color:#fff;border:0;border-radius:20px;padding:7px 12px;cursor:pointer;
        box-shadow:0 8px 22px rgba(16,34,94,.3);font:700 13px system-ui}
      #eon-bag:hover{background:#1a3170}
      #eon-bag .eb-n{background:#7ed957;color:#10225e;border-radius:10px;padding:0 7px;font-size:12px}
      #eon-pockets{position:fixed;right:16px;bottom:158px;z-index:2147483600;width:300px;max-width:calc(100vw - 32px);
        max-height:60vh;overflow:auto;background:#fff;color:#10225e;border-radius:14px;border:1.5px solid #1f6dff33;
        box-shadow:0 16px 44px rgba(16,34,94,.26);opacity:0;transform:translateY(8px);pointer-events:none;
        transition:opacity .18s ease,transform .18s ease;font:500 13px system-ui}
      #eon-pockets.show{opacity:1;transform:none;pointer-events:auto}
      #eon-pockets .ep-h{display:flex;align-items:center;padding:10px 12px;background:#10225e;color:#fff;font-weight:700;font-size:12.5px;position:sticky;top:0}
      #eon-pockets .ep-clear{margin-left:auto;cursor:pointer;opacity:.8;font-size:11px;font-weight:600}
      #eon-pockets .ep-clear:hover{opacity:1}
      #eon-pockets .ep-close{margin-left:12px;cursor:pointer;opacity:.8;font-size:14px;line-height:1}
      #eon-pockets .ep-close:hover{opacity:1}
      .eon-pour{position:fixed;z-index:2147483640;font:700 12px/1 system-ui,sans-serif;
        color:rgba(20,24,40,.62);pointer-events:none;will-change:transform,opacity;text-shadow:0 1px 2px rgba(255,255,255,.55)}
      .eon-pop{position:fixed;z-index:2147483639;width:26px;height:26px;border-radius:50%;
        border:2px solid rgba(126,217,87,.55);pointer-events:none;will-change:transform,opacity}
      #eon-pockets .ep-row{display:flex;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid #eef1f7}
      #eon-pockets .ep-txt{flex:1;min-width:0;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#16203a;font-weight:600}
      #eon-pockets .ep-row:hover .ep-txt{color:#1f6dff}
      #eon-pockets .ep-pin,.ep-x{cursor:pointer;opacity:.55;font-size:13px}
      #eon-pockets .ep-pin:hover,.ep-x:hover{opacity:1}
      #eon-pockets .ep-pin.on{opacity:1;filter:drop-shadow(0 0 1px #C9A227)}
      #eon-pockets .ep-empty{padding:16px 12px;color:#8a96ad;font-weight:500;text-align:center}
      #eon-pockets .ep-tools{display:flex;gap:6px;padding:8px 12px;background:#f6f8fc;border-top:1px solid #eef1f7}
      #eon-pockets .ep-tools button{flex:1;border:0;border-radius:8px;padding:6px 3px;cursor:pointer;background:#eaeefb;color:#10225e;font:700 11px system-ui}
      #eon-pockets .ep-tools button:hover{background:#dde4f8}
      #eon-pockets .ep-tool{cursor:pointer;opacity:.5;font-size:12px}
      #eon-pockets .ep-tool:hover{opacity:1}
      #eon-tools-menu{position:fixed;z-index:2147483641;background:#fff;color:#10225e;border-radius:10px;
        border:1px solid #1f6dff33;box-shadow:0 12px 30px rgba(16,34,94,.22);padding:5px;display:none;min-width:158px;font:600 12.5px system-ui}
      #eon-tools-menu.show{display:block}
      #eon-tools-menu button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:7px 9px;border-radius:7px;cursor:pointer;color:#16203a;font:600 12.5px system-ui}
      #eon-tools-menu button:hover{background:#eef1f7}
      #eon-magnify{position:fixed;inset:0;z-index:2147483645;background:rgba(16,34,94,.34);display:none;align-items:center;justify-content:center}
      #eon-magnify.show{display:flex}
      #eon-magnify .em-card{max-width:min(640px,90vw);max-height:74vh;overflow:auto;background:#fff;border-radius:14px;
        padding:22px 24px;box-shadow:0 24px 60px rgba(0,0,0,.3);font:500 16px/1.5 system-ui;color:#16203a;white-space:pre-wrap;word-break:break-word}
      #eon-magnify .em-x{position:fixed;top:18px;right:24px;color:#fff;font-size:26px;cursor:pointer;line-height:1}`;
    document.head.appendChild(s);
  }
  _buildChip() {
    if (document.getElementById('eon-bag')) { this._chip = document.getElementById('eon-bag'); return; }
    const b = document.createElement('button'); b.id = 'eon-bag';
    b.innerHTML = `🎒 <span class="eb-n">0</span>`;
    b.title = 'EON’s backpack — what he’s carrying';
    b.onclick = (e) => { e.stopPropagation(); this._togglePanel(); };
    document.body.appendChild(b);
    this._chip = b; this._chipN = b.querySelector('.eb-n');
  }
  _buildPanel() {
    if (document.getElementById('eon-pockets')) { this._panel = document.getElementById('eon-pockets'); return; }
    const p = document.createElement('div'); p.id = 'eon-pockets';
    p.innerHTML = `
      <div class="ep-h">🎒 Backpack <span class="ep-clear">Clear</span><span class="ep-close" title="Close">✕</span></div>
      <div class="ep-tools">
        <button class="et-sum" title="Add up every number he's carrying">🧮 Sum</button>
        <button class="et-bundle" title="Combine everything into one">🧺 Bundle</button>
        <button class="et-sort" title="Tidy the bag">🔤 Sort</button>
        <button class="et-fetch" title="Fetch your deadlines into the bag">📥 Fetch</button>
      </div>
      <div class="ep-list"></div>`;
    document.body.appendChild(p);
    this._panel = p; this._list = p.querySelector('.ep-list');
    p.querySelector('.ep-clear').onclick = (e) => { e.stopPropagation(); this._clear(); };
    p.querySelector('.ep-close').onclick = (e) => { e.stopPropagation(); this._togglePanel(false); };
    p.querySelector('.et-sum').onclick = (e) => { e.stopPropagation(); this._toolSum(); };
    p.querySelector('.et-bundle').onclick = (e) => { e.stopPropagation(); this._toolBundle(); };
    p.querySelector('.et-sort').onclick = (e) => { e.stopPropagation(); this._toolSort(); };
    p.querySelector('.et-fetch').onclick = (e) => { e.stopPropagation(); this._toolFetch(); };
  }
  _togglePanel(force) {
    this._open = (force === undefined) ? !this._open : force;
    if (this._open) { this._renderPanel(); this._panel.classList.add('show'); }
    else this._panel.classList.remove('show');
  }
  _renderChip() {
    if (this._chipN) this._chipN.textContent = String(this.pockets.length);
    this.update();
  }
  _renderPanel() {
    if (!this._list) return;
    if (!this.pockets.length) { this._list.innerHTML = `<div class="ep-empty">Drag any text onto EON and he’ll keep it here.</div>`; return; }
    this._list.innerHTML = '';
    for (const p of this.pockets) {
      const row = document.createElement('div'); row.className = 'ep-row';
      row.innerHTML = `<span class="ep-pin ${p.pinned ? 'on' : ''}" title="Pin">📌</span>
        <span class="ep-txt" title="Paste">${this._esc(this._short(p.text, 56))}</span>
        <span class="ep-tool" title="Tools">🔧</span>
        <span class="ep-x" title="Remove">✕</span>`;
      row.querySelector('.ep-txt').onclick = (e) => { e.stopPropagation(); this._paste(p); };
      row.querySelector('.ep-pin').onclick = (e) => { e.stopPropagation(); this._pin(p); };
      row.querySelector('.ep-tool').onclick = (e) => { e.stopPropagation(); this._openTools(p, e.currentTarget); };
      row.querySelector('.ep-x').onclick = (e) => { e.stopPropagation(); this._del(p); };
      this._list.appendChild(row);
    }
  }

  /** Public: drop a snippet into the bag (used by Ask EON / fetch). */
  addText(text, line) { if (text != null && String(text).trim()) this._addResult(String(text), line || 'Kept it. 🎒', '🎒'); }

  // ---------------- tools & transforms (the smart hands) ----------------
  /** A reaction: little emote + sparkle + a word. */
  _react(glyph, line, emote = 'cheer') {
    try { this.ctx.character.playEmote(emote); } catch {}
    this._sparkle(glyph || '✨');
    try { this.ctx.ai?.speak(line, 2700); } catch {}
  }

  /** Put a freshly made snippet into the bag (nothing lost). */
  _addResult(text, line, glyph, emote) {
    const clean = String(text);
    this.pockets = this.pockets.filter((p) => p.text !== clean);
    this.pockets.unshift({ id: 'r' + Date.now().toString(36) + ((Math.random() * 999) | 0), text: clean, pinned: false, ts: Date.now() });
    this._trim(); this._save(); this._renderChip();
    if (this._open) this._renderPanel();
    this._react(glyph, line, emote);
  }

  _toolSum() {
    const nums = this.pockets.flatMap((p) => this._numbersIn(p.text));
    if (!nums.length) { this._react('🧮', 'No numbers to add up. 🤔', 'think'); return; }
    const total = nums.reduce((a, b) => a + b, 0);
    this._addResult(this._fmtNum(total), `🧮 ${nums.length} number${nums.length > 1 ? 's' : ''} = ${this._fmtNum(total)}`, '🧮');
  }
  _toolBundle() {
    const texts = this.pockets.map((p) => p.text);
    if (texts.length < 2) { this._react('🧺', 'Give me a couple of things to bundle. 🧺', 'think'); return; }
    this._addResult(texts.join('\n'), `Bundled ${texts.length} into one. 🧺`, '🧺');
  }
  _toolSort() {
    if (this.pockets.length < 2) return;
    this.pockets.sort((a, b) => (b.pinned - a.pinned) || a.text.localeCompare(b.text));
    this._save(); this._renderPanel();
    this._react('🔤', 'Tidied the bag! 🔤', 'point');
  }
  _toolFetch() {
    let feed = []; try { feed = window.EonBrain?.getAlerts?.() || []; } catch {}
    if (!feed.length) { this._react('📥', 'Nothing urgent to fetch right now. 🌿', 'think'); return; }
    const top = feed.slice(0, 3);
    for (const f of top) {
      const due = f.dueAt ? ` — due ${this._fmtDate(f.dueAt)}` : '';
      const t = `${f.label || f.entity}${due}`;
      this.pockets = this.pockets.filter((p) => p.text !== t);
      this.pockets.unshift({ id: 'f' + Date.now().toString(36) + ((Math.random() * 999) | 0), text: t, pinned: false, ts: Date.now() });
    }
    this._trim(); this._save(); this._renderChip(); if (this._open) this._renderPanel();
    this._react('📥', `Fetched ${top.length} deadline${top.length > 1 ? 's' : ''} for you. 📥`, 'cheer');
  }

  // per-pocket actions popover
  _openTools(p, anchor) {
    const m = this._ensureToolsMenu();
    m.innerHTML = '';
    const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = (e) => { e.stopPropagation(); m.classList.remove('show'); fn(); }; m.appendChild(b); };
    add('🔍 Magnify', () => this._magnify(p));
    add('📋 Copy', () => { try { navigator.clipboard?.writeText(p.text); } catch {} this._react('📋', 'Copied. 📋', 'point'); });
    if (this._isDateish(p.text)) add('📅 → Reminder', () => this._toReminder(p));
    if (this._numbersIn(p.text).length >= 2) add('🧮 Sum its numbers', () => this._addResult(this._fmtNum(this._numbersIn(p.text).reduce((a, b) => a + b, 0)), '🧮 Summed. ', '🧮'));
    if (/[a-z]/i.test(p.text)) { add('AA  UPPERCASE', () => this._recase(p, 'upper')); add('aa  lowercase', () => this._recase(p, 'lower')); add('Aa  Title Case', () => this._recase(p, 'title')); }
    m.classList.add('show');
    const rh = m.getBoundingClientRect(), r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, r.left - rh.width - 6) + 'px';
    m.style.top = Math.max(8, Math.min(innerHeight - rh.height - 8, r.top - 4)) + 'px';
  }
  _ensureToolsMenu() {
    if (this._toolsMenu) return this._toolsMenu;
    const m = document.createElement('div'); m.id = 'eon-tools-menu';
    document.body.appendChild(m);
    document.addEventListener('click', (e) => { if (this._toolsMenu && !this._toolsMenu.contains(e.target)) this._toolsMenu.classList.remove('show'); });
    this._toolsMenu = m; return m;
  }

  _recase(p, mode) {
    const fn = mode === 'upper' ? (s) => s.toUpperCase()
      : mode === 'lower' ? (s) => s.toLowerCase()
      : (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    this._addResult(fn(p.text), 'Reworded it for you. ✍️', '✍️', 'point');
  }
  _toReminder(p) {
    const d = this._parseDateish(p.text);
    if (!d) { this._react('📅', 'Hmm, no clear date there. 🤔', 'think'); return; }
    const title = this._short(p.text, 60);
    try {
      const r = window.EonBrain?.createReminder?.({ title, remindAt: d.toISOString() });
      if (r && r.catch) r.catch(() => {});
      this._react('📅', `Reminder set for ${this._fmtDate(d.toISOString())}. ⏰`, 'cheer');
    } catch { this._react('📅', 'Sign in as owner to set reminders. 🔒', 'think'); }
  }
  _magnify(p) {
    let m = document.getElementById('eon-magnify');
    if (!m) {
      m = document.createElement('div'); m.id = 'eon-magnify';
      m.innerHTML = `<span class="em-x" title="Close">✕</span><div class="em-card"></div>`;
      document.body.appendChild(m);
      const close = () => m.classList.remove('show');
      m.onclick = (e) => { if (e.target === m || e.target.classList.contains('em-x')) close(); };
    }
    m.querySelector('.em-card').textContent = p.text;
    m.classList.add('show');
  }

  // type detection
  _numbersIn(s) {
    return (String(s).match(/-?\d[\d,]*\.?\d*/g) || [])
      .map((x) => parseFloat(x.replace(/,/g, ''))).filter((n) => !Number.isNaN(n));
  }
  _isDateish(s) {
    const t = String(s);
    if (!/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t)) return false;
    return !Number.isNaN(this._parseMs(t));
  }
  _parseDateish(s) { const ms = this._parseMs(s); return Number.isNaN(ms) ? null : new Date(ms); }
  _parseMs(s) {
    const m = String(s).match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\b\d{1,2}\s+\w+\s+\d{2,4}|\b\w+\s+\d{1,2},?\s+\d{2,4}/i);
    return Date.parse(m ? m[0] : s);
  }
  _fmtNum(n) { return (Math.round(n * 100) / 100).toLocaleString(); }
  _fmtDate(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }

  // ---------------- helpers ----------------
  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }
  _short(t, n = PREVIEW) { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  _esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  _load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; } }
  _save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.pockets.slice(0, MAX_POCKETS + 8))); } catch {} }
}
