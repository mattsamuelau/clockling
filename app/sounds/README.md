# Sounds (web only)

Drop the sound files here. Any short clip the browser can play works
(wav / mp3 / ogg). Missing files are detected on first play and skipped
silently; sounds can be turned off in Settings &gt; Sound effects.

| File | Plays when |
|---|---|
| `ling_chill.wav` | a zergling chills or hatches from an egg |
| `ling_attack.wav` | lings decide to attack / go aggro |
| `ling_die.wav` | a zergling dies |
| `bane_die.wav` | a baneling explodes and kills marines (a bane dying without kills plays `ling_die.wav`) |
| `marine_shoot.wav` | a marine fires |
| `marine_die.wav` | a marine dies |
| `marine_voice.wav` | an idle marine chatters (only while no marine is attacking) |
| `marine_spawn.wav` | a new marine spawns in |
| `music/*.wav` | looping background track (see brief below) |

Names must match exactly - `clockling.html` loads them by name from this folder.

## Sound design brief

Source clips to compile (trim / convert to wav):

| Purpose | Event | Source |
|---|---|---|
| Marine gunfire | `marine_shoot` | YouTube short `hPoYpRRsf0c` - cut a section from the **middle** of the audio |
| Marine chatter (idle) | `marine_voice` | myinstants: `marine-good-to-go-50098`, `rock-and-roll-marine-20680` |
| Marine spawn voiceline | `marine_spawn` | myinstants: `wanna-piece-of-me-boy-marine-64377` |
| Lings attack / go aggro | `ling_attack` | 101soundboards: `zergling-zzewht03` (62043074) |
| Ling dies | `ling_die` | 101soundboards: `zergling-zzedth00` (62041948) |
| Bane explodes (with kills) | `bane_die` | YouTube short `dV748_ZSzws` - cut a section from the **middle** of the audio |
| Ling chill / hatches from egg | `ling_chill` | 101soundboards: `zergling-zzewht00` (62042588) |
| Background music | `music/*` | YouTube `pNt0iVG2VOA` - pull the Starcraft soundtracks: Zerg, Protoss, Terran 1, Terran 2, Terran 3 |

Behaviour rules:

- **Marine chatter** plays only while **no marine is attacking**, one line after
  another, picked randomly - never overlapping. The spawn voiceline plays when a
  marine spawns in.
- **Bane deaths:** `bane_die` plays when a bane explodes and kills at least one
  marine; a bane that dies without killing anything plays the normal `ling_die`.
- **Speed scaling:** sounds must follow `gameSpeed` but stay sane at 5x. Plan:
  clamp the playback rate (e.g. 0.75-2.0x regardless of game speed) and scale the
  per-event `gap` throttle with speed, so triggers never pile up.
- **Config:** add a sound-frequency knob (e.g. `soundRate`) for how often chatter
  and voicelines fire; per-event `gap` already exists in `clockling.html`.
- **Background music:** `music/zerg.wav`, `music/protoss.wav`, `music/terran1..3.wav`
  loop quietly under the SFX, with a **dropdown selector** (`musicTrack`, web only:
  Off / Zerg / Protoss / Terran 1-3). Fade between tracks when switched.

Multiple clips per event (`marine_voice1..2`, spawn variants) need a small loader
update (SOUNDS entries -> arrays). Do that when the clips land.
