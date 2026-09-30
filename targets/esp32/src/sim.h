/* Clockling - battle sim, ported from app/js/swarm.js (logic only; drawing
 * lives in render.cpp). Keep the two in step: same rules, same TUNING keys. */
#pragma once
#include <stdint.h>
#include "gen_assets.h"

enum Kind : uint8_t { K_NONE, K_LING, K_BANE, K_MARINE, K_EGG };
enum SplatCol : uint8_t { SC_LING, SC_BANE, SC_MARINE };

struct Unit {
    Kind kind, hatchKind;
    bool dead, berserk, entered, shooting;
    int8_t face, faceDir;
    uint8_t frame;
    uint8_t splatCol;
    uint16_t kills;
    float x, y, heading, speed, w, bumpR, frameTimer;
    float hp, age, t, hatchT, hatchMult, splatScale;
    float retarget, aim, aimT, shootCd, attackCd, healCd, flashT, hitX, hitY;
};

struct Splat { float x, y, life, max, base; uint8_t col, seed; };

struct Corpse {
    float x, y, w, rot, life, max;
    const SpriteFrame* img;
    bool mirror;
};

namespace sim {

constexpr int MAX_UNITS = 220;
constexpr int MAX_SPLATS = 96;
constexpr int MAX_CORPSES = 64;

extern int W, H;
extern Unit units[MAX_UNITS];
extern int nUnits;
extern Splat splats[MAX_SPLATS];
extern int nSplats;
extern Corpse corpses[MAX_CORPSES];
extern int nCorpses;

void init(int w, int h);
void setCount(int n);             /* restart the battle with n lings */
void update(float dt);            /* one sim tick (logic + splat/corpse aging) */
void killNear(float x, float y, float r);
int countKind(Kind k);

/* Shared with the renderer so corpses/units pick identical frames/orientation. */
const SpriteSet& frameSet(const Unit& c);
float drawAngle(const Unit& c, bool* mirror);
float frand(float a, float b);

}  // namespace sim
