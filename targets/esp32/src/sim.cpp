#include "sim.h"

#include <Arduino.h>
#include <math.h>
#include <string.h>

#include "tuning.h"

namespace sim {

int W = 240, H = 320;
Unit units[MAX_UNITS];
int nUnits = 0;
Splat splats[MAX_SPLATS];
int nSplats = 0;
Corpse corpses[MAX_CORPSES];
int nCorpses = 0;

static int respawnLeftLings = 0;
static float respawnTimer = 0;
static float marineTimer = 3;
static int lastMarineCount = 0;
static float morphCooldown = 0;
static int wavePending = 0;
static float waveSpawnT = 0;
static bool waveFirst = true;
static bool waveIsRespawn = false;
static float waveSpawnX = 0, waveSpawnY = 0;
static float waveChainDir = 1;

/* population knobs scaled by unitScale (applyUnitScale in swarm.js) */
static int MAX_LINGS, MAX_BANES, MAX_MARINES, BERSERK_BANES;
static int WAVE_LO, WAVE_HI, RESPAWN_SZ_LO, RESPAWN_SZ_HI;
static float SPAWN_RATE;

static const float PI_F = 3.14159265f;

static uint32_t rng = 0x12345678;
float frand(float a, float b) {
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
    return a + (rng >> 8) * (1.0f / 16777216.0f) * (b - a);
}
static float random01() { return frand(0, 1); }
static int jsRound(float v) { return (int)floorf(v + 0.5f); }

static void applyUnitScale() {
    float s = TUN(unitScale);
    MAX_LINGS = max(1, jsRound(TUN(maxLings) * s));
    MAX_BANES = max(1, jsRound(TUN(maxBanes) * s));
    MAX_MARINES = max(1, jsRound(TUN(maxMarines) * s));
    BERSERK_BANES = max(1, jsRound(TUN(berserkBanes) * s));
    WAVE_LO = max(1, jsRound(TUN(marineWaveSizeLo) * s));
    WAVE_HI = max(1, jsRound(TUN(marineWaveSizeHi) * s));
    RESPAWN_SZ_LO = max(1, jsRound(TUN(marineRespawnSizeLo) * s));
    RESPAWN_SZ_HI = max(1, jsRound(TUN(marineRespawnSizeHi) * s));
    SPAWN_RATE = fmaxf(0.1f, TUN(marineSpawnRateMult) * s);
}

static float marineRange() { return TUN(marineW) * TUN(marineRangeMult); }

static Unit* push() {
    if (nUnits >= MAX_UNITS) return nullptr;
    Unit* c = &units[nUnits++];
    memset(c, 0, sizeof(Unit));
    return c;
}

/* hatchKind: what an egg turns into. Returns nullptr when the pool is full. */
static Unit* make(Kind kind, Kind hatchKind = K_NONE) {
    Unit* c = push();
    if (!c) return nullptr;
    c->kind = kind;
    c->x = frand(24, W - 24);
    c->y = frand(24, H - 24);
    c->heading = frand(0, PI_F * 2);
    c->frameTimer = frand(0, 0.12f);
    c->hp = 100;
    c->splatScale = 1;
    c->hatchKind = hatchKind;
    if (kind == K_LING) {
        c->faceDir = -1; c->face = -1; c->w = TUN(lingW); c->bumpR = TUN(lingBump);
        c->speed = frand(26, 46); c->splatCol = SC_LING;
        c->hp = TUN(lingHp);
    } else if (kind == K_BANE) {
        c->faceDir = 1; c->face = 1; c->w = TUN(baneW); c->bumpR = TUN(baneBump);
        c->speed = frand(24, 40); c->splatCol = SC_BANE; c->splatScale = TUN(baneSplatScale);
        c->hp = TUN(baneHp);
    } else if (kind == K_MARINE) {
        c->faceDir = -1; c->face = -1; c->w = TUN(marineW); c->bumpR = TUN(marineBump);
        c->speed = frand(16, 24); c->splatCol = SC_MARINE; c->hp = TUN(marineHp);
        c->splatScale = TUN(marineSplatScale);
        c->shootCd = TUN(marineShootInterval); c->aim = c->heading;
    } else if (kind == K_EGG) {
        c->w = TUN(eggW); c->bumpR = 12; c->speed = 0; c->hatchMult = 1;
        c->hatchT = frand(TUN(eggTimeMin), TUN(eggTimeMax));
        c->splatCol = SC_BANE; c->splatScale = 1;
    }
    return c;
}

const SpriteSet& frameSet(const Unit& c) {
    switch (c.kind) {
        case K_LING: return SPR_LING;
        case K_BANE: return SPR_BANE;
        case K_EGG: return SPR_EGG;
        default: return c.shooting ? SPR_MATK : SPR_MWALK;
    }
}

/* Orient so the sprite's facing side points along travel; if that would put
 * the bottom above the horizon, mirror horizontally. Never upside down. */
float drawAngle(const Unit& c, bool* mirror) {
    float ang = (c.kind == K_MARINE) ? c.aim : c.heading;
    bool m = (c.faceDir == 1) ? (c.face == -1) : (c.face == 1);
    *mirror = m;
    if (c.faceDir == 1) return m ? ang + PI_F : ang;
    return m ? -ang : ang + PI_F;
}

static bool alive(const Unit& c) { return !c.dead && c.kind != K_NONE; }

static Unit* nearestMarine(float x, float y) {
    Unit* best = nullptr; float bd = 1e9f;
    for (int i = 0; i < nUnits; i++) {
        Unit& c = units[i];
        if (c.kind != K_MARINE || c.dead || c.hp <= 0) continue;
        float dx = c.x - x, dy = c.y - y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = &c; }
    }
    return best;
}

