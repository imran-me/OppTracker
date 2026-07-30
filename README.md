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
├── accounts.html           # Accounts — PRIVATE income/expense intelligence (owner-only, never public)
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
├── work.html               # Work Sheet — PRIVATE professional to-do / monthly control sheet (owner-only)
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
├── docs/
│   └── work-sheet-context.md   # Work Sheet build context — data shape, style & approach
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
12. **Work Sheet** — *(owner only, private)* the professional to-do: a monthly control sheet of workstreams, cadence gates, a delivery register and a month-end close. Reached from the **briefcase icon** in the top bar.

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

## Accounts — Private Finance Intelligence (owner-only)

A private personal-finance command centre at **`accounts.html`**. It is **owner-only** and
**never visible to the public** — hidden from the nav for visitors, redirect-protected via
`Security.PROTECTED_PAGES`, and (critically) stored **outside** the public portfolio document.

### Why a separate store
Every visitor reads the single public Firestore doc `opptrack/data` to render the portfolio.
So finance data must **never** live there or it would ship in every visitor's payload — even if
hidden on screen. Instead the Accounts module uses its own store:

- **localStorage** key `pomls_finance_v1` — instant, offline, on this device.
- **Firestore doc `opptrack_private/finance`** — same Firebase project, but a **separate,
  dedicated collection** (deliberately *not* under `opptrack`, so no public rule on the
  portfolio collection can ever match it; Firestore denies it by default).

It works on this device immediately. To sync it privately across your devices, add this
**owner-only read+write** rule in **Firebase Console → Firestore → Rules** (then Publish),
inside `match /databases/{database}/documents { … }`:

```
match /opptrack_private/{doc} {
  allow read, write: if request.auth != null
    && request.auth.token.email == 'me.imran.personal@gmail.com';
}
```

Keep your existing public-portfolio rule scoped to `/opptrack/data` (not a `/opptrack/{document=**}`
wildcard) so nothing else is ever public.

Until that rule exists the page shows a subtle **"Private · this device"** pill and stays local
(never leaking, never breaking). With the rule it flips to **"Private · synced."**

### Three flows, not two

A transaction is **income**, **expense** or **deposit**:

| Flow | Meaning | Effect |
|------|---------|--------|
| **Income** | money that came in | adds to income |
| **Deposit** | money you **kept** — savings, DPS, FDR, shares | **subtracted from spendable income**, never counted as spending, no necessity band |
| **Expense** | money that is actually gone | counted as spending, carries a necessity band |

```
income − deposited − expense = net saved (what is still in hand)
deposited + net saved        = total kept
savings rate                = total kept ÷ income
```

This matters: with savings filed as an *expense* (as it was before), moving ৳7,000 into
savings made the page report a 22% savings rate when 36% of income had actually been kept —
and called your savings your "biggest expense". Deposits fix that.

> **Automatic migration.** Records saved before deposits existed (an expense categorised
> *Savings / Investment*, *DPS*, *FDR* …) are reclassified to `deposit` once, on first load,
> and the store is stamped `_finV: 2` so it never re-runs. A later deliberate re-tag is
> respected. `Savings / Investment` also moves from the expense list to the deposit list.

### What it tracks (BDT ৳)
- **Transactions** — income, expense or deposit; amount, date, category/sector, payment method
  (Cash, bKash, Nagad, Rocket, Card, Bank), repeat cadence, and a free-text note.
- **Necessity band per expense** — *Essential · Important · Discretionary · Avoidable* — the
  heart of the "was it worth it?" spending-quality analysis. Untagged spend is reported
  separately rather than silently assumed *Discretionary*, so it can't inflate "could save".
- **Editable categories** for all three flows, **monthly budget** and **savings goal**
  (⚙ Categories & budget). The budget is compared against real spending, deposits excluded.

### Month rollover — how history is kept and a new month starts

**Nothing has to be done on the 1st.** Every record is filed under the month of its own date,
permanently; July stays July when August begins. There is no "close the books" step that moves,
freezes or archives anything, so no data can be lost at a month boundary.

What *does* travel between months is the **leftover cash**, and it is **derived, never stored**:

```
opening(month) = starting balance + Σ (income − deposit − expense) of every earlier month
closing(month) = opening(month) + this month's net      → becomes the next month's opening
vault(month)   = Σ every deposit up to and including it → the pot; never resets
```

