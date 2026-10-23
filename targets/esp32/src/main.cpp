/* Clockling for ESP32 (Freenove FNK0114B 2.8" CYD).
 *  - tap the screen: splat units near the tap (like the watch)
 *  - press and hold the screen ~1.5 s: show the settings address
 *  - hold BOOT for 2 s: reopen the WiFi setup hotspot */
#include <Arduino.h>

#include "net.h"
#include "render.h"
#include "sim.h"
#include "touch.h"
#include "tuning.h"

static const int PIN_BOOT = 0;
#ifdef BOARD_CYD
static const int PIN_LED_R = 22, PIN_LED_G = 16, PIN_LED_B = 17;  /* active low */
#endif

static uint32_t s_lastUs;
static uint32_t s_infoUntil = 0;
static bool s_wasTouched = false;
static uint32_t s_touchStart = 0;
#ifdef BOARD_CYD
static uint32_t s_bootDown = 0;
#endif
static float s_brightness = -1;
#ifndef NO_WIFI
static net::State s_lastNet = net::CONNECTING;
#endif

static void setLine(render::Overlay& ov, int i, const char* s) {
    strlcpy(ov.lines[i], s, sizeof(ov.lines[i]));
}

static void buildOverlay(render::Overlay& ov) {
    ov = render::Overlay();
#ifndef NO_WIFI
    net::State st = net::state();
    if (st == net::PORTAL) {
        ov.show = true;
        setLine(ov, 0, "WiFi setup");
        char l[48];
        snprintf(l, sizeof(l), "Join WiFi: %s", net::AP_NAME);
        setLine(ov, 1, l);
        setLine(ov, 2, "then open 192.168.4.1");
    } else if (st == net::ONLINE && millis() < s_infoUntil) {
        ov.show = true;
        setLine(ov, 0, "Settings");
        setLine(ov, 1, "http://clockling.local");
        setLine(ov, 2, ("or http://" + net::ip()).c_str());
    }
#endif
}

#ifdef BOARD_RGB_LED
/* Onboard WS2812 shows who's winning (zerg vs terran count on screen) with a slow
 * breathe: pink = zerg ahead, blue = terran ahead, a tie keeps the last colour.
 * When terran takes the lead, it first flashes red/blue like a police light. */
static const float LED_PEAK = 14;              /* max channel value of the breathe (0-255) */
static const float LED_FLASH_PEAK = 22;
static const uint32_t LED_PERIOD_MS = 4500;    /* one full breathe */
static const uint32_t LED_FLASH_STEP_MS = 130; /* red, blue, red, blue, red, blue */
static const uint32_t LED_FLASH_COOLDOWN_MS = 8000;

static void updateWinnerLed() {
    static uint32_t last = 0, phase0 = 0, flashStart = 0, lastFlash = 0;
    static int8_t shown = 0;
    uint32_t now = millis();
    if (now - last < 30) return;
    last = now;

    int zerg = 0, terran = 0;
    for (int i = 0; i < sim::nUnits; i++) {
        const Unit& u = sim::units[i];
        if (u.dead) continue;
        if (u.kind == K_LING || u.kind == K_BANE) zerg++;
        else if (u.kind == K_MARINE) terran++;
    }
    int8_t want = zerg > terran ? 1 : (terran > zerg ? 2 : shown);
    if (want != shown) {
        bool flash = want == 2 && shown == 1 && (lastFlash == 0 || now - lastFlash > LED_FLASH_COOLDOWN_MS);
        shown = want;
        phase0 = now;
        if (flash) flashStart = lastFlash = now;
    }
    if (!shown) return;

    if (flashStart && now - flashStart < 6 * LED_FLASH_STEP_MS) {
        bool red = ((now - flashStart) / LED_FLASH_STEP_MS) % 2 == 0;
        if (red) neopixelWrite(BOARD_RGB_LED, (uint8_t)LED_FLASH_PEAK, 0, 0);
        else neopixelWrite(BOARD_RGB_LED, 0, 0, (uint8_t)LED_FLASH_PEAK);
        return;
    }
    flashStart = 0;

    /* 0..1 raised cosine, squared so the dim end looks even despite 8-bit steps */
    float ph = ((now - phase0) % LED_PERIOD_MS) / (float)LED_PERIOD_MS;
    float b = 0.5f - 0.5f * cosf(ph * 6.2831853f);
    b = 0.06f + 0.94f * b * b;
    float v = LED_PEAK * b;
    if (shown == 1) neopixelWrite(BOARD_RGB_LED, (uint8_t)(v + 0.5f), (uint8_t)(v * 0.08f + 0.5f), (uint8_t)(v * 0.4f + 0.5f));
    else neopixelWrite(BOARD_RGB_LED, 0, (uint8_t)(v * 0.1f + 0.5f), (uint8_t)(v + 0.5f));
}
#endif