static Unit* nearestZerg(float x, float y) {
    Unit* best = nullptr; float bd = 1e9f;
    for (int i = 0; i < nUnits; i++) {
        Unit& c = units[i];
        if ((c.kind != K_LING && c.kind != K_BANE) || c.dead) continue;
        float dx = c.x - x, dy = c.y - y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = &c; }
    }
    return best;
}

static Unit* nearestOtherMarine(const Unit* self) {
    Unit* best = nullptr; float bd = 1e9f;
    for (int i = 0; i < nUnits; i++) {
        Unit& c = units[i];
        if (c.kind != K_MARINE || c.dead || &c == self) continue;
        float dx = c.x - self->x, dy = c.y - self->y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = &c; }
    }
    return best;
}

static int countNearbyLings(const Unit* self, float r) {
    int n = 0;
    for (int i = 0; i < nUnits; i++) {
        const Unit& c = units[i];
        if (c.kind != K_LING || c.dead || &c == self) continue;
        float dx = c.x - self->x, dy = c.y - self->y;
        if (dx * dx + dy * dy < r * r) n++;
    }
    return n;
}

static int countNearbyMarines(const Unit* self, float r) {
    int n = 0;
    for (int i = 0; i < nUnits; i++) {
        const Unit& c = units[i];
        if (c.kind != K_MARINE || c.dead) continue;
        float dx = c.x - self->x, dy = c.y - self->y;
        if (dx * dx + dy * dy < r * r) n++;
    }
    return n;
}

