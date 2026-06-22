# OppTrack — Personal Opportunity, Achievement, Project & Activity Management System

A complete, cloud-synced personal dashboard **and** public portfolio for managing
scholarships, fellowships, competitions, hackathons, tasks, documents, achievements,
contacts, research and projects. Data syncs live across all your devices via Firebase.

Built for **Md Imran Hossain** — B.Sc. in Computing & Information System,
Daffodil International University.

- **100% frontend** — HTML5, CSS3, Bootstrap 5, Vanilla JavaScript
- **No build step** — runs by opening `index.html`
- **Live multi-device sync** via **Firebase Firestore** (Local Storage kept as an offline cache) + JSON export/import for backup
- **Owner-only editing** enforced server-side by **Firebase Authentication** + Firestore security rules
- **GitHub Pages ready** — free hosting

---

## Quick start (run locally)

You can simply **double-click `index.html`** and it works.

For the smoothest experience (so all relative links behave exactly like on the web),
run a tiny local server from the project folder:

```bash
# Option A — Python (already on most systems)
python3 -m http.server 8000
# then open http://localhost:8000

# Option B — Node
npx serve .
```

> Sample data loads on first run. Viewing works anywhere; **owner login + editing needs a
> served origin** (e.g. `http://localhost:8000`, not a `file://` double-click) because
> Firebase Authentication requires an `http(s)` domain that is in your Firebase **Authorized
> domains** list. Edits then save to Firestore and sync to every device automatically.

---

## File structure

```text
/
├── index.html              # Landing / entry page + live snapshot
├── dashboard.html          # Module 1 — summary cards, alerts, calendar, quick actions
├── opportunities.html      # Module 2 — opportunity list with search/filter/sort
├── opportunity-details.html# Single opportunity: full record + timeline + linked tasks
├── tasks.html              # Module 3 — Kanban task board (drag & drop)
├── documents.html          # Module 4 — document tracker (status, expiry, links)
├── achievements.html       # Module 5 — achievement gallery
├── contacts.html           # Module 6 — contacts & network
├── research.html           # Module 7 — research hub
├── projects.html           # Module 8 — project management
├── categories.html         # Module 9 — master category settings (feeds all dropdowns)
├── profile.html            # Module 10 — public portfolio (about, stats, showcase)
│
├── login.html              # Owner login page (password gate)
├── owner.html              # Owner Dashboard — secure content-management hub
│
├── assets/
│   ├── css/style.css           # One centralized stylesheet (design system + components + login UI)
│   ├── js/app.js               # One centralized engine (data layer, UI, all page logic)
│   ├── js/firebase-config.js   # Firebase project config + init; sets OWNER_EMAIL + the Firestore doc
│   ├── js/security.js          # Owner-only access control via Firebase Auth: login, guards, UI gating
│   └── img/favicon.svg         # Brand mark; drop profile/achievement images here too
│
├── data/
│   └── backup-guide.md     # Export / import + Google Drive backup workflow
│
├── .nojekyll               # Tells GitHub Pages to serve files as-is
└── README.md
```

---

## How the architecture works (for future edits)

The project keeps **one CSS file and one JS file** as required. To avoid repeating the
sidebar and top bar in twelve files, each page contains only its own content plus two
empty placeholders:

```html
<body data-page="dashboard" class="app-shell">
  <aside id="sidebar" class="sidebar"></aside>   <!-- filled by app.js -->
  <header id="topbar" class="topbar"></header>   <!-- filled by app.js -->
  ...page content with the IDs that app.js looks for...
</body>
```

On load, `app.js` reads `data-page`, renders the shared sidebar + top bar, then runs the
matching page initializer (e.g. `initDashboard`).

**Where to change things:**

| You want to…                                   | Edit this                                            |
|------------------------------------------------|------------------------------------------------------|
| Add/rename a dropdown option                   | The **Category Manager** page (saved live), or `DEFAULT_CATEGORIES` in `app.js` |
| Add/rename a field on a form                   | The `SCHEMAS` object in `app.js` (one place drives every Add/Edit form) |
| Change colours, spacing, fonts                 | The **Design Tokens** section at the top of `style.css` |
| Change the sample data                         | The `SEED_DATA()` function at the bottom of `app.js` |
| Add a navigation link                          | The `NAV` array in `app.js`                          |

