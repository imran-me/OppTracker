# Work Sheet — build context

Working notes for the **job section** (`work.html`) — what it is, how it is put together, and the
style and approach we hold ourselves to when changing it. Read this before touching the `wk*` code
in `assets/js/app.js` or §26 of `assets/css/style.css`.

*(The Accounts module has its own write-up in the README. This file is only about the job side.)*

---

## 1. What the section is

A private, owner-only **monthly control sheet** for professional work — the job to-do that sits
alongside the public portfolio but is never part of it. Reached from the **briefcase icon** in the
top bar (`.owner-only`, invisible to visitors) and redirect-protected through
`Security.PROTECTED_PAGES`, so guessing the URL lands on the login page.

It renders three levels, a weekly rhythm, a delivery register and a month-end close:

```
Department            e.g. a business line
└─ Main task          WS-01 · title      ← priority, timeline, roles, optional delivery
   └─ Phase           a label on a sub-task, not a separate object
      └─ Sub-task     the actual line of work — dates, people, assignee, report point
```

Ticks are stored **per month**, so each month starts clean while every earlier month stays on file.

## 2. The hard rule: no sheet content in this repository

**This repo is public.** Login-gating a *page* does not hide *source code* — anything committed
here is readable on GitHub and at `…/assets/js/app.js` no matter who is signed in. The sheet names
people, internal systems and staff-management rules, so:

- **Only the renderer ships.** No workstreams, names, department labels or checklist text in
  `app.js`, in any HTML file, in the README, or in this file.
- **Content lives only in the private store** — localStorage `pomls_work_v1` plus Firestore
  `opptrack_private/worksheet` (the same private collection Accounts uses, so the existing
  `match /opptrack_private/{doc}` rule already covers it).
- **`data/work-*.json` is git-ignored** so a seed file can sit in the project folder without ever
  being committed.

When you write a comment, a commit message, a README line or a doc like this one: describe the
*mechanism*, never the *content*. If an example is needed, invent a neutral one.

## 3. The data the renderer expects

Stored under one private document; every field optional unless noted.

| Key | Shape | Notes |
|-----|-------|-------|
| `org`, `title`, `subtitle` | strings | masthead text. Only the part of `org` before `·` is shown |
| `signature` | string | footer line |
| `depts[]` | `{ key, label, tag }` | empty departments still render, so they stay reachable |
| `workstreams[]` | `{ id, dept, title, description, priority, start, end, myRole, devRole, withWhom, boss, bossItem, bossDue, note, mode, modeLabel }` | `id` is `WS-01`-style, from `wkNextId()`; `boss*` puts it in the delivery register |
| `workstreams[].subtasks[]` | `{ id, phase, title, day, from, to, withWhom, assignTo, reportOn, ticks, buf, notes }` | `id` is a `uid()`; `phase` is just a string label; `ticks > 1` renders N boxes |
| `cadence[]` | `{ id, day, time, gate, kind, owner, what }` | weekly gates. `day` drives the due-today flag; `kind` is one of `WK_GATE_KINDS`; week count adapts to the month (4–6) |
| `close[]` | `{ id, title, category, owner, due, critical, notes }` | month-end close. `category` is one of `WK_CLOSE_CATS` and groups the list; `critical` gates the month |
| `checks` | `{ '<month-slug>': { '<key>': true } }` | tick state, per month |
| `_wkV` | number | schema stamp (currently `4`). Not a gate on its own — see the migration note below |

**Tick keys are built from ids, never positions** — `WS-01.sub.<subtaskId>` (or
`WS-01.sub.<subtaskId>.<n>` for a repeat-count row), `cad.<rowId>.<week>` for a gate,
`close.<rowId>` for a close item, `boss.<WS-id>` for a delivery sign-off. That is what lets a row be
renamed, re-phased or reordered without losing its history. Deleting something clears its keys from
**every** month (`wkForgetKeys`), so nothing lingers in the counts.

> This was learned the hard way twice. Cadence ticks were once keyed by the **gate's text** and
> close ticks by the **array index**, so renaming a gate or reordering the close list silently
> orphaned the month's progress. If you add another tickable list, key it by id from the start.

## 4. What the job-side rounds changed

**Masthead.** Trimmed to the group name only (`wkBrand()` cuts everything after the first `·` —
the office/holder line was noise) and given an **identity card** on the right: name, role and
company beside a photo column. `wkIdentityHtml()` reads the live profile and its current
experience entry, so it follows the profile instead of duplicating it; the private sheet may
override any field with `ownerName` / `ownerRole` / `ownerOrg` / `ownerPhoto`.

