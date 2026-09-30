/* Clockling - live TUNING/SETTINGS values, persisted to NVS as a JSON blob of
 * overrides (only keys that differ from the generated defaults are stored). */
#pragma once
#include <Arduino.h>
#include "gen_assets.h"

extern float g_tun[T_COUNT];

/* TUN(maxLings) reads the live value of a key. */
#define TUN(k) (g_tun[T_##k])
#define TUNB(k) (g_tun[T_##k] != 0.0f)

namespace tuning {
void begin();                       /* load defaults, then saved overrides */
int find(const char* key);          /* key -> index, or -1 */
void resetAll();                    /* all keys back to defaults (not saved) */
void save();                        /* persist overrides + tz */
const String& tz();                 /* POSIX TZ string, e.g. GMT0BST,M3.5.0/1,M10.5.0 */
void setTz(const String& tz);
}
