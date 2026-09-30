/* Clockling - draws the sim + clock to the TFT, one band at a time with DMA. */
#pragma once
#include <stdint.h>

namespace render {

struct Overlay {
    bool show = false;
    char lines[4][48] = {};
};

void begin();                        /* init TFT, DMA, backlight */
void setBrightness(float pct);       /* 0..100 */
void setLandscape(bool landscape);   /* rotate the panel: 320x240 vs 240x320 */
int width();
int height();
void frame(const Overlay& ov);       /* draw one full frame */

}  // namespace render
