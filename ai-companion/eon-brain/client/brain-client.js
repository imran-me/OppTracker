/* ============================================================
   EON Brain — tiny front-end client.
   The avatar CONSUMES the brain through this; it does not think.
   Wire the meditation visuals to these results later (the avatar
   code itself stays untouched until you choose to integrate).

   Usage:
     import { EonBrainClient } from './eon-brain/client/brain-client.js';
     const brain = new EonBrainClient('/ai-companion/eon-brain/api/index.php');
     const { state } = await brain.getState();   // drive meditation UI
     const { alerts } = await brain.getAlerts();  // float over + point at pointTo
   ============================================================ */

export class EonBrainClient {
  /** @param {string} base e.g. '/ai-companion/eon-brain/api/index.php' (or '/eon' if rewritten) */
  constructor(base) { this.base = base.replace(/\/$/, ''); }

  async _get(path) {
    const r = await fetch(this.base + path, { cache: 'no-store' });
    return r.json();
  }
  async _post(path, body) {
    const r = await fetch(this.base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }

  /** Learning lifecycle + progress → drives the meditation animation. */
  getState() { return this._get('/state'); }

  /** Active alerts/reminders, urgency-sorted; each has { label, urgency, pointTo }. */
  getAlerts() { return this._get('/alerts'); }

  markSeen(id)            { return this._post(`/alerts/${encodeURIComponent(id)}/seen`); }
  snooze(id, minutes = 30){ return this._post(`/alerts/${encodeURIComponent(id)}/snooze`, { minutes }); }
  dismiss(id)             { return this._post(`/alerts/${encodeURIComponent(id)}/dismiss`); }

  createReminder({ title, note, remind_at, link }) {
    return this._post('/reminders', { title, note, remind_at, link });
  }

  /** Optional: ask EON to meditate now (e.g. to show the animation on demand). */
  meditate() { return this._post('/meditate'); }
}

/* ---- Example: poll state to drive the avatar's meditation (sketch only) ----
   const brain = new EonBrainClient('/ai-companion/eon-brain/api/index.php');
   setInterval(async () => {
     const { state } = await brain.getState();
     // state.state ∈ idle | meditating | reading-section | insight
     // state.progress ∈ 0..1 ; state.section = table being read
     // when 'insight': window.EON?.character?.setState('thinking');
     //   show state.message, and float EON to point at state.pointTo
   }, 4000);
*/