**Data storage:** the whole store lives in one **Firestore document** (`opptrack/data`),
read by every device for live sync. A copy is also kept under the Local Storage key
`pomls_data_v1` as an offline cache / instant first paint. The data layer (`DB` in
`app.js`) writes both: `DB._persistLocal()` (cache) and `DB._persistCloud()` (Firestore).
Firebase project config lives in `assets/js/firebase-config.js`.

---

## Owner-Only Management System (security) 🔐

The site is **public to view** and **owner-only to manage**. Anyone with the link can
browse, search, filter and read everything. Only the signed-in owner can add, edit,
delete, archive, manage categories, import, reset or change the profile.

> **⚡ Now backed by Firebase.** Sign-in uses **Firebase Authentication** (the single
> owner account set in `OWNER_EMAIL`, `assets/js/firebase-config.js`) and writes are
> enforced by **Firestore security rules** on the server — so unauthorized edits are
> rejected no matter what the browser does. This is real, server-enforced ownership,
> not just the cosmetic client gate the section below originally described. The login
> UI and guards still live in **`assets/js/security.js`**; data sync lives in `DB`
> (`app.js`) + `assets/js/firebase-config.js`.
>
> **Firestore security rule** (paste in Firebase Console → Firestore → Rules):
> ```
> rules_version = '2';
> service cloud.firestore {
>   match /databases/{database}/documents {
>     match /opptrack/data {
>       allow read: if true;                                              // public can view
>       allow write: if request.auth != null
>                    && request.auth.token.email == 'me.imran.personal@gmail.com';  // only the owner can edit
>     }
>   }
> }
> ```

### How it works

| Layer | What it does | Where |
|-------|--------------|-------|
| **Authentication** | **Firebase Authentication** email/password sign-in. The owner is the single account whose email equals `OWNER_EMAIL`. Firebase keeps the session signed in across reloads/devices; brute-force throttling is handled by Firebase itself. | `security.js` → `login()` / `init()` |
| **Authorization (server)** | The real wall: **Firestore security rules** allow public *read* but permit *write* only when `request.auth.token.email` equals the owner email. Rejected on Google's servers, so dev-tools / console writes fail no matter what the browser does. | Firestore Console → Rules |
| **UI gating** | `<body>` gets `owner-mode` or `viewer-mode`. Every management control is marked `.owner-only` and hidden from visitors by CSS. `viewer-mode` is baked into each page's `<body>` so admin controls **never flash** before JS runs. | `style.css` §22, `applyMode()` |
| **Action guards** | Every data-mutation (`DB.save/upsert/remove/importJSON/resetAll`, add/edit modal, delete, drag-to-move, reminders, category add/remove, profile edit) calls `Security.guard()` first. This is a client-side UX gate; the server rules above are what actually enforce it. | `app.js` (search “Security.guard”) |
| **Page protection** | Owner-only pages (`owner.html`, `categories.html`, listed in `Security.PROTECTED_PAGES`) **redirect** non-owners to the login page. | `requireOwner()` |
| **Session control** | Owner badge + **Log out** appear in the top bar / nav; the Owner Dashboard shows the signed-in account. | `renderAuthControl()` |

### 🔑 Setting / changing the owner account

The owner is one Firebase Authentication user. To change who can edit:

1. **Firebase Console → Authentication → Users** — add (or edit) the user, e.g.
   `me.imran.personal@gmail.com` with a password.
2. Set the same email as **`OWNER_EMAIL`** in `assets/js/firebase-config.js`.
3. Set the same email in the **Firestore security rule** (`request.auth.token.email == '…'`).
4. Save / redeploy. To change just the password, use **Authentication → Users** (or the
   "reset password" email) — no code change needed.

> The Firebase **config values** in `firebase-config.js` (apiKey, projectId, …) are safe to
> be public; they only identify the project. Edit power comes solely from the security rule.

### Signing in / out

- Click **Owner login** (top bar, landing page, or portfolio nav) → `login.html`.
- Sign in with the owner email + password → you land on the **Owner Dashboard**
  (`owner.html`): content counts, management links, quick-add, backup/restore, danger zone.
- Click the **log-out** icon to end the session immediately (do this on shared devices).

### ✅ Security note — this is server-enforced

Because data now lives in **Firestore** (not just the browser) and writes are gated by
**Firebase security rules**, owner-only editing is enforced on the server:

- A visitor can **read** everything but **cannot write** — the server rejects it, even from
  the dev-tools console or a hand-crafted request.
- Whatever the owner saves is the single shared copy every visitor sees.

