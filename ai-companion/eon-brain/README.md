# EON Brain — Portable Learning & Awareness Engine

EON's **mind**. Connect it to any system and it learns that system on its own —
discovering the schema, reading the data (read-only), and surfacing help. This
phase delivers the **learning foundation** plus the only two helping features for
now: **reminders** and **deadline alerts**. Everything else is built so new
"skills" plug into the same memory later.

> **Where it runs.** This is a PHP module — it needs a PHP runtime to execute. It
> does **not** run on a static host (e.g. GitHub Pages). Deploy it on your ERP's
> PHP server (or any PHP host). EON's *own* store defaults to a **SQLite file**,
> so it works with zero setup and the source DB stays physically separate.
>
> **It never writes to your system.** EON only ever reads the source (SELECT) and
> writes exclusively to its own `eon_*` tables / SQLite file.

---

## The big idea: system-agnostic
Connecting EON to a new system is **configuration, not code**:

1. **Connector** — a generic PDO connector (SQLite / MySQL / Postgres). Point it
   at a database in `config/brain.config.php`.
2. **Schema auto-discovery** — on connect, EON inspects the system and finds every
   table, its columns, types, relationships, and especially **date columns**. It
   auto-detects each table's **deadline** column (`due`, `deadline`, `expiry`,
   `valid_till`, `renewal`, `end_date`, …) and **label** column
   (`name`/`title`/`reference`). No manual table list.
3. **Knowledge Store** — a normalized internal memory (`eon_knowledge`) holding
   what EON learned, independent of the source's structure.

So: **connect EON → he learns the system's all.** Same code, any system.

---

## Quick start (with the built-in demo)
```bash
cd ai-companion/eon-brain

php bin/seed-demo.php          # makes a throwaway SQLite "source system"
php bin/meditate.php           # one meditation cycle: learn → scan → raise

# serve the API and poll it
php -S 127.0.0.1:8801
curl http://127.0.0.1:8801/api/index.php/state
curl http://127.0.0.1:8801/api/index.php/alerts
```

### Connect to YOUR system
Edit `config/brain.config.php` → `source`:
```php
'source' => [
  'name'     => 'erp',
  'driver'   => 'mysql',           // sqlite | mysql | pgsql
  'host'     => '127.0.0.1',
  'database' => 'epal_erp',
  'username' => 'readonly_user',   // a READ-ONLY account is recommended
  'password' => '••••',
],
```
(or set `EON_SOURCE_*` env vars). Then run `php bin/meditate.php`. That's it —
discovery + learning happen automatically.

### Schedule the meditation cycle (default 15 min)
```cron
*/15 * * * *  php /path/to/ai-companion/eon-brain/bin/meditate.php >> /var/log/eon.log 2>&1
```

---

## How the avatar consumes it
The avatar **only reads results** — all thinking is inside `eon-brain/`. Use
`client/brain-client.js`:

| Endpoint | Purpose |
|---|---|
| `GET /state` | `state` ∈ `idle / meditating / reading-section / insight` + `progress` 0..1 + `section`. **Drives the meditation visuals.** |
| `GET /alerts` | active alerts/reminders, urgency-sorted; each has `label`, `urgency`, `dueAt`, **`pointTo`** (where to float and point). |
| `POST /alerts/{id}/seen` | acknowledge |
| `POST /alerts/{id}/snooze` | body `{ "minutes": 30 }` |
| `POST /alerts/{id}/dismiss` | hide (won't reappear) |
| `POST /reminders` | body `{ title, note?, remind_at, link? }` |
| `POST /meditate` | run a cycle now (handy to *show* meditation on demand) |

**Meditation mapping (suggested):** poll `/state`; when `meditating`/`reading-section`,
play a sit-and-glow with light streaming in and mist over `state.section`; when
`insight`, open his eyes with a spark, show `state.message`, and float him to point
at the section in `state.pointTo`.

> The 3D avatar code is intentionally **untouched** in this phase. Wiring these
> results into the meditation animation is the next, separate step.

---

## What's inside
```
eon-brain/
├── config/brain.config.php      # connection, windows, interval, overrides
├── bootstrap.php                # autoload + Brain factory
├── src/
│   ├── Connector/               # ConnectorInterface + generic PdoConnector (read-only)
│   ├── Discovery/SchemaDiscovery.php   # tables/columns/relations + deadline/label detection
│   ├── Storage/BrainStore.php   # creates ONLY eon_* tables (migrations)
│   ├── Knowledge/KnowledgeStore.php    # normalized memory + future-skill hook
│   ├── Learning/Learner.php     # incremental, chunked, read-only learner
│   ├── Learning/MindState.php   # idle→meditating→reading→insight + progress
│   ├── Deadlines/DeadlineScanner.php   # windows → de-duplicated alerts + pointTo
│   ├── Reminders/ReminderEngine.php    # manual + auto, seen/snooze/dismiss
│   ├── Cycle/MeditationCycle.php       # learn → scan → raise → insight
│   └── Brain.php                # facade (the single entry point)
├── api/index.php                # the HTTP routes above
├── bin/meditate.php             # the scheduled cycle (cron)
├── bin/seed-demo.php            # demo source so you can see it work
└── client/brain-client.js       # avatar's consumer
```

EON's own tables: `eon_sources`, `eon_tables` (the map), `eon_knowledge`
(memory), `eon_alerts`, `eon_reminders`, `eon_state`.

---

## Configuration
All in `config/brain.config.php`:
- **`source`** — the system to learn (read-only).
- **`brain`** — EON's own store (default SQLite file).
- **`windows`** — deadline warning days, default `[7,3,1,0]`.
- **`interval_seconds`** — meditation cadence (default 900).
- **`overrides`** — per-table corrections when auto-detection needs a nudge:
  ```php
  'overrides' => [
    'opportunities' => [
      'deadline_column' => 'deadline',
      'label_column'    => 'name',
      'link_pattern'    => 'opportunity-details.html?id={id}',
    ],
  ],
  ```

---

## Where future helping features attach
The Knowledge Store is **general-purpose** — every learned row keeps its full
payload (`payload_json`). New skills (suggestions, mistake-catching, summaries,
analysis…) should:
1. **Read** from `KnowledgeStore::records()` / `Brain::recall()` — never re-read
   the source.
2. **Write** their own derived outputs into new `eon_*` tables.
3. Hook into the cycle after `scan` in `Cycle/MeditationCycle.php`.

See the boxed `FUTURE-SKILL HOOK` comment in `Knowledge/KnowledgeStore.php`.

---

## Safety & scale
- **Read-only** on the source: only `SELECT`; table/column identifiers are
  whitelisted from discovery and quoted; all values are bound (no raw SQL).
- **Own tables only**: migrations create `eon_*` exclusively; the source schema is
  never altered.
- **Incremental + chunked**: bounded by the deadline horizon and read in chunks
  (`chunk_size`), so it scales to large databases.