Because it is recomputed from the ledger each time, adding a forgotten July receipt **next
week** still corrects August's opening balance automatically. Two settings control it
(⚙ Categories & budget): **Carry the leftover into the next month** (on by default) and
**Starting balance before your first record**, which anchors the chain.

**Closing a month is optional and reversible.** On the turn of a month a banner offers the
previous one for review; closing it writes a single entry under `closes['YYYY-MM']` — your note
plus a snapshot of the figures as they stood — and nothing else. It does not lock the month:
you can still add records to it, the live numbers keep recomputing, and *Reopen* deletes only
that review entry. The close dialog can also **copy** any lines you tick that are marked
*Monthly* into the next month as **brand-new** records; the originals are never touched.

### What it shows

The page is a **cockpit**: a sticky command bar, a KPI strip where every tile is a *lens*, the
money river, then one tabbed workspace — instead of eight stacked cards.

- **Command bar** (sticky) — privacy pill, month stepper, a **12-month scrub** sparkline you can
  click to travel, search across the month, and Add.
- **Hero balance** — what is in hand at month end, the *Opened → +in −deposited −spent* rail,
  the savings-rate ring, the **spend-quality grade** and the lifetime **Vault** total.
- **KPI lenses** — Income, Deposited, Spent and "Could save", each with a **month-over-month
  delta**. Clicking one focuses the whole page on that flow (click again to release).
- **Money river** — the month as a single bar: deposits, each necessity band, untagged spend and
  what is left. Every segment is clickable and drills into the ledger.
- **Ledger** — search, filter by category / necessity / method / day, **grouped by day with day
  totals**, inline necessity retagging, and **bulk** retag / recategorise / delete.
- **Calendar** — a heatmap of the month's daily rhythm; shade = how much was spent, dots mark
  income and deposit days, and clicking a day opens it in the ledger.
- **Breakdown** — the necessity bands, sector breakdowns (income / expense / deposits kept
  separate) and payment methods split **per flow**. These are never added together: one combined
  figure per method matched neither earnings nor spending.
- **Trends** — 12 months of income vs expense vs deposits with the budget line; click to travel.
- **Months** — the archive of everything: an **all-time strip** (months tracked, earned,
  deposited, spent, kept, in hand now) over a per-month table grouped into **years with
  subtotals**, each row showing its opening and closing balance, quality grade and saved review
  note, with a jump button. Nothing ages out.
- **All months in the ledger** — the ledger's *This month · All months* switch widens it to every
  record you have ever logged, still day-grouped and still fully searchable and filterable.
- **Insights** — the plain-language findings (savings verdict on what you *kept*, deposit note,
  spending-quality leak, biggest sector, month-over-month movement, budget status, untagged
  nudge), plus the **recurring radar** (lines that repeat across months, found in your own
  ledger — no new data entry) and a **what-if slider** projecting a trim of the soft spend.

> The **Repeats** field is a label for your own reference. It is *not* projected into future
> months automatically — a July record marked *Monthly* only becomes an August one if you tick
> it in the month-close dialog.

---

## Work Sheet — private professional to-do (owner-only)

> **Before changing this section, read [`docs/work-sheet-context.md`](docs/work-sheet-context.md)** —
> the data shape the renderer expects, the id-based tick keys, and the style and approach rules
> (chief among them: no sheet content in this public repo).

A monthly **control sheet** at **`work.html`**, opened from the **briefcase icon** in the top
bar. The icon is `.owner-only` (invisible to visitors) and the page is redirect-protected via
`Security.PROTECTED_PAGES`, so a visitor who guesses the URL lands on the login page.

It renders workstreams as collapsible cards with per-workstream progress, department roll-ups, a
weekly **cadence** grid (weeks 1–4), a **delivery register** of sign-offs, and a **month-end
close** list. Ticks are stored **per month**, so each month starts clean while previous months
stay on file. There is a print view that drops the app chrome and prints the sheet alone.

### Three levels

```
Department            e.g. Software & Development
└─ Main task          WS-01 · <a workstream>     ← priority, timeline, roles, delivery
   └─ Phase           Week 1 · groundwork        ← a heading that groups sub-tasks
      └─ Sub-task     D1 · <a single line>       ← dates, people, assignee, report point
```

A **phase** is just a label on a sub-task, so there is one editable list per main task rather
than two parallel ones. The imported checklist folds into exactly this: every item became a
sub-task, and its group name became the sub-task's phase.

### Building the sheet in the browser

Nothing needs editing by hand — departments, main tasks and sub-tasks are all managed on the page:

