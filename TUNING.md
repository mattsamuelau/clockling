# Settings & tuning reference

Defaults live in exactly one place each:

- **`app/js/tuning-meta.js`** - `TUNING_META.tuning`: the `default` for every TUNING key,
  plus its label, meaning, class and options. `app/js/swarm.js` derives its runtime
  `TUNING` object from these defaults at load.
- **`app/js/settings.js`** - `var SETTINGS = { ... }`: clock, display and battle options.

Both settings screens are built from `tuning-meta.js`, and the ESP32 firmware defaults are
generated from these two files. To change a default, edit the one file above (or run
`python bake_tuning.py <share-link>` to bake exported settings in) and regenerate:
`python gen_docs.py` and `python targets/esp32/tools/gen_assets.py`.

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
  `splatLife`, `splatBase`, `splatFadeStart`, `corpseLife`, `goreSplatLife`,
  `goreCorpseLife`, `baneSplatLifeMult`, `marineSplatScale`, `baneSplatScale`,
  `retargetInterval`, `aimInterval`, `unitCount`, `mapW`, `mapH`.

## Battlefield size (web)

The web battlefield always fills the window. `fieldSize` sets how many logical pixels the
shorter side spans; the sim runs in those logical pixels and is drawn scaled up, crisp at any
resolution. Medium (320) matches the ESP32 panel's proportions, so a battle looks the same on
both.

<!-- BEGIN:TABLES -->

## Zerg Rules

| Key | Default | Meaning | Class |
|---|---|---|---|
| `ovJoinRadius` | 2.5 | Overmind (zergSkill 30%+): only zerg within this of the swarm's front (x marine range) count toward an attack; stragglers rally to the front. | Visible |
| `ovSurround` | 40 | Overmind (zergSkill 50%+): degrees each attacking ling arcs off the straight line so the swarm wraps around the marines. | Visible |
| `ovBaneHold` | true | Overmind (zergSkill 50%+): banes ride in the pack until lings are biting a clump of marines. | Visible |
| `ovBaneClump` | 2 | Overmind: marines that must stand inside a bane's splash before it rolls in. | Visible |
| `ovBaneMaxHold` | 6 | Overmind: longest a bane waits in the pack (s). | Visible |
| `ovFrontMorph` | 0.8 | Overmind: how strongly morphs pick lings at the front line / near the terran spawn (x zergSkill; 0 = oldest lings). | Visible |
| `ovBaneVanguard` | 0.5 | Overmind: share of a committing swarm's banes that lead at ling pace to break the marine line (the rest hold in the pack for a clump). | Visible |
| `ovGuardBanes` | true | Overmind (zergSkill 40%+): up to 3 idle lings step between a hunted baneling and its hunter to draw fire, peeling off below half HP. | Visible |
| `zergNoHope` | 0.35 | A committed swarm fights to the death unless the whole swarm drops below this share of the strength the fight needs (attackOdds x marines). | Visible |
| `zergSmarts` | true | A swarm ready to attack stalks first, circling the marines just out of range, and only commits when cornered, overwhelming them or out of patience (off = it charges straight in). | Visible |
| `zergPatience` | 8 | zergSmarts: seconds a stalking swarm circles before it attacks anyway. | Visible |
| `zergAllInOdds` | 1.5 | zergSmarts: a stalking swarm attacks at once when it has this many times attackOdds (0 = never). | Visible |
| `zergStandoff` | 1.3 | zergSmarts: stalking ring radius (x marine range). | Advanced |
| `zergCornerDist` | 0.18 | zergSmarts: a swarm this close to walls (x board short side) with marines near counts as cornered and attacks. | Advanced |
| `attackGroupSize` | 14 | Minimum swarm strength (ling 1, bane 2) to attack; capped at maxLings. | Visible |
| `lingFleeSpeedMult` | 1.6 | Speed multiplier for lings escaping marines. | Visible |
| `berserkBanes` | 2 | Banelings alive needed to trigger bane berserk. | Visible |
| `berserkUntilDeath` | false | On: berserk never retreats; off: cancels when outnumbered. | Visible |
| `attackOdds` | 2.25 | Swarm strength (ling 1, bane 2) needed per marine in the target group. | Visible |
| `allyRadius` | 45 | Lings/banes this close to each other count as one swarm. | Visible |
| `marineScanRadius` | 140 | Lings flee marines inside this radius (never less than 1.25x marine range). | Visible |
| `marineGroupRadius` | 60 | Radius around a marine used to count its group. | Visible |
| `berserkCatchRadius` | 80 | Lings catch berserk from a berserk bane within this radius. | Visible |

