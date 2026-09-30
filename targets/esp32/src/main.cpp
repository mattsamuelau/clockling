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
static const int PIN_LED_R = 22, PIN_LED_G = 16, PIN_LED_B = 17;  /* active low */

static uint32_t s_lastUs;
static uint32_t s_infoUntil = 0;
static bool s_wasTouched = false;
static uint32_t s_touchStart = 0;
static uint32_t s_bootDown = 0;
static float s_brightness = -1;
static bool s_landscape = false;
static net::State s_lastNet = net::CONNECTING;

static void setLine(render::Overlay& ov, int i, const char* s) {
    strlcpy(ov.lines[i], s, sizeof(ov.lines[i]));
}

static void buildOverlay(render::Overlay& ov) {
    ov = render::Overlay();
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
}

/* rotate panel + touch and restart the battle for the new shape */
static void applyOrientation() {
    s_landscape = TUNB(landscape);
    render::setLandscape(s_landscape);
    touch::setLandscape(s_landscape);
    sim::init(render::width(), render::height());
}

static void pollInput() {
    int16_t x, y;
    bool down = touch::read(&x, &y);
    uint32_t now = millis();
    if (down && !s_wasTouched) {
        s_touchStart = now;
        sim::killNear(x, y, 45);   /* watch tap radius (60 px) at the 0.75x unit scale */
    }
    if (down && now - s_touchStart > 1500) s_infoUntil = now + 10000;
    s_wasTouched = down;

    if (digitalRead(PIN_BOOT) == LOW) {
        if (!s_bootDown) s_bootDown = now;
        if (now - s_bootDown > 2000) {
            net::startPortal();
            s_bootDown = now + 60000;   /* don't retrigger while still held */
        }
    } else {
        s_bootDown = 0;
    }
}

void setup() {
    Serial.begin(115200);
    Serial.println("\nClockling ESP32");
    pinMode(PIN_BOOT, INPUT_PULLUP);
    for (int p : {PIN_LED_R, PIN_LED_G, PIN_LED_B}) {
        pinMode(p, OUTPUT);
        digitalWrite(p, HIGH);   /* RGB LED off */
    }

    tuning::begin();
    render::begin();
    render::setBrightness(TUN(brightness));
    s_brightness = TUN(brightness);
    touch::begin();
    applyOrientation();

    render::Overlay ov;
    ov.show = true;
    setLine(ov, 0, "Clockling");
    setLine(ov, 1, "Connecting to WiFi...");
    render::frame(ov);

    net::begin();
    if (net::state() == net::ONLINE) s_infoUntil = millis() + 12000;
    s_lastNet = net::state();
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
    net::loop();

    net::State st = net::state();
    if (st == net::ONLINE && s_lastNet != net::ONLINE) s_infoUntil = millis() + 12000;
    s_lastNet = st;

    if (TUNB(landscape) != s_landscape) applyOrientation();

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
