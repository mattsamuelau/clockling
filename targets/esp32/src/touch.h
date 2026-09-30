/* Clockling - XPT2046 resistive touch on its own bit-banged pins (FNK0114B). */
#pragma once
#include <stdint.h>

namespace touch {
void begin();
/* true while pressed; x/y in portrait screen pixels (240x320). */
bool read(int16_t* x, int16_t* y);
}
