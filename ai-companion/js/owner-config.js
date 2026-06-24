/* ============================================================
   EON — owner-config.js
   Single source of truth for who EON works for, the discovery
   "hooks" he can lead visitors to, and any public announcements.
   EON's dialogue always pulls the owner's name from here.

   Rule: the display name is "Imran" — never the formal "Md." prefix.
   ============================================================ */

export const OWNER = {
  // Display name EON uses everywhere. Strip any "Md." styling.
  name: 'Imran',
  // How EON refers to him warmly.
  boss: 'my boss Imran',
  bossShort: 'my boss',
  // A few proud, pre-loaded facts EON can speak to (kept generic so they
  // stay true as content changes; specific titles are read live from the DOM).
  knows: [
    'builds AI, software and data projects',
    'has a wall of wins, scholarships and certifications',
    'does real research, not just talk',
    'turns ideas into things that ship',
  ],
};

/** Replace formal styling like "Md. Imran ..." → "Imran". */
export function ownerFirstName(raw) {
  if (!raw) return OWNER.name;
  const cleaned = String(raw).replace(/^\s*(md\.?|mohammad|muhammad|mohammed)\s+/i, '').trim();
  const first = cleaned.split(/\s+/)[0];
  return first || OWNER.name;
}

/* Discovery hooks — the "wanna see?" engine pulls from these. EON prefers a
   hook on a DIFFERENT page than the visitor is on, so he can LEAD them there.
   page    : where it lives
   selector: what to land on / point at once there
   teaser  : the offer line  ({name} = owner name)
   land    : what he says on arrival                                         */
export const HOOKS = [
  { id: 'project',     page: 'projects.html',     selector: '.gal-grid',
    teaser: 'Did you know {name} is building some seriously cool projects? Want to see one?',
    land:   "Here it is — one of {name}'s projects. Impressive, right? 🚀" },
  { id: 'achievement', page: 'achievements.html', selector: '.gal-grid',
    teaser: "There's something {name} is really proud of. Want a look?",
    land:   '{name} earned every bit of this. 🏆' },
  { id: 'profile',     page: 'profile.html',      selector: '#pfPhoto',
    teaser: 'Curious who {name} really is? I can show you.',
    land:   "That's the man himself — {name}. 😎" },
  { id: 'research',    page: 'research.html',      selector: '.stack-16, .page-wrap',
    teaser: '{name} does some big-brain research. Wanna peek?',
    land:   "Big-brain stuff — this is {name}'s research. 🧠" },
  { id: 'wins',        page: 'profile.html',       selector: '#wins',
    teaser: '{name} has a whole wall of wins. Want to see?',
    land:   'Win after win after win. 🥇' },
  { id: 'contact',     page: 'profile.html',       selector: '#contact',
    teaser: 'Liking what you see? I can show you how to reach {name}.',
    land:   'Right here — go on, say hi to {name}! 📬' },
];

/* Public announcements — owner-set, surfaced in-character at the right time.
   Leave empty for none. Example shape:
   { id, text, pages: ['*'] | ['profile','projects'], until: '2026-12-31' }   */
export const ANNOUNCEMENTS = [
  // { id: 'open-to-work', text: '{name} is open to new opportunities right now! 🚀', pages: ['*'] },
];
