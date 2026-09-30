/* Clockling - software rasteriser for one horizontal band of the screen.
 * There is no room for a 240x320 framebuffer next to WiFi (no PSRAM), so each
 * frame is drawn as a stack of bands; every primitive clips to the band. */
#pragma once
#include <stdint.h>
#include "gen_assets.h"

struct Band {
    uint16_t* px;   /* native RGB565, row-major, width W */
    int W;
    int y0, h;      /* screen rows [y0, y0+h) */
};

namespace gfx {

inline uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

void initBackground(bool landscape);   /* (re)load the baked gradient for this orientation */
void background(Band& b);
void fillRect(Band& b, float x, float y, float w, float h, uint16_t col, uint8_t alpha);
void line(Band& b, float x0, float y0, float x1, float y1, float width, uint16_t col, uint8_t alpha);

/* Sprite centred at (cx,cy), drawn dstW wide, mirrored then rotated like the
 * canvas code in swarm.js (translate, scale(-1,1), rotate). bottomHalf draws
 * only the lower half of the image with its top edge at the centre (corpses). */
void sprite(Band& b, const SpriteFrame& f, float cx, float cy, float dstW, float rot,
            bool mirror, uint8_t alpha, bool bottomHalf = false);

/* Cartoon splat: 16-spoke jagged blob + 4 droplets + inner dot. */
void splat(Band& b, float x, float y, float base, float grow, uint8_t seed,
           uint16_t outer, uint16_t inner, uint8_t alpha);

/* Text. x is the left edge; returns the advance width. */
int text(Band& b, const Font& f, int x, int baseline, const char* s, uint16_t col, uint8_t alpha = 255);
int textWidth(const Font& f, const char* s);

}  // namespace gfx
