/* Clockling - WiFi (WiFiManager captive portal, like NerdMiner's MinerAP),
 * NTP time, and the settings web page at http://clockling.local. */
#pragma once
#include <Arduino.h>

namespace net {

enum State { CONNECTING, PORTAL, ONLINE };

extern const char* AP_NAME;

void begin();          /* tries saved WiFi (blocks up to ~15 s), else opens the portal */
void loop();           /* call every frame */
void startPortal();    /* re-open the setup hotspot on demand (BOOT button) */
State state();
String ip();

}  // namespace net
