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
static int waveEdge = 0;        /* 0 left, 1 right, 2 top, 3 bottom */
static float waveAnchor = 0;    /* position along that edge */

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
    c->want = c->heading;
    c->moveMul = 1;
    c->cluster = -1;
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

/* Choose the spawn edge for a wave: the map edge farthest from the zerg's centre
 * of mass, at the point mirrored across from them. 0 left, 1 right, 2 top, 3 bottom. */
static void pickSpawnEdge() {
    float zx = 0, zy = 0; int zn = 0;
    for (int i = 0; i < nUnits; i++) {
        const Unit& z = units[i];
        if ((z.kind == K_LING || z.kind == K_BANE) && !z.dead) { zx += z.x; zy += z.y; zn++; }
    }
    if (zn > 0) { zx /= zn; zy /= zn; } else { zx = frand(0, W); zy = frand(0, H); }
    float d[4] = {zx, W - zx, zy, H - zy};
    waveEdge = 0;
    for (int e = 1; e < 4; e++) if (d[e] > d[waveEdge]) waveEdge = e;
    float len = waveEdge < 2 ? H : W;
    float mirror = waveEdge < 2 ? H - zy : W - zx;
    float margin = 1.5f * TUN(marineW);
    waveAnchor = constrain(mirror, margin, len - margin);
}

/* one marine just off-screen on waveEdge at `along`, marching straight in */
static void spawnMarine(float along) {
    Unit* mm = make(K_MARINE);
    if (!mm) return;
    static const float NX[4] = {1, -1, 0, 0}, NY[4] = {0, 0, 1, -1};  /* inward normal */
    float nx = NX[waveEdge], ny = NY[waveEdge], inset = TUN(marineSpawnInset);
    if (waveEdge < 2) {
        mm->x = waveEdge == 0 ? -inset : W + inset;
        mm->y = along;
    } else {
        mm->x = along;
        mm->y = waveEdge == 2 ? -inset : H + inset;
    }
    mm->heading = atan2f(ny, nx) + frand(-0.08f, 0.08f);
    mm->want = mm->heading;
    mm->aim = mm->heading;
    /* boosted march in, stopping marineEntryDepth x (shorter side) inside the edge */
    float dd = inset + TUN(marineEntryDepth) * min(W, H);
    mm->deployX = constrain(mm->x + nx * dd, 20.0f, W - 20.0f);
    mm->deployY = constrain(mm->y + ny * dd, 20.0f, H - 20.0f);
    mm->deployT = 3;
}

/* egg centroid (lings guard it), refreshed by updateSwarm() */
static float eggCx = 0, eggCy = 0;
static int eggN = 0;
static const float ZERG_TURN = 0.45f;   /* zerg steering: share of the turn closed per 1/8 s */
static float patrolX = 0, patrolY = 0, patrolT = 0;  /* shared marine patrol waypoint */

/* shared squad waypoint: a new random spot when the squad reaches it or after 8 s */
static void patrolWaypoint() {
    float x = 0, y = 0; int n = 0;
    for (int i = 0; i < nUnits; i++) {
        const Unit& m = units[i];
        if (m.kind != K_MARINE || m.dead) continue;
        x += m.x; y += m.y; n++;
    }
    bool near = false;
    if (n) {
        float dx = patrolX - x / n, dy = patrolY - y / n;
        near = dx * dx + dy * dy < 25 * 25;
    }
    if (patrolT <= 0 || near) {
        patrolX = frand(30, W - 30);
        patrolY = frand(30, H - 30);
        patrolT = 8;
    }
}

/* guard: flock as one swarm (boids: separation + alignment + cohesion) around
 * the eggs, out of marine weapon range and out of the marine quadrant */
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
            ax += (dqx / dq) * 1.0f;
            ay += (dqy / dq) * 1.0f;
        }
    }

    /* flock: separation + alignment + cohesion among lings and banes (not eggs) */
    float flockR = TUN(allyRadius) * 2;
    float cx = 0, cy = 0, hx = 0, hy = 0; int n = 0;
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
        if (d2 < flockR * flockR) {
            cx += o.x; cy += o.y; n++;
            hx += cosf(o.heading); hy += sinf(o.heading);
        }
    }
    if (n > 0) {
        cx /= n; cy /= n;
        float dcx = cx - c->x, dcy = cy - c->y;
        float dc = sqrtf(dcx * dcx + dcy * dcy); if (dc == 0) dc = 1;
        ax += (dcx / dc) * 0.6f;
        ay += (dcy / dc) * 0.6f;
        float hl = sqrtf(hx * hx + hy * hy);
        if (hl > 0.01f) { ax += (hx / hl) * 0.5f; ay += (hy / hl) * 0.5f; }
    }

    /* guard the eggs: gentle pull toward them when the swarm drifts away */
    if (eggN > 0) {
        float ex = eggCx - c->x, ey = eggCy - c->y;
        float de = sqrtf(ex * ex + ey * ey); if (de == 0) de = 1;
        float pull = 0.35f * fminf(1.0f, de / 60);
        ax += (ex / de) * pull;
        ay += (ey / de) * pull;
    }

    /* organic wander */
    ax += frand(-0.25f, 0.25f);
    ay += frand(-0.25f, 0.25f);

    c->want = atan2f(ay, ax);
    c->speed = frand(lo, hi);
}

