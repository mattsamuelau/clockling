/* Clockling - display / clock / battle settings (defaults).
 * Shared by the web app (clockling.html) and the ESP32 firmware, which generates
 * its defaults from this file (targets/esp32/tools/gen_assets.py). Keys marked
 * "web only" or "ESP32 only" are ignored by the other target.
 * clockling.html layers saved settings (localStorage) and shared links on top.
 */
var SETTINGS = {
    /* clock */
    showClock: true,
    hour24: true,
    showSeconds: false,
    clockPosition: 0,      /* 0 top, 1 middle, 2 bottom, 3 top left, 4 top right, 5 bottom left, 6 bottom right */
    clockBehind: true,     /* draw the clock behind the units instead of on top */
    clockScale: 0.55,      /* web only: clock size multiplier */
    timeZone: "auto",      /* web only: IANA zone (e.g. "Europe/London") or "auto" = this device */

    /* battle */
    gameSpeed: 5,        /* speed multiplier */
    unitScale: 5,          /* population multiplier (max units, wave sizes, spawn rate) */
    marineSkill: 0.6,      /* web only: marine AI skill 0 (stand and die) .. 1 (elite kiting) */
    unitCount: 10,         /* starting lings */
    unitSpeed: 1.0,        /* movement speed multiplier for every unit */
    showHealthBars: true,
    showKills: true,       /* web only: one yellow mark per ling a marine has killed */
    gore: true,            /* gore mode: splats and corpses linger (splat 16.2 s, corpse 19.2 s) */
    fieldSize: 1280,       /* web only: battlefield short side in logical px (smaller = bigger units) */

    /* audio (web only) */
    soundOn: true,
    soundVolume: 30,       /* percent */
    soundRate: 1,          /* how often chatter and voicelines fire (0 = never, 2 = twice as often) */
    musicTrack: 3,         /* 0 off, 1 Zerg, 2 Protoss, 3 Terran 1, 4 Terran 2, 5 Terran 3 */
    musicVolume: 30,       /* percent */

    /* device */
    landscape: true        /* ESP32 only: horizontal 320x240 panel (off = vertical 240x320) */
};
