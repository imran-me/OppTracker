/* ============================================================
   EON Brain (Firebase edition) — bootstrap.
   Drop-in: <script type="module" src="./ai-companion/eon-brain/eon-brain.js"></script>
   It waits for your Firebase (already loaded on every page), starts
   the brain, and exposes window.EonBrain for the avatar to consume:

     window.EonBrain.getState()    // meditation lifecycle + progress
     window.EonBrain.getAlerts()   // deadline alerts + due reminders
     window.EonBrain.createReminder({ title, remindAt, link })
     window.EonBrain.snooze(id, 30) / .dismiss(id) / .markSeen(id)
     window.EonBrain.meditate()    // run a cycle now
   ============================================================ */

import { Brain } from './brain.js';
import { BRAIN_CONFIG } from './config.js';

async function waitForFirebase(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore && window.firebase.apps?.length) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

(async () => {
  if (window.EonBrain) return;                       // already running on this page
  const ok = await waitForFirebase();
  if (!ok) { console.warn('[EON brain] Firebase not available — brain idle.'); return; }
  try {
    const brain = new Brain(BRAIN_CONFIG);
    window.EonBrain = brain;
    await brain.start();
  } catch (e) {
    console.warn('[EON brain] failed to start:', e);
  }
})();