## Zerg Units

| Key | Default | Meaning | Class |
|---|---|---|---|
| `maxLings` | 16 | Max zerglings on screen. | Visible |
| `maxBanes` | 3 | Max banelings on screen. | Visible |
| `lingHp` | 100 | Zergling hit points. | Visible |
| `baneHp` | 140 | Baneling hit points. | Visible |
| `lingBiteDamage` | 10 | Damage per zergling bite. | Visible |
| `lingBiteInterval` | 0.2 | Seconds between bites. | Visible |
| `baneSplashDamage` | 90 | Baneling blast damage. | Visible |
| `baneSplashR` | 61 | Baneling blast radius (px). | Visible |
| `berserkSpeedMult` | 1.5 | Speed multiplier while berserk. | Visible |
| `lingAttackBoostMult` | 1.5 | Speed burst for every ling that joins an attack (berserk lings get the larger of this and berserk speed). | Visible |
| `lingAttackBoostTime` | 3 | Seconds the attack speed burst lasts. | Visible |
| `lingAttackBoostCooldown` | 5 | Seconds after a burst ends before a ling can burst again. | Visible |

## Zerg Lifecycle

| Key | Default | Meaning | Class |
|---|---|---|---|
| `startArmy` | 0.7 | Both sides open the battle with this share of their caps (lings at a hive on one side, a full marine wave from the far edge), so the action starts at once. | Visible |
| `growthRate` | 0.25 | Growth mode: caps grow by this share of their base per minute. | Visible |
| `growthMax` | 6 | Growth mode: caps stop growing at this multiple of their base. | Visible |
| `respawnInterval` | 1.5 | Seconds between ling-egg refill batches. | Visible |
| `zergWaveLo` | 20 | Min seconds after the zerg are wiped out (no lings, banes or eggs) before eggs come back. | Visible |
| `zergWaveHi` | 25 | Max seconds after the zerg are wiped out before eggs come back. | Visible |
| `respawnBatch` | 8 | Eggs spawned per refill batch. | Visible |
| `eggTimeMin` | 7 | Min seconds until an egg hatches. | Visible |
| `eggTimeMax` | 9 | Max seconds until an egg hatches. | Visible |
| `eggHatchMult` | 1.5 | Egg hatch acceleration multiplier. | Advanced |
| `eggHp` | 100 | Egg hit points (eggs act as a tanky shield). | Visible |
| `eggDamageMult` | 0.1 | Fraction of normal damage an egg takes per hit (0.1 = 10%: about 40 shots). | Visible |
| `eggOverlap` | 0 | How much a new egg may overlap another (0 = never touch, 1 = may stack). | Visible |
| `eggMarineClearance` | 0.4 | Eggs are laid at least this far from any marine (fraction of the board's short side), on the far side from the marines. | Visible |
| `morphAge` | 4 | Lings must live this long before morphing. | Visible |
| `morphCooldown` | 2 | Seconds between successful morphs. | Visible |
| `morphChancePerSec` | 1 | Chance per second to start morphing. | Visible |

## Terran Units

| Key | Default | Meaning | Class |
|---|---|---|---|
| `maxMarines` | 6 | Max marines on screen. | Visible |
| `marineHp` | 120 | Marine hit points. | Visible |
| `marineShootDamage` | 25 | Damage per marine shot. | Visible |
| `marineShootInterval` | 0.36 | Seconds between shots. | Visible |
| `marineRangeMult` | 3 | Weapon range multiplier. | Visible |

## Terran Spawning

| Key | Default | Meaning | Class |
|---|---|---|---|
| `marineSpawnMode` | 0 | Where marine waves enter: 0 far from the zerg, 1 behind the marines already fighting, 2 strategist (reinforce while they hold, land far away when they're overrun). | Visible |
| `marineEntrySpeed` | 1.5 | Speed multiplier while new marines march in from off-screen. | Visible |
| `marineEntryDepth` | 0.09 | March-in boost stops this far inside the edge (x shorter side). | Visible |
| `marineSpawnRateMult` | 1.5 | Marine spawn rate multiplier. | Visible |
| `marineWaveLo` | 30 | Min seconds after all marines die. | Visible |
| `marineWaveHi` | 32 | Max seconds after all marines die. | Visible |
| `marineWaveSizeLo` | 6 | Min marines per wave. | Visible |
| `marineWaveSizeHi` | 6 | Max marines per wave. | Visible |
| `marineRespawnLo` | 8 | Min seconds between respawns. | Visible |
| `marineRespawnHi` | 10 | Max seconds between respawns. | Visible |
| `marineRespawnSizeLo` | 2 | Min marines per respawn. | Visible |
| `marineRespawnSizeHi` | 2 | Max marines per respawn. | Visible |
| `marineSpawnGap` | 0.5 | Seconds between marines in wave. | Visible |
| `marineSpawnInset` | 6 | Px off-screen spawn distance. | Advanced |

## Terran Behavior

| Key | Default | Meaning | Class |
|---|---|---|---|
| `marineTactics` | true | New marine AI: kite, regroup, or advance. | Visible |
| `marineKiteFrac` | 0.6 | Marines back off from zerg closer than this fraction of their range. | Visible |
| `marineSightMult` | 2 | Marines patrol when no zerg is within this x weapon range. | Visible |
| `marineFleeHpPct` | 0.9 | Marines kite away below this HP fraction. | Advanced |
| `marineGroupWeight` | 0.5 | Pull toward other marines. | Advanced |
| `marineAwayWeight` | 1 | Push away from zerg. | Advanced |
| `marineTurnRate` | 0.25 | Marine steering: share of the turn closed every 1/8 s. | Advanced |
| `marineHealPct` | 0.1 | HP all units heal per tick. | Advanced |
| `marineHealInterval` | 0.5 | Seconds between heal ticks. | Advanced |
| `stimDuration` | 3 | Seconds a stimpack lasts. | Visible |
| `stimCooldown` | 10 | Seconds before a marine can stim again. | Visible |
| `stimSpeedMult` | 2 | Speed multiplier while stimmed. | Visible |
| `stimHpCost` | 0.5 | Share of MAX HP each stimpack costs (it can kill: green marines may stim themselves to death). | Visible |
| `stimRegenMult` | 0 | HP regen multiplier after a stim (for stimRegenTime). | Visible |
| `stimRegenTime` | 20 | Seconds of slowed regen from the moment a marine stims. | Visible |
| `stimGroupMax` | 3 | Only marine groups this small (or smaller) stim to escape. | Visible |
| `stimRegroupDist` | 0.3 | Lone marines farther than this from the main mob (x board short side) stim back to it. | Visible |
| `marineKiteSpeed` | 0.5 | Speed multiplier while kiting / running back to the mob for green marines (on top of skill footwork and stim); rises to 1x at max skill. | Visible |
| `marineUpright` | true | Marines stand upright (feet down) when not firing, facing and leaning with their squad's walk; off = they always face the closest zerg, leaning at most marineMaxTilt. | Visible |
| `marineWalkTilt` | 25 | marineUpright: max degrees a marine leans from upright while walking (it turns fully to its target when firing). | Visible |
| `marineMicro` | true | Per-marine micro (50%+ skill), like SC2 bots: stutter-step back while the gun cools down, fire when ready, and split away from banelings. | Visible |
| `marineBaneHunt` | true | The 1-2 closest healthy marines (60%+ skill) stim forward and shoot a bane that isn't charging - in the open or stuck among them - keeping out of its splash. | Visible |
| `marineStimAttack` | true | A healthy marine group (3+, 60%+ skill) in a fight it can win stims together and pushes in hard. | Visible |
| `marineSquads` | true | Split kiting: a big marine mob splits into control groups that kite independently, taking turns to backstep and peeling apart to pull the swarm apart (off = the whole mob kites as one). | Visible |
| `marineCtrlGroups` | 4 | marineSquads: most control groups one mob splits into (2 below 75% skill, none below 50%). | Visible |
| `marineCtrlGroupSize` | 6 | marineSquads: marines per control group (a mob of 12 makes 2 groups, 40 makes marineCtrlGroups). | Visible |
| `marineFlank` | true | Marines advance on a flank instead of straight at the zerg. | Visible |
| `marineStimPush` | true | Stimmed elite marines (75%+ skill) push in while firing and kite back later. | Visible |
| `marineEliteKite` | true | Elite marines (75%+ skill) stutter-step whenever lings close in, and kite at full footwork speed. | Visible |
| `marineFlankAngle` | 45 | Degrees off the direct line marines advance at, so they come in on a flank (scaled by skill; straight in when they overwhelm 3:1). | Visible |
| `marineMaxTilt` | 45 | Max degrees a marine sprite leans from level when aiming up or down (feet stay down). | Visible |
| `marineSkillTopSpeed` | 3 | Movement multiplier at max marine skill (1x at half skill). | Advanced |

## Movement

| Key | Default | Meaning | Class |
|---|---|---|---|
| `zergSpeed` | 1.2 | Zerg base speed multiplier. | Visible |
| `terranSpeed` | 1.35 | Terran base speed multiplier. | Visible |

## Visuals

| Key | Default | Meaning | Class |
|---|---|---|---|
| `lingW` | 30 | Zergling sprite width (px). | Advanced |
| `baneW` | 39 | Baneling sprite width (px). | Advanced |
| `marineW` | 42 | Marine sprite width (px). | Advanced |
| `eggW` | 21 | Egg sprite width (px). | Advanced |
| `lingBump` | 10 | Zergling collision radius. | Advanced |
| `baneBump` | 12 | Baneling collision radius. | Advanced |
| `marineBump` | 12 | Marine collision radius. | Advanced |
| `splatLife` | 1.21 | Death-splat lifetime (s). | Advanced |
| `splatBase` | 7 | Splat start radius (px). | Advanced |
| `splatFadeStart` | 0.6 | Splat fade start fraction. | Advanced |
| `corpseLife` | 2.2 | Dead sprite lingers (s). | Advanced |
| `goreSplatLife` | 16.2 | Gore mode: death splat lingers (s). | Advanced |
| `goreCorpseLife` | 19.2 | Gore mode: corpse lingers (s). | Advanced |
| `baneSplatLifeMult` | 0.3 | Green (baneling) splat lifetime x red splat lifetime. | Advanced |
| `marineSplatScale` | 1.4 | Marine splat scale. | Advanced |
| `baneSplatScale` | 2.5 | Baneling splat scale. | Advanced |
| `retargetInterval` | 0.5 | Ling/bane retarget interval (s). | Advanced |
| `aimInterval` | 0.3 | Marine re-aim interval (s). | Advanced |

## Map

| Key | Default | Meaning | Class |
|---|---|---|---|
| `mapW` | 216 | Battlefield width (px). | Advanced |
| `mapH` | 432 | Battlefield height (px). | Advanced |

## SETTINGS (not `TUNING`) - in `app/js/settings.js`

| Key | Default | Meaning | Applies to |
|---|---|---|---|
| `showClock` | true | Show the clock. | both |
| `hour24` | true | 24-hour clock (off = 12-hour). | both |
| `showSeconds` | false | Show seconds. | both |
| `clockPosition` | 0 | Where the clock sits. | both |
| `clockBehind` | true | Draw the clock behind the units. | both |
| `clockScale` | 0.55 | Clock size. | web |
| `timeZone` | auto | Time zone (auto = this device). | web |
| `gameSpeed` | 2.5 | Speed multiplier. | both |
| `unitScale` | 2 | Unit multiplier (population, waves, spawn rate). | both |
| `marineSkill` | 0.8 | Marine smarts: 0 = stand and die, 1 = one marine can dance around a swarm. | web |
| `zergSkill` | 0.8 | Overmind smarts: 0 = every swarm piles in, 1 = backup gathers, lings surround, banes wait for a clump. | web |
| `zergBrain` | 0 | Overmind brain: Default = the tuning panel, Trained = the self-play champion (tools/sim/train.js). | web |
| `terranBrain` | 0 | Commander brain: Default = the tuning panel, Trained = the self-play champion (tools/sim/train.js). | web |
| `unitCount` | 10 | Starting zerglings. | both |
| `unitSpeed` | 1 | Movement speed multiplier for every unit. | both |
| `growthMode` | false | Growth mode: both sides keep getting reinforcements beyond the caps until one wipes the other off the board, then caps reset. | web |
| `showHealthBars` | true | Show unit health bars. | both |
| `showKills` | true | Marine kill marks (one per ling killed). | web |
| `gore` | true | Gore mode: splats and corpses linger (splat 16.2 s, corpse 19.2 s). | both |
| `fieldSize` | 1280 | Battlefield size (smaller = bigger units). | web |
| `soundOn` | true | Play sound effects. | web |
| `soundVolume` | 30 | Sound volume. | web |
| `soundRate` | 1 | How often chatter and voicelines play (0 = never). | web |
| `musicTrack` | 6 | Background music. | web |
| `musicVolume` | 30 | Music volume. | web |
| `landscape` | true | Horizontal screen (off = vertical). | ESP32 |

ESP32-only device settings (`brightness`, `fpsCap`) are defined in `targets/esp32/tools/gen_assets.py`.

<!-- END:TABLES -->