The one thing that ships publicly is the Firebase config (harmless) — never put secrets in
client code; the security rule is the protection.

---

## Modules at a glance

1. **Dashboard** — auto summary cards, notifications, deadline alerts (30/14/7/3-day colour bands), calendar with reminders, quick actions.
2. **Opportunities** — full tracking with type, sub-type, priority, 16 statuses, dates, and automatic days-remaining / overdue countdowns.
3. **Task Board** — Kanban (To Do → Cancelled) with drag-and-drop and opportunity-linked or independent tasks.
4. **Documents** — passport, NID, CV, SOP, MOI, transcripts… with status, expiry and Drive links.
5. **Achievements** — gallery of awards, certifications and leadership roles.
6. **Contacts** — professors, mentors, alumni and industry contacts.
7. **Research Hub** — ideas, problem statements, references and stage.
8. **Projects** — idea → completed, with tech stack and team.
9. **Category Manager** — edit every dropdown list; changes apply system-wide instantly.
10. **Portfolio** — public about/stats/showcase page generated from your data.
11. **Owner Dashboard** — *(owner only)* secure hub: content counts, management links, quick-add, backup/restore and reset.

---

## Deploy to GitHub Pages (free)

1. Create a new repository on GitHub, e.g. `opportunity-manager`.
2. Upload **all files and folders** from this project (keep the structure intact).
   - Using the web UI: *Add file → Upload files →* drag the whole folder contents.
   - Or with Git:
     ```bash
     git init
     git add .
     git commit -m "OppTrack initial deploy"
     git branch -M main
     git remote add origin https://github.com/<your-username>/opportunity-manager.git
     git push -u origin main
     ```
3. On GitHub: **Settings → Pages**.
4. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: `main` / `(root)`**, then **Save**.
5. Wait ~1 minute. Your site is live at:
   `https://<your-username>.github.io/opportunity-manager/`

The included `.nojekyll` file ensures GitHub serves every file untouched.

> **Note on data:** records now **sync automatically across devices** via Firebase Firestore
> (see the *Firebase live sync* section). For the live site to work you must publish the
> Firestore security rules and add your Pages domain to Firebase **Authorized domains**.
> Export/Import JSON (top-bar cloud icon) still works as a manual backup.

---

## Backup & restore

Open the **cloud icon** in the top bar:

- **Export full backup (JSON)** — downloads everything as a dated `.json` file.
- **Import backup** — restores from a previously exported `.json`.
- **Reset to sample data** — wipes local data back to the demo records.

Full Google Drive workflow: see [`data/backup-guide.md`](data/backup-guide.md).

---

## Firebase live sync — how it's set up (already configured)

This site uses **Firebase Firestore** for live, cross-device data sync and **Firebase
Authentication** for owner login. Everything below is already wired into the code; this
section documents how it works and how to reproduce it on a fresh Firebase project.

### What was done (architecture)

- **One Firestore document holds everything.** The entire store (opportunities, tasks,
  profile, categories, …) is saved as a single document at **`opptrack/data`**. Every
  device reads this same document, so they all show identical content.
- **Local Storage is now just a cache.** `pomls_data_v1` is still written on every save,
  but only for instant first paint and offline fallback. Firestore is the source of truth.
- **`DB` (in `app.js`) was rewired** — the rest of the app was untouched because every page
  already reads/writes through `DB`:
  - `DB.loadLocal()` — instant paint from the cache.
  - `DB.loadCloud()` — fetches the authoritative copy from Firestore on startup.
  - `DB.subscribe()` — a Firestore `onSnapshot` listener that pushes changes from other
    devices live and re-renders the page (it pauses while an edit modal is open).
  - `DB.save()` → `DB._persistLocal()` (cache) **and** `DB._persistCloud()` (Firestore),
    automatically, on every change. No manual "sync" step.
- **Sync indicator** — a small bottom-left pill (`setSync()` in `app.js`, styled in
  `style.css` §23) shows **Saving… → Synced** on owner edits, **Updated** when a remote
  change arrives, or **Sync failed** on error.
- **Login is Firebase Auth** (`security.js`), locked to the single `OWNER_EMAIL`. The old
  client-side hashed-password gate was removed.
- **Firebase loads via the compat CDN SDK** (no build step). These tags were added to every
  page, before `security.js`:
  ```html
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
  <script src="./assets/js/firebase-config.js"></script>
  ```

