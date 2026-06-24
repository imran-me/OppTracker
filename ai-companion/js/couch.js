/* ============================================================
   EON — couch.js
   A cosy couch in EON's corner (its own little module — nothing 3D,
   nothing that touches the avatar). When it's on, the REAL EON goes
   and sits ON it during his normal idle "go home" moments. It exposes
   the seat's screen point so the avatar can rest on the cushion
   (on top of it, never inside it).

   Public:  start() · show(on) · setSize(scale) · seatScreen()
   ============================================================ */

// where EON's contact point should land on the couch, as fractions of
// the couch's on-screen box (tweak these to seat him perfectly).
const SEAT_X = 0.5;
const SEAT_Y = 0.62;

export class Couch {
  constructor() { this._on = false; this._scale = 1; }

  start() { this._inject(); this._build(); }

  _inject() {
    if (document.getElementById('eon-couch-style')) return;
    const s = document.createElement('style'); s.id = 'eon-couch-style';
    s.textContent = `
      #eon-couch{position:fixed;right:26px;bottom:34px;width:300px;height:188px;pointer-events:none;
        z-index:2147482500;opacity:0;transform-origin:bottom right;transition:opacity .4s ease;}
      #eon-couch.show{opacity:1;}
      #eon-couch svg{width:100%;height:100%;display:block;filter:drop-shadow(0 14px 18px rgba(16,34,94,.22));}`;
    document.head.appendChild(s);
  }

  _build() {
    if (document.getElementById('eon-couch')) { this.el = document.getElementById('eon-couch'); return; }
    const el = document.createElement('div'); el.id = 'eon-couch'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <svg viewBox="0 0 300 188" xmlns="http://www.w3.org/2000/svg">
        <!-- legs -->
        <rect x="40" y="158" width="16" height="22" rx="5" fill="#7a4a26"/>
        <rect x="244" y="158" width="16" height="22" rx="5" fill="#7a4a26"/>
        <!-- back cushions -->
        <rect x="58" y="28" width="184" height="92" rx="20" fill="#1f6dff"/>
        <rect x="66" y="34" width="84" height="80" rx="16" fill="#2f8bff"/>
        <rect x="150" y="34" width="84" height="80" rx="16" fill="#2f8bff"/>
        <!-- base -->
        <rect x="34" y="96" width="232" height="70" rx="20" fill="#10225e"/>
        <!-- seat cushions -->
        <rect x="56" y="104" width="92" height="44" rx="14" fill="#28c7d8"/>
        <rect x="152" y="104" width="92" height="44" rx="14" fill="#28c7d8"/>
        <!-- armrests -->
        <rect x="26" y="78" width="40" height="86" rx="16" fill="#1f6dff"/>
        <rect x="234" y="78" width="40" height="86" rx="16" fill="#1f6dff"/>
        <rect x="30" y="82" width="32" height="30" rx="12" fill="#2f8bff"/>
        <rect x="238" y="82" width="32" height="30" rx="12" fill="#2f8bff"/>
        <!-- accent pillow -->
        <rect x="196" y="70" width="46" height="46" rx="12" fill="#7ed957" transform="rotate(12 219 93)"/>
      </svg>`;
    document.body.appendChild(el);
    this.el = el;
  }

  show(on) { this._on = !!on; this.el?.classList.toggle('show', this._on); }
  setSize(scale) { this._scale = scale; if (this.el) this.el.style.transform = `scale(${scale})`; }

  /** Screen point where EON should sit (on the cushion). null if hidden. */
  seatScreen() {
    if (!this.el || !this._on) return null;
    const r = this.el.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width * SEAT_X, y: r.top + r.height * SEAT_Y };
  }
}
