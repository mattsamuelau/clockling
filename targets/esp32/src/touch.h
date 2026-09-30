/* Clockling - XPT2046 resistive touch on its own bit-banged pins (FNK0114B). */
#pragma once
#include <stdint.h>

namespace touch {
void begin();
/* true while pressed; x/y in screen pixels for the current orientation. */
bool read(int16_t* x, int16_t* y);
void setLandscape(bool landscape);   /* match render::setLandscape */
}
