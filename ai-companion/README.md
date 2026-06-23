# EON — EPAL AI Companion

A self-contained, modular **living digital companion** that lives inside your ERP.
EON walks around the screen, watches what you do, reacts with emotion and
animation, has a home, gets bored, drinks tea, and sleeps — designed so users feel
*"EON is part of the system."*

> **Isolated by design.** Everything lives in `/ai-companion/`. It injects one overlay
> layer into `<body>` and touches nothing else in your app. Remove the script tag and
> EON is gone without a trace.

---

## Quick start

### Option A — standalone demo
Open `ai-companion/index.php` on a PHP host (or any static server). A playground page
loads with EON and buttons to trigger reactions.

### Option B — embed in your existing ERP
Add **one import-map** (once) and **one module script** to any page:

```html
<!-- Three.js (no build step needed) -->
<script type="importmap">
{ "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }
</script>

<!-- EON styles + engine -->
<link rel="stylesheet" href="/ai-companion/css/companion.css">
<link rel="stylesheet" href="/ai-companion/css/home.css">
<link rel="stylesheet" href="/ai-companion/css/animations.css">
<script type="module" src="/ai-companion/js/main.js"></script>
```

That's it. EON boots itself, restores its memory, walks in, and waves.

> If your app already bundles `three`, point the import-map at your copy instead.

---

## Two deployment realities (read this)

1. **Static hosting (e.g. GitHub Pages):** PHP does **not** execute. EON detects this
   and transparently persists state to `localStorage`. Everything still works. The
   `/php` and `/api` endpoints are there for when you *do* have a PHP host.
2. **3D model:** v1 builds EON **procedurally** in Three.js (rounded primitives in the
   EPAL palette) so it runs with zero asset downloads. To upgrade to a rigged,
   Pixar-style model later, drop `eon.glb` into `/assets/models/` and swap the
   `_build()` method in `character-controller.js` for a `GLTFLoader` + `AnimationMixer`
   (the public API — `setState`, `lookAt`, `update` — stays identical).

---

## Architecture

```
main.js ── boots overlay + Three.js scene, owns the 60 FPS loop
   │
   ├─ character-controller.js  builds EON + drives every animation state
   ├─ emotion-engine.js        emotion → state + glow + speech (transient reactions)
   ├─ activity-engine.js       idle ladder (home→relax→sleep) + random life + waking
   ├─ event-tracker.js         passive observers (type/click/submit/scroll/toasts)
   ├─ ai-core.js               persistence + speech bubbles + memory + future-LLM hook
   ├─ home-system.js           cozy corner house + day/night + rain
   ├─ particle-system.js       footsteps, ZZZ, confetti, steam, hearts (pooled sprites)
   └─ pathfinding.js           horizontal navigation with smooth arrival
```

All subsystems share one `ctx` object created in `main.js`, so they stay decoupled and
individually testable. There is **no global state** beyond `window.EON` (exposed for
debugging / manual control).

### Manual control (handy for testing)
```js
EON.emotion.react('celebrating', { priority: 3 });
EON.character.setState('dance');
EON.nav.goHome();
EON.ai.speak('Hello from the console!');
```

---

## Behaviour map

| User action            | EON reaction                                  |
|------------------------|-----------------------------------------------|
| Mouse move             | Eyes + head follow the cursor                 |
| Type in a field        | Walks over, watches, tilts head (curious)     |
| Click                  | Turns to face the click                       |
| Submit a form          | Happy jump + confetti celebration             |
| Success toast appears  | Cheers + confetti (auto-detected in the DOM)  |
| Error toast appears    | Concerned / confused, thinking                |
| Scroll                 | Strolls alongside the page                    |
| Idle 5 / 10 / 20 min   | Goes home → tea/reading → sleeps              |
| Return after idle      | Wakes, stretches, waves                       |
| Click EON              | Random reaction (wave/dance/cheer/heart)      |

Notification detection is heuristic (matches `toast`, `alert`, `success`, `error`,
`role="alert"`, etc.). Tune `_watchNotifications()` in `event-tracker.js` to match
your app's exact markup for best results.

---

## Configuration

Edit `config/settings.php` (PHP host) **or** the `DEFAULTS` block in `js/main.js`
(static host) — they mirror each other. Toggle subsystems via `features`:
`pet`, `home`, `speech`, `particles`, `dayNight`, `sound`. Adjust idle timings and the
palette there too.

---

## Persistence & memory

* `php/save-state.php` / `load-state.php` — file-based JSON store (one file per user
  key under `assets/.state/`). No database.
* `php/memory-manager.php` — shared store helper.
* Front-end (`ai-core.js`) tries PHP first, falls back to `localStorage`. A stable
  per-browser `eon-user-key` identifies the user.

EON remembers: first-seen date, visit count, affection score, last emotion, activity
count — the foundation for the roadmap's memory phase.

---

## Future AI roadmap

`api/future-ai-endpoints.php` already speaks the contract `ai-core.think()` expects
(`{ intent, message, context } → { ok, reply, emotion }`). Wiring a real model later
means filling in one `eon_think()` function — **no front-end changes**.

1. Living companion ✅ (this release)
2. Voice interaction
3. Memory system (semantic recall)
4. Workflow learning
5. Personalized assistance
6. Full AI coworker

---

## Performance

* Orthographic, pixel-mapped scene; `low-power` WebGL; pixel-ratio capped at 2.
* Pooled particles, throttled mouse handling, `dt` clamped after tab-away.
* Passive/capture listeners only — never blocks or delays the host app.
* Hide on small screens by adding class `eon-hide-mobile` to `#eon-layer`.

To turn EON off for a user, the **✕** chip sets `localStorage['eon-disabled']='1'`;
clear it to bring EON back.
