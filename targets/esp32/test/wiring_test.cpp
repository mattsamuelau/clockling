// Stage 1 wiring test for ESP32-S3 + 1.9" 170x320 ST7789V.
// Each step logs to Serial (115200) and waits for BOOT (GPIO0) or any key in
// the serial monitor before moving on.
#include <Arduino.h>
#include <TFT_eSPI.h>

extern "C" uint32_t tft_spi_hz = 40000000;

static const int PIN_BOOT = 0;
static const int PIN_BL = TFT_BL;
static const int BL_CH = 0;

TFT_eSPI tft;

static void waitNext(const char *what) {
  Serial.printf("   -> press BOOT (or send any key) for %s\n", what);
  while (Serial.available()) Serial.read();
  for (;;) {
    if (Serial.available()) { while (Serial.available()) Serial.read(); break; }
    if (digitalRead(PIN_BOOT) == LOW) {
      delay(30);
      while (digitalRead(PIN_BOOT) == LOW) delay(5);
      delay(30);
      break;
    }
    delay(5);
  }
}

// ---------------------------------------------------------------------------
static void t1Backlight() {
  Serial.println("\n== T1 Backlight only (no SPI init) ==");
  Serial.println("   Expect: backlight blinks ON/OFF 3 times, then fades up from dark to full.");
  pinMode(PIN_BL, OUTPUT);
  for (int i = 0; i < 3; i++) {
    Serial.printf("   blink %d: ON\n", i + 1);
    digitalWrite(PIN_BL, HIGH); delay(500);
    Serial.printf("   blink %d: OFF\n", i + 1);
    digitalWrite(PIN_BL, LOW); delay(500);
  }
  Serial.println("   PWM ramp 0 -> 255");
  ledcSetup(BL_CH, 5000, 8);
  ledcAttachPin(PIN_BL, BL_CH);
  for (int d = 0; d <= 255; d++) { ledcWrite(BL_CH, d); delay(8); }
  Serial.println("   T1 done, backlight at full.");
}

// ---------------------------------------------------------------------------
static void t2Fills() {
  Serial.println("\n== T2 Init + solid fills ==");
  ledcDetachPin(PIN_BL);
  tft.init();  // drives BL high via TFT_BL
  tft.setRotation(0);
  Serial.printf("   init done: %d x %d\n", tft.width(), tft.height());
  struct { uint16_t c; const char *name; } fills[] = {
    {TFT_RED, "RED"}, {TFT_GREEN, "GREEN"}, {TFT_BLUE, "BLUE"},
    {TFT_WHITE, "WHITE"}, {TFT_BLACK, "BLACK"},
  };
  for (auto &f : fills) {
    Serial.printf("   expect: %s\n", f.name);
    tft.fillScreen(f.c);
    delay(1000);
  }
}

// ---------------------------------------------------------------------------
static void cornerBox(int x, int y, int s, uint16_t c, const char *label) {
  tft.fillRect(x, y, s, s, c);
  tft.setTextColor(TFT_BLACK, c);
  tft.setTextDatum(MC_DATUM);
  tft.drawString(label, x + s / 2, y + s / 2, 2);
}

static void t3Edges() {
  Serial.println("\n== T3 Offset / edge check ==");
  for (int rot = 0; rot <= 1; rot++) {
    tft.setRotation(rot);
    int w = tft.width(), h = tft.height(), s = 30;
    tft.fillScreen(TFT_NAVY);
    tft.drawRect(0, 0, w, h, TFT_YELLOW);
    cornerBox(2, 2, s, TFT_RED, "TL");
    cornerBox(w - s - 2, 2, s, TFT_GREEN, "TR");
    cornerBox(2, h - s - 2, s, TFT_CYAN, "BL");
    cornerBox(w - s - 2, h - s - 2, s, TFT_WHITE, "BR");
    tft.setTextColor(TFT_WHITE, TFT_NAVY);
    tft.setTextDatum(MC_DATUM);
    char buf[24];
    snprintf(buf, sizeof buf, "rot %d  %dx%d", rot, w, h);
    tft.drawString(buf, w / 2, h / 2, 2);
    Serial.printf("   rotation %d (%dx%d): navy bg, 1px YELLOW border on all 4 edges,\n", rot, w, h);
    Serial.println("   corners TL=red TR=green BL=cyan BR=white, small gap to the border.");
    Serial.println("   Look for: border missing on an edge, or a noise/garbage strip.");
    waitNext(rot == 0 ? "rotation 1" : "T4");
  }
}

