# Clockling on ESP32 (Freenove FNK0114B, 2.8" CYD)

The battle sim + clock running natively on the Freenove ESP32 Display
(ESP32-WROOM-32E, 240x320 ST7789, XPT2046 resistive touch, no PSRAM).

## Build & flash

```bash
pip install platformio
cd targets/esp32
pio run -e fnk0114b -t upload      # port auto-detected (add upload_port = COMx to pin one)
pio device monitor -e fnk0114b     # fps / heap / IP log every 10 s
```

## Using it

- **First boot / no WiFi:** join the `Clockling-Setup` hotspot and open 192.168.4.1 to
  pick your network (same flow as NerdMiner's MinerAP). WiFi saved by NerdMiner is reused.
- **Settings:** `http://clockling.local` (or the IP shown on screen). Every TUNING key,
  Visible first, Advanced behind a toggle, per-key revert, Save, Reset all, time zone.
  Values apply live and persist in NVS.
- **Tap** the screen to splat units; **press and hold** ~1.5 s to show the settings address.
- **Hold BOOT** for 2 s to reopen the setup hotspot.
- **Orientation:** the `landscape` checkbox (Display) switches between vertical 240x320 and
  horizontal 320x240 live; the battle restarts for the new shape.
- **Clock:** position (top, middle, bottom or a corner), in front of or behind the units,
  24-hour, seconds; time zone is a POSIX TZ string (UK by default).

## How this relates to the web version

The web app (`clockling.html` at the repo root) is the reference: `app/js/swarm.js` holds the
rules and TUNING defaults, `app/js/settings.js` the display defaults. This firmware is a
port. Its defaults are *generated* from those files, so changing a default there and running
`tools/gen_assets.py` updates both. Its rules are a hand port in `src/sim.cpp` (same function
names and order as `swarm.js`), so behaviour changes must be made in both places.

The ESP32 leaves out web-only extras (kill marks, score bar, clock size, battlefield size)
and adds device settings (brightness, frame cap, orientation).

## How it's put together

| File | Role |
|---|---|
| `src/sim.cpp` | Port of `app/js/swarm.js` game logic (same rules and TUNING keys) |
| `src/render.cpp`, `src/gfx.cpp` | Software renderer drawing 32-row bands, pushed by DMA (no room for a full framebuffer) |
| `src/net.cpp`, `src/web_page.h` | WiFiManager portal, NTP, settings web server + API |
| `src/tuning.cpp` | Live values + NVS persistence |
| `src/touch.cpp` | Bit-banged XPT2046 (pins 25/32/33/39) |
| `tools/gen_assets.py` | Generates `gen_*.cpp` from the web app: defaults/meta, sprites, fonts, background |

Defaults come from the web app (`swarm.js`, `settings.js`, `tuning-meta.js`). After
changing those or the sprites, run `python targets/esp32/tools/gen_assets.py` and rebuild.
ESP32-specific overrides (unit sizes and behaviour radii at 0.75x, seconds hidden) live
at the top of `gen_assets.py`.

A full-flash backup of the original NerdMiner firmware is at
`D:\git\clockling-backup\nerdminer_fnk0114b_backup.bin`; restore with
`python -m esptool --port COM7 write_flash 0 nerdminer_fnk0114b_backup.bin`.

Fonts: Roboto (Apache 2.0), in `fonts/`.