### One-time Firebase Console setup

1. **Create a project** at <https://console.firebase.google.com> → add a **Web app** (`</>`).
   Copy the `firebaseConfig` object into `assets/js/firebase-config.js`.
2. **Authentication → Sign-in method:** enable **Email/Password**.
3. **Authentication → Users → Add user:** create the owner (email + password). Put that same
   email in `OWNER_EMAIL` (`firebase-config.js`) and in the security rule (below).
4. **Authentication → Settings → Authorized domains:** add your GitHub Pages domain
   (e.g. `your-username.github.io`) so sign-in works on the live site.
5. **Firestore Database → Create database** (production mode), then **Rules tab → paste →
   Publish:**
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /opptrack/data {
         allow read: if true;                                              // public can view
         allow write: if request.auth != null
                      && request.auth.token.email == 'me.imran.personal@gmail.com';  // only the owner can edit
       }
     }
   }
   ```

### First run & good-to-know

- **First owner login seeds the cloud.** The Firestore document starts empty; the first
  time the owner loads/saves, the app copies *that device's* current data up as the master.
  Do your first owner login on the device that already holds your real data.
- **1 MB document limit.** Firestore caps a single document at ~1 MiB. Many base64-uploaded
  images/PDFs can approach it (the app warns near the limit) — prefer Drive/download links
  for large files, or graduate uploads to **Firebase Storage** (also free) later.
- **Free tier** (Spark plan) limits are far beyond a personal site's needs.

Other backends if you ever outgrow Firestore: **Supabase** (Postgres + auth) or a private
backend. Avoid a GitHub Gist + token on a public site — the write token would be exposed.

---

## Google Drive auto-backup (safety net)

On top of Firebase, the whole dataset is also mirrored to **one file in a dedicated folder**
in the owner's Google Drive — `My Drive / OppTracker Backups / opptrack-backup.json` —
updated automatically on every save. Firebase stays the live copy the site reads/displays;
Drive is a **backup** you can download anytime, so if Firebase ever fails you still have a
current copy to **Import backup** from. (The folder is created automatically on first backup;
a file left in the root from earlier is moved into it.)

### How it works (`assets/js/drive.js`)

- Uses **Google Identity Services** for a short-lived OAuth token with the least-privilege
  **`drive.file`** scope — the app can only touch files it created, nothing else in your Drive.
- `DB.save()` → `DB._persistDrive()` → `Drive.backup()` (debounced ~1.5 s) writes/overwrites
  the single backup file. The bottom-left pill shows **Backing up to Drive… → Backed up**.
- Connect once from **Owner Dashboard → Google Drive backup → Connect Drive** (a one-time
  Google popup; in Testing mode you'll click *Advanced → continue*). After that the token is
  re-acquired **silently** on each page load, so backups keep running with no further clicks.
- Backups never block a save and never run for visitors — owner only.

### One-time Google Cloud setup

In **console.cloud.google.com** (reuse the same project):

1. **Enable** the **Google Drive API**.
2. **Google Auth Platform** → **Branding** (app name + emails), **Audience** (External +
   add yourself as a **test user**), **Data Access** (add scope `.../auth/drive.file`).
3. **Clients → Create OAuth client → Web application**, with **Authorized JavaScript origins**
   = your Pages origin (`https://imran-me.github.io`) and `http://localhost:8000`.
4. Put the resulting **Client ID** in `Drive.CLIENT_ID` (`assets/js/drive.js`).

> Note: an OAuth **JavaScript origin** is scheme + domain only — `https://imran-me.github.io`,
> **not** `https://imran-me.github.io/OppTracker/` (no path allowed). The site under the
> `/OppTracker/` path is still covered by that origin.

### Good to know

- The backup file lives in **your own Drive** (private to you) — open/download it from
  drive.google.com, or via **Owner Dashboard → Open in Drive**.
- Unlike Firestore's 1 MB document cap, a Drive file can be large — so the Drive backup can
  hold more than Firestore if your data (with base64 uploads) ever grows past 1 MB.

---

## Browser support

Latest Chrome, Edge, Firefox and Safari. Fully responsive for mobile, tablet and desktop.
Respects reduced-motion preferences and keyboard focus.

---

## Credits

Fonts: Plus Jakarta Sans, Inter, JetBrains Mono (Google Fonts).
UI: Bootstrap 5 + Bootstrap Icons.
Everything else: handwritten, commented Vanilla JS.
