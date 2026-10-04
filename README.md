<p align="center">
  <a href="app/images/ling1.png"><img src="app/images/ling1.png" alt="Clockling zergling" width="200"></a>
</p>

# Clockling
**[Open Clockling](https://mattsamuelau.github.io/clockling/)**

| | **Web** - `clockling.html` | **ESP32** - `targets/esp32/` |
|---|---|---|
| Runs on | Any browser (desktop, phone, embedded iframe) | Freenove ESP32 Display, 2.8" 240x320 "CYD" (FNK0114B) |
| Code | `app/js/swarm.js` (the reference implementation) | `src/sim.cpp`, a C++ port of `swarm.js` |
| Drawing | Canvas, scaled crisp to any window | Software renderer, 32-row bands pushed over DMA, ~25-30 fps |
| Settings | Gear button, slide-out drawer, saved in the browser | Web page served by the board at `http://clockling.local`, saved on the device |
| Clock | Any IANA time zone, size slider, 7 positions, front/behind units | NTP time with a POSIX time zone, 7 positions, front/behind units |
| Extras | Kill marks, score bar, battlefield size, share links, embed code | Touch to splat, landscape/portrait, backlight, frame cap |
| Not available | - | Kill marks, score bar, clock size (memory and pixels are tight) |

### How they relate

```
app/js/tuning-meta.js TUNING defaults + labels, meanings, groups, options  <-- source of truth
app/js/swarm.js       derives its TUNING object from tuning-meta.js; game rules
app/js/settings.js    SETTINGS defaults (clock, display, battle)
app/images/*.png      sprites
        |                                   |
        | loaded directly                   | targets/esp32/tools/gen_assets.py
        v                                   v
  clockling.html                   gen_tuning.cpp  (defaults, sizes x0.75 for the small panel)
  (web app)                        gen_sprites.cpp (sprites pre-scaled to on-screen size)
                                   gen_fonts.cpp / gen_background.cpp
                                            |
                                            v
                                   sim.cpp (hand-ported rules) + renderer -> firmware
```

- **Defaults** live in exactly one place each: TUNING in `tuning-meta.js`, SETTINGS in
  `settings.js`. `gen_assets.py` applies ESP32-specific scaling and overrides before
  generating firmware tables, and `gen_docs.py` regenerates the tables in `TUNING.md`
  from the same source - so the docs can't drift.
- **Rules** are ported by hand. When you change behaviour in `swarm.js`, make the same
  change in `targets/esp32/src/sim.cpp` (the functions have the same names and order).
- Keys marked `only: "web"` or `only: "esp32"` in `tuning-meta.js` exist on one side only.

## Changing the defaults (export → agent)

Tune everything in the settings drawer, then hand the result to an agent to bake into
the repo defaults:

1. Settings drawer → **Share / embed** → copy the **Link** (it carries your exact
   settings as `{s, t}` in the `#s=...` hash).
2. Agent runs `python bake_tuning.py <link>` (or the raw JSON) - this writes the
   exported values into `tuning-meta.js` / `settings.js`, then regenerates
   `TUNING.md` and the ESP32 assets.
3. Agent commits and pushes. `python bake_tuning.py --check` regenerates without
   baking and shows what would change.

Manual tweaks work too: edit the `default:` in `tuning-meta.js` or the value in
`settings.js`, then run `python gen_docs.py` and
`python targets/esp32/tools/gen_assets.py`.

## Sounds

Web-only for now: SFX, marine chatter and a background-music picker
(Settings > Battle). The clips in `app/sounds/` are built by
`python build_sounds.py` from the sources in the
[sound design brief](app/sounds/README.md), which also covers the events and
speed-scaling rules. Missing files are skipped silently; toggle in
Settings > Sound effects.

## Use it

### Web

- **Online**: [mattsamuelau.github.io/clockling](https://mattsamuelau.github.io/clockling/).
- **Locally**: open `clockling.html` directly in a browser. This requires no server or
  Node.js.
- **Optional local server**: in VS Code, run *Terminal > Run Task... > Clockling: run*, or
  run `node server.js`, then open http://127.0.0.1:8080/clockling.html. If port 8080 is
  busy, use *Clockling: run on port 8090* or `PORT=8090 node server.js`.

- **Settings**: use the gear button or <kbd>S</kbd>. Main controls are in the drawer;
  rules and balance values are under *Advanced tuning*. Changes apply immediately and
  persist in the browser. Press <kbd>R</kbd> to restart.
- **Share / embed**: the drawer provides
  - a **link** that carries your exact settings (in the `#s=...` part), so friends see
    your battle without touching their own saved setup;
  - an **iframe** snippet for any site that allows embeds (the gear hides until hovered);
  - a **Markdown** snippet for GitHub READMEs. GitHub won't run live pages inside a
    README, so it shows the demo GIF and opens your setup when clicked.

### ESP32

Plug in a Freenove FNK0114B, then from `targets/esp32`: `pio run -e fnk0114b -t upload`.
On first boot join the `Clockling-Setup` WiFi hotspot to connect it to your network, then
change settings at `http://clockling.local`. Full guide: [targets/esp32/README.md](targets/esp32/README.md).

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
5. **Patrol** - no zerg within `marineSightMult` x weapon range: the squad walks to
   shared random waypoints until it finds some.

All units steer smoothly toward their chosen heading instead of snapping to it.

Each rule maps to a clearly named setting (`attackGroupSize`, `berserkBanes`,
`attackOdds`, ...); see [TUNING.md](TUNING.md).

## Tweaking it

| I want to... | Do this |
|---|---|
| Try a setting | Web: settings drawer. ESP32: `http://clockling.local`. Both apply live. |
| Change a default | Edit `app/js/swarm.js` (TUNING) or `app/js/settings.js` (SETTINGS) and the matching `default` in `app/js/tuning-meta.js`. Then run `python targets/esp32/tools/gen_assets.py` and rebuild firmware; ESP32 overrides are in `targets/esp32/tools/gen_assets.py`. |
| Make my device's settings the defaults | Read them from `http://clockling.local/api/config` (each key has its value `v` and default `d`) and copy the differences into the files above. |
| Change how units behave | Edit the rules in `app/js/swarm.js`, then port the same change to `targets/esp32/src/sim.cpp`. |
| Add a setting | Add it to `swarm.js`/`settings.js` and `tuning-meta.js` (class, meaning, optional `options`, `min/max/step`, `only`). Both settings screens pick it up automatically. |
| Change ESP32-only scaling | `SCALED` / `ESP32_DEFAULTS` / `EXTRA` at the top of `targets/esp32/tools/gen_assets.py`. |

Every key is documented in **[TUNING.md](TUNING.md)**.

> `bake_tuning.py` rewrites the TUNING block in `swarm.js` from the table inside it. It
> ignores arguments, so only run it when you mean to; keep its table equal to the defaults.

## Testing and training the AI (web)

The web sim can run headless in Node, so balance and AI changes are measured
rather than eyeballed. Everything lives in `tools/sim/`:

- **`harness.js`** runs the real `app/js/swarm.js` without a browser and reports
  how the battle went: how long each side controlled the map, how often control
  swung, losses, stims, bane kills and wipes.
- **`balance.js`** searches spawn / respawn / swarm settings for the battle
  presets (Balanced, Terran, Zerg, Mental), scoring each candidate on whether the
  fight is *fun*: each side takes decisive control for a while, then loses it,
  rather than a stalemate or a wipe. `apply_presets.py` writes the winners into
  the defaults and the presets.
- **`train.js`** trains the two commanders by self-play: the zerg **Overmind**
  and the terran **Commander** are each a set of decision settings (when to
  attack, bane timing, control groups, stim use, where to spawn...), never unit
  stats. Two populations evolve against each other and are rewarded for
  efficient trades, holding the map and wiping the enemy (`rewards.js`). The
  champions land in `app/js/brains.js` as the *Trained* Overmind / Commander
  options in the settings drawer.

Both the marines (skill slider, per-marine stutter-step and bane splits,
control-group kiting, stim) and the zerg (Zerg skill slider: surrounds, bane
timing, stalking, protecting banes) have toggles in the tuning panel, so any
behaviour can be switched off to compare. These AI features are web-only; the
ESP32 sim keeps the simpler rules.

## Porting to another device

1. **Pick a display path.** Anything that can run a browser can just show `clockling.html`
   (kiosk mode, a Raspberry Pi, an old phone or tablet). That's the zero-effort port.
2. **For microcontrollers**, copy `targets/esp32` as a template:
   - `sim.cpp` is plain C++ with no hardware calls, so it ports as is.
   - Swap `render.cpp`/`gfx.cpp` for your display (anything that can push a rectangle of
     RGB565 pixels works; the band renderer needs only `2 x W x 32 x 2` bytes of RAM).
   - Swap `touch.cpp` for your input and `net.cpp` for your connectivity (or drop it).
   - Adjust `SCALED` in `gen_assets.py` for your screen size, so sprites and radii keep the
     web version's proportions (the ESP32 uses 0.75 on a 320 px long side).
3. **Check behaviour** against the web version with the same settings; the sim should look
   the same.

## Repo layout

```
clockling.html            the web app (open this)
index.html                redirects to clockling.html (GitHub Pages entry)
server.js                 tiny local web server (node server.js)
.vscode/tasks.json        VS Code tasks to run it
app/
  js/swarm.js             battle sim + TUNING defaults (reference implementation)
  js/settings.js          SETTINGS defaults
  js/tuning-meta.js       labels/meanings/groups/options for every key
  js/brains.js            trained Overmind / Commander brains (from tools/sim/train.js)
  images/                 sprite frames
targets/esp32/            ESP32 firmware (PlatformIO); see its README
docs/                     demo GIF, screenshot, the original project brief
tools/sim/                headless sim, balance search and self-play training (see above)
TUNING.md                 every setting explained
bake_tuning.py            writes a table of values into swarm.js's TUNING block
```

## Branches

- **`main`** - the web app and the ESP32 firmware. This is where development happens.
- **[`gearfit`](https://github.com/mattsamuelau/clockling/tree/gearfit)** - the original
  project, a Tizen 2.3.2 watch face for the Samsung Gear Fit 2 (it ran as "Zerg Desk").
  Kept as it was, with its own older rules and settings, for anyone with the old watch.
  It is not maintained and does not get changes from `main`.

## Credits

Unit sprites are fan art derived from StarCraft II animations; StarCraft is a trademark of
Blizzard Entertainment, which has nothing to do with this project. Clock font on the ESP32:
Roboto (Apache 2.0).