static void pollInput() {
    uint32_t now = millis();
#ifdef BOARD_CYD
    int16_t x, y;
    bool down = touch::read(&x, &y);
    if (down && !s_wasTouched) {
        s_touchStart = now;
        sim::killNear(x, y, 45);   /* watch tap radius (60 px) at the 0.75x unit scale */
    }
    if (down && now - s_touchStart > 1500) s_infoUntil = now + 10000;
    s_wasTouched = down;
#endif

#ifdef BOARD_CYD
    if (digitalRead(PIN_BOOT) == LOW) {
        if (!s_bootDown) s_bootDown = now;
        if (now - s_bootDown > 2000) {
            net::startPortal();
            s_bootDown = now + 60000;   /* don't retrigger while still held */
        }
    } else {
        s_bootDown = 0;
    }
#else
    /* No touch: BOOT is the only input.
     *   short press  = splat around a random unit
     *   double press = show the settings address for 10 s
     *   hold 2 s     = spawn one marine at a random spot
     * (WiFi setup: the hotspot starts by itself when no WiFi is saved, or use
     * "Forget WiFi" on the settings page.) */
    static bool down = false, longFired = false;
    static uint32_t downAt = 0, upAt = 0;
    static int taps = 0;
    bool pressed = digitalRead(PIN_BOOT) == LOW;
    if (pressed && !down && now - upAt > 30) {
        down = true; downAt = now; longFired = false;
    } else if (pressed && down && !longFired && now - downAt >= 2000) {
        longFired = true;
        taps = 0;
        sim::spawnMarine();
    } else if (!pressed && down) {
        down = false; upAt = now;
        if (!longFired) taps++;
    }
    if (!down && taps && now - upAt > 350) {
        if (taps == 1) sim::splatRandom(45);
#ifndef NO_WIFI
        else s_infoUntil = now + 10000;
#else
        else sim::spawnMarine();   /* no settings page without WiFi: double press adds a marine */
#endif
        taps = 0;
    }
#endif
}

void setup() {
    Serial.begin(115200);
    Serial.println("\nClockling ESP32");
    pinMode(PIN_BOOT, INPUT_PULLUP);
#ifdef BOARD_CYD
    for (int p : {PIN_LED_R, PIN_LED_G, PIN_LED_B}) {
        pinMode(p, OUTPUT);
        digitalWrite(p, HIGH);   /* RGB LED off */
    }
#endif

    tuning::begin();
    render::begin();
    render::setBrightness(TUN(brightness));
    s_brightness = TUN(brightness);
#ifdef BOARD_CYD
    touch::begin();
#endif
    sim::init(TFT_WIDTH, TFT_HEIGHT);

    render::Overlay ov;
    ov.show = true;
    setLine(ov, 0, "Clockling");
    setLine(ov, 1, "Connecting to WiFi...");
    render::frame(ov);

#ifndef NO_WIFI
    net::begin();
    if (net::state() == net::ONLINE) s_infoUntil = millis() + 12000;
    s_lastNet = net::state();
#endif
    s_lastUs = micros();
}

void loop() {
    uint32_t frameStart = micros();
    float real = (frameStart - s_lastUs) / 1e6f;
    s_lastUs = frameStart;
    float dt = fminf(0.25f, fminf(0.05f, real) * TUN(gameSpeed));

    sim::update(dt);
    render::Overlay ov;
    buildOverlay(ov);
    render::frame(ov);

    pollInput();
#ifdef BOARD_RGB_LED
    updateWinnerLed();
#endif
#ifndef NO_WIFI
    net::loop();

    net::State st = net::state();
    if (st == net::ONLINE && s_lastNet != net::ONLINE) s_infoUntil = millis() + 12000;
    s_lastNet = st;
#else
    const int st = 0;
#endif

    if (TUN(brightness) != s_brightness) {
        s_brightness = TUN(brightness);
        render::setBrightness(s_brightness);
    }

    /* stats */
    static uint32_t statT = 0, frames = 0;
    frames++;
    if (millis() - statT > 10000) {
        Serial.printf("fps %.1f  units %d  heap %u (min %u)  wifi %d\n", frames * 1000.0f / (millis() - statT),
                      sim::nUnits, ESP.getFreeHeap(), ESP.getMinFreeHeap(), (int)st);
        statT = millis();
        frames = 0;
    }

    /* frame cap keeps the chip cooler */
    float cap = TUN(fpsCap);
    if (cap >= 1) {
        uint32_t budget = (uint32_t)(1e6f / cap), used = micros() - frameStart;
        if (used < budget) delay((budget - used) / 1000);
    }
}
