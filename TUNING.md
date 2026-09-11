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

## Map & resolution

| Key | Default | Meaning | Class |
|---|---|---|---|
| `mapW` | 216 | Battlefield width (px). Set to the widget's canvas width. | Advanced |
| `mapH` | 432 | Battlefield height (px). Set to the widget's canvas height. | Advanced |

## Max units

| Key | Default | Meaning | Class |
|---|---|---|---|
| `maxLings` | 8 | Max zerglings on screen at once. | Visible |
| `maxBanes` | 1 | Max banelings on screen at once. | Visible |
| `maxMarines` | 3 | Max marines on screen at once. | Visible |

## Zerg (zerglings, banelings, eggs)

| Key | Default | Meaning | Class |
|---|---|---|---|
| `respawnInterval` | 2 | Seconds between ling-egg refill batches. | Visible |
| `respawnBatch` | 2 | Eggs spawned per refill batch. | Visible |
| `eggTime` | 8.5 | Seconds until an egg hatches. | Visible |
| `eggHatchMult` | 1.25 | When an egg hatches, one other egg speeds up by this much. | Advanced |
| `morphAge` | 4 | A ling must live this long before it can morph into a baneling egg. | Visible |
| `morphCooldown` | 2 | Seconds between successful morphs. | Visible |
| `morphChancePerSec` | 1 | Chance per second an eligible ling starts morphing. | Visible |
| `lingHp` | 100 | Zergling hit points. | Visible |
| `baneHp` | 140 | Baneling hit points. | Visible |
| `lingBiteDamage` | 10 | Damage per zergling bite. | Visible |
| `lingBiteInterval` | 0.2 | Seconds between bites. | Visible |
| `baneSplashDamage` | 90 | Damage a baneling deals to every marine in blast radius. | Visible |
| `baneSplashR` | 75 | Baneling blast radius (px). | Visible |
| `lingAllyRadius` | 40 | Distance that counts as "next to" another ling. | Advanced |
| `lingAllyMin` | 18 | Lings need at least this many nearby allies to charge (unless a baneling is out). | Visible |
| `lingBaneAllyMin` | 1 | *(currently unused in code)* intended: banes needed when marines are maxed. | Advanced |
| `lingFleeRadius` | 140 | Radius of the "few marines nearby" check. | Advanced |
| `lingFleeMarineMin` | 3 | Below this many nearby marines, lings attack even alone. | Advanced |
| `lingBerserkMult` | 1.5 | Speed multiplier while a ling is berserk. | Visible |
| `lingBerserkBanes` | 2 | Lings need at least this many banes alive before going berserk. | Visible |
| `lingSeekCooldown` | 3 | Seconds before a ling may seek (bunch toward) another ling again. | Advanced |
| `lingSeekPairCooldown` | 5 | Seconds a sought ling won't seek its seeker back. | Advanced |

## Terran (marines)

| Key | Default | Meaning | Class |
|---|---|---|---|
| `marineSpawnRateMult` | 1.5 | >1 spawns marines faster. | Visible |
| `marineWaveLo` | 30 | Seconds after all marines die until the next wave (min). | Visible |
| `marineWaveHi` | 32 | … (max). | Visible |
| `marineRespawnLo` | 10 | Seconds between marine respawns while marines are alive (min). | Visible |
| `marineRespawnHi` | 14 | … (max). | Visible |
| `marineSpawnGap` | 1 | Seconds between marines within one wave. | Visible |
| `marineSpawnInset` | 6 | How many px off-screen marines spawn. | Advanced |
| `marineWaveSizeLo` | 6 | Min marines per wave (when none alive). | Visible |
| `marineWaveSizeHi` | 8 | Max marines per wave. | Visible |
| `marineRespawnSizeLo` | 2 | Min marines per respawn cycle (while alive). | Visible |
| `marineRespawnSizeHi` | 4 | Max marines per respawn cycle. | Visible |
| `marineHp` | 100 | Marine hit points. | Visible |
| `marineShootDamage` | 25 | Damage per marine shot. | Visible |
| `marineShootInterval` | 0.4 | Seconds between shots. | Visible |
| `marineRangeMult` | 3 | Weapon range = `marineRangeMult` × `marineW`. | Visible |
| `marineFleeHpPct` | 0.9 | Marines only flee lings below this HP fraction. | Advanced |
| `marineFleeRangeMult` | 1.5 | Lings flee only inside this × marine range. | Advanced |
| `marineGroupWeight` | 0.5 | Pull toward other marines. | Advanced |
| `marineAwayWeight` | 1 | Push away from zerg. | Advanced |
| `marineTurnRate` | 0.25 | How fast marines steer. | Advanced |
| `marineHealPct` | 0.10 | Marines heal this fraction of max HP per tick. | Advanced |
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
| `lat` | 51.5074 | Latitude for weather (Open-Meteo). |
| `lon` | -0.1278 | Longitude for weather. |
| `city` | "London" | City label under the clock. |
| `hour24` | true | 24h vs 12h clock. |
| `showSeconds` | true | Show seconds. |
| `critterCount` | 10 | Legacy initial-spawn count (kept for the preview). |
| `critterSpeed` | 1.0 | Global zerg movement speed multiplier. |

## New settings to add (see BRIEF.md)

- `showWeather` / `showClock` — hide the weather block / clock block.
- Settings persistence + "revert to default" (per key or per group).
