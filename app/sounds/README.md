# Sounds (web only)

The clips here are built from the sources in the brief below by
`python build_sounds.py` (repo root; needs ffmpeg and `pip install yt-dlp curl_cffi`).
Re-cut a clip by editing its start / length in that script and re-running it.
Any clip the browser can play works (wav / mp3 / ogg). Missing files are
detected on first play and skipped silently; sounds can be turned off in
Settings &gt; Sound effects.

| File | Plays when |
|---|---|
| `ling_chill.wav` | a zergling chills or hatches from an egg (follows Chatter) |
| `ling_attack.wav` | lings decide to attack / go aggro |
| `ling_die.wav` | a zergling dies |
| `bane_die.wav` | a baneling explodes and kills marines, or is tapped (a bane dying without kills plays `ling_die.wav`) |
| `marine_shoot.wav` | a marine fires |
| `marine_die1..2.wav` | a marine dies (random pick) |
| `marine_voice1..2.wav` | idle marine chatter, random line (only while no marine is attacking) |
| `marine_spawn.wav` | a new marine spawns in (follows Chatter) |
| `music/*.mp3` | looping background track (see brief below) |

Names must match exactly - `clockling.html` loads them by name from this folder
(`SOUNDS` lists one or more files per event; a random one plays).

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
| Marine dies | `marine_die` | 101soundboards: `marine-tmadth00` (62042568), `marine-tmadth01` (62042583) |
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
- **Background music:** `music/zerg.mp3`, `music/protoss.mp3`, `music/terran1..3.mp3`
  loop quietly under the SFX, with a **dropdown selector** (`musicTrack`, web only:
  Off / Zerg / Protoss / Terran 1-3). Fade between tracks when switched.

Implementation notes:

- Music is mp3, not wav: five ~5 min tracks as wav would be ~250 MB. Cuts are
  the OST chapters Zerg One, Protoss One, Terran One / Two / Three.
- Playback rate = gameSpeed clamped to 0.75-2.0x. Gaps shrink with that rate
  and grow again past the clamp (5x: gaps are 1.25x the 1x value).
- Each clip has up to 3 overlapping copies (gunfire); past that a play is dropped.
- `soundRate` (Settings > Chatter, 0-3x, 0 = off) sets the pause between marine
  lines and the throttle on ling chill / spawn lines. Music has its own volume
  (`musicVolume`) and ignores the Sound effects switch.