**The sheet became editable in the browser.** Departments, main tasks and sub-tasks are all
created, edited and deleted on the page — no hand-editing JSON, no re-import. Priority colours the
card's left rule; with none set it falls back to the delegation mode.

**One list, not two.** The imported shape was `groups → items` rendered as a read-only checklist
*below* the sub-task list — two parallel layers splitting the same work. Those items **are** the
sub-tasks, so `_hydrate` folds each item into a real sub-task and turns its group name into that
sub-task's **phase**. The fold runs whenever any workstream still carries `groups` (not on a
version flag), so it self-heals after a re-import, and it cannot double up because groups are
removed as they convert. Old position-based ticks are remapped to the new id-based keys in every
month.

**The rhythm and the close list became first-class.** Both were inert data — cadence as
`[day, gate, what]` tuples, close as bare strings — with no way to add, edit or delete a row, and
the text/index tick keys described above. Both are now id-based records with their own editors, and
each carries information rather than just a label:

- A **gate** has a kind (`Plan · Stand-up · Audit · Delivery · Review · Sync`, colour-tagged so the
  shape of the week reads at a glance), a time, an owner, its own completion bar for the month, and
  a **due-today** flag — `wkGateDueToday()` matches the row's day against today's weekday, or any
  row marked daily.
- **Week columns follow the month on screen.** `wkWeeksInMonth()` parses the month label and returns
  4–6, so a month spanning six calendar weeks gets six boxes. A fixed four silently dropped the last
  week's tick.
- A **close item** has an area (`WK_CLOSE_CATS`) that groups the list with per-area tallies, an
  owner, a when, a note, and a **critical** flag. Criticals gate the month: while any is open the
  panel states the month cannot be called closed and edges those rows red; when all are signed off
  it flips to a green confirmation. That is the one place in this section where the UI takes a
  position rather than just displaying state — and it earns it, because "closed" should mean
  something.

**The seed was regenerated to match.** `data/work-seed.json` (git-ignored) is written in the current
schema so importing it needs no migration at all. Things that genuinely repeat are modelled as
repeat-count rows rather than one box — a recurring daily gate check becomes `ticks: 20` with a
running tally, not twenty separate lines. Timelines were deliberately left blank: the day markers in
that content are working-day numbers, not calendar dates, and a wrong date is worse than none.

## 5. Where the code is

All in the single `app.js`, in one block under the `6.8 WORK SHEET` banner:

- `WorkDB` — private storage layer; mirrors `FinanceDB` (local first, cloud when the rule allows,
  debounced writes, `onSnapshot` with an echo guard on `_clientId`). `_hydrate` also holds the
  self-healing shape migrations: checklist groups → sub-tasks, cadence tuples → rows with ids,
  close strings → rows with ids — each one remapping old tick keys to the new ones.
- `wkText` / `wkBrand` / `wkIdentityHtml` — safe text and masthead.
- `wkSubKeys` / `wkItemKeys` / `wkPhases` / `wkAllPhases` / `wkNextId` — the model helpers.
- `wkWeeksInMonth` / `wkGateKeys` / `wkGateKind` / `wkGateDueToday` — the rhythm helpers, plus the
  `WK_PRIORITIES`, `WK_GATE_KINDS` and `WK_CLOSE_CATS` tables that drive the tags and dropdowns.
- `wkChecks` / `wkOn` / `wkForgetKeys` — per-month tick state.
- `drawWork` → `wkWorkstreamHtml` → `wkSubtaskHtml` — render; `wkPaint` updates counters and bars
  **without** a re-render.
- `wkModal` / `wkVal` — the shared editor scaffolding, then one editor per record type:
  `openWorkDeptModal`, `openWorkTaskModal`, `openWorkSubModal`, `openWorkGateModal`,
  `openWorkCloseModal`. Deletes are `workDeleteTask`, `workDeleteSub` and the shared
  `workDeleteRow('cadence'|'close', id)`.
- Every control is a `[data-wkact]` button handled by **one delegated `host.onclick`** in
  `wireWork()`. Because `drawWork()` replaces the whole subtree, assignment (`host.onclick = …`,
  not `addEventListener`) is deliberate — it cannot stack duplicate listeners across redraws.
  The handler calls `preventDefault()` + `stopPropagation()` because several of those buttons sit
  inside a `<summary>`, which would otherwise toggle the card open.

CSS lives in its own section of `style.css`, prefixed `wk-`, using the same tokens as everything
else plus the sheet's own ink/gold accents.

## 6. Our style

- **Luxurious yet modern, digital, minimalistic** — refined cards, borders, restrained colour.
  Upgrades are additive; we never redesign something that already works.
- **One stylesheet, one script, no build step, no dependencies.** New UI reuses the existing
  tokens (`--primary`, `--line`, tone pairs like `--green` / `--green-soft`) and the existing
  components (`.card`, `.chip`, `.dt`, `.btn-ghost`, `.section-title`) before inventing anything.
