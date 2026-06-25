/* ============================================================
   EON Brain (Firebase edition) — configuration.
   Runs 100% in the browser on your existing Firebase. No server,
   no SQL, no localStorage. EON reads your data and stores his own
   brain in Firestore.
   ============================================================ */

export const BRAIN_CONFIG = {
  // ── Where YOUR data lives (read-only). The whole dataset is one doc. ──
  sourceCollection: 'opptrack',
  sourceDoc: 'data',
  // The doc wraps the dataset under this field (OppTrack saves { store: {...} }).
  // Set to '' if your entities sit at the top level of the doc.
  sourceRoot: 'store',

  // ── Where EON stores HIS brain (separate area; owner-only write). ──
  brainCollection: 'eon-brain',
  brainDoc: 'brain',

  // Only this account may write EON's brain (matches your Firestore rules).
  // Falls back to window.OWNER_EMAIL when present.
  ownerEmail: (typeof window !== 'undefined' && window.OWNER_EMAIL) || 'me.imran.personal@gmail.com',

  // ── Which entities actually have an actionable deadline. Everything else
  //    (achievements, projects, research, training, volunteering, contacts…)
  //    carries historical/award dates that must NEVER be nagged as deadlines. ──
  deadlineEntities: ['opportunities', 'tasks', 'reminders'],

  // ── Deadline warning windows, in days (descending). ──
  windows: [7, 3, 1, 0],

  // One meditation cycle cadence (ms) while the site is open.
  intervalMs: 15 * 60 * 1000,
  // brief pause between sections so the avatar can "read" each one
  meditationPauseMs: 450,
  // how long the insight lingers after a cycle (ms)
  insightLingerMs: 90 * 1000,

  // Where to point the avatar for a given entity. Placeholders: {entity} {id} {label}
  linkPatterns: {
    opportunities: 'opportunity-details.html?id={id}',
    tasks:         'tasks.html',
    documents:     'documents.html',
    achievements:  'achievements.html',
    training:      'training.html',
    volunteering:  'volunteering.html',
    research:      'research.html',
    projects:      'projects.html',
    contacts:      'contacts.html',
    default:       '{entity}.html',
  },

  // Optional manual overrides when auto-detection needs a nudge:
  // entity => { deadlineField, labelField }
  overrides: {
    // opportunities: { deadlineField: 'deadline', labelField: 'name' },
  },
};