/* any berserk bane within r of (x,y)? lings catch berserk from these */
static bool berserkBaneNear(float x, float y, float r) {
    for (int i = 0; i < nUnits; i++) {
        const Unit& c = units[i];
        if (c.kind != K_BANE || c.dead || !c.berserk) continue;
        float dx = c.x - x, dy = c.y - y;
        if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
}

int countKind(Kind kind) {
    int n = 0;
    for (int i = 0; i < nUnits; i++) {
        if (units[i].kind == kind && !units[i].dead) n++;
    }
    return n;
}

struct Home { int qx, qy; float cx, cy; };

/* the marine quadrant with the most marines, plus the centroid inside it */
static Home marineHome() {
    int counts[2][2] = {{0, 0}, {0, 0}};
    for (int i = 0; i < nUnits; i++) {
        const Unit& c = units[i];
        if (c.kind != K_MARINE || c.dead) continue;
        counts[c.x < W / 2.0f ? 0 : 1][c.y < H / 2.0f ? 0 : 1]++;
    }
    Home h = {0, 0, 0, 0};
    int best = -1;
    for (int x = 0; x < 2; x++)
        for (int y = 0; y < 2; y++)
            if (counts[x][y] > best) { best = counts[x][y]; h.qx = x; h.qy = y; }
    float cx = 0, cy = 0; int n = 0;
    for (int j = 0; j < nUnits; j++) {
        const Unit& c = units[j];
        if (c.kind != K_MARINE || c.dead) continue;
        if ((c.x < W / 2.0f ? 0 : 1) == h.qx && (c.y < H / 2.0f ? 0 : 1) == h.qy) {
            cx += c.x; cy += c.y; n++;
        }
    }
    if (n > 0) { cx /= n; cy /= n; } else { cx = W / 2.0f; cy = H / 2.0f; }
    h.cx = cx; h.cy = cy;
    return h;
}

/* put a new egg anywhere except the quadrant with the most marines */
static void placeEggOpposite(Unit* egg) {
    int marineCount = countKind(K_MARINE);
    Home home = marineHome();
    int ox[4], oy[4], n = 0;
    for (int x = 0; x < 2; x++)
        for (int y = 0; y < 2; y++) {
            if (marineCount > 0 && x == home.qx && y == home.qy) continue;
            ox[n] = x; oy[n] = y; n++;
        }
    int pick = min(n - 1, (int)(random01() * n));
    egg->x = frand(ox[pick] * W / 2.0f + 16, ox[pick] * W / 2.0f + W / 2.0f - 16);
    egg->y = frand(oy[pick] * H / 2.0f + 16, oy[pick] * H / 2.0f + H / 2.0f - 16);
}

static int pendingLings() {
    int n = countKind(K_LING);
    for (int i = 0; i < nUnits; i++) {
        const Unit& c = units[i];
        if (c.kind == K_EGG && !c.dead && c.hatchKind == K_LING) n += 2; /* each egg yields 2 lings */
    }
    return n;
}

static float wrapAngle(float d) {
    while (d > PI_F) d -= 6.283f;
    while (d < -PI_F) d += 6.283f;
    return d;
}

/* fall back: stay out of the marine quadrant and flock together (lings + banes) */
static void fallBack(Unit* c, float lo, float hi) {
    float ax = 0, ay = 0;

    /* avoid the nearest marine when close */
    Unit* m = nearestMarine(c->x, c->y);
    if (m) {
        float dmx = c->x - m->x, dmy = c->y - m->y;
        float dm2 = dmx * dmx + dmy * dmy;
        float avoidR = TUN(marineScanRadius);
        if (dm2 < avoidR * avoidR) {
            float dm = sqrtf(dm2); if (dm == 0) dm = 1;
            float w = 1 - (dm / avoidR);
            ax += (dmx / dm) * w * 2.2f;
            ay += (dmy / dm) * w * 2.2f;
        }
    }

    /* stay out of the quadrant with the most marines */
    if (countKind(K_MARINE) > 0) {
        Home home = marineHome();
        bool inMarineQ = (c->x >= home.qx * W / 2.0f && c->x < home.qx * W / 2.0f + W / 2.0f &&
                          c->y >= home.qy * H / 2.0f && c->y < home.qy * H / 2.0f + H / 2.0f);
        if (inMarineQ) {
            float hx = home.qx * W / 2.0f + W / 4.0f, hy = home.qy * H / 2.0f + H / 4.0f;
            float dqx = c->x - hx, dqy = c->y - hy;
            float dq = sqrtf(dqx * dqx + dqy * dqy); if (dq == 0) dq = 1;
            ax += (dqx / dq) * 1.6f;
            ay += (dqy / dq) * 1.6f;
        }
    }

    /* flock: separation + cohesion among lings and banes only (not eggs) */
    float cx = 0, cy = 0; int n = 0;
    for (int i = 0; i < nUnits; i++) {
        Unit& o = units[i];
        if (&o == c || o.dead) continue;
        if (o.kind != K_LING && o.kind != K_BANE) continue;
        float dx = o.x - c->x, dy = o.y - c->y;
        float d2 = dx * dx + dy * dy;
        float minR = c->bumpR + o.bumpR + 8;
        if (d2 > 0.01f && d2 < minR * minR) {
            float d = sqrtf(d2);
            float w = (minR - d) / minR;
            ax -= (dx / d) * w * 1.5f;
            ay -= (dy / d) * w * 1.5f;
        }
        if (d2 < 90 * 90) { cx += o.x; cy += o.y; n++; }
    }
    if (n > 0) {
        cx /= n; cy /= n;
        float dcx = cx - c->x, dcy = cy - c->y;
        float dc = sqrtf(dcx * dcx + dcy * dcy); if (dc == 0) dc = 1;
        ax += (dcx / dc) * 0.6f;
        ay += (dcy / dc) * 0.6f;
    }

    /* organic wander */
    ax += frand(-0.25f, 0.25f);
    ay += frand(-0.25f, 0.25f);

    if (ax != 0 || ay != 0) {
        float diff = wrapAngle(atan2f(ay, ax) - c->heading);
        c->heading += diff * 0.3f;
        c->speed = frand(lo, hi);
    }
}

/* turn c.heading toward (tx,ty), or away from it when `away` is true */
static void marineSteerToward(Unit* c, float tx, float ty, bool away) {
    float dx = away ? (c->x - tx) : (tx - c->x);
    float dy = away ? (c->y - ty) : (ty - c->y);
    float diff = wrapAngle(atan2f(dy, dx) - c->heading);
    c->heading += diff * TUN(marineTurnRate);
}

/* classic marine steering: group with other marines, flee lings only when hurt */
static void marineClassicSteer(Unit* c) {
    float ax = 0, ay = 0;
    if (c->hp < TUN(marineHp) * TUN(marineFleeHpPct)) {
        Unit* z = nearestZerg(c->x, c->y);
        if (z) {
            float dxz = c->x - z->x, dyz = c->y - z->y;
            float dz = sqrtf(dxz * dxz + dyz * dyz); if (dz == 0) dz = 1;
            ax += (dxz / dz) * TUN(marineAwayWeight);
            ay += (dyz / dz) * TUN(marineAwayWeight);
        }
    }
    Unit* om = nearestOtherMarine(c);
    if (om) {
        float dxm = om->x - c->x, dym = om->y - c->y;
        float dm = sqrtf(dxm * dxm + dym * dym); if (dm == 0) dm = 1;
        ax += (dxm / dm) * TUN(marineGroupWeight);
        ay += (dym / dm) * TUN(marineGroupWeight);
    }
    if (ax != 0 || ay != 0) {
        float diff = wrapAngle(atan2f(ay, ax) - c->heading);
        c->heading += diff * TUN(marineTurnRate);
    }
}

/* new marine tactics: kite away, regroup when outnumbered, else advance */
static void marineTacticsSteer(Unit* c) {
    Unit* z = nearestZerg(c->x, c->y);
    int zergCount = countKind(K_LING) + countKind(K_BANE);
    bool outnumbered = zergCount > countKind(K_MARINE);
    bool damaged = c->hp < TUN(marineHp) * TUN(marineFleeHpPct);
    bool zergInRange = false;
    if (z) {
        float dxz = z->x - c->x, dyz = z->y - c->y, r = marineRange();
        zergInRange = (dxz * dxz + dyz * dyz) < r * r;
    }
    if (damaged || zergInRange) {
        if (z) marineSteerToward(c, z->x, z->y, true);       /* flee/kite */
    } else if (outnumbered) {
        Unit* om = nearestOtherMarine(c);                     /* regroup */
        if (om) marineSteerToward(c, om->x, om->y, false);
    } else if (z) {
        marineSteerToward(c, z->x, z->y, false);              /* advance */
    }
}

static void step(Unit* c, float dt) {
    if (c->kind == K_EGG) { c->t += dt * (c->hatchMult ? c->hatchMult : 1); return; }
    float unitSpeed = TUN(unitSpeed);

    if (c->kind == K_MARINE) {
        /* only start steering once fully on-screen */
        if (!c->entered && c->x >= 0 && c->x <= W && c->y >= 0 && c->y <= H) c->entered = true;
        if (c->flashT > 0) c->flashT -= dt;
        c->retarget -= dt;
        if (c->retarget <= 0) {
            c->retarget = 0.5f;
            if (c->entered) {
                if (TUNB(marineTactics)) marineTacticsSteer(c);
                else marineClassicSteer(c);
            }
        }
        float v = c->speed * TUN(terranSpeed) * unitSpeed * dt;
        c->x += cosf(c->heading) * v;
        c->y += sinf(c->heading) * v;
        /* reflect only when moving outward, so marines can walk in from off-screen */
        if (c->x < 18 && cosf(c->heading) < 0) { c->x = 18; c->heading = PI_F - c->heading; }
        if (c->x > W - 18 && cosf(c->heading) > 0) { c->x = W - 18; c->heading = PI_F - c->heading; }
        if (c->y < 18 && sinf(c->heading) < 0) { c->y = 18; c->heading = -c->heading; }
        if (c->y > H - 18 && sinf(c->heading) > 0) { c->y = H - 18; c->heading = -c->heading; }
        /* re-aim at the closest zerg, but only every aimInterval (anti-jitter) */
        c->aimT -= dt;
        if (c->aimT <= 0) {
            c->aimT = TUN(aimInterval);
            Unit* tgt = nearestZerg(c->x, c->y);
            c->aim = tgt ? atan2f(tgt->y - c->y, tgt->x - c->x) : c->heading;
        }
    } else {
        /* ling / bane: only pick a direction every retargetInterval (anti-jitter) */
        c->age += dt;
        c->retarget -= dt;
        if (c->retarget <= 0) {
            c->retarget = TUN(retargetInterval);
            Unit* m = nearestMarine(c->x, c->y);
            if (c->kind == K_LING) {
                int allies = countNearbyLings(c, TUN(allyRadius));
                if (m) {
                    /* marine group size = marines clustered around the target marine */
                    int marineGroup = countNearbyMarines(m, TUN(marineGroupRadius));
                    bool favorable = allies >= TUN(attackGroupSize) && marineGroup <= TUN(maxEngageMarines);
                    bool catching = berserkBaneNear(c->x, c->y, TUN(berserkCatchRadius));
                    if (c->berserk) {
                        /* cancel and retreat only when the numbers are against us
                         * and no berserk bane is nearby to re-trigger it */
                        if (!TUNB(berserkUntilDeath) && !favorable && !catching) {
                            c->berserk = false;
                            fallBack(c, 26, 46);
                        } else {
                            c->heading = atan2f(m->y - c->y, m->x - c->x) + frand(-0.1f, 0.1f);
                            c->speed = frand(26, 46) * TUN(berserkSpeedMult);
                        }
                    } else if (catching) {
                        c->berserk = true;
                        c->heading = atan2f(m->y - c->y, m->x - c->x) + frand(-0.1f, 0.1f);
                        c->speed = frand(26, 46) * TUN(berserkSpeedMult);
                    } else if (favorable) {
                        c->heading = atan2f(m->y - c->y, m->x - c->x) + frand(-0.1f, 0.1f);
                        c->speed = frand(26, 46);
                    } else {
                        c->berserk = false;
                        fallBack(c, 26, 46);
                    }
                } else {
                    c->berserk = false;
                    fallBack(c, 26, 46);
                }
            } else {
                /* bane: berserk when enough banes are alive (counts itself).
                 * Banelings NEVER lose berserk once they have it. */
                if (m && (c->berserk || countKind(K_BANE) >= BERSERK_BANES)) {
                    c->berserk = true;
                    c->heading = atan2f(m->y - c->y, m->x - c->x) + frand(-0.1f, 0.1f);
                    c->speed = frand(24, 40) * TUN(berserkSpeedMult);
                } else {
                    fallBack(c, 24, 40);
                }
            }
        }
        float v = c->speed * TUN(zergSpeed) * unitSpeed * dt;
        c->x += cosf(c->heading) * v;
        c->y += sinf(c->heading) * v;
        if (c->x < 18) { c->x = 18; c->heading = PI_F - c->heading; }
        if (c->x > W - 18) { c->x = W - 18; c->heading = PI_F - c->heading; }
        if (c->y < 18) { c->y = 18; c->heading = -c->heading; }
        if (c->y > H - 18) { c->y = H - 18; c->heading = -c->heading; }
    }

    /* horizontal facing with hysteresis */
    float cosh = cosf(c->kind == K_MARINE ? c->aim : c->heading);
    if (cosh > 0.3f) c->face = 1;
    else if (cosh < -0.3f) c->face = -1;

    c->frameTimer -= dt;
    const SpriteSet& fs = frameSet(*c);
    if (c->frameTimer <= 0 && fs.n) {
        c->frameTimer = (c->kind == K_MARINE) ? 0.1f : 0.12f;
        /* baneling rolls the other way -> reverse the frame order */
        if (c->kind == K_BANE) c->frame = (c->frame + fs.n - 1) % fs.n;
        else c->frame = (c->frame + 1) % fs.n;
    }
}

static void addSplat(float x, float y, uint8_t col, float scale) {
    if (nSplats >= MAX_SPLATS) return;
    Splat& s = splats[nSplats++];
    s.x = x; s.y = y; s.life = s.max = TUN(splatLife);
    s.col = col; s.seed = (uint8_t)min(3, (int)(random01() * 4));
    s.base = TUN(splatBase) * (scale ? scale : 1);
}

static void addCorpse(const Unit& c, const SpriteFrame* img) {
    if (nCorpses >= MAX_CORPSES) return;
    Corpse& co = corpses[nCorpses++];
    co.x = c.x; co.y = c.y; co.w = c.w; co.img = img;
    co.rot = drawAngle(c, &co.mirror);
    co.life = co.max = TUN(corpseLife);
}

static void killUnit(Unit* c) {
    if (c->dead) return;
    addSplat(c->x, c->y, c->splatCol, c->splatScale);
    c->dead = true;
    if (c->kind == K_LING) {
        respawnLeftLings++;
        /* corpse: freeze the frame, show only the bottom half, fade out */
        addCorpse(*c, &SPR_LING.frames[c->frame % SPR_LING.n]);
    } else if (c->kind == K_BANE) {
        /* splash: damage EVERY marine in blast range, not just the touched one */
        float r = TUN(baneSplashR);
        for (int i = 0; i < nUnits; i++) {
            Unit& m = units[i];
            if (m.kind != K_MARINE || m.dead) continue;
            float dx = m.x - c->x, dy = m.y - c->y;
            if (dx * dx + dy * dy < r * r) m.hp -= TUN(baneSplashDamage);
        }
    } else if (c->kind == K_MARINE) {
        const SpriteSet& ms = frameSet(*c);
        addCorpse(*c, &ms.frames[c->frame % ms.n]);
    }
}

/* when an egg hatches, speed up one other active egg */
static void boostSiblingEgg() {
    int idx[MAX_UNITS], n = 0;
    for (int i = 0; i < nUnits; i++)
        if (units[i].kind == K_EGG && !units[i].dead) idx[n++] = i;
    if (n) {
        Unit& pick = units[idx[min(n - 1, (int)(random01() * n))]];
        pick.hatchMult = (pick.hatchMult ? pick.hatchMult : 1) * TUN(eggHatchMult);
    }
}

void init(int w, int h) {
    W = w; H = h;
    rng = esp_random() | 1;
    applyUnitScale();
    setCount((int)TUN(unitCount) ? (int)TUN(unitCount) : MAX_LINGS);
}

/* initial population: lings only (banelings come from morphing) */
void setCount(int n) {
    applyUnitScale();
    int want = max(0, min(MAX_LINGS, n));
    nUnits = 0; nCorpses = 0; nSplats = 0;
    for (int i = 0; i < want; i++) make(K_LING);
    respawnLeftLings = 0;
    respawnTimer = 0;
    marineTimer = 3;
    lastMarineCount = 0;
    morphCooldown = 0;
    wavePending = 0;
}

/* tap: splat only units near the tap point (eggs are safe) */
void killNear(float x, float y, float r) {
    for (int i = 0; i < nUnits; i++) {
        Unit& c = units[i];
        if (c.dead || c.kind == K_EGG) continue;
        float dx = c.x - x, dy = c.y - y, rr = r + c.bumpR;
        if (dx * dx + dy * dy < rr * rr) killUnit(&c);
    }
}

void update(float dt) {
    applyUnitScale();  /* settings can change live from the web page */

    /* new lings spawn as eggs, a batch at a time */
    if (respawnLeftLings > 0) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) {
            respawnTimer = TUN(respawnInterval);
            int n = 0;
            while (respawnLeftLings > 0 && n < TUN(respawnBatch) && pendingLings() < MAX_LINGS) {
                Unit* egg = make(K_EGG, K_LING);
                if (!egg) break;
                placeEggOpposite(egg);
                respawnLeftLings--;
                n++;
            }
        }
    }

    /* marines enter in waves, staggered, from the corner farthest from the lings */
    marineTimer -= dt;
    if (marineTimer <= 0) {
        bool marinesAlive = countKind(K_MARINE) > 0;
        float mInt = marinesAlive ? frand(TUN(marineRespawnLo), TUN(marineRespawnHi))
                                  : frand(TUN(marineWaveLo), TUN(marineWaveHi));
        marineTimer = mInt / SPAWN_RATE;
        int wave = marinesAlive ? jsRound(frand(RESPAWN_SZ_LO, RESPAWN_SZ_HI))
                                : jsRound(frand(WAVE_LO, WAVE_HI));
        wavePending = max(0, min(wave, MAX_MARINES - countKind(K_MARINE)));
        waveSpawnT = 0;
        waveFirst = true;
        waveIsRespawn = marinesAlive;
    }

    /* release the queued wave one marine at a time, marineSpawnGap apart */
    if (wavePending > 0) {
        waveSpawnT -= dt;
        if (waveSpawnT <= 0) {
            waveSpawnT = TUN(marineSpawnGap);
            Unit* mm = make(K_MARINE);
            if (mm) {
                float off = 1.1f * TUN(marineW), inset = TUN(marineSpawnInset);
                if (waveFirst) {
                    if (waveIsRespawn) {
                        /* respawn: reinforce from the edge of the marine home quadrant */
                        Home home = marineHome();
                        mm->x = (home.qx == 0) ? -inset : W + inset;
                        mm->y = (home.qy == 0) ? -inset : H + inset;
                    } else {
                        /* wave: farthest corner (diagonally opposite the lings), just off-screen */
                        float lx = 0, ly = 0; int ln = 0;
                        for (int i = 0; i < nUnits; i++) {
                            const Unit& lc = units[i];
                            if (lc.kind == K_LING && !lc.dead) { lx += lc.x; ly += lc.y; ln++; }
                        }
                        if (ln > 0) { lx /= ln; ly /= ln; } else { lx = W / 2.0f; ly = H / 2.0f; }
                        mm->x = (lx < W / 2.0f) ? W + inset : -inset;
                        mm->y = (ly < H / 2.0f) ? H + inset : -inset;
                    }
                    waveChainDir = (mm->x < 0) ? 1 : -1;
                    waveFirst = false;
                } else {
                    /* chain along the border, 1.1x marine width apart */
                    mm->x = waveSpawnX + waveChainDir * off;
                    mm->y = waveSpawnY;
                }
                waveSpawnX = mm->x;
                waveSpawnY = mm->y;
                mm->heading = atan2f(H / 2.0f - mm->y, W / 2.0f - mm->x) + frand(-0.3f, 0.3f);
                mm->aim = mm->heading;
            }
            wavePending--;
        }
    }

    /* morph: eligible lings turn into baneling eggs (1-3 at a time) */
    if (morphCooldown > 0) morphCooldown -= dt;
    if (MAX_BANES > 0 && morphCooldown <= 0) {
        int baneEggs = 0;
        for (int i = 0; i < nUnits; i++)
            if (units[i].kind == K_EGG && !units[i].dead && units[i].hatchKind == K_BANE) baneEggs++;
        int baneSlots = MAX_BANES - countKind(K_BANE) - baneEggs;
        if (baneSlots > 0 && random01() < TUN(morphChancePerSec) * dt) {
            /* candidates sorted oldest first */
            int cand[MAX_UNITS], nc = 0;
            for (int i = 0; i < nUnits; i++) {
                const Unit& l = units[i];
                if (l.kind == K_LING && !l.dead && l.age >= TUN(morphAge)) cand[nc++] = i;
            }
            for (int i = 1; i < nc; i++) {
                int v = cand[i], j = i - 1;
                while (j >= 0 && units[cand[j]].age < units[v].age) { cand[j + 1] = cand[j]; j--; }
                cand[j + 1] = v;
            }
            int batch = 1;
            if (nc > 1) {
                float r = random01();
                if (r < 0.35f) batch = 2;
                else if (r < 0.5f) batch = 3; /* 3 if lucky */
            }
            batch = min(batch, min(baneSlots, nc));
            for (int b = 0; b < batch; b++) {
                Unit& l2 = units[cand[b]];
                l2.kind = K_EGG;
                l2.hatchKind = K_BANE;
                l2.t = 0;
                l2.hatchT = frand(TUN(eggTimeMin), TUN(eggTimeMax));
                l2.w = TUN(eggW);
                l2.splatCol = SC_BANE;
                l2.splatScale = 1; /* hatch uses the normal green egg-splat */
                l2.speed = 0;
                respawnLeftLings++; /* the consumed ling comes back as an egg */
            }
            if (batch > 0) morphCooldown = TUN(morphCooldown);
        }
    }

    /* eggs hatch */
    for (int e = 0; e < nUnits; e++) {
        Unit* eg = &units[e];
        if (eg->kind == K_EGG && !eg->dead && eg->t >= eg->hatchT) {
            addSplat(eg->x, eg->y, eg->splatCol, eg->splatScale);
            eg->dead = true;
            float ex = eg->x, ey = eg->y;
            if (eg->hatchKind == K_BANE) {
                morphCooldown = TUN(morphCooldown);
                Unit* nb = make(K_BANE);
                if (nb) { nb->x = ex; nb->y = ey; }
            } else {
                /* two lings hatch out of each zergling egg */
                for (int h2 = 0; h2 < 2; h2++) {
                    Unit* nl = make(K_LING);
                    if (!nl) break;
                    nl->x = ex + (h2 == 0 ? -6 : 6);
                    nl->y = ey + (h2 == 0 ? 4 : -4);
                }
            }
            boostSiblingEgg();
        }
    }

    /* move everyone */
    for (int i = 0; i < nUnits; i++) if (!units[i].dead) step(&units[i], dt);

    /* marines shoot the closest zerg (ling or bane) within range */
    float range = marineRange();
    for (int i = 0; i < nUnits; i++) {
        Unit& mc = units[i];
        if (mc.kind != K_MARINE || mc.dead) continue;
        Unit* tgt = nearestZerg(mc.x, mc.y);
        mc.shooting = false;
        if (!tgt) continue;
        float drx = tgt->x - mc.x, dry = tgt->y - mc.y;
        if (drx * drx + dry * dry >= range * range) continue;
        mc.shooting = true;
        mc.shootCd -= dt;
        if (mc.shootCd <= 0) {
            mc.shootCd = TUN(marineShootInterval);
            bool wasAlive = tgt->hp > 0;
            tgt->hp -= TUN(marineShootDamage);
            if (wasAlive && tgt->hp <= 0 && tgt->kind == K_LING) mc.kills++;
            mc.flashT = 0.1f;
            mc.hitX = tgt->x + frand(-tgt->w * 0.3f, tgt->w * 0.3f);
            mc.hitY = tgt->y + frand(-tgt->w * 0.3f, tgt->w * 0.3f);
        }
    }

    /* all units regenerate HP over time (shared heal settings) */
    for (int i = 0; i < nUnits; i++) {
        Unit& hc = units[i];
        if (hc.dead || hc.kind == K_EGG) continue;
        hc.healCd -= dt;
        if (hc.healCd <= 0) {
            hc.healCd = TUN(marineHealInterval);
            float maxHp = hc.kind == K_MARINE ? TUN(marineHp) : hc.kind == K_BANE ? TUN(baneHp) : TUN(lingHp);
            hc.hp = fminf(maxHp, hc.hp + maxHp * TUN(marineHealPct));
        }
    }

    /* lings bite marines every lingBiteInterval while touching */
    for (int i = 0; i < nUnits; i++) {
        Unit& l = units[i];
        if (l.dead || l.kind != K_LING) continue;
        Unit* mt = nearestMarine(l.x, l.y);
        if (!mt) continue;
        float dx = mt->x - l.x, dy = mt->y - l.y, touch = l.bumpR + mt->bumpR + 6;
        if (dx * dx + dy * dy < touch * touch) {
            l.attackCd -= dt;
            if (l.attackCd <= 0) {
                l.attackCd = TUN(lingBiteInterval);
                mt->hp -= TUN(lingBiteDamage);
            }
        }
    }

    /* banelings explode on marines */
    for (int i = 0; i < nUnits; i++) {
        Unit& a = units[i];
        if (a.dead || a.kind != K_BANE) continue;
        Unit* t2 = nearestMarine(a.x, a.y);
        if (!t2) continue;
        float dx = t2->x - a.x, dy = t2->y - a.y, touch = a.bumpR + t2->bumpR + 6;
        if (dx * dx + dy * dy < touch * touch) killUnit(&a); /* splash damages all nearby marines */
    }

    /* deaths at 0 hp: marines, then lings, then banes (same order as swarm.js) */
    const Kind order[3] = {K_MARINE, K_LING, K_BANE};
    for (int o = 0; o < 3; o++)
        for (int i = 0; i < nUnits; i++)
            if (units[i].kind == order[o] && !units[i].dead && units[i].hp <= 0) killUnit(&units[i]);

    /* bump separation: units push apart. Zerg bounce off marines at 50% and keep
     * their heading, so they lunge-bite in place instead of phasing through. */
    for (int bi = 0; bi < nUnits; bi++) {
        for (int bj = bi + 1; bj < nUnits; bj++) {
            Unit* a2 = &units[bi];
            Unit* b2 = &units[bj];
            if (a2->dead || b2->dead) continue;
            if (a2->kind == K_EGG || b2->kind == K_EGG) continue; /* eggs never move */
            bool aZerg = a2->kind == K_LING || a2->kind == K_BANE;
            bool bZerg = b2->kind == K_LING || b2->kind == K_BANE;
            bool zergVsMarine = (aZerg && b2->kind == K_MARINE) || (bZerg && a2->kind == K_MARINE);
            float dx = b2->x - a2->x, dy = b2->y - a2->y;
            float d2 = dx * dx + dy * dy;
            float minD = a2->bumpR + b2->bumpR;
            if (!(d2 > 0.01f && d2 < minD * minD)) continue;
            float d = sqrtf(d2);
            float nx = dx / d, ny = dy / d;
            float overlap = minD - d;
            if (zergVsMarine) {
                /* the marine is NOT pushed, so a swarm can't shove it off the map */
                Unit* zerg = aZerg ? a2 : b2;
                Unit* marine = (zerg == a2) ? b2 : a2;
                float zx = zerg->x - marine->x, zy = zerg->y - marine->y;
                float zd = sqrtf(zx * zx + zy * zy); if (zd == 0) zd = 1;
                zerg->x += zx / zd * overlap * 0.5f;
                zerg->y += zy / zd * overlap * 0.5f;
                zerg->x = constrain(zerg->x, 12.0f, W - 12.0f);
                zerg->y = constrain(zerg->y, 12.0f, H - 12.0f);
            } else {
                float push = overlap / 2;
                a2->x -= nx * push; a2->y -= ny * push;
                b2->x += nx * push; b2->y += ny * push;
                float va = cosf(a2->heading) * nx + sinf(a2->heading) * ny;
                float vb = cosf(b2->heading) * nx + sinf(b2->heading) * ny;
                if (va > 0) a2->heading = atan2f(sinf(a2->heading) - 2 * va * ny, cosf(a2->heading) - 2 * va * nx);
                if (vb < 0) b2->heading = atan2f(sinf(b2->heading) - 2 * vb * ny, cosf(b2->heading) - 2 * vb * nx);
            }
        }
    }

    /* remove the dead (order-preserving, like splice) */
    int w = 0;
    for (int i = 0; i < nUnits; i++) {
        if (!units[i].dead) {
            if (w != i) units[w] = units[i];
            w++;
        }
    }
    nUnits = w;

    /* if all marines just died, schedule a fresh wave */
    int mc2 = countKind(K_MARINE);
    if (lastMarineCount > 0 && mc2 == 0) marineTimer = frand(TUN(marineWaveLo), TUN(marineWaveHi)) / SPAWN_RATE;
    lastMarineCount = mc2;

    /* age splats and corpses (drawSplats/drawCorpses did this in swarm.js) */
    w = 0;
    for (int i = 0; i < nSplats; i++) {
        splats[i].life -= dt;
        if (splats[i].life > 0) splats[w++] = splats[i];
    }
    nSplats = w;
    w = 0;
    for (int i = 0; i < nCorpses; i++) {
        corpses[i].life -= dt;
        if (corpses[i].life > 0) corpses[w++] = corpses[i];
    }
    nCorpses = w;
}

}  // namespace sim
