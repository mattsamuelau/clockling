#include "render.h"

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <esp_heap_caps.h>
#include <math.h>
#include <time.h>

#include "gfx.h"
#include "sim.h"
#include "tuning.h"

namespace render {

static TFT_eSPI tft;
static int W = TFT_WIDTH, H = TFT_HEIGHT;
/* each band buffer holds BAND_PX pixels: 32 rows portrait, 24 rows landscape */
static const int BAND_PX = 240 * 32;
static int s_bandH = 32;
static uint16_t* s_buf[2];
static const int BL_CH = 7;

/* palette (swarm.js / style.css) */
static const uint16_t C_LING_OUT = gfx::rgb(0xe0, 0x28, 0x28), C_LING_IN = gfx::rgb(0xff, 0x6b, 0x4a);
static const uint16_t C_BANE_OUT = gfx::rgb(0x39, 0xff, 0x14), C_BANE_IN = gfx::rgb(0xb8, 0xff, 0x4d);
static const uint16_t C_MAR_OUT = gfx::rgb(0xd6, 0x20, 0x20), C_MAR_IN = gfx::rgb(0xff, 0x6b, 0x4a);
static const uint16_t C_TIME = gfx::rgb(182, 255, 94);
static const uint16_t C_SEC = gfx::rgb(0xc3, 0xa6, 0xff), C_DATE = gfx::rgb(0xcf, 0xc3, 0xf5);
static const uint16_t C_HP_OK = gfx::rgb(0x4c, 0xff, 0x4c), C_HP_MID = gfx::rgb(0xff, 0xd2, 0x3e);
static const uint16_t C_HP_LOW = gfx::rgb(0xff, 0x4c, 0x4c);
static const uint16_t C_SHOT = gfx::rgb(255, 220, 80), C_WHITE = gfx::rgb(0xea, 0xff, 0xf0);

/* per-frame draw list, so trig and frame picks happen once per frame, not per band */
struct UnitDraw {
    const SpriteFrame* img;
    float x, y, w, hh, rot;
    bool mirror, bar;
    float hpFrac;
    float ymin, ymax;
};
static UnitDraw s_ud[sim::MAX_UNITS];
static int s_nud;

/* clock layout: the web #face stack at 1/2 scale, pinned to the top */
static const uint8_t CLOCK_ALPHA = 153;   /* 40% more see-through than the web clock */
static int s_timeBase, s_secBase, s_dateBase;
static char s_time[8], s_sec[8], s_date[24];
static bool s_timeValid;

static const char* MONTHS[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
static const char* DAYS[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};

static void layoutClock() {
    int tA = FONT_TIME.ascent, tD = FONT_TIME.descent;
    int sLine = FONT_SEC.ascent + FONT_SEC.descent;
    int secBox = max(12, sLine);
    const int timeBox = 36, top = 6;   /* pinned to the top of the screen */
    s_timeBase = top + (timeBox - (tA + tD)) / 2 + tA;
    int secTop = top + timeBox + 1;
    s_secBase = secTop + FONT_SEC.ascent;
    s_dateBase = secTop + (s_sec[0] ? secBox : 0) + 2 + FONT_DATE.ascent;
}

static void pad2(char* out, int v) { out[0] = '0' + (v / 10) % 10; out[1] = '0' + v % 10; out[2] = 0; }

static void tickClock() {
    time_t now = time(nullptr);
    struct tm t;
    localtime_r(&now, &t);
    s_timeValid = t.tm_year + 1900 >= 2024;
    if (!s_timeValid) {
        strcpy(s_time, "--:--");
        strcpy(s_sec, TUNB(showSeconds) ? ":--" : "");
        strcpy(s_date, "syncing time...");
        return;
    }
    int h = t.tm_hour;
    int hh = TUNB(hour24) ? h : (h % 12 == 0 ? 12 : h % 12);
    pad2(s_time, hh);
    s_time[2] = ':';
    pad2(s_time + 3, t.tm_min);
    if (TUNB(showSeconds)) { s_sec[0] = ':'; pad2(s_sec + 1, t.tm_sec); }
    else s_sec[0] = 0;
    snprintf(s_date, sizeof(s_date), "%s %d %s", DAYS[t.tm_wday], t.tm_mday, MONTHS[t.tm_mon]);
}

void begin() {
    tft.init();
    tft.setRotation(0);
    tft.setSwapBytes(false);
    tft.fillScreen(TFT_BLACK);
    tft.initDMA();
    for (int i = 0; i < 2; i++) {
        s_buf[i] = (uint16_t*)heap_caps_malloc(BAND_PX * 2, MALLOC_CAP_DMA);
        if (!s_buf[i]) Serial.println("render: band buffer alloc failed");
    }
    ledcSetup(BL_CH, 5000, 8);
    ledcAttachPin(TFT_BL, BL_CH);
    spritesToRam();
    layoutClock();
}

void setLandscape(bool landscape) {
    tft.dmaWait();
    tft.setRotation(landscape ? 1 : 0);
    W = tft.width();
    H = tft.height();
    s_bandH = BAND_PX / W;
    gfx::initBackground(landscape);
}

int width() { return W; }
int height() { return H; }

void setBrightness(float pct) {
    pct = constrain(pct, 1.0f, 100.0f);
    ledcWrite(BL_CH, (uint32_t)(pct * 2.55f));
}

static void buildDrawList() {
    s_nud = 0;
    for (int i = 0; i < sim::nUnits; i++) {
        const Unit& c = sim::units[i];
        const SpriteSet& fs = sim::frameSet(c);
        UnitDraw& d = s_ud[s_nud];
        int idx;
        if (c.kind == K_EGG) {
            /* eggA/B ping-pong 0.5s each until 2.5s, then eggC until it hatches */
            idx = (c.t < 2.5f) ? ((int)floorf(c.t / 0.5f) % 2) : 2;
        } else {
            idx = c.frame % fs.n;
        }
        d.img = &fs.frames[idx];
        d.x = c.x; d.y = c.y; d.w = c.w;
        d.hh = c.w * fs.srcH / fs.srcW;
        d.mirror = false;
        d.rot = (c.kind == K_EGG) ? 0 : sim::drawAngle(c, &d.mirror);
        d.bar = c.kind != K_EGG;
        d.hpFrac = constrain(c.hp / 100.0f, 0.0f, 1.0f);
        float r = sqrtf(d.w * d.w + d.hh * d.hh) * 0.5f + 1;
        d.ymin = c.y - r;
        d.ymax = fmaxf(c.y + r, c.y + d.hh / 2 + 5);
        s_nud++;
    }
}

static void drawBand(Band& b, const Overlay& ov) {
    float bTop = b.y0 - 2, bBot = b.y0 + b.h + 2;
    gfx::background(b);

    /* splats: grow 20% early, stay put, fade near the end */
    for (int i = 0; i < sim::nSplats; i++) {
        const Splat& s = sim::splats[i];
        float reach = s.base * 1.6f + 2;
        if (s.y + reach < bTop || s.y - reach > bBot) continue;
        float elapsed = s.max - s.life;
        float grow = fminf(1.0f, elapsed / 0.15f);
        float alpha = 0.95f;
        float fadeStart = s.max * TUN(splatFadeStart);
        if (elapsed > fadeStart) alpha = 0.95f * fmaxf(0.0f, 1 - (elapsed - fadeStart) / (s.max - fadeStart));
        uint16_t o = s.col == SC_LING ? C_LING_OUT : s.col == SC_BANE ? C_BANE_OUT : C_MAR_OUT;
        uint16_t in = s.col == SC_LING ? C_LING_IN : s.col == SC_BANE ? C_BANE_IN : C_MAR_IN;
        gfx::splat(b, s.x, s.y, s.base, grow, s.seed, o, in, (uint8_t)(alpha * 255));
    }

    /* dead units: bottom half of the frozen sprite, slowly fading */
    for (int i = 0; i < sim::nCorpses; i++) {
        const Corpse& co = sim::corpses[i];
        if (co.y + co.w < bTop || co.y - co.w > bBot) continue;
        gfx::sprite(b, *co.img, co.x, co.y, co.w, co.rot, co.mirror,
                    (uint8_t)(0.95f * 255 * co.life / co.max), true);
    }

    for (int i = 0; i < s_nud; i++) {
        const UnitDraw& d = s_ud[i];
        if (d.ymax < bTop || d.ymin > bBot) continue;
        gfx::sprite(b, *d.img, d.x, d.y, d.w, d.rot, d.mirror, 255);
        if (!d.bar || !TUNB(showHealthBars)) continue;
        /* health bar under every non-egg unit (0.75x the web size, like the units) */
        float bw = 22, bh = 2, by = d.y + d.hh / 2 + 3;
        gfx::fillRect(b, d.x - bw / 2, by, bw, bh, 0, 140);
        uint16_t hc = d.hpFrac > 0.5f ? C_HP_OK : (d.hpFrac > 0.25f ? C_HP_MID : C_HP_LOW);
        gfx::fillRect(b, d.x - bw / 2, by, bw * d.hpFrac, bh, hc, 255);
    }

    /* firing lines: brief, semi-transparent, gun tip -> random point on the target */
    for (int i = 0; i < sim::nUnits; i++) {
        const Unit& m = sim::units[i];
        if (m.kind != K_MARINE || m.flashT <= 0) continue;
        float alpha = fminf(1.0f, m.flashT / 0.1f) * 0.7f;
        float gx = m.x + cosf(m.aim) * (m.w / 2 + 3), gy = m.y + sinf(m.aim) * (m.w / 2 + 3);
        if (fmaxf(gy, m.hitY) < bTop || fminf(gy, m.hitY) > bBot) continue;
        gfx::line(b, gx, gy, m.hitX, m.hitY, 1.0f, C_SHOT, (uint8_t)(alpha * 255));
    }

    /* clock on top of the battle (the #face overlay) */
    if (TUNB(showClock)) {
        gfx::text(b, FONT_TIME, (W - gfx::textWidth(FONT_TIME, s_time)) / 2, s_timeBase, s_time, C_TIME, CLOCK_ALPHA);
        if (s_sec[0])
            gfx::text(b, FONT_SEC, (W - gfx::textWidth(FONT_SEC, s_sec)) / 2, s_secBase, s_sec, C_SEC, CLOCK_ALPHA);
        gfx::text(b, FONT_DATE, (W - gfx::textWidth(FONT_DATE, s_date)) / 2, s_dateBase, s_date, C_DATE, CLOCK_ALPHA);
    }

    /* status panel (WiFi setup / settings address) */
    if (ov.show) {
        int n = 0;
        while (n < 4 && ov.lines[n][0]) n++;
        int lh = 20, boxH = n * lh + 14, boxY = H - 12 - boxH;
        if (boxY < b.y0 + b.h && boxY + boxH > b.y0) {
            gfx::fillRect(b, 8, boxY, W - 16, boxH, 0, 190);
            for (int i = 0; i < n; i++) {
                int base = boxY + 7 + i * lh + FONT_TEXT.ascent;
                uint16_t col = i == 0 ? C_TIME : C_WHITE;
                gfx::text(b, FONT_TEXT, (W - gfx::textWidth(FONT_TEXT, ov.lines[i])) / 2, base, ov.lines[i], col);
            }
        }
    }
}

void frame(const Overlay& ov) {
    tickClock();
    layoutClock();
    buildDrawList();
    tft.startWrite();
    int k = 0;
    for (int y = 0; y < H; y += s_bandH, k ^= 1) {
        Band b = {s_buf[k], W, y, min(s_bandH, H - y)};
        drawBand(b, ov);
        /* panel expects big-endian RGB565 */
        uint32_t n = b.W * b.h;
        uint16_t* p = b.px;
        for (uint32_t i = 0; i < n; i++) p[i] = (p[i] >> 8) | (p[i] << 8);
        /* waits for the previous band's DMA, then starts this one */
        tft.pushImageDMA(0, y, W, b.h, b.px);
    }
    tft.dmaWait();
    tft.endWrite();
}

}  // namespace render
