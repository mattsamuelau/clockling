# Settings & tuning reference

Two files hold the web defaults and the ESP32 base defaults:

- **`app/js/swarm.js`** - `var TUNING = { ... }`: the battle rules and balance (this file).
- **`app/js/settings.js`** - `var SETTINGS = { ... }`: clock, display and battle options.
- **`app/js/tuning-meta.js`** - the label, meaning, Visible/Advanced class and options for
  every key. Both settings screens are generated from it.

How values are layered:

- **Web (`clockling.html`)**: defaults, then what you saved in this browser (localStorage),
  then a shared link's `#s=...` settings. Change anything in the settings drawer and it
  applies live and saves automatically. *Reset all* returns to the defaults.
- **ESP32**: defaults generated from these files with target-specific overrides (see
  `targets/esp32/tools/gen_assets.py`, which scales sizes and radii by 0.75 for the
  240x320 panel), then values saved on the device (NVS) from its settings page at
  `http://clockling.local`.
- **Testing**: `?tun_<key>=<number>` in the URL overrides a TUNING value at load (used by
  headless test harnesses).

**Visibility classes**: **Visible** keys are shown up front; **Advanced** ones sit in the
collapsible advanced section. All are editable and revertable.

Tables below list web defaults. ESP32 retains its prior values for `maxLings` (10),
`maxMarines` (7), `eggHatchMult` (1), `clockBehind` (false), and `gameSpeed` (1), as set
in `targets/esp32/tools/gen_assets.py`.

## Parameter tiers

Settings are grouped into three tiers:

- **Core** — the unit ruleset and population caps. Changing these changes *what units
  do*, not just how strong they are:
  `maxLings`, `maxBanes`, `maxMarines`, `attackGroupSize`, `berserkBanes`,
  `berserkUntilDeath`, `attackOdds`, `allyRadius`, `marineScanRadius`,
  `marineGroupRadius`, `berserkCatchRadius`,
  `eggTimeMin`, `eggTimeMax`, `marineTactics`, `marineKiteFrac`.
- **Normal** — the usual balance knobs (health, damage, speeds, spawn pace):
  `lingHp`, `baneHp`, `marineHp`, `lingBiteDamage`, `lingBiteInterval`,
  `baneSplashDamage`, `baneSplashR`, `marineShootDamage`, `marineShootInterval`,
  `marineRangeMult`, `zergSpeed`, `terranSpeed`, `berserkSpeedMult`,
  `respawnInterval`, `respawnBatch`, `morphAge`, `morphCooldown`,
  `morphChancePerSec`, `marineSpawnRateMult`, `marineWaveLo`, `marineWaveHi`,
  `marineWaveSizeLo`, `marineWaveSizeHi`, `marineFleeHpPct`, `hour24`,
  `showSeconds`, `showClock`, `landscape`, `unitSpeed`.
- **Advanced** — visuals, collisions, and fine timing; rarely needed:
  `eggHatchMult`, `marineRespawnLo`, `marineRespawnHi`, `marineRespawnSizeLo`,
  `marineRespawnSizeHi`, `marineSpawnGap`, `marineSpawnInset`, `marineGroupWeight`,
  `marineAwayWeight`, `marineTurnRate`, `marineHealPct`, `marineHealInterval`,
  `lingW`, `baneW`, `marineW`, `eggW`, `lingBump`, `baneBump`, `marineBump`,
  `splatLife`, `splatBase`, `splatFadeStart`, `corpseLife`, `marineSplatScale`,
  `baneSplatScale`, `retargetInterval`, `aimInterval`, `unitCount`, `mapW`, `mapH`.

## Map & resolution

| Key | Default | Meaning | Class |
|---|---|---|---|
| `mapW` | 216 | Battlefield width (px). Set to the widget's canvas width. | Advanced |
| `mapH` | 432 | Battlefield height (px). Set to the widget's canvas height. | Advanced |

## Max units

| Key | Default | Meaning | Class |
|---|---|---|---|
| `maxLings` | 16 | Max zerglings on screen at once. | Visible |
| `maxBanes` | 3 | Max banelings on screen at once. | Visible |
| `maxMarines` | 6 | Max marines on screen at once. | Visible |

## Movement

