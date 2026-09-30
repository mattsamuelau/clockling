#include "touch.h"

#include <Arduino.h>

/* Same approach as Freenove's TFT_Touch library: a press is two consecutive
 * stable readings with both raw axes inside (0, 4095). Calibration comes from
 * Freenove's 2.8" sketch: setCal(527, 3552, 683, 3464, 320, 240, 1), mapped
 * for portrait (TFT_Touch rotation 0: xyswap + xflip). */
namespace touch {

static const int RAW_ERR = 20;
static bool s_landscape = false;

void setLandscape(bool landscape) { s_landscape = landscape; }
static const int CAL_A_MIN = 527, CAL_A_MAX = 3552;   /* 0x90 channel -> screen y */
static const int CAL_B_MIN = 683, CAL_B_MAX = 3464;   /* 0xD0 channel -> screen x */

static inline void clk() {
    digitalWrite(TOUCH_CLK_PIN, HIGH);
    digitalWrite(TOUCH_CLK_PIN, LOW);
}

static int readAxis(uint8_t cmd) {
    digitalWrite(TOUCH_CS_PIN, LOW);
    for (int i = 7; i >= 0; i--) {
        digitalWrite(TOUCH_DIN_PIN, (cmd >> i) & 1);
        clk();
    }
    clk();
    int data = 0;
    for (int i = 11; i >= 0; i--) {
        data |= digitalRead(TOUCH_DOUT_PIN) << i;
        clk();
    }
    clk(); clk(); clk();
    digitalWrite(TOUCH_CS_PIN, HIGH);
    digitalWrite(TOUCH_DIN_PIN, LOW);
    return data;
}

void begin() {
    pinMode(TOUCH_CS_PIN, OUTPUT);
    pinMode(TOUCH_CLK_PIN, OUTPUT);
    pinMode(TOUCH_DIN_PIN, OUTPUT);
    pinMode(TOUCH_DOUT_PIN, INPUT);
    digitalWrite(TOUCH_CS_PIN, HIGH);
    digitalWrite(TOUCH_CLK_PIN, LOW);
    digitalWrite(TOUCH_DIN_PIN, LOW);
}

bool read(int16_t* x, int16_t* y) {
    int a = readAxis(0x90), b = readAxis(0xD0);
    for (int i = 0; i < 2; i++) {
        delayMicroseconds(300);
        if (abs(a - readAxis(0x90)) > RAW_ERR) return false;
        if (abs(b - readAxis(0xD0)) > RAW_ERR) return false;
    }
    if (a <= 0 || a >= 4095 || b <= 0 || b >= 4095) return false;
    /* calibration crosses sit 30 px in from the edges. Landscape is Freenove's
     * native rotation 1; portrait is rotation 0 (xyswap + xflip). */
    long lx = map(a, CAL_A_MIN, CAL_A_MAX, 30, 320 - 30);   /* landscape x */
    long ly = map(b, CAL_B_MIN, CAL_B_MAX, 30, 240 - 30);   /* landscape y */
    if (s_landscape) {
        *x = (int16_t)constrain(lx, 0L, 319L);
        *y = (int16_t)constrain(ly, 0L, 239L);
    } else {
        *x = (int16_t)constrain(240 - ly, 0L, 239L);
        *y = (int16_t)constrain(lx, 0L, 319L);
    }
    return true;
}

}  // namespace touch