- **Mobile ≠ desktop.** Phone layouts get their own rules — denser spacing, scaled type, no
  horizontal page scroll; wide things scroll inside their own container.
- **Tone carries meaning consistently** — green earned/good, red spent/risk, blue kept/info, amber
  caution, gold delivery. A colour means the same thing on every page.
- **Copy is plain and specific.** Say the number and what it means; never inflate. If something is
  unknown (an untagged expense, an unscored month) we say so rather than guessing a value.
- **Print matters** for this section: the sheet prints without app chrome.

## 7. Our approach

- **Never break existing systems, data, text or features.** Changes are additive by default.
- **Additive schema only.** New fields get safe defaults in `_hydrate`; stored records are not
  rewritten. When a real migration is unavoidable (the deposit split, the checklist fold) it must
  be **idempotent**, carry existing state across, and either be version-stamped or self-detecting.
- **Derive, don't store.** Anything computable from records is computed at render time, so a late
  edit corrects the past and the future automatically. Snapshots are for notes, never for figures
  the app relies on.
- **Escape everything.** All user/imported text goes through `escapeHtml` (or `wkText`, which
  escapes first and then re-enables a tiny markup subset). Imported content can never inject HTML.
- **Owner-gated at every layer** — hidden nav, page redirect, `Security.guard()` before any write,
  and Firestore rules doing the real enforcement on the server.
- **Comments explain *why*, not *what*.** The interesting comments in this codebase record a
  decision or a trap (why deposits are not expenses, why tick keys are id-based, why the fold is
  not version-gated). Keep that up.
- **Don't touch EON** (`ai-companion/`). It is an isolated module with no coupling to these pages.

## 8. How we verify

There is no test runner in the repo and no browser automation here, so verification is done with
throwaway Node scripts kept **outside** the repo (scratchpad):

1. `node --check assets/js/app.js` after every edit.
2. A **vm sandbox** that loads `app.js` with minimal DOM stubs and exercises the pure logic
   (totals, carry chains, key generation) against hand-computed fixtures.
3. A **render smoke test** using the same sandbox with a fake DOM: drive every tab, filter, state
   and modal, assert the expected markup appears, and assert **no stored record was mutated by
   rendering**.
4. Brace-balance / orphan-selector check on the stylesheet after big CSS edits.

Test *expectations* are allowed to be wrong — when one fails, decide whether the code or the
assertion is at fault before changing either.

## 9. Working alongside other sessions

More than one agent has edited `app.js` and `style.css` at the same time on this project. It works,
with discipline:

- Keep edits **regional** — targeted `Edit` calls in your own function block, never a whole-file
  rewrite of a shared file.
- Check `git status` and the diff **before committing**; commit only your own hunks if someone
  else's work-in-progress is sitting in the same file (splitting a patch by hunk is easy; untangling
  a bad commit is not).
- Both sessions committing to `main` is normal here, since GitHub Pages deploys from it.

## 10. Deliberately not done

- No auto-projection of recurring work into the next month — a repeat marker is a label, and new
  records are only ever created when explicitly asked for.
- No invented dates. Where source content used working-day numbers (`D1`, `D10`) rather than
  calendar dates, the timeline fields were left empty for the owner to fill.
- No reorganising the owner's structure. Regenerating the seed kept every workstream in the
  department it was already in; a third department was added **empty and labelled to be renamed**
  rather than guessing what belongs in it.
- No sheet content, seed data or fixtures committed. Ever.

## 11. Traps already hit — don't hit them again

Recorded because each one cost a round to find:

| Trap | What happened | The rule now |
|------|---------------|--------------|
| Text/index tick keys | Renaming a gate or reordering the close list orphaned a month's progress | Key every tickable row by `id` |
| Two parallel layers | A rich sub-task list rendered *above* a read-only checklist holding all the real content | One list per concept. If new UI shows "none yet" while data is visible below it, the model is wrong |
| Fixed four week boxes | Six-week months lost the last tick | Derive counts from the month on screen |
| Import order | Ticks were assigned **after** `_hydrate`, so a migration could not remap them and they pointed at rows that no longer existed | Carry state **into** hydrate, then migrate |
| Skipping empty groups | A department with no workstreams did not render, so it was unreachable and could never be filled | Render empty containers with a way in |
| Placeholders as leaks | Real names and workstream titles reached form placeholders and a README diagram | Sweep for private strings before every push; examples must be invented |
| Stale references in tests | A harness held an object captured before a re-hydrate and asserted against a detached copy | Re-fetch from `WorkDB.data` after any hydrate |
