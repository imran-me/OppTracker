/* ============================================================
   EON — physics.js  ·  "Play Physics"
   A tiny state model of how EON FEELS being handled. A few hidden
   meters (0–100) rise with rough handling and decay over time at
   different rates; his reactions are thresholds on those meters, so the
   same grab/spin lands differently depending on accumulated state — the
   tenth spin makes him woozy, the first is just funny.

   Meters:  dizzy (clears in seconds) · sick (medium) · temper (minutes)
            · trust (persisted — he remembers how you treat him)

   The dizzy → pass-out arc:
     <35 fine · 35–62 woozy · 62–90 very dizzy · ≥90 knocked out
   Recovery decays him back; spin the OTHER way and he "unwinds" faster.

   Pure add-on: it only adds reactions to physical input via the avatar's
   existing animation hooks (setStagger / setKnockedOut / playEmote /
   particles). His work, intelligence and abilities are untouched. Set
   ctx.play.enabled = false and EON behaves exactly as before.
   ============================================================ */

const TRUST_KEY = 'eon-trust';

export class PlayState {
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = true;
    this.dizzy = 0; this.sick = 0; this.temper = 0;
    this.trust = this._loadTrust();      // 0..100, persisted (50 = neutral)
    this.knockedOut = false;
    this._ko = 'none';                   // none | out | up
    this._heldMs = 0; this._impStage = 0;
    this._grabs = [];                    // recent grab timestamps (squeeze detection)
    this._spinNet = 0;
    this._nextStar = 0; this._nextBlip = 0; this._lastFlinch = 0; this._lastStretch = 0;
  }

  start() { if (typeof window !== 'undefined') window.EonPlay = this; }

  _owner() { try { return !!window.EonBrain?.isOwner?.(); } catch { return false; } }
  _loadTrust() { try { const v = +localStorage.getItem(TRUST_KEY); return Number.isFinite(v) && v > 0 ? v : 50; } catch { return 50; } }
  _saveTrust() { try { localStorage.setItem(TRUST_KEY, String(Math.round(this.trust))); } catch {} }
  _clamp(v) { return Math.max(0, Math.min(100, v)); }
  _head(dx = 0, dy = 0.7) { try { return this.ctx.character._worldHead(dx, dy); } catch { return null; } }
  _glyph(ch, dx = 0) { const p = this._head((Math.random() - 0.5) * 0.7 + dx, 0.5 + Math.random() * 0.4); if (p) try { this.ctx.particles?.emote(ch, p); } catch {} }
  _say(t, ms = 2400) { try { this.ctx.ai?.speak(t, ms); } catch {} }
  _emote(e) { try { this.ctx.character?.playEmote?.(e); } catch {} }
  _pick(a) { return a[(Math.random() * a.length) | 0]; }

  // ================= interaction inputs (from event-tracker) =================
  onGrab() {
    if (!this.enabled) return;
    const now = performance.now();
    this._grabs = this._grabs.filter(t => now - t < 2500); this._grabs.push(now);
    if (this.knockedOut) return;
    this._heldMs = 0; this._impStage = 0;
    if (this._grabs.length >= 3) {                         // repeated grabbing → annoyed
      this.temper = this._clamp(this.temper + 14); this._adjustTrust(-1.5);
      this._glyph('💢'); this._emote('grumpy'); this._say(this._pick(['Hey! Quit it. 😤', 'Stop poking me!']));
    } else {
      this._emote('held'); this._glyph('❗'); this._say(this._pick(['Whoa! 😳', 'Hey— careful!', 'Up we go…']));
    }
  }
  /** Signed angular delta (radians) of the drag around his body → dizziness. */
  onSwirl(dAngle) {
    if (!this.enabled || !dAngle) return;
    this._spinNet = this._spinNet * 0.85 + dAngle;
    const sameDir = this._spinNet === 0 || Math.sign(dAngle) === Math.sign(this._spinNet);
    const mag = Math.min(0.7, Math.abs(dAngle));
    this.dizzy = this._clamp(this.dizzy + mag * 14 * (sameDir ? 1 : -0.9));   // opposite spin "unwinds"
    this.sick = this._clamp(this.sick + mag * 6);
  }
  /** Fast yank while dragging → elastic stretch. */
  onYank(speed) {
    if (!this.enabled || this.knockedOut) return;
    const now = performance.now();
    if (speed > 2.2 && now - this._lastStretch > 700) { this._lastStretch = now; this._emote('stretchY'); this._glyph('💨'); }
  }
  /** Released. speed = pointer speed at release (px/ms). */
  onDrop(speed) {
    if (!this.enabled) return;
    this._heldMs = 0; this._impStage = 0;
    if (this.knockedOut) return;
    if (speed > 2.6) {                                     // hard fling / slam
      this.temper = this._clamp(this.temper + 22); this.dizzy = this._clamp(this.dizzy + 16); this._adjustTrust(-3);
      this._emote('jump'); this._glyph('💫'); this._say(this._pick(['Wheeee— ow! 😵', 'RUDE. 😠', 'Boing!']));
    } else if (speed > 0.9) {                              // a proper drop
      this._adjustTrust(-0.5); this._glyph('💢'); this._say(this._pick(['Oof. Rude. 😒', 'A little gentler?']));
    }
  }
  /** Gentle upward toss / kind handling → he loves it. */
  onGentle() {
    if (!this.enabled || this.knockedOut) return;
    this._adjustTrust(2); this.temper = this._clamp(this.temper - 8);
    this._emote('cheer'); this._glyph('💖'); this._say(this._pick(['Wheee! 😄', 'Hehe, again!', 'I trust you. 🥰']));
  }
  /** Poke / double-click → snap him out of it faster. */
  revive() {
    if (!this.enabled) return;
    this.dizzy = Math.max(0, this.dizzy - 45); this.sick = Math.max(0, this.sick - 40);
    if (this.knockedOut && this.dizzy < 70) { this._wakeUp(); }
  }

  // ================= per-frame =================
  update(dt) {
    if (!this.enabled) { if (this.knockedOut) this._wakeUp(); return; }
    const owner = this._owner();
    const rec = owner ? 1.7 : 1;                            // owner recovers faster

    // decay (different rates — the "real little creature" feel)
    this.dizzy = Math.max(0, this.dizzy - 16 * rec * dt);
    this.sick = Math.max(0, this.sick - 11 * rec * dt);
    this.temper = Math.max(0, this.temper - 1.6 * rec * dt);
    this._spinNet *= (1 - Math.min(1, dt * 2));
    this.trust += (50 - this.trust) * 0.0008 * dt * 60;     // trust drifts slowly to neutral

    // being held too long → impatience escalates
    if (this.ctx.drag?.active && !this.knockedOut) {
      this._heldMs += dt * 1000;
      if (this._heldMs > 3000 && this._impStage < 1) { this._impStage = 1; this._emote('lookWatch'); this._say('You gonna put me down or…? ⏱️'); }
      else if (this._heldMs > 6000 && this._impStage < 2) { this._impStage = 2; this.temper = this._clamp(this.temper + 10); this._emote('grumpy'); this._glyph('💢'); this._say('Seriously. Down. Now. 😤'); }
    }

    // ---- knocked-out arc ----
    if (this.knockedOut) {
      if (Math.random() < dt * 1.4) this._glyph(this._pick(['💫', '🐦', '⭐', '💤']));
      if (this.dizzy < (owner ? 38 : 24)) this._wakeUp();   // recovered enough → get up
      return;
    }

    // ---- pass-out threshold (owner working = he resists going fully out) ----
    const koAt = (owner && this.ctx.focus) ? 999 : 90;
    if (this.dizzy >= koAt) { this._knockout(); return; }

    // ---- dizzy stagger (woozy → very dizzy) ----
    const stagger = this.dizzy < 35 ? 0 : Math.min(1, (this.dizzy - 35) / 55);
    try { this.ctx.character?.setStagger?.(stagger); } catch {}
    if (stagger > 0) {
      const now = performance.now();
      if (now > this._nextStar) {
        this._nextStar = now + (this.dizzy > 62 ? 280 : 700);
        this._glyph(this.dizzy > 62 ? this._pick(['💫', '😵', '⭐']) : '💫');
      }
      if (now > this._nextBlip) {
        this._nextBlip = now + 3200;
        this._say(this.dizzy > 62 ? this._pick(['I caaan\'t walk straight… 🥴', 'whoa whoa whoa 😵‍💫']) : this._pick(['whoa, hey… 😵', 'I\'m fiiine… 🌀']));
      }
      if (this.sick > 55 && Math.random() < dt * 0.8) this._glyph('🤢');
    }

    // ---- grumpy (temper) ----
    this.grumpy = this.temper >= 58;
    if (this.grumpy && Math.random() < dt * 0.25) { this._emote('grumpy'); this._glyph('💢'); }
  }

  _knockout() {
    this.knockedOut = true; this._ko = 'out';
    try { this.ctx.character?.setStagger?.(0); this.ctx.character?.setKnockedOut?.(true); } catch {}
    this._adjustTrust(-2);
    this._glyph('💫'); this._glyph('🐦', 0.3); this._glyph('⭐', -0.3);
    this._say(this._pick(['…out cold. 😵', 'x_x', 'urgh… *thud*']), 3000);
    try { const p = this._head(0.2, 0.6); if (p) this.ctx.particles?.zzz(p); } catch {}
  }
  _wakeUp() {
    this.knockedOut = false; this._ko = 'none';
    this.dizzy = Math.min(this.dizzy, 30); this.sick = Math.min(this.sick, 20);
    try { this.ctx.character?.setKnockedOut?.(false); this.ctx.character?.setState?.('wakeUp'); } catch {}
    this._glyph('💫');
    this._say(this._pick(['ugh… my head. 😖', 'what… happened? 🥴', '*shakes head* …rude.']), 3200);
  }

  _adjustTrust(d) { this.trust = this._clamp(this.trust + d); this._saveTrust(); }
}