// ---------------------------------------------------------------------------
static void t4Orientation() {
  Serial.println("\n== T4 Orientation / text ==");
  for (int rot = 0; rot < 4; rot++) {
    tft.setRotation(rot);
    int w = tft.width(), h = tft.height();
    tft.fillScreen(TFT_BLACK);
    tft.fillTriangle(w / 2, 4, w / 2 - 18, 30, w / 2 + 18, 30, TFT_GREEN);
    tft.setTextDatum(TC_DATUM);
    tft.setTextColor(TFT_GREEN, TFT_BLACK);
    tft.drawString("TOP", w / 2, 34, 4);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    char buf[24];
    snprintf(buf, sizeof buf, "%d x %d", w, h);
    tft.drawString(buf, w / 2, h / 2, 4);
    snprintf(buf, sizeof buf, "rotation %d", rot);
    tft.drawString(buf, w / 2, h / 2 + 30, 2);
    tft.setTextDatum(BC_DATUM);
    tft.setTextColor(TFT_RED, TFT_BLACK);
    tft.drawString("bottom", w / 2, h - 4, 2);
    Serial.printf("   rotation %d: green arrow + TOP at the top edge, '%d x %d', red 'bottom'.\n", rot, w, h);
    Serial.println("   Text should read normally (not mirrored).");
    waitNext(rot < 3 ? "next rotation" : "T5");
  }
}

// ---------------------------------------------------------------------------
static void t5Speed() {
  Serial.println("\n== T5 SPI speed ==");
  tft.setRotation(0);
  TFT_eSprite spr(&tft);
  spr.setAttribute(PSRAM_ENABLE, false);  // internal RAM, fair speed test
  if (!spr.createSprite(tft.width(), tft.height())) {
    Serial.println("   !! sprite alloc FAILED");
    return;
  }
  Serial.printf("   sprite %dx%d allocated, free heap %u\n", spr.width(), spr.height(), ESP.getFreeHeap());
  const uint32_t freqs[] = {40000000, 80000000};
  for (uint32_t f : freqs) {
    tft_spi_hz = f;
    int w = spr.width(), h = spr.height();
    for (int y = 0; y < h; y += 10)
      for (int x = 0; x < w; x += 10)
        spr.fillRect(x, y, 10, 10, ((x / 10 + y / 10) & 1) ? TFT_WHITE : TFT_BLACK);
    spr.drawRect(0, 0, w, h, TFT_RED);
    uint32_t t0 = micros();
    for (int i = 0; i < 50; i++) spr.pushSprite(0, 0);
    uint32_t dt = micros() - t0;
    float fps = 50e6f / dt;
    Serial.printf("   %u MHz: 50 pushes in %u ms -> %.1f fps\n", f / 1000000, dt / 1000, fps);
    char buf[32];
    snprintf(buf, sizeof buf, "%u MHz %.1f fps", f / 1000000, fps);
    spr.fillRect(10, h / 2 - 14, w - 20, 28, TFT_BLUE);
    spr.setTextColor(TFT_WHITE, TFT_BLUE);
    spr.setTextDatum(MC_DATUM);
    spr.drawString(buf, w / 2, h / 2, 2);
    spr.pushSprite(0, 0);
    Serial.println("   Expect: clean 10px black/white checkerboard, red 1px frame, blue label.");
    Serial.println("   Look for: speckles, shifted rows, wrong colours.");
    waitNext(f == freqs[0] ? "80 MHz" : "finish");
  }
  spr.deleteSprite();
  tft_spi_hz = 40000000;
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  delay(300);
  Serial.println("\n\n##### Clockling wiring test: ESP32-S3 + 1.9in ST7789V 170x320 #####");
  Serial.printf("PSRAM %u bytes, flash %u bytes\n", ESP.getPsramSize(), ESP.getFlashChipSize());
  waitNext("T1");
  t1Backlight();
  waitNext("T2");
  t2Fills();
  waitNext("T3");
  t3Edges();
  t4Orientation();
  t5Speed();
  Serial.println("\n##### ALL TESTS DONE #####");
  waitNext("restart");
  ESP.restart();
}

void loop() {}
