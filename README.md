# OppTrack — Personal Opportunity, Achievement, Project & Activity Management System

A complete, offline-first personal dashboard **and** public portfolio for managing
scholarships, fellowships, competitions, hackathons, tasks, documents, achievements,
contacts, research and projects.

Built for **Md Imran Hossain** — B.Sc. in Computing & Information System,
Daffodil International University.

- **100% frontend** — HTML5, CSS3, Bootstrap 5, Vanilla JavaScript
- **No server, no database, no build step** — runs by opening `index.html`
- **Data stays in your browser** via Local Storage, with JSON export/import for backup
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

> All sample data loads automatically on first run. Edit anything and it saves instantly.

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
│   ├── css/style.css       # One centralized stylesheet (design system + components + login UI)
│   ├── js/app.js           # One centralized engine (data layer, UI, all page logic)
│   ├── js/security.js      # Owner-only access control: auth, sessions, guards, UI gating
│   └── img/favicon.svg     # Brand mark; drop profile/achievement images here too
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

All data is stored under the Local Storage key `pomls_data_v1`.

---

## Owner-Only Management System (security) 🔐

The site is **public to view** and **owner-only to manage**. Anyone with the link can
browse, search, filter and read everything. Only the signed-in owner can add, edit,
delete, archive, manage categories, import, reset or change the profile. All of this
lives in one place: **`assets/js/security.js`**.

### How it works

| Layer | What it does | Where |
|-------|--------------|-------|
| **Authentication** | Password login. The password is never stored — only a salted **SHA-256 hash** (`OWNER_HASH`). Verified with the browser's Web Crypto API. | `security.js` → `login()` |
| **Session** | On success a **signed, time-limited session** is written to Local Storage (`pomls_owner_session_v1`). It auto-expires after `SESSION_HOURS` (default 8) and is re-validated on every page load; a hand-edited session fails its signature check and is discarded. | `security.js` → `init()` / `isOwner()` |
| **UI gating** | `<body>` gets `owner-mode` or `viewer-mode`. Every management control is marked `.owner-only` and is hidden from visitors by CSS. `viewer-mode` is baked into each page's `<body>` so admin controls **never flash** before JS runs. | `style.css` §22, `applyMode()` |
| **Action guards** | Every data-mutation (`DB.save/upsert/remove/importJSON/resetAll`, add/edit modal, delete, drag-to-move, reminders, category add/remove, profile edit) calls `Security.guard()` first. Because the check is **inside the data layer**, calls fired from the console / dev-tools are rejected too. | `app.js` (search “Security.guard”) |
| **Page protection** | Owner-only pages (`owner.html`, `categories.html`, listed in `Security.PROTECTED_PAGES`) **redirect** non-owners to the login page. | `requireOwner()` |
| **Session control** | Owner badge + **Log out** appear in the top bar / nav; the Owner Dashboard shows time remaining. | `renderAuthControl()` |

### 🔑 Setting your password (do this before going live)

The shipped default password is **`Owner@2026`**. Change it:

1. Open the site, press **F12 → Console**, and run:
   ```js
   await Security.hashFor('your-new-strong-password')
   ```
2. Copy the printed hash.
3. Paste it as the value of **`OWNER_HASH`** in `assets/js/security.js`.
4. Save / redeploy. The old password no longer works.

> You can also change `SALT`, `SESSION_HOURS`, `LOGIN_PAGE`, and `PROTECTED_PAGES`
> in the **CONFIGURATION** block at the top of `security.js` (all are commented).

### Signing in / out

- Click **Owner login** (top bar, landing page, or portfolio nav) → `login.html`.
- After signing in you land on the **Owner Dashboard** (`owner.html`): content counts,
  one-click management links, quick-add, backup/restore and a danger zone.
- Click the **log-out** icon to end the session immediately (do this on shared devices).

### ⚠️ Honest security note — read this

This is a **100% client-side static site** (e.g. GitHub Pages) with **no server**, and the
data lives in each visitor's **own browser**. On such a site, *no client-only code can be
made fully tamper-proof*: a determined person can read the JavaScript or edit their own
Local Storage by hand. This layer (hashed password, signed session, guarded writes,
redirects, hidden controls) is the correct, practical solution here **because**:

- A visitor who bypasses the gate only changes **their own private local copy** — it never
  reaches you or any other visitor.
- The content you publish is whatever ships in `app.js` (`SEED_DATA`) or your committed
  data; visitors cannot alter that for anyone else.

If you need **server-enforced** owner-only control (where unauthorized writes are rejected
no matter what the browser does), move the data layer to a backend — see the
**Firebase** section below. Firebase Auth + Firestore security rules enforce ownership on
the server, which dev-tools cannot bypass. Only `DB.load()` / `DB.save()` need to change.

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

> **Note on data:** Local Storage is per-browser and per-device. Your records do **not**
> sync between phone and laptop automatically. Use **Export backup** and **Import backup**
> (top-bar cloud icon) to move data between devices — see `data/backup-guide.md`.

---

## Backup & restore

Open the **cloud icon** in the top bar:

- **Export full backup (JSON)** — downloads everything as a dated `.json` file.
- **Import backup** — restores from a previously exported `.json`.
- **Reset to sample data** — wipes local data back to the demo records.

Full Google Drive workflow: see [`data/backup-guide.md`](data/backup-guide.md).

---

## Future upgrade: Firebase (optional, for multi-device sync)

Local Storage is perfect for a single device. If you later want your data to **sync across
phone and laptop** and have **cloud backup**, Firebase is a clean, mostly-free next step
that keeps the project serverless.

Recommended path:

1. **Create a Firebase project** at <https://console.firebase.google.com> and add a Web app.
2. **Enable Authentication** (Email/Password or Google sign-in) so only you can write.
3. **Enable Cloud Firestore** (a NoSQL document database).
4. **Add the SDK** to your pages (CDN, no build step needed):
   ```html
   <script type="module">
     import { initializeApp } from "https://www.gstatic.com/firebasejs/10.x/firebase-app.js";
     import { getFirestore, doc, setDoc, getDoc }
       from "https://www.gstatic.com/firebasejs/10.x/firebase-firestore.js";
     const app = initializeApp({ /* your config */ });
     const db  = getFirestore(app);
   </script>
   ```
5. **Mirror the storage layer.** The whole app already reads/writes through one object
   (`DB` in `app.js`). To go cloud, change just `DB.load()` and `DB.save()`:
   - `save()` → also write `DB.data` to a Firestore document, e.g. `users/{uid}/store/main`.
   - `load()` → read that document on startup; fall back to Local Storage when offline.
   Because every page uses `DB`, nothing else needs to change.
6. **Lock it down** with Firestore security rules so a user can only read/write their own
   document:
   ```
   match /users/{uid}/{document=**} {
     allow read, write: if request.auth != null && request.auth.uid == uid;
   }
   ```

Other options if you outgrow Firestore: **Supabase** (Postgres + auth, generous free tier)
or a private **GitHub Gist** as a simple JSON store via the GitHub API.

---

## Browser support

Latest Chrome, Edge, Firefox and Safari. Fully responsive for mobile, tablet and desktop.
Respects reduced-motion preferences and keyboard focus.

---

## Credits

Fonts: Plus Jakarta Sans, Inter, JetBrains Mono (Google Fonts).
UI: Bootstrap 5 + Bootstrap Icons.
Everything else: handwritten, commented Vanilla JS.