/* point c.want toward (tx,ty), or away from it when `away` is true */
static void marineSteerToward(Unit* c, float tx, float ty, bool away) {
    float dx = away ? (c->x - tx) : (tx - c->x);
    float dy = away ? (c->y - ty) : (ty - c->y);
    c->want = atan2f(dy, dx);
}

/* smooth turning: each 1/8 s, close `rate` of the gap between heading and want */
static void turnToward(Unit* c, float rate, float dt) {
    float diff = wrapAngle(c->want - c->heading);
    float r = constrain(rate, 0.01f, 0.99f);
    c->heading += diff * (1 - powf(1 - r, dt * 8));
}

/* head for marine m (small random spread so the swarm fans out around it) */
static void charge(Unit* c, const Unit* m, float lo, float hi, float mult) {
    c->want = atan2f(m->y - c->y, m->x - c->x) + frand(-0.15f, 0.15f);
    c->speed = frand(lo, hi) * mult;
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
    if (ax != 0 || ay != 0) c->want = atan2f(ay, ax);
    c->moveMul = 1;
}

/* centre of the other marines (the squad); false when alone */
static bool squadCentre(const Unit* self, float* sx, float* sy) {
    float x = 0, y = 0; int n = 0;
    for (int i = 0; i < nUnits; i++) {
        const Unit& c = units[i];
        if (c.kind != K_MARINE || c.dead || &c == self) continue;
        x += c.x; y += c.y; n++;
    }
    if (!n) return false;
    *sx = x / n; *sy = y / n;
    return true;
}

/* marine tactics: kite when zerg get close, stand and shoot at range, keep the
 * squad together, and advance unless heavily outnumbered */
static void marineTacticsSteer(Unit* c) {
    Unit* z = nearestZerg(c->x, c->y);
    float dz = 1e9f;
    if (z) {
        float zx = z->x - c->x, zy = z->y - c->y;
        dz = sqrtf(zx * zx + zy * zy); if (dz == 0) dz = 1;
    }
    bool damaged = c->hp < TUN(marineHp) * TUN(marineFleeHpPct);
    /* supply: ling/bane = 0.5, marine = 1. Marines out-range the zerg, so they
     * only count as outnumbered at 2:1 */
    bool outnumbered = (countKind(K_LING) + countKind(K_BANE)) * 0.5f > 2 * countKind(K_MARINE);
    float sqx = 0, sqy = 0, sqD = 0;
    bool sq = squadCentre(c, &sqx, &sqy);
    if (sq) {
        float sx = sqx - c->x, sy = sqy - c->y;
        sqD = sqrtf(sx * sx + sy * sy); if (sqD == 0) sqD = 1;
    }
    float range = marineRange();

    if (dz > range * TUN(marineSightMult)) {
        /* nothing in sight: close up, then patrol together until we find zerg */
        if (sq && sqD > TUN(marineGroupRadius)) {
            marineSteerToward(c, sqx, sqy, false);
            c->moveMul = 1;
        } else {
            patrolWaypoint();
            marineSteerToward(c, patrolX, patrolY, false);
            c->moveMul = 0.6f;
        }
    } else if (z && (damaged || dz < range * TUN(marineKiteFrac))) {
        /* kite: back off from the nearest zerg, drifting toward the squad */
        float ax = (c->x - z->x) / dz * TUN(marineAwayWeight), ay = (c->y - z->y) / dz * TUN(marineAwayWeight);
        if (sq) {
            ax += (sqx - c->x) / sqD * TUN(marineGroupWeight);
            ay += (sqy - c->y) / sqD * TUN(marineGroupWeight);
        }
        c->want = atan2f(ay, ax);
        c->moveMul = 1;
    } else if (z && dz < range) {
        /* in range: stand and shoot, shuffling toward the squad */
        if (sq && sqD > TUN(marineGroupRadius) * 0.5f) marineSteerToward(c, sqx, sqy, false);
        c->moveMul = 0.2f;
    } else if (sq && sqD > TUN(marineGroupRadius)) {
        /* regroup */
        marineSteerToward(c, sqx, sqy, false);
        c->moveMul = 1;
    } else if (z && !outnumbered) {
        /* advance on the nearest zerg */
        marineSteerToward(c, z->x, z->y, false);
        c->moveMul = 0.8f;
    } else {
        /* heavily outnumbered: hold with the squad */
        if (sq) marineSteerToward(c, sqx, sqy, false);
        c->moveMul = 0.3f;
    }
}