| Key | Default | Meaning | Class |
|---|---|---|---|
| `zergSpeed` | 1.2 | Zerg base speed multiplier. | Visible |
| `terranSpeed` | 1.2 | Terran (marine) base speed multiplier. | Visible |

## Zerg (zerglings, banelings, eggs)

| Key | Default | Meaning | Class |
|---|---|---|---|
| `respawnInterval` | 1.5 | Seconds between ling-egg refill batches. | Visible |
| `respawnBatch` | 8 | Eggs spawned per refill batch. | Visible |
| `eggTimeMin` | 7 | Min seconds until an egg hatches. | Visible |
| `eggTimeMax` | 9 | Max seconds until an egg hatches. | Visible |
| `eggHatchMult` | 1.5 | When an egg hatches, one other egg speeds up by this much. | Advanced |
| `morphAge` | 4 | A ling must live this long before it can morph into a baneling egg. | Visible |
| `morphCooldown` | 2 | Seconds between successful morphs. | Visible |
| `morphChancePerSec` | 1 | Chance per second an eligible ling starts morphing. | Visible |
| `lingHp` | 100 | Zergling hit points. | Visible |
| `baneHp` | 140 | Baneling hit points. | Visible |
| `lingBiteDamage` | 10 | Damage per zergling bite. | Visible |
| `lingBiteInterval` | 0.2 | Seconds between bites. | Visible |
| `baneSplashDamage` | 90 | Damage a baneling deals to every marine in blast radius. | Visible |
| `baneSplashR` | 61 | Baneling blast radius (px). | Visible |
| `attackGroupSize` | 10 | Minimum swarm strength (ling 1, bane 2) to attack; capped at `maxLings`. | Visible |
| `berserkBanes` | 2 | Banelings alive needed to trigger bane berserk. | Visible |
| `berserkUntilDeath` | false | On: berserk never retreats; off: cancels when outnumbered. | Visible |
| `attackOdds` | 1.5 | Swarm strength (ling 1, bane 2) needed per marine in the target group. | Visible |
| `lingFleeSpeedMult` | 1.6 | Speed multiplier for lings escaping marines. | Visible |
| `allyRadius` | 45 | Lings/banes this close to each other count as one swarm (keep above ~2x `lingBump` + 8). | Visible |
| `marineScanRadius` | 140 | Lings flee marines inside this radius (never less than 1.25x marine range). | Visible |
| `marineGroupRadius` | 60 | Radius around a marine used to count its group. | Visible |
| `berserkCatchRadius` | 80 | Lings catch berserk from a berserk bane within this radius. | Visible |
| `berserkSpeedMult` | 1.5 | Speed multiplier while berserk. | Visible |

## Terran (marines)

| Key | Default | Meaning | Class |
|---|---|---|---|
| `marineSpawnRateMult` | 1.5 | >1 spawns marines faster. | Visible |
| `marineWaveLo` | 30 | Seconds after all marines die until the next wave (min). | Visible |
| `marineWaveHi` | 32 | … (max). | Visible |
| `marineRespawnLo` | 8 | Seconds between marine respawns while marines are alive (min). | Visible |
| `marineRespawnHi` | 10 | … (max). | Visible |
| `marineSpawnGap` | 0.5 | Seconds between marines within one wave. | Visible |
| `marineEntrySpeed` | 1.5 | Speed multiplier while new marines march in from off-screen. | Visible |
| `marineEntryDepth` | 0.09 | The march-in boost stops this far inside the edge (x shorter side). | Visible |
| `marineSightMult` | 2 | Marines patrol when no zerg is within this x weapon range. | Visible |
| `marineSpawnInset` | 6 | How many px off-screen marines spawn. | Advanced |
| `marineWaveSizeLo` | 6 | Min marines per wave (when none alive). | Visible |
| `marineWaveSizeHi` | 6 | Max marines per wave. | Visible |
| `marineRespawnSizeLo` | 2 | Min marines per respawn cycle (while alive). | Visible |
| `marineRespawnSizeHi` | 2 | Max marines per respawn cycle. | Visible |
| `marineHp` | 120 | Marine hit points. | Visible |
| `marineShootDamage` | 25 | Damage per marine shot. | Visible |
| `marineShootInterval` | 0.36 | Seconds between shots. | Visible |
| `marineRangeMult` | 3 | Weapon range = `marineRangeMult` × `marineW`. | Visible |
| `marineFleeHpPct` | 0.9 | Marines kite away below this HP fraction. | Advanced |
| `marineKiteFrac` | 0.6 | Marines back off from zerg closer than this fraction of their range. | Visible |
| `marineGroupWeight` | 0.5 | Pull toward other marines. | Advanced |
| `marineAwayWeight` | 1 | Push away from zerg. | Advanced |
| `marineTurnRate` | 0.25 | Marine steering: share of the remaining turn closed every 1/8 s. | Advanced |
| `marineTactics` | true | Marine AI: kite, hold and shoot, regroup, or advance (off = classic). | Visible |
| `marineHealPct` | 0.10 | All units heal this fraction of max HP per tick. | Advanced |
| `marineHealInterval` | 0.5 | Seconds between heal ticks. | Advanced |

