# EON Brain — Firebase edition (free, no server)

EON's mind, running **100% in your browser** on the Firebase you already use.
No PHP, no SQL, no hosting, no cost. He reads your data, learns it, watches your
deadlines, raises reminders, and stores **his own brain in Firestore**.

> The portable **PHP/SQL** version (generic DB connector, for a future hosted EON
> that connects to any system) is kept safely at `E:\Imran\Eon\ai-companion\eon-brain`.
> This folder is the Firebase adapter that fits *this* site.

---

## How it works
- **Reads your data** — your whole dataset is one Firestore doc (`opptrack/data`).
  EON reads it and **auto-discovers** your entities (opportunities, tasks, …),
  detecting each one's **date/deadline** field and a human **label** — no manual list.
- **Scans deadlines** — anything inside the warning windows (`[7,3,1,0]` days, plus
  overdue) becomes an alert with a label, urgency, and a **`pointTo`** link.
- **Reminders** — you can add manual reminders; deadlines auto-raise them too.
  Snooze / dismiss / seen all supported, de-duplicated.
- **Stores his brain in Firestore** — under a separate `eon-brain/brain` doc
  (never mixed with your data).
- **Meditation state** — publishes `idle → meditating → reading-section → insight`
  + progress, for the avatar's meditation animation (next step).

### Owner vs viewer (free-tier rules)
- **You (owner, signed in):** EON computes and **writes** his brain to Firestore.
- **Visitors (read-only):** they just **read** the brain you computed. Their browsers
  never try to write (your Firestore rules are public-read, owner-write).
- **Runs while the site is open.** With no server, EON meditates when a page is open
  (throttled to once per interval). Always-on background scanning comes when EON
  later moves to your paid server.

---

## Files
```
eon-brain/
├── eon-brain.js     # bootstrap: waits for Firebase, starts the brain, window.EonBrain
├── brain.js         # engine: cycle, deadline scan, reminders, state, Firestore persistence
├── discovery.js     # auto-discovers entities + date/deadline/label fields from your data
├── config.js        # windows, interval, owner email, link patterns, overrides
└── README.md
```
It's already embedded on every page:
`<script type="module" src="./ai-companion/eon-brain/eon-brain.js"></script>`

---

## The avatar consumes it via `window.EonBrain`
```js
window.EonBrain.getState();    // { state, progress, section, message, pointTo }
window.EonBrain.getAlerts();   // [{ type, label, urgency, dueAt, pointTo, status }]
window.EonBrain.createReminder({ title, remindAt: '2026-07-01T09:00', link });
window.EonBrain.snooze(id, 30);  window.EonBrain.dismiss(id);  window.EonBrain.markSeen(id);
window.EonBrain.meditate();    // run a cycle now (e.g. to show the animation)
```
Wiring these into the 3D meditation visuals (sit, glow, light streaming in, float
over and point at `pointTo`) is the next, separate step — the avatar code is
untouched for now.

---

## One thing to check in Firebase
EON writes to a new `eon-brain` collection. Your Firestore security rules already
allow the owner to write and everyone to read if they use a wildcard like:
```
match /{document=**} {
  allow read: if true;
  allow write: if request.auth != null && request.auth.token.email == 'me.imran.personal@gmail.com';
}
```
If your rules are per-collection instead, add the same allowance for `eon-brain`.

---

## Configure
Edit `config.js`: `windows`, `intervalMs`, `linkPatterns` per entity, and
`overrides` if auto-detection ever needs correcting. To connect a *different*
Firestore data shape later, this `discovery.js` is the only adapter to adjust.
