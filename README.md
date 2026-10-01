# ⚙️ Clockling

A live **zerglings vs marines battle** with a clock on top, packaged as a
**phone widget (Android)** and a **Windows desktop widget**.

Time on top. Total war underneath.

## Status

- ✅ Working web **preview** (battle sim + clock + live settings panel with save/revert).
- 🚧 Being converted into Android + Windows widgets.

## Unit rules

Each unit follows a short, fixed set of rules (kept intentionally simple):

**Swarm** (lings + banes)
- Lings and banes chained within `allyRadius` of each other form one swarm, and the
  swarm decides as a unit.
- It attacks when its strength (ling 1, bane 2) is at least `attackGroupSize` (capped at
  `maxLings`) **and** at least `attackOdds` x the target marine group (every marine within
  weapon range of the target), so it masses up in proportion to what it faces.
- A cornered swarm (marines already inside 70% of their range) fights at half odds
  rather than run.
- Once committed it keeps attacking while it holds half of both, so it doesn't flicker
  at the threshold. A berserk baneling in the swarm always sends it in.

**Zergling**
1. **Flee** - any marine within `marineScanRadius` (at least 1.25x marine range): run from
   all nearby marines toward the hive at `lingFleeSpeedMult`, sliding along walls.
2. **Guard** - otherwise flock as a boids swarm (separation, alignment, cohesion) around the
   hive, the safe spot where new eggs are laid, so hatchlings start inside the swarm.
3. **Attack** - charge the nearest marine whenever the swarm attacks.
4. **Berserk** - catch berserk from a berserk bane within `berserkCatchRadius` and charge
   at berserk speed. It ends when the swarm calls off the attack, unless
   `berserkUntilDeath` is on.

**Baneling**
1. **Guard** - same as zerglings.
2. **Berserk** - charge with an attacking swarm, or once `berserkBanes` banelings are
   alive (counting itself), and explode on contact. Banelings never lose berserk.

**Marine** (with `marineTactics` on)
0. **Spawn** - waves arrive in pairs, side by side, from the map edge farthest from the
   zerg, and march straight in at `marineEntrySpeed` until `marineEntryDepth` inside.
1. **Kite** - back away (toward the squad) when damaged below `marineFleeHpPct` or a zerg
   is closer than `marineKiteFrac` x weapon range.
2. **Hold and shoot** - a zerg is in range: stand and fire.
3. **Regroup** - further than `marineGroupRadius` from the squad: close up.
4. **Advance** - push toward the nearest zerg, unless outnumbered 2:1 on supply
   (ling/bane = 0.5, marine = 1); then hold with the squad.

All units steer smoothly toward their chosen heading instead of snapping to it.

Each rule maps to a clearly-named parameter (`attackGroupSize`, `berserkBanes`,
`attackOdds`, …). See `TUNING.md` for the full list and every setting's
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
