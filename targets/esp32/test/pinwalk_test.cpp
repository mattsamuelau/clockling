// Pin-walk: drives each display signal HIGH 3s then LOW 3s, one pin at a time,
// so each wire can be checked with a multimeter at the display-side pin.
#include <Arduino.h>
#include "driver/gpio.h"

struct P { int pin; const char *name; };
static const P pins[] = {{TFT_CS, "CS"}, {TFT_DC, "DC/CD"}, {TFT_RST, "RST/RES"}, {TFT_MOSI, "MOSI/SDA"}, {TFT_SCLK, "SCK/SCL"}};

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(TFT_BL, OUTPUT); digitalWrite(TFT_BL, HIGH);
  for (auto &p : pins) { pinMode(p.pin, OUTPUT); digitalWrite(p.pin, LOW); }
  Serial.println("\n#### pin-walk: measure display-side pin vs GND (HIGH ~3.3V, LOW 0V)");
}

void loop() {
  for (auto &p : pins) {
    gpio_set_direction((gpio_num_t)p.pin, GPIO_MODE_INPUT_OUTPUT);
    digitalWrite(p.pin, HIGH); delay(50);
    int hi = digitalRead(p.pin);
    Serial.printf("GPIO%d (%s): HIGH for 5s  (readback=%d)\n", p.pin, p.name, hi);
    delay(4950);
    digitalWrite(p.pin, LOW); delay(50);
    int lo = digitalRead(p.pin);
    Serial.printf("GPIO%d (%s): LOW for 5s  (readback=%d)\n", p.pin, p.name, lo);
    delay(4950);
  }
}