/* Swarm decisions. Lings and banes chained within allyRadius of each other form
 * one swarm, and the whole swarm attacks together when it is at least
 * attackGroupSize strong (capped at maxLings, so it is always reachable) and its
 * target marine group is no bigger than maxEngageMarines. Once committed it keeps
 * attacking until cut to half strength, so it doesn't flicker at the threshold.
 * A berserk baneling in the swarm always sends it in. */
static void updateSwarm() {
    static int zs[MAX_UNITS], stack[MAX_UNITS];
    int nz = 0;
    float ex = 0, ey = 0; int en = 0;
    for (int i = 0; i < nUnits; i++) {
        Unit& u = units[i];
        u.cluster = -1;
        if (u.dead) continue;
        if (u.kind == K_LING || u.kind == K_BANE) zs[nz++] = i;
        else if (u.kind == K_EGG) { ex += u.x; ey += u.y; en++; }
    }
    eggN = en;
    if (en) { eggCx = ex / en; eggCy = ey / en; }

    float r2 = TUN(allyRadius) * TUN(allyRadius);
    int nc = 0;
    for (int i = 0; i < nz; i++) {
        if (units[zs[i]].cluster >= 0) continue;
        int sp = 0;
        units[zs[i]].cluster = nc;
        stack[sp++] = zs[i];
        while (sp) {
            const Unit& a = units[stack[--sp]];
            for (int j = 0; j < nz; j++) {
                Unit& b = units[zs[j]];
                if (b.cluster >= 0) continue;
                float dx = b.x - a.x, dy = b.y - a.y;
                if (dx * dx + dy * dy < r2) { b.cluster = nc; stack[sp++] = zs[j]; }
            }
        }
        nc++;
    }

    int need = max(1, min((int)TUN(attackGroupSize), MAX_LINGS));
    for (int k = 0; k < nc; k++) {
        int size = 0; float cx = 0, cy = 0;
        bool committed = false, berserkBane = false;
        for (int i = 0; i < nz; i++) {
            const Unit& z = units[zs[i]];
            if (z.cluster != k) continue;
            size++; cx += z.x; cy += z.y;
            if (z.attacking) committed = true;
            if (z.kind == K_BANE && z.berserk) berserkBane = true;
        }
        cx /= size; cy /= size;
        bool attack = false;
        Unit* m = nearestMarine(cx, cy);
        if (m) {
            int mg = countNearbyMarines(m, TUN(marineGroupRadius));
            int maxEngage = (int)TUN(maxEngageMarines);
            attack = (size >= need && mg <= maxEngage) ||
                     (committed && size >= (need + 1) / 2 && mg <= maxEngage + 1) ||
                     berserkBane;
        }
        for (int i = 0; i < nz; i++)
            if (units[zs[i]].cluster == k) units[zs[i]].attacking = attack;
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
        if (c->deployT > 0) {
            /* marching in: head straight for the deploy point at entry speed
             * (still shooting), then switch to normal tactics */
            c->deployT -= dt;
            float ddx = c->deployX - c->x, ddy = c->deployY - c->y;
            c->want = atan2f(ddy, ddx);
            c->moveMul = TUN(marineEntrySpeed);
            if (ddx * ddx + ddy * ddy < 64 || c->deployT <= 0) { c->deployT = 0; c->moveMul = 1; c->retarget = 0; }
        } else if (c->retarget <= 0) {
            c->retarget = 0.3f;
            if (c->entered) {
                if (TUNB(marineTactics)) marineTacticsSteer(c);
                else marineClassicSteer(c);
            }
        }
        turnToward(c, TUN(marineTurnRate), dt);
        float v = c->speed * TUN(terranSpeed) * unitSpeed * c->moveMul * dt;
        c->x += cosf(c->heading) * v;
        c->y += sinf(c->heading) * v;
        /* reflect only when moving outward, so marines can walk in from off-screen */
        if (c->x < 18 && cosf(c->heading) < 0) { c->x = 18; c->heading = c->want = PI_F - c->heading; }
        if (c->x > W - 18 && cosf(c->heading) > 0) { c->x = W - 18; c->heading = c->want = PI_F - c->heading; }
        if (c->y < 18 && sinf(c->heading) < 0) { c->y = 18; c->heading = c->want = -c->heading; }
        if (c->y > H - 18 && sinf(c->heading) > 0) { c->y = H - 18; c->heading = c->want = -c->heading; }
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
                if (m) {
                    bool catching = berserkBaneNear(c->x, c->y, TUN(berserkCatchRadius));
                    if (c->berserk) {
                        /* cancel only when the swarm has called off the attack and
                         * no berserk bane is nearby to re-trigger it */
                        if (!TUNB(berserkUntilDeath) && !c->attacking && !catching) {
                            c->berserk = false;
                            fallBack(c, 26, 46);
                        } else {
                            charge(c, m, 26, 46, TUN(berserkSpeedMult));
                        }
                    } else if (catching) {
                        c->berserk = true;   /* catch berserk from a nearby berserk bane */
                        charge(c, m, 26, 46, TUN(berserkSpeedMult));
                    } else if (c->attacking) {
                        charge(c, m, 26, 46, 1);   /* the swarm is attacking: go with it */
                    } else {
                        fallBack(c, 26, 46);       /* guard the eggs, out of marine range */
                    }
                } else {
                    c->berserk = false;
                    fallBack(c, 26, 46);
                }
            } else {
                /* bane: charge with an attacking swarm, or once enough banes are alive
                 * (counts itself). Banelings NEVER lose berserk once they have it. */
                if (m && (c->berserk || c->attacking || countKind(K_BANE) >= BERSERK_BANES)) {
                    c->berserk = true;
                    charge(c, m, 24, 40, TUN(berserkSpeedMult));
                } else {
                    fallBack(c, 24, 40);
                }
            }
        }
        turnToward(c, ZERG_TURN, dt);
        float v = c->speed * TUN(zergSpeed) * unitSpeed * dt;
        c->x += cosf(c->heading) * v;
        c->y += sinf(c->heading) * v;
        if (c->x < 18) { c->x = 18; c->heading = c->want = PI_F - c->heading; }
        if (c->x > W - 18) { c->x = W - 18; c->heading = c->want = PI_F - c->heading; }
        if (c->y < 18) { c->y = 18; c->heading = c->want = -c->heading; }
        if (c->y > H - 18) { c->y = H - 18; c->heading = c->want = -c->heading; }
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

    /* marines enter in pairs from the map edge farthest from the zerg */
    marineTimer -= dt;
    if (patrolT > 0) patrolT -= dt;
    if (marineTimer <= 0) {
        bool marinesAlive = countKind(K_MARINE) > 0;
        float mInt = marinesAlive ? frand(TUN(marineRespawnLo), TUN(marineRespawnHi))
                                  : frand(TUN(marineWaveLo), TUN(marineWaveHi));
        marineTimer = mInt / SPAWN_RATE;
        int wave = marinesAlive ? jsRound(frand(RESPAWN_SZ_LO, RESPAWN_SZ_HI))
                                : jsRound(frand(WAVE_LO, WAVE_HI));
        wavePending = max(0, min(wave, MAX_MARINES - countKind(K_MARINE)));
        /* marines arrive two by two: round down to pairs (a lone marine only
         * when maxMarines is 1) */
        if (MAX_MARINES >= 2) wavePending -= wavePending % 2;
        waveSpawnT = 0;
        if (wavePending > 0) pickSpawnEdge();
    }

    /* release the queued wave a pair at a time, marineSpawnGap apart */
    if (wavePending > 0) {
        waveSpawnT -= dt;
        if (waveSpawnT <= 0) {
            waveSpawnT = TUN(marineSpawnGap);
            int pair = min(2, wavePending);
            float along = waveAnchor + frand(-0.5f, 0.5f) * TUN(marineW);
            for (int pi = 0; pi < pair; pi++) {
                float slot = (pair == 2) ? (pi == 0 ? -0.7f : 0.7f) * TUN(marineW) : 0;
                spawnMarine(along + slot);
            }
            wavePending -= pair;
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

    /* swarm-level attack decisions, then move everyone */
    updateSwarm();
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
                /* same side: just push apart. No heading bounce: the swarm packs
                 * tightly and steering (flock separation) handles spacing, so
                 * bouncing here only made units jitter. */
                float push = overlap / 2;
                a2->x -= nx * push; a2->y -= ny * push;
                b2->x += nx * push; b2->y += ny * push;
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