| Control | Where | What it does |
|---------|-------|--------------|
| **+** | on every department heading | new **main task** under that department |
| **⋯** | on every department heading | rename the department, or remove it once it is empty |
| **Add department** | below the board | a new department (empty ones still render, so they are reachable) |
| **Add sub-task** | on the *Sub-tasks* heading inside a card | new sub-task, phase picked in the form |
| **+** | on each phase heading | new sub-task straight into that phase |
| ✏️ / 🗑 | main-task head and every sub-task row | edit or delete, with a confirm on deletes |

**Main task** — title, description, department, **priority**, from/to timeline, *my role*, *dev
role*, who it is worked on with, and an optional delivery (deliverable + gate) that puts it in the
delivery register.

**Sub-task** — title, **phase** (type a new name to start one; existing names are offered),
a short **day marker** (`D3`), its own **from → to** dates, who it is worked on **with**, who it
is **assigned to**, the date it gets **reported up**, a **repeat count** for "do this N times"
rows (renders N boxes with a running tally), a **buffer** flag for only-if-needed lines, and notes.

**Priority colours the card's left rule** — **High red · Medium amber · Low green**. With no
priority set, the rule falls back to the delegation mode (navy for self-build, gold for
delegated).

Ticks are keyed by each sub-task's own id, so they survive editing, re-phrasing, moving between
phases and reordering. Deleting a main task or a sub-task clears its ticks from **every** month —
including all boxes of a repeat-count row — so nothing lingers in the counts. Shrinking a repeat
count drops the ticks of the removed boxes.

### Operating rhythm — the recurring gates

The rhythm is a list of gates you run every week, ticked once per week. **+** on the heading adds
one; ✏️/🗑 on each row edits or deletes it. A gate carries **when** (a weekday, or *Daily*), a
**time**, a **kind**, **who runs it**, and what actually happens.

- **Kinds** are colour-tagged — Plan, Stand-up, Audit, Delivery, Review, Sync — so the week's shape
  reads at a glance.
- **Rows due today are flagged.** A gate whose day matches today's weekday (or is *Daily*) gets a
  gold `today` marker and a tinted row.
- **Week columns follow the month on screen.** A month spanning five or six calendar weeks gets
  five or six boxes instead of a fixed four, so a week's tick can't fall off the end.
- Each row shows its own **completion bar** for the month, and the section header totals it.

### Month-end close — what must be true

**+** adds an item; ✏️/🗑 edit or delete. Each item carries an **area**, an **owner**, **when**,
a note, and a **critical** flag.

- Items are **grouped by area** (Finance, People, Operations, Marketing, Digital, Other) with a
  per-area tally.
- **Criticals gate the month.** While any critical item is open the panel says the month cannot be
  called closed and marks those rows with a red edge; once they are all signed off it flips to a
  green confirmation.

> Both sections used to be plain data — cadence as `[day, gate, what]` tuples, close as bare
> strings — with tick keys built from the **gate text** and the **array position**. So renaming a
> gate or reordering the close list silently orphaned its ticks. Both are now records with stable
> ids, and existing ticks were carried across on upgrade.

### ⚠️ Why the sheet's content is NOT in this repository

**This repo is public.** Login-gating a *page* does not hide *source code* — anything committed
here is readable at `github.com/…` and at `…/assets/js/app.js` regardless of who is signed in.
A work sheet naturally names people, internal systems and staff-management rules, so:

- **Only the renderer ships.** `app.js` contains no workstreams, names or checklist text.
- **The content lives solely in your private store:** localStorage `pomls_work_v1` +
  Firestore **`opptrack_private/worksheet`** — the same private collection Accounts uses, so the
  **existing `match /opptrack_private/{doc}` rule already covers it** and no new Firestore rule
  is needed. Without that rule it stays on the device and shows *"Private · this device"*.
- **You load it once** with **Import sheet** (a JSON file). `data/work-*.json` is in
  `.gitignore` so the sheet file can live in the project folder without ever being committed.
  After the first import it syncs to every device you sign in on, and **Export** gives you a
  copy back.

> Never paste the sheet's content into `app.js`, a HTML file, or the README. Keep it in the
> private Firestore doc and the git-ignored JSON.

---

## Design directives & change log

Living record of the owner's intent (per request, kept in the repo):

- **UI must feel *luxurious yet modern, digital & minimalistic*** — refined cards, borders,
  text colours, animations and effects, using the **existing indigo/sky theme** (no over-design,
  no over-colour; everything balanced).
