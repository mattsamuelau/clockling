# ⚙️ Clockling

A live **zerglings vs marines battle** with a clock and weather on top — being reborn as a
**phone widget (Android)** and a **Windows desktop widget**, after the original Gear Fit 2
watch-face version (repo `gearfit`) was mothballed.

Time & weather on top. Total war underneath.

## Status

- ✅ Working web **preview** (battle sim + clock/weather + live tuning panel) — carried over from the watch repo.
- 🚧 Being converted into Android + Windows widgets.

## Quickstart (preview)

```bash
node server.js
# open http://127.0.0.1:8080/preview.html
```

## Repo layout

```
clockling/
├─ app/                 # the battle sim + clock/weather web app (platform-agnostic core)
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/
│  │  ├─ swarm.js       # battle sim (all game logic + TUNING defaults)
│  │  ├─ main.js        # clock, battery/tap glue (has watch-era code to strip)
│  │  ├─ weather.js     # Open-Meteo weather + TimeSync (internet clock)
│  │  └─ settings.js    # base SETTINGS + URL overrides
│  └─ images/           # sprite frames (lings, banes, marines, eggs)
├─ preview.html         # browser sim + live tuning panel
├─ server.js            # zero-dep static server for the preview
├─ bake_tuning.py       # bakes tuned TUNING values back into swarm.js defaults
├─ TUNING.md            # full reference of every tunable + visibility class
└─ BRIEF.md             # the build-out brief for the next agent
```

## Docs

- **[BRIEF.md](BRIEF.md)** — the plan: preview → widget, settings model, remove "docked", hide weather/clock, Android + Windows widget approaches, deployment.
- **[TUNING.md](TUNING.md)** — every `TUNING` value documented (default, meaning, visible vs advanced).
