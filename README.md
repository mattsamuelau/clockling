> **Legacy branch.** This is the original Clockling: a Tizen 2.3.2 watch face for the Samsung
> Gear Fit 2 (it ran as "Zerg Desk"). It is kept as it was and is not maintained. The project
> continues on the [`main` branch](https://github.com/mattsamuelau/clockling) as a web app and
> ESP32 firmware, with newer rules and settings that do not apply here.

# ⚔️ Zerg Desk

An always-on **watch-face battlefield** for the Samsung Gear Fit 2 (SM-R360) — a Tizen 2.3.2 web watch face where a swarm of zerglings and banelings endlessly fights waves of marines across your wrist.

Time & weather on top. Total war underneath.

## What's on the face

- **Zerglings** — swarm, group up, and bite marines. They only charge with backup nearby… unless a baneling is on the field, then it's game on.
- **Banelings** — roll in, explode, and splash-damage every marine in range. Born from eggs when an old-enough ling morphs.
- **Marines** — march in from off-screen, cluster up, shoot the nearest zerg, heal over time, and flee when hurt.
- **Eggs** — lings hatch from eggs (two per egg), and eggs only spawn away from the action.
- **Clock** — semi-transparent green digits with a glowing outline, synced to real time over Wi-Fi.

## Project layout

```
gearfit/
├─ app/                 # the Tizen web watch face
│  ├─ config.xml        # wearable_clock category, package id zergdesk10
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/
│  │  ├─ swarm.js       # the battle sim (all game logic + TUNING)
│  │  ├─ main.js        # clock, power, battery, taps
│  │  ├─ weather.js     # Open-Meteo weather + TimeSync (internet clock)
│  │  └─ settings.js    # base settings + URL overrides
│  └─ images/           # extracted sprite frames (lings, banes, marines, eggs)
├─ preview.html         # browser sim + live tuning panel
├─ server.js            # tiny static server for the preview (node server.js)
├─ deploy.ps1           # build + sign + install to the watch over Wi-Fi
├─ marine_extract.py    # rembg-based marine sprite extraction
└─ marine_clean.py      # post-cleanup of the marine frames
```

## Run the simulator

```bash
node server.js
# then open http://127.0.0.1:8080/preview.html
```

The left panel is a **live tuning console** — every combat number is editable and hot-reloads the sim:

- **Spawn** — marine wave timing, wave size odds, respawn rates, egg time
- **Zerg** — HP, bite damage, baneling splash, morph rules, ally thresholds
- **Terran** — HP, shot damage/interval, range, flee & regroup behaviour
- **Visuals** — splats, corpse fade, sprite sizes, hitboxes

Use the **resolution** dropdown to run the sim in a bigger field (square 432×432 or 2×), and the **settings file** dropdown to switch between presets (`preview`, `fit2` — a low-battery variant, `2x2res`). Changes persist via **Save settings**.

## Deploy to the watch

The Gear Fit 2 only accepts certs whose dates are valid **at install time**, and its clock can only be set from a paired phone. The flow that works:

1. On the paired phone (Samsung Gear app), set the date to **1 June 2021** and let the watch re-sync.
2. Keep the watch on Wi-Fi with **Debugging** enabled.
3. Build, sign and install:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -ip 192.168.1.141
```

4. Launch it:

```powershell
D:\tizen-studio\tools\sdb.exe -s 192.168.1.141:26101 shell "wrt-launcher -s zergdesk10.ZergDesk"
```

The watch face keeps showing the **real time** via `worldtimeapi`/Open-Meteo over Wi-Fi, so the watch's clock can stay in 2021 forever and future installs stay painless.

## Why Tizen 2.3.2?

The Gear Fit 2 runs a 2014-era WebKit — ES5 only, no `fetch`, no arrows, XHR for network. All sim code is written accordingly and runs at 216×432 on-device.

---

*For the Swarm.*

