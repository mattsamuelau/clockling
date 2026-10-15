// Software-SPI ST7789 test, no TFT_eSPI. Isolates wiring from library config.
// Pins come from the same TFT_* defines as [s3_19in].
#include <Arduino.h>

static const int SCK_P = TFT_SCLK, MOSI_P = TFT_MOSI, CS_P = TFT_CS, DC_P = TFT_DC, RST_P = TFT_RST, BL_P = TFT_BL;

static void wr(uint8_t b) {
  for (int i = 7; i >= 0; i--) {
    digitalWrite(MOSI_P, (b >> i) & 1);
    digitalWrite(SCK_P, HIGH);
    digitalWrite(SCK_P, LOW);
  }
}
static void cmd(uint8_t c) { digitalWrite(DC_P, LOW); digitalWrite(CS_P, LOW); wr(c); digitalWrite(CS_P, HIGH); }
static void dat(uint8_t d) { digitalWrite(DC_P, HIGH); digitalWrite(CS_P, LOW); wr(d); digitalWrite(CS_P, HIGH); }
static void win(int x0, int y0, int x1, int y1) {
  cmd(0x2A); dat(x0 >> 8); dat(x0); dat(x1 >> 8); dat(x1);
  cmd(0x2B); dat(y0 >> 8); dat(y0); dat(y1 >> 8); dat(y1);
  cmd(0x2C);
}
static void fill(uint16_t c) {
  win(35, 0, 35 + 169, 319);
  digitalWrite(DC_P, HIGH); digitalWrite(CS_P, LOW);
  for (int i = 0; i < 170 * 320; i++) { wr(c >> 8); wr(c & 0xFF); }
  digitalWrite(CS_P, HIGH);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n#### bit-bang ST7789 test: SCK=%d MOSI=%d CS=%d DC=%d RST=%d BL=%d\n", SCK_P, MOSI_P, CS_P, DC_P, RST_P, BL_P);
  int out[] = {SCK_P, MOSI_P, CS_P, DC_P, RST_P, BL_P};
  for (int p : out) pinMode(p, OUTPUT);
  digitalWrite(CS_P, HIGH); digitalWrite(SCK_P, LOW); digitalWrite(BL_P, HIGH);
  digitalWrite(RST_P, HIGH); delay(20); digitalWrite(RST_P, LOW); delay(20); digitalWrite(RST_P, HIGH); delay(150);
  cmd(0x01); delay(150);          // SWRESET
  cmd(0x11); delay(120);          // SLPOUT
  cmd(0x3A); dat(0x55);           // 16 bpp
  cmd(0x36); dat(0x00);           // MADCTL portrait, RGB
  cmd(0x21);                      // INVON
  cmd(0x13);                      // NORON
  cmd(0x29); delay(20);           // DISPON
  Serial.println("init sent");
}

void loop() {
  const struct { uint16_t c; const char *n; } f[] = {
    {0xF800, "RED"}, {0x07E0, "GREEN"}, {0x001F, "BLUE"}, {0xFFFF, "WHITE"}, {0x0000, "BLACK"}};
  for (auto &x : f) {
    Serial.printf("fill %s\n", x.n);
    fill(x.c);
    delay(2000);
  }
}
