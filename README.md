# ⚙️ Clockling

A live **zerglings vs marines battle** with a clock on top, packaged as a
**phone widget (Android)** and a **Windows desktop widget**.

Time on top. Total war underneath.

## Status

- ✅ Working web **preview** (battle sim + clock + live settings panel with save/revert).
- 🚧 Being converted into Android + Windows widgets.

## Unit rules

Each unit follows a short, fixed set of rules (kept intentionally simple):

**Zergling**
1. **Guard** — avoid nearby marines and flock together around the eggs
   (starling-murmuration style, wherever the eggs are).
2. **Group attack** — attack when `attackGroupSize` allies are within `allyRadius`
   **and** the target marine's cluster (marines within `marineGroupRadius`) is no
   bigger than `maxEngageMarines`.
3. **Berserk** — catch berserk from a berserk bane within `berserkCatchRadius`, then
   charge at berserk speed. Cancel and retreat when outnumbered, unless
   `berserkUntilDeath` is on.
4. **Fall back** — alone, or facing too many marines, return to the safe quadrant.

**Baneling**
1. **Guard** — same as zerglings: avoid marines and flock around the eggs.
2. **Berserk** — when `berserkBanes` banelings are alive (counting itself), charge and
   explode on contact. Banelings never lose berserk once they have it.

**Marine** (with `marineTactics` on)
1. **Flee / kite** — back away if damaged or a zerg is in weapon range.
2. **Regroup** — outnumbered, move toward the closest marine.
3. **Advance** — otherwise push toward the nearest zerg.

Each rule maps to a clearly-named parameter (`attackGroupSize`, `berserkBanes`,
`maxEngageMarines`, …). See `TUNING.md` for the full list and every setting's
**Core / Normal / Advanced** tier.

## Quickstart (preview)

```bash
node server.js
# open http://127.0.0.1:8080/preview.html
```

The preview toolbar has **Time** (1x/2x/5x/10x game speed) and **Units** (1x/2x/5x/10x
population) dropdowns — both apply live without resetting the simulation.

## Repo layout

```
clockling/
├─ app/                 # the battle sim + clock web app (platform-agnostic core)
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/
│  │  ├─ swarm.js       # battle sim (all game logic + TUNING defaults)
│  │  ├─ main.js        # clock/tap glue
│  │  ├─ settings.js    # base SETTINGS + persisted overrides
│  │  ├─ tuning-meta.js # TUNING/SETTINGS metadata (visibility, defaults)
│  │  └─ settings-ui.js # load/save/revert settings to local storage
│  └─ images/           # sprite frames (lings, banes, marines, eggs)
├─ preview.html         # browser sim + live tuning panel
├─ server.js            # zero-dep static server for the preview
├─ bake_tuning.py       # bakes tuned TUNING values back into swarm.js defaults
├─ TUNING.md            # full reference of every tunable + visibility class
└─ BRIEF.md             # the build-out brief for the next agent
```

## Docs

- **[BRIEF.md](BRIEF.md)** — the plan: preview → widget, settings model, Android + Windows widget approaches, deployment.
- **[TUNING.md](TUNING.md)** — every `TUNING` value documented, with its Core / Normal / Advanced tier.