## Visuals & timing

| Key | Default | Meaning | Class |
|---|---|---|---|
| `lingW` | 30 | Zergling sprite width (px). | Advanced |
| `baneW` | 39 | Baneling sprite width (30% larger than ling). | Advanced |
| `marineW` | 42 | Marine sprite width. | Advanced |
| `eggW` | 21 | Egg sprite width (both egg types). | Advanced |
| `lingBump` | 10 | Zergling collision radius. | Advanced |
| `baneBump` | 12 | Baneling collision radius. | Advanced |
| `marineBump` | 12 | Marine collision radius. | Advanced |
| `splatLife` | 1.21 | Death-splat lifetime (s). | Advanced |
| `splatBase` | 7 | Splat start radius (px). | Advanced |
| `splatFadeStart` | 0.6 | Fraction of splat life before it starts fading. | Advanced |
| `corpseLife` | 2.2 | Dead sprite lingers this long, fading. | Advanced |
| `marineSplatScale` | 1.4 | Marine death-splat scale. | Advanced |
| `baneSplatScale` | 2.5 | Baneling death-splat scale. | Advanced |
| `retargetInterval` | 0.5 | Lings/banes retarget this often (anti-jitter). | Advanced |
| `aimInterval` | 0.3 | Marine re-aims this often. | Advanced |

## SETTINGS (not `TUNING`) - in `app/js/settings.js`

| Key | Default | Meaning | Applies to |
|---|---|---|---|
| `showClock` | true | Show the clock. | both |
| `hour24` | true | 24-hour time (off = 12-hour). | both |
| `showSeconds` | false | Show seconds. | both |
| `clockPosition` | 0 | 0 top, 1 middle, 2 bottom, 3 top left, 4 top right, 5 bottom left, 6 bottom right. | both |
| `clockBehind` | true | Draw the clock behind the units instead of on top. | both |
| `clockScale` | 0.55 | Clock size multiplier. | web |
| `timeZone` | auto | IANA zone (e.g. `Europe/London`) or `auto`. The ESP32 has its own POSIX TZ setting. | web |
| `gameSpeed` | 1.5 | Speed multiplier (the Speed slider). | both |
| `unitScale` | 1 | Population multiplier: max units, wave sizes, spawn rate (the Units slider). | both |
| `unitCount` | 10 | Starting zerglings. | both |
| `unitSpeed` | 1.0 | Movement speed multiplier for every unit. | both |
| `showHealthBars` | true | Show unit health bars. | both |
| `showKills` | true | One yellow mark per zergling a marine has killed. | web |
| `showScore` | false | Zerg vs terran supply bar along the top. | web |
| `fieldSize` | 1280 | Battlefield short side in logical px (Small 480, Medium 640, Large 960, Huge 1280). Smaller = bigger units. | web |
| `landscape` | true | Horizontal 320x240 panel (off = vertical 240x320). The web app always fills its window. | ESP32 |

ESP32-only device settings (`brightness`, `fpsCap`) are defined in `targets/esp32/tools/gen_assets.py`.

## Battlefield size (web)

The web battlefield always fills the window. `fieldSize` sets how many logical pixels the
shorter side spans; the sim runs in those logical pixels and is drawn scaled up, crisp at any
resolution. Medium (320) matches the ESP32 panel's proportions, so a battle looks the same on
both.
