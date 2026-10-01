# TUNING reference

Every battle-sim knob lives in `var TUNING = { ... }` at the top of `app/js/swarm.js`.
The preview panel reads these via `?tun_<key>=<number>` URL overrides; defaults are the
values baked into `swarm.js`.

**Visibility classes** (for the widget settings UI):

- **Visible** — user-facing setting in the main settings screen.
- **Advanced** — hidden in an "Advanced" (collapsible) section by default, but still
  editable, saveable, and revertable.

> Revert = restore this key to the baked default. Save = persist to local storage
> (`localStorage` in web; platform storage on Android/Windows).

## Parameter tiers

Settings are grouped into three tiers:

- **Core** — the unit ruleset and population caps. Changing these changes *what units
  do*, not just how strong they are:
  `maxLings`, `maxBanes`, `maxMarines`, `attackGroupSize`, `berserkBanes`,
  `berserkUntilDeath`, `maxEngageMarines`, `allyRadius`, `marineScanRadius`,
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
| `maxLings` | 8 | Max zerglings on screen at once. | Visible |
| `maxBanes` | 3 | Max banelings on screen at once. | Visible |
| `maxMarines` | 3 | Max marines on screen at once. | Visible |

## Movement

| Key | Default | Meaning | Class |
|---|---|---|---|
| `zergSpeed` | 1 | Zerg base speed multiplier. | Visible |
| `terranSpeed` | 1.5 | Terran (marine) base speed multiplier. | Visible |

## Zerg (zerglings, banelings, eggs)

| Key | Default | Meaning | Class |
|---|---|---|---|
| `respawnInterval` | 2 | Seconds between ling-egg refill batches. | Visible |
| `respawnBatch` | 4 | Eggs spawned per refill batch. | Visible |
| `eggTimeMin` | 8 | Min seconds until an egg hatches. | Visible |
| `eggTimeMax` | 10 | Max seconds until an egg hatches. | Visible |
| `eggHatchMult` | 1 | When an egg hatches, one other egg speeds up by this much. | Advanced |
| `morphAge` | 4 | A ling must live this long before it can morph into a baneling egg. | Visible |
| `morphCooldown` | 2 | Seconds between successful morphs. | Visible |
| `morphChancePerSec` | 1 | Chance per second an eligible ling starts morphing. | Visible |
| `lingHp` | 100 | Zergling hit points. | Visible |
| `baneHp` | 140 | Baneling hit points. | Visible |
| `lingBiteDamage` | 10 | Damage per zergling bite. | Visible |
| `lingBiteInterval` | 0.2 | Seconds between bites. | Visible |
| `baneSplashDamage` | 90 | Damage a baneling deals to every marine in blast radius. | Visible |
| `baneSplashR` | 75 | Baneling blast radius (px). | Visible |
| `attackGroupSize` | 5 | Swarm size (lings + banes) needed to attack; capped at `maxLings`. | Visible |
| `berserkBanes` | 2 | Banelings alive needed to trigger bane berserk. | Visible |
| `berserkUntilDeath` | false | On: berserk never retreats; off: cancels when outnumbered. | Visible |
| `maxEngageMarines` | 4 | Largest marine group a swarm will attack. | Visible |
| `allyRadius` | 45 | Lings/banes this close to each other count as one swarm (keep above ~2x `lingBump` + 8). | Visible |
| `marineScanRadius` | 140 | Idle lings keep this far from marines. Keep above marine range (`marineW` x `marineRangeMult`). | Visible |
| `marineGroupRadius` | 60 | Radius around a marine used to count its group. | Visible |
| `berserkCatchRadius` | 80 | Lings catch berserk from a berserk bane within this radius. | Visible |
| `berserkSpeedMult` | 1.5 | Speed multiplier while berserk. | Visible |

## Terran (marines)

| Key | Default | Meaning | Class |
|---|---|---|---|
| `marineSpawnRateMult` | 1.5 | >1 spawns marines faster. | Visible |
| `marineWaveLo` | 30 | Seconds after all marines die until the next wave (min). | Visible |
| `marineWaveHi` | 32 | … (max). | Visible |
| `marineRespawnLo` | 10 | Seconds between marine respawns while marines are alive (min). | Visible |
| `marineRespawnHi` | 14 | … (max). | Visible |
| `marineSpawnGap` | 1 | Seconds between marines within one wave. | Visible |
| `marineEntrySpeed` | 1.5 | Speed multiplier while new marines march in from off-screen. | Visible |
| `marineEntryDepth` | 0.11 | The march-in boost stops this far inside the edge (x shorter side). | Visible |
| `marineSightMult` | 2 | Marines patrol when no zerg is within this x weapon range. | Visible |
| `marineSpawnInset` | 6 | How many px off-screen marines spawn. | Advanced |
| `marineWaveSizeLo` | 6 | Min marines per wave (when none alive). | Visible |
| `marineWaveSizeHi` | 8 | Max marines per wave. | Visible |
| `marineRespawnSizeLo` | 2 | Min marines per respawn cycle (while alive). | Visible |
| `marineRespawnSizeHi` | 4 | Max marines per respawn cycle. | Visible |
| `marineHp` | 100 | Marine hit points. | Visible |
| `marineShootDamage` | 25 | Damage per marine shot. | Visible |
| `marineShootInterval` | 0.4 | Seconds between shots. | Visible |
| `marineRangeMult` | 3 | Weapon range = `marineRangeMult` × `marineW`. | Visible |
| `marineFleeHpPct` | 0.5 | Marines kite away below this HP fraction. | Advanced |
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

## SETTINGS (not `TUNING`) — in `app/js/settings.js`

| Key | Default | Meaning |
|---|---|---|
| `hour24` | true | 24h vs 12h clock. |
| `showSeconds` | true | Show seconds. |
| `showClock` | true | Show the clock block. |
| `showHealthBars` | true | Show unit health bars. |
| `landscape` | false | Horizontal screen (on) or vertical (off). ESP32 rotates the panel live and restarts the battle; the web preview swaps `mapW`/`mapH`. |
| `unitCount` | 10 | Initial unit count on first load. |
| `unitSpeed` | 1.0 | Global unit movement speed multiplier. |

## Widget size presets

The preview exposes three named sizes that set `mapW`/`mapH` (and, in the future, default
unit counts per size):

| Preset | `mapW` × `mapH` |
|---|---|
| Small | 432 × 432 |
| Medium | 864 × 864 |
| Large | 1296 × 1296 |

> Per-size unit defaults (more units on bigger maps) are a deferred feature — see the
> "Resolution presets" note at the bottom of `BRIEF.md`.
