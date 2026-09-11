# Clockling — build-out brief

**Goal:** turn the watch-face battle sim into a **phone widget (Android)** and a
**Windows desktop widget**, with a proper settings system. The old Gear Fit 2 watch
(overheats in minutes) is abandoned; repo `gearfit` is mothballed. This repo is the
fresh start.

Everything here is **local-first** — no pushing to remotes unless explicitly asked.

---

## 1. What's already here (working)

- `node server.js` → `http://127.0.0.1:8080/preview.html` — live battle sim
  (zerglings/banelings vs marines) + clock + weather + a live tuning panel.
- Battle sim: `app/js/swarm.js` (all logic + `TUNING` defaults).
- Clock/battery/tap glue: `app/js/main.js` — **still has watch-era code to strip**.
- Weather + internet clock: `app/js/weather.js` (Open-Meteo, no API key).
- Base settings: `app/js/settings.js`.
- Sprites: `app/images/` (lings, banes, eggs, marines incl. `marine_walk*` + `marine_new*`).
- `bake_tuning.py` — regex-bakes tuned values back into `swarm.js` defaults.
- Docs: `README.md`, `TUNING.md`.

## 2. Immediate cleanup (do first)

1. **Branding:** rename "Zerg Desk" → "Clockling" in `app/index.html`, `preview.html`,
   `server.js` log line, comments. Keep package/bundle ids consistent.
2. **Remove "docked":** `app/js/main.js` line ~85 sets `elBatt.textContent = "docked"`
   when running outside Tizen (the browser preview has no battery API). In the widgets
   there is no "docked" state — remove that string and either show real battery (Android/
   Windows) or hide the battery element.
3. **Strip Tizen code from `main.js`:** the `window.tizen` block (power request,
   screen-state listener, `tizen.systeminfo` battery). Replace with platform adapters
   (see §5). Keep the clock/tap logic.
4. **`app/index.html`** references a Tizen-style layout (`#swarm` 216×432, `#face`).
   Make the canvas responsive and resolution-driven by `TUNING.mapW/mapH`.

## 3. Settings system (required)

- **Visible vs Advanced:** use the `Class` column in `TUNING.md`. Visible keys go on the
  main settings screen; Advanced keys go in a collapsible "Advanced" section.
- **Edit + save + revert:**
  - Edit any key (number inputs; integer vs float by key).
  - **Save** → persist (web: `localStorage`; Android: `SharedPreferences`/DataStore;
    Windows: a JSON config file).
  - **Revert** → restore the baked default (per key and a "reset all" button).
  - `bake_tuning.py` remains the "commit tuned defaults into the repo" step for the
    web preview; the widget settings UI must not require it (it reads/writes persisted
    settings directly).
- **New settings:**
  - `showWeather` (bool) — hide the weather block.
  - `showClock` (bool) — hide the clock block (battle only).
- The current `preview.html` tuning panel (settings-file dropdown + localStorage presets)
  is a prototype of this; the widget needs a real settings UI, not the dev panel.

## 4. Shared core (architecture)

Refactor so **one** platform-agnostic core drives all targets:

```
core/            # pure ES modules / no DOM
  ├─ sim.js      # battle sim (from swarm.js)
  ├─ tuning.js   # TUNING defaults + overrides + save/revert
  ├─ settings.js # SETTINGS + persistence interface
  └─ clock.js    # clock + weather (from main.js/weather.js, de-Tizen-ified)
targets/
  ├─ web/        # preview.html (dev + tuning)
  ├─ android/    # widget
  └─ windows/    # widget
```

Keep the sim drawing to a canvas; each target gives it a `<canvas>` (web), a `Bitmap`
(Android), or a window surface (Windows).

## 5. Android widget — approach & constraints

- **Reality check:** Android home-screen widgets are throttled — `RemoteViews` cannot
  run a continuous canvas/game loop at high fps (updates are ~1/sec best case and
  battery-taxing; animations aren't allowed). Plan for a **low-fps, tick-based** widget.
- **Recommended path:** `Jetpack Glance` (Compose-based widget UI) + a renderer that
  draws the sim into a `Bitmap`, updated by a `WorkManager`/foreground service on a
  short interval. Accept ~1 fps; the sim is already step-based (`Swarm.frame(dt)`),
  so it adapts to variable fps.
- **Alternative for smooth animation:** a **live wallpaper** or a full app — note these
  are *not* home-screen widgets. Decide early which the user actually wants.
- Deliverables: Gradle project, `AppWidgetProvider` + Glance widget, settings screen
  (Activity/Compose), persistence, APK/AAB build.

## 6. Windows desktop widget — approach & options

- **Option A (fastest, reuses web core):** a frameless, always-on-bottom window via
  **Tauri** (or Electron) running the existing web core — real canvas, real fps,
  click-through possible. Best for "looks like a widget".
- **Option B (lightweight):** a **Rainmeter** skin (WebView/JS or Lua) — low effort,
  but weaker for an animated canvas sim.
- **Option C (native):** WinUI 3 / WPF with a `Canvas`/`SwapChain` — most control,
  most work.
- Recommended: **Option A (Tauri)** for a true animated widget; revisit if footprint
  matters.

## 7. Deploy to both

- **Web preview:** `node server.js` (dev only).
- **Android:** Gradle build → APK/AAB; sideload or Play.
- **Windows:** Tauri/Electron installer (or Rainmeter .rmskin).
- Aim: same `core/` + `tuning.js` defaults shipped to all three; a single "set defaults
  then build all targets" script is the goal (later milestone).

## 8. Suggested order of work

1. Cleanup + rename (§2) — keep the web preview green.
2. Settings system in the web preview (§3) — proves save/revert before porting.
3. Split out `core/` (§4) — no behaviour change, just structure.
4. Android widget (§5) — tick-based, 1 fps.
5. Windows widget (§6) — Tauri.
6. Deploy story (§7) + docs.

---

## Hand-off checklist (next agent)

- [ ] Rename Zerg Desk → Clockling everywhere.
- [ ] Remove "docked" + Tizen code from `main.js`.
- [ ] Build settings UI: Visible + Advanced sections, save, per-key revert, reset all.
- [ ] Add `showWeather` / `showClock` settings.
- [ ] Extract `core/` (sim/tuning/settings/clock) from `app/`.
- [ ] Android widget (Glance + Bitmap renderer, ~1 fps).
- [ ] Windows widget (Tauri, frameless always-on-bottom).
- [ ] Document + script deployment for both platforms.
