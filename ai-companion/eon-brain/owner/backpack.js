/* ============================================================
   EON — owner/backpack.js
   The Backpack (his living clipboard). OWNER-MODE v1: text catch & paste.

   • Catch — drag selected text onto EON; he grabs it with a "caught it!"
     reaction and tucks it in a pocket.
   • Pockets — a carried history of the last several snippets, persisted
     (he still has them tomorrow). Pin one to a gold pocket.
   • Inventory — tap his 📎 bag to see everything he carries.
   • Paste — click a pocket and it pours into the field you last used
     (or onto the clipboard if no field is focused).

   Later phases add: numbers→charts, fetch, tools, batch, transforms.
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
      this._pourAnimation(p.text, el);                 // letters arc out of his bag…
      setTimeout(() => {                               // …then the text lands in the field
        this._pasteInto(el, p.text);
        try { this.ctx.character.playEmote('point'); } catch {}
        try { this.ctx.ai?.speak('There you go! ✨', 2200); } catch {}
      }, 360);
    } else {
      this._pasteInto(null, p.text);                   // no field → clipboard
      try { this.ctx.character.playEmote('point'); } catch {}
      try { this.ctx.ai?.speak('Copied it for you — paste anywhere. 📋', 3000); } catch {}
    }
  }

  _validField(el) {
    return (el && el.isConnected && (el.matches?.('input, textarea') || el.isContentEditable)) ? el : null;
  }

  /** Soft little letters that fly out of EON's backpack and arc into the field. */
  _pourAnimation(text, el) {
    try {
      const start = this._bagPoint();
      const r = el.getBoundingClientRect();
      const end = { x: r.left + 14, y: r.top + Math.min(18, r.height / 2) };
      const chars = String(text).replace(/\s+/g, ' ').trim().slice(0, 14).split('');
      if (!chars.length || !start) return;
      const arc = Math.max(90, Math.min(230, Math.abs(end.x - start.x) * 0.32 + 100));   // how high it loops
      const cx = (start.x + end.x) / 2, cy = Math.min(start.y, end.y) - arc;             // control point above
      chars.forEach((ch, i) => {
        if (ch === ' ') return;
        const span = document.createElement('span');
        span.className = 'eon-pour'; span.textContent = ch;
        span.style.left = start.x + 'px'; span.style.top = start.y + 'px';
        document.body.appendChild(span);
        const frames = [];
        for (let s = 0; s <= 1.0001; s += 0.2) {
          const m = 1 - s;
          const x = m * m * start.x + 2 * m * s * cx + s * s * end.x;
          const y = m * m * start.y + 2 * m * s * cy + s * s * end.y;
          frames.push({
            transform: `translate(${x - start.x}px, ${y - start.y}px) scale(${s > 0.85 ? 0.55 : 1}) rotate(${i % 2 ? 10 : -8}deg)`,
            opacity: s < 0.08 ? 0 : (s > 0.9 ? 0 : 0.85),
          });
        }
        const anim = span.animate(frames, { duration: 700, delay: i * 52, easing: 'cubic-bezier(.45,.02,.5,1)', fill: 'forwards' });
        const kill = () => span.remove();
        anim.onfinish = kill;
        setTimeout(kill, 700 + i * 52 + 500);            // safety cleanup
      });
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
      .eon-pour{position:fixed;z-index:2147483640;font:600 12px/1 system-ui,sans-serif;
        color:rgba(20,24,40,.6);pointer-events:none;will-change:transform,opacity;text-shadow:0 1px 1px rgba(255,255,255,.5)}
      #eon-pockets .ep-row{display:flex;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid #eef1f7}
      #eon-pockets .ep-txt{flex:1;min-width:0;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#16203a;font-weight:600}
      #eon-pockets .ep-row:hover .ep-txt{color:#1f6dff}
      #eon-pockets .ep-pin,.ep-x{cursor:pointer;opacity:.55;font-size:13px}
      #eon-pockets .ep-pin:hover,.ep-x:hover{opacity:1}
      #eon-pockets .ep-pin.on{opacity:1;filter:drop-shadow(0 0 1px #C9A227)}
      #eon-pockets .ep-empty{padding:16px 12px;color:#8a96ad;font-weight:500;text-align:center}`;
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
    p.innerHTML = `<div class="ep-h">🎒 Backpack <span class="ep-clear">Clear</span><span class="ep-close" title="Close">✕</span></div><div class="ep-list"></div>`;
    document.body.appendChild(p);
    this._panel = p; this._list = p.querySelector('.ep-list');
    p.querySelector('.ep-clear').onclick = (e) => { e.stopPropagation(); this._clear(); };
    p.querySelector('.ep-close').onclick = (e) => { e.stopPropagation(); this._togglePanel(false); };
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
        <span class="ep-txt" title="Paste">${this._esc(this._short(p.text, 60))}</span>
        <span class="ep-x" title="Remove">✕</span>`;
      row.querySelector('.ep-txt').onclick = (e) => { e.stopPropagation(); this._paste(p); };
      row.querySelector('.ep-pin').onclick = (e) => { e.stopPropagation(); this._pin(p); };
      row.querySelector('.ep-x').onclick = (e) => { e.stopPropagation(); this._del(p); };
      this._list.appendChild(row);
    }
  }

  // ---------------- helpers ----------------
  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }
  _short(t, n = PREVIEW) { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  _esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  _load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; } }
  _save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.pockets.slice(0, MAX_POCKETS + 8))); } catch {} }
}
