#include "net.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiManager.h>

#include "sim.h"
#include "tuning.h"
#include "web_page.h"

namespace net {

const char* AP_NAME = "Clockling-Setup";
static const char* HOSTNAME = "clockling";

static WiFiManager wm;
static WebServer server(80);
static WiFiManagerParameter* tzParam;
static State s_state = CONNECTING;
static bool s_serverUp = false;

State state() { return s_state; }
String ip() { return WiFi.localIP().toString(); }

static void applyTime() {
    configTzTime(tuning::tz().c_str(), "pool.ntp.org", "time.google.com");
}

static void onPortalSave() {
    if (tzParam && tzParam->getValue()[0]) {
        tuning::setTz(tzParam->getValue());
        tuning::save();
    }
}

/* ------------------------------------------------------------------ settings API */
/* JSON string escape for the few characters that can appear in meta text */
static void appendEscaped(String& out, const char* s) {
    out += '"';
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') out += '\\';
        out += *s;
    }
    out += '"';
}

/* Streamed in small chunks: building the ~10 KB document as one String can fail
 * to allocate on a fragmented heap (the page then got an empty 200). */
static void handleGetConfig() {
    server.setContentLength(CONTENT_LENGTH_UNKNOWN);
    server.send(200, "application/json", "");
    String chunk;
    chunk.reserve(512);
    chunk = "{\"tz\":";
    appendEscaped(chunk, tuning::tz().c_str());
    chunk += ",\"groups\":[";
    for (int g = 0; g < TGROUP_COUNT; g++) {
        if (g) chunk += ',';
        appendEscaped(chunk, TGROUPS[g]);
    }
    chunk += "],\"keys\":[";
    server.sendContent(chunk);
    char num[24];
    for (int i = 0; i < T_COUNT; i++) {
        const TMeta& m = TMETA[i];
        chunk = i ? ",{\"k\":" : "{\"k\":";
        appendEscaped(chunk, m.key);
        snprintf(num, sizeof(num), "%g", g_tun[i]);
        chunk += ",\"v\":"; chunk += num;
        snprintf(num, sizeof(num), "%g", m.def);
        chunk += ",\"d\":"; chunk += num;
        chunk += ",\"b\":"; chunk += m.isBool;
        chunk += ",\"a\":"; chunk += m.advanced;
        chunk += ",\"g\":"; chunk += m.group;
        chunk += ",\"m\":";
        appendEscaped(chunk, m.meaning);
        if (m.opts) { chunk += ",\"o\":"; appendEscaped(chunk, m.opts); }
        chunk += '}';
        server.sendContent(chunk);
    }
    server.sendContent("]}");
    server.sendContent("");   /* end of chunked response */
}

static void handlePostConfig() {
    JsonDocument doc;
    if (deserializeJson(doc, server.arg("plain"))) {
        server.send(400, "text/plain", "bad json");
        return;
    }
    int changed = 0;
    for (JsonPair kv : doc["values"].as<JsonObject>()) {
        int i = tuning::find(kv.key().c_str());
        if (i < 0) continue;
        float v = kv.value().as<float>();
        if (!isfinite(v)) continue;
        g_tun[i] = v;
        changed++;
    }
    if (doc["tz"].is<const char*>()) {
        String tz = doc["tz"].as<String>();
        if (tz != tuning::tz()) {
            tuning::setTz(tz);
            applyTime();
        }
    }
    tuning::save();
    Serial.printf("settings: saved %d values\n", changed);
    server.send(200, "application/json", "{\"ok\":true}");
}

static void handleReset() {
    tuning::resetAll();
    tuning::save();
    server.send(200, "application/json", "{\"ok\":true}");
}

static void restartBattle() {
    int n = (int)TUN(unitCount);
    sim::setCount(n ? n : (int)TUN(maxLings));
}

static void handleRestart() {
    restartBattle();
    server.send(200, "application/json", "{\"ok\":true}");
}

static void handleWifiReset() {
    server.send(200, "application/json", "{\"ok\":true}");
    delay(300);
    wm.resetSettings();
    ESP.restart();
}

static void startServer() {
    if (s_serverUp) return;
    server.on("/", HTTP_GET, [] { server.send_P(200, "text/html", WEB_PAGE); });
    server.on("/api/config", HTTP_GET, handleGetConfig);
    server.on("/api/config", HTTP_POST, handlePostConfig);
    server.on("/api/reset", HTTP_POST, handleReset);
    server.on("/api/restart", HTTP_POST, handleRestart);
    server.on("/api/wifi-reset", HTTP_POST, handleWifiReset);
    server.onNotFound([] { server.send(404, "text/plain", "not found"); });
    server.begin();
    if (MDNS.begin(HOSTNAME)) MDNS.addService("http", "tcp", 80);
    s_serverUp = true;
    Serial.printf("net: settings at http://%s.local  (http://%s)\n", HOSTNAME, ip().c_str());
}

static void stopServer() {
    if (!s_serverUp) return;
    server.stop();
    MDNS.end();
    s_serverUp = false;
}

static void goOnline() {
    s_state = ONLINE;
    applyTime();
    startServer();
}

void begin() {
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(HOSTNAME);
    static char tzBuf[64];
    strlcpy(tzBuf, tuning::tz().c_str(), sizeof(tzBuf));
    tzParam = new WiFiManagerParameter("tz", "Timezone (POSIX TZ, UK default)", tzBuf, 63);
    wm.addParameter(tzParam);
    wm.setSaveConfigCallback(onPortalSave);
    wm.setSaveParamsCallback(onPortalSave);
    wm.setTitle("Clockling");
    wm.setHostname(HOSTNAME);
    std::vector<const char*> menu = {"wifi", "info", "exit"};
    wm.setMenu(menu);
    wm.setConnectTimeout(15);
    wm.setConfigPortalBlocking(false);
    wm.setConfigPortalTimeout(0);
    if (wm.autoConnect(AP_NAME)) {
        goOnline();
    } else {
        s_state = PORTAL;
        Serial.printf("net: no WiFi - join '%s' then open 192.168.4.1\n", AP_NAME);
    }
}

void startPortal() {
    if (s_state == PORTAL) return;
    stopServer();
    s_state = PORTAL;
    wm.startConfigPortal(AP_NAME);
    Serial.printf("net: portal open on '%s'\n", AP_NAME);
}

void loop() {
    if (s_state == PORTAL) {
        if (wm.process() || (WiFi.status() == WL_CONNECTED && !wm.getConfigPortalActive())) {
            goOnline();
        }
        return;
    }
    if (s_serverUp) server.handleClient();
}

}  // namespace net
