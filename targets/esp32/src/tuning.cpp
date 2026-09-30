#include "tuning.h"

#include <ArduinoJson.h>
#include <Preferences.h>

float g_tun[T_COUNT];

namespace tuning {

static const char* NS = "clockling";
static const char* DEFAULT_TZ = "GMT0BST,M3.5.0/1,M10.5.0";  /* UK */
static String s_tz = DEFAULT_TZ;

int find(const char* key) {
    for (int i = 0; i < T_COUNT; i++) {
        if (strcmp(TMETA[i].key, key) == 0) return i;
    }
    return -1;
}

void resetAll() {
    for (int i = 0; i < T_COUNT; i++) g_tun[i] = TMETA[i].def;
}

void begin() {
    resetAll();
    Preferences p;
    if (!p.begin(NS, true)) return;
    String json = p.getString("tun", "{}");
    s_tz = p.getString("tz", DEFAULT_TZ);
    p.end();

    JsonDocument doc;
    if (deserializeJson(doc, json)) return;
    for (JsonPair kv : doc.as<JsonObject>()) {
        int i = find(kv.key().c_str());
        if (i >= 0) g_tun[i] = kv.value().as<float>();
    }
}

void save() {
    JsonDocument doc;
    for (int i = 0; i < T_COUNT; i++) {
        if (g_tun[i] != TMETA[i].def) doc[TMETA[i].key] = g_tun[i];
    }
    String json;
    serializeJson(doc, json);
    Preferences p;
    if (!p.begin(NS, false)) return;
    p.putString("tun", json);
    p.putString("tz", s_tz);
    p.end();
}

const String& tz() { return s_tz; }
void setTz(const String& tz) { s_tz = tz.length() ? tz : String(DEFAULT_TZ); }

}  // namespace tuning