- **Mobile ≠ desktop.** On phones, showcase cards sit **2 per row** (never one giant full-width
  card), with tightened spacing and scaled type — super-responsive and premium.
- **Never break existing systems, functionality, text, information or features** — UI upgrades
  are additive (see `style.css` §25 "Luxury polish" and §24 "Accounts").
- **Do not touch EON** (`ai-companion/`) or any existing functionality/options.
- **Accounts feature** (above) — a private income/expense "game changer," owner-only, invisible
  to the public, that turns raw entries into savings insight.

_2026-07-02 — Added the private Accounts module; luxury UI polish + mobile density pass across
the public portfolio and dashboard._

_2026-07-30 — Removed the global "Add new" dropdown from the top bar (every section already has
its own Add button). Added the owner-only **Work Sheet** (briefcase icon → `work.html`) with its
content held outside the public repo — see the section above._

_2026-07-30 — Accounts money-math audit & fixes: added the **deposit** flow with a **Deposited**
KPI (savings are money kept, subtracted from income, no longer counted as spending — the savings
rate was understated); split **by payment method** per flow (it was adding income and expense into
one meaningless figure); corrected the spending-quality insight to state the true
Avoidable/Discretionary total alongside the reclaimable slice (it reported the estimate as if it
were the band total); untagged spend is no longer silently assumed Discretionary._

_2026-07-30 — Accounts redesigned as a **cockpit**: sticky command bar with search and a
12-month scrub, a hero balance card, KPI tiles that act as **lenses** over the whole page, the
**money river**, and one tabbed workspace (Ledger · Calendar · Breakdown · Trends · Months ·
Insights) in place of eight stacked cards. Added **month rollover** — derived opening/closing
balances, a lifetime deposit vault, an optional reversible month close with carry-forward of
monthly items — plus a calendar heatmap, spend-quality grade, recurring radar, what-if slider,
day-grouped ledger with search/filters and bulk retagging. All additive: no stored record is
changed by any of it._

_2026-07-30 — Tidied the Work Sheet masthead: the eyebrow now carries the group only, the long
strapline is gone, and an **identity card** (name, role, company + photo) sits on the right. The
card reads the live profile — set the photo on the **Profile** page and it appears here._

_2026-07-30 — Work Sheet became fully editable in the browser: **+** on each department heading
adds a main task (title, description, priority, timeline, my role, dev role, who it is with,
delivery), with a richer **phase / sub-task** layer underneath each one (from → to, with whom,
assigned to, report-up date, notes). Edit + delete on both, and department add / rename / remove.
**Priority now drives the card's left rule — High red, Medium amber, Low green.** Empty
departments render so they can be built into, and deleting anything clears its ticks from every
month._

_2026-07-30 — **Folded the imported checklist into the sub-task list.** Those checklist items were
the sub-tasks, so having a separate "Phases & sub-tasks" block above them split the same work into
two systems, with the read-only half holding all the content. Each item is now a real sub-task and
its group name became the sub-task's **phase**, so every line is editable and gets dates, people,
an assignee and a report point. Every tick was carried across to the new id-based keys, in every
month. Sub-tasks also gained a day marker, a repeat count (for "10 videos" style rows, with a
tally) and a buffer flag. `data/work-seed.json` was reshaped to the same layout, with priorities
set so the colour rules show on import._

_2026-07-30 — **Operating rhythm and Month-end close are now editable and carry real information.**
Both were static data with no add/edit/delete, and their tick keys came from the gate text and the
array index — so renaming a gate or reordering the close list silently orphaned its ticks. Both are
now id-based records. Gates gained a kind (colour-tagged), a time, an owner, a due-today flag and a
per-gate completion bar, and the week columns now follow the month on screen (4, 5 or 6 weeks
instead of a fixed 4). Close items gained an area to group under, an owner, a when, a note and a
**critical** flag that gates the month — the panel refuses to call the month closed while any
critical item is open. `data/work-seed.json` regenerated in the current schema: 3 departments,
6 main tasks, 94 sub-tasks across 15 phases (186 tickable with repeat counts), 6 rhythm gates and
9 close items._

---

## Credits

Fonts: Plus Jakarta Sans, Inter, JetBrains Mono (Google Fonts).
UI: Bootstrap 5 + Bootstrap Icons.
Everything else: handwritten, commented Vanilla JS.

