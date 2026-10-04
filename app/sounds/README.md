# Sounds (web only)

Drop the sound files here. Any short clip the browser can play works
(wav / mp3 / ogg). Missing files are detected on first play and skipped
silently; sounds can be turned off in Settings &gt; Sound effects.

| File | Plays when |
|---|---|
| `ling_chill.wav` | an idle zergling chatters |
| `ling_attack.wav` | a swarm commits to an attack |
| `ling_die.wav` | a zergling dies |
| `bane_die.wav` | a baneling explodes |
| `marine_shoot.wav` | a marine fires |
| `marine_die.wav` | a marine dies |
| `marine_voice.wav` | a marine wave arrives (voiceline) |

Names must match exactly - `clockling.html` loads them by name from this folder.

## Sound design brief

Source clips to compile (trim / convert to wav):

| Purpose | Event | Source |
|---|---|---|
| Marine gunfire | `marine_shoot.wav` | YouTube short `hPoYpRRsf0c` - cut a section from the **middle** of the audio |
| Marine voicelines (idle banter) | `marine_voice` | myinstants: `marine-good-to-go-50098`, `starcraft-marine-start-11584`, `rock-and-roll-marine-20680`, `starcraft-marine-36665` |
| New marine spawn voiceline | `marine_spawn` | 101soundboards `24049472-starcraft-marine` or myinstants `wanna-piece-of-me-boy-marine-64377` |
| Zergling chatter | `ling_chill` | 101soundboards: `zergling-zzewht03` (62043074), `zergling-2` (23926222), `zergling-zzedth00` (62041948), `zergling-zzewht00` (62042588) |

Behaviour rules:

- **Marine voicelines** play only while **no marine is attacking** (idle banter),
  one after another, picked randomly - never overlapping.
- **Zergling chatter** just loops the set for now; later it gets split into
  event-based noises (attack/die already have their own events).
- **Speed scaling:** sounds must follow `gameSpeed` but stay sane at 5x. Plan:
  clamp the playback rate (e.g. 0.75-2.0x regardless of game speed) and scale the
  per-event `gap` throttle with speed, so triggers never pile up.
- **Config:** add a sound-frequency knob (e.g. `soundRate`) so how often chatter
  and voicelines fire is tunable; per-event `gap` already exists in
  `clockling.html`.

Multiple clips per event (`marine_voice1..4`, `ling_chill1..4`, spawn
variants) need a small loader update (SOUNDS entries -> arrays). Do that when
the clips land.
