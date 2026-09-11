/* Zerg Desk - battle swarm: lings/banes vs marines, egg morphs.
 * Sprite art: user GIFs -> images/ling0-3.png, bane0-3.png, eggA-C.png, marine0-20.png.
 * ES5 on purpose: Gear Fit 2 runs an old Tizen WebKit (no fetch/arrows/ellipse).
 */
var Swarm = (function () {
    "use strict";

    var canvas = null;
    var ctx = null;
    var W = 216, H = 432;
    var lingFrames = [];
    var baneFrames = [];
    var eggFrames = [];
    var marineIdleFrames = [];   /* walk animation (not attacking) */
    var marineFlashFrames = [];  /* attack animation */
    var critters = [];
    var splats = [];
    var corpses = [];
    var running = false;
    var rafId = null;
    var lastT = 0;
    var respawnLeftLings = 0;
    var respawnTimer = 0;
    var marineTimer = 3;
    var lastMarineCount = 0;
    var morphCooldown = 0;
    var wavePending = 0;
    var waveSpawnT = 0;
    var waveFirst = true;
    var waveSpawnX = 0;
    var waveSpawnY = 0;
    var waveChainDir = 1;
    var zergDeaths = 0;
    var terranDeaths = 0;

    /* ALL tunable numbers live here so balance is easy to tweak. */
    var TUNING = {
        mapW: 216,
        mapH: 432,
        marineSpawnRateMult: 1.5, /* >1 spawns marines faster */
        maxLings: 8,
        maxBanes: 1,
        maxMarines: 3,
        lingW: 30,
        baneW: 39,             /* 30% larger than the ling */
        marineW: 42,
        eggW: 21,               /* eggs are 30% smaller than a ling; both egg types */
        lingBump: 10,
        baneBump: 12,
        marineBump: 12,
        respawnInterval: 2,   /* seconds between ling-egg refill batches */
        respawnBatch: 2,        /* eggs spawned per batch */
        marineWaveLo: 30,        /* how long after all marines die until the next wave */
        marineWaveHi: 32,
        marineRespawnLo: 10,    /* how often marines spawn while marines are alive */
        marineRespawnHi: 14,
        marineSpawnGap: 1,    /* marines in a wave spawn this many seconds apart */
        marineSpawnInset: 6,    /* how many px off-screen marines spawn */
        marineWaveSizeLo: 6,    /* min marines per wave (no marines alive) */
        marineWaveSizeHi: 8,    /* max marines per wave */
        marineRespawnSizeLo: 2, /* min marines per respawn cycle (while alive) */
        marineRespawnSizeHi: 4, /* max marines per respawn cycle */
        retargetInterval: 0.5,  /* lings/banes retarget this often (anti-jitter) */
        aimInterval: 0.3,       /* marine re-aims this often */
        morphAge: 4,           /* ling must live this long before morphing */
        morphCooldown: 2,
        morphChancePerSec: 1, /* chance/sec an eligible ling starts morphing */
        eggTime: 8.5,
        eggHatchMult: 1.25,        /* when an egg hatches, one other egg speeds up this much */
        splatLife: 1.21,
        splatBase: 7,           /* splat start radius (grows only 20%) */
        splatFadeStart: 0.6,    /* fraction of splat life before it starts fading */
        baneSplashR: 75,        /* baneling blast radius (damages all marines inside) */
        baneSplashDamage: 90,   /* damage a baneling deals to every marine in range */
        baneHp: 140,            /* baneling health (1.5x a zergling) */
        corpseLife: 2.2,        /* dead marine sprite lingers this long, fading */
        marineSplatScale: 1.4,  /* marine death splat is bigger */
        baneSplatScale: 2.5,      /* baneling splat is 2x normal */
        lingHp: 100,            /* zergling hit points */
        marineHp: 100,          /* marine hit points */
        marineShootDamage: 25,  /* marine damage per shot */
        marineShootInterval: 0.4,
        lingBiteDamage: 10,     /* ling damage per bite */
        lingBiteInterval: 0.2,
        marineHealPct: 0.10,    /* marines heal this fraction of max hp per tick */
        marineHealInterval: 0.5,
        marineGroupWeight: 0.5, /* pull toward other marines */
        marineAwayWeight: 1,  /* push away from zerg */
        marineTurnRate: 0.25,   /* how fast marines steer */
        marineFleeHpPct: 0.9,   /* marines only flee lings below this hp fraction */
        marineRangeMult: 3,      /* marine weapon range = this * marineW */
        marineFleeRangeMult: 1.5, /* lings flee only inside this * marine range */
        lingAllyRadius: 40,     /* how close counts as "next to" for lings */
        lingAllyMin: 18,         /* lings need this many nearby allies to attack */
        lingBaneAllyMin: 1,     /* when marines are maxed, lings need this many nearby banes to attack */
        lingFleeRadius: 140,    /* radius for the "few marines nearby" check */
        lingFleeMarineMin: 3,   /* below this many nearby marines, lings attack even alone */
        lingBerserkMult: 1.5,   /* speed multiplier when a ling goes berserk */
        lingBerserkBanes: 2,    /* lings need at least this many banes alive before going berserk */
        lingSeekCooldown: 3,    /* seconds before a ling seeks another ling again */
        lingSeekPairCooldown: 5 /* seconds before a sought ling seeks its seeker back */
    };

    /* preview control panel: ?tun_<key>=<number> overrides */
    (function () {
        var q = window.location.search || "";
        var re = /[?&]tun_([A-Za-z0-9]+)=([0-9.]+)/g, mm;
        while ((mm = re.exec(q)) !== null) {
            var k = mm[1], v = parseFloat(mm[2]);
            if (TUNING[k] !== undefined && !isNaN(v)) TUNING[k] = v;
        }
    })();

    /* map resolution (preview can override via tun_mapW / tun_mapH) */
    W = TUNING.mapW;
    H = TUNING.mapH;

    var MAX_LINGS = TUNING.maxLings;
    var MAX_BANES = TUNING.maxBanes;
    var MAX_MARINES = TUNING.maxMarines;
    var LING_W = TUNING.lingW;
    var BANE_W = TUNING.baneW;
    var MARINE_W = TUNING.marineW;
    var EGG_W = TUNING.eggW;
    var LING_BUMP = TUNING.lingBump;
    var BANE_BUMP = TUNING.baneBump;
    var MARINE_BUMP = TUNING.marineBump;
    var RESPAWN_T = TUNING.respawnInterval;
    var MARINE_LO = TUNING.marineWaveLo;
    var MARINE_HI = TUNING.marineWaveHi;
    var MARINE_LO2 = TUNING.marineRespawnLo;
    var MARINE_HI2 = TUNING.marineRespawnHi;
    var MARINE_INSET = TUNING.marineSpawnInset;
    var SHOOT_DMG = TUNING.marineShootDamage;
    var SHOOT_T = TUNING.marineShootInterval;
    var BITE_DMG = TUNING.lingBiteDamage;
    var BITE_T = TUNING.lingBiteInterval;
    var LING_HP = TUNING.lingHp;
    var MARINE_HP = TUNING.marineHp;
    var MARINE_HEAL_PCT = TUNING.marineHealPct;
    var MARINE_HEAL_T = TUNING.marineHealInterval;
    var MARINE_GROUP_W = TUNING.marineGroupWeight;
    var MARINE_AWAY_W = TUNING.marineAwayWeight;
    var MARINE_TURN = TUNING.marineTurnRate;
    var MARINE_FLEE_PCT = TUNING.marineFleeHpPct;
    var MARINE_RANGE = MARINE_W * TUNING.marineRangeMult;
    var MARINE_FLEE_RANGE = MARINE_RANGE * TUNING.marineFleeRangeMult;
    var LING_ALLY_R = TUNING.lingAllyRadius;
    var LING_ALLY_MIN = TUNING.lingAllyMin;
    var LING_BANE_ALLY_MIN = TUNING.lingBaneAllyMin;
    var LING_FLEE_R = TUNING.lingFleeRadius;
    var LING_FLEE_MARINE_MIN = TUNING.lingFleeMarineMin;
    var LING_BERSERK_MULT = TUNING.lingBerserkMult;
    var LING_BERSERK_BANES = TUNING.lingBerserkBanes;
    var LING_SEEK_CD = TUNING.lingSeekCooldown;
    var LING_SEEK_PAIR_CD = TUNING.lingSeekPairCooldown;
    var RETARGET_T = TUNING.retargetInterval;
    var AIM_T = TUNING.aimInterval;
    var MORPH_AGE = TUNING.morphAge;
    var MORPH_CD = TUNING.morphCooldown;
    var EGG_TIME = TUNING.eggTime;
    var SPLAT_LIFE = TUNING.splatLife;
    var SPLAT_BASE = TUNING.splatBase;
    var BANE_SPLASH_R = TUNING.baneSplashR;
    var BANE_SPLASH_DMG = TUNING.baneSplashDamage;
    var BANE_HP = TUNING.baneHp;
    var CORPSE_LIFE = TUNING.corpseLife;
    var BANE_SPLAT_SCALE = TUNING.baneSplatScale;
    var LING_SPLAT = ["#e02828", "#ff6b4a"];
    var BANE_SPLAT = ["#39ff14", "#b8ff4d"]; /* fluoro lime green */
    var MARINE_SPLAT = ["#d62020", "#ff6b4a"];

    var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
        function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
    var caf = window.cancelAnimationFrame || window.webkitCancelAnimationFrame || clearTimeout;

    function rand(a, b) { return a + Math.random() * (b - a); }

    function loadSet(urls, target, done) {
        var left = urls.length;
        for (var i = 0; i < urls.length; i++) {
            (function (idx) {
                var img = new Image();
                img.onload = function () { target[idx] = img; left--; if (left === 0) done(); };
                img.onerror = function () { target[idx] = null; left--; if (left === 0) done(); };
                img.src = urls[idx];
            })(i);
        }
    }

    function loadFrames(done) {
        var sets = 0;
        function inc() {
            sets++;
            if (sets === 5) done();
        }
        loadSet(["images/ling0.png", "images/ling1.png", "images/ling2.png", "images/ling3.png"], lingFrames, inc);
        loadSet(["images/bane0.png", "images/bane1.png", "images/bane2.png", "images/bane3.png"], baneFrames, inc);
        loadSet(["images/eggA.png", "images/eggB.png", "images/eggC.png"], eggFrames, inc);
        var walkUrls = [];
        for (var w = 0; w < 6; w++) walkUrls.push("images/marine_walk0." + (w + 1) + ".png");
        loadSet(walkUrls, marineIdleFrames, inc);
        var atkUrls = [];
        for (var a = 0; a < 8; a++) atkUrls.push("images/marine_new" + a + ".png");
        loadSet(atkUrls, marineFlashFrames, inc);
    }

    /* hatchKind: what an egg turns into. */
    function make(kind, hatchKind) {
        var c = {
            kind: kind, x: rand(24, W - 24), y: rand(24, H - 24),
            heading: rand(0, Math.PI * 2), speed: 0, face: 0, faceDir: 0,
            w: 0, bumpR: 0, frame: 0, frameTimer: rand(0, 0.12),
            dead: false, hp: 100, age: 0, t: 0, splatCol: null, splatScale: 1,
            retarget: 0, aim: 0, aimT: 0, shootCd: 0, hatchKind: hatchKind || null
        };
        if (kind === "ling") {
            c.faceDir = -1; c.face = -1; c.w = LING_W; c.bumpR = LING_BUMP;
            c.speed = rand(26, 46); c.splatCol = LING_SPLAT;
            c.hp = LING_HP; c.attackCd = 0; c.healCd = 0; c.berserk = false;
            c.seekCd = 0; c.avoidSeek = null; c.avoidSeekCd = 0;
        } else if (kind === "bane") {
            c.faceDir = 1; c.face = 1; c.w = BANE_W; c.bumpR = BANE_BUMP;
            c.speed = rand(24, 40); c.splatCol = BANE_SPLAT; c.splatScale = BANE_SPLAT_SCALE;
            c.hp = BANE_HP;
        } else if (kind === "marine") {
            c.faceDir = -1; c.face = -1; c.w = MARINE_W; c.bumpR = MARINE_BUMP;
            c.speed = rand(16, 24); c.splatCol = MARINE_SPLAT; c.hp = MARINE_HP;
            c.splatScale = TUNING.marineSplatScale;
            c.shootCd = SHOOT_T; c.aim = c.heading; c.healCd = 0; c.entered = false; c.shootTarget = null;
            c.flashT = 0; c.hitX = 0; c.hitY = 0; c.kills = 0;
        } else if (kind === "egg") {
            c.w = EGG_W; c.bumpR = 12; c.speed = 0; c.t = 0; c.hatchMult = 1;
            c.splatCol = BANE_SPLAT; c.splatScale = 1; /* normal green egg-splat, same as lings */
        }
        return c;
    }

    function frameSet(kind) {
        if (kind === "ling") return lingFrames;
        if (kind === "bane") return baneFrames;
        if (kind === "egg") return eggFrames;
        return [];
    }

    /* marines switch between the walk (not attacking) and attack frame sets */
    function marineSet(c) {
        return (c.shootTarget && marineFlashFrames.length) ? marineFlashFrames : marineIdleFrames;
    }

    function nearestMarine(x, y) {
        var best = null, bd = 1e9;
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind !== "marine" || c.dead || c.hp <= 0) continue;
            var dx = c.x - x, dy = c.y - y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    function nearestLing(x, y) {
        var best = null, bd = 1e9;
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind !== "ling" || c.dead) continue;
            var dx = c.x - x, dy = c.y - y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    function nearestZerg(x, y) {
        var best = null, bd = 1e9;
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if ((c.kind !== "ling" && c.kind !== "bane") || c.dead) continue;
            var dx = c.x - x, dy = c.y - y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    function nearestOtherMarine(self) {
        var best = null, bd = 1e9;
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind !== "marine" || c.dead || c === self) continue;
            var dx = c.x - self.x, dy = c.y - self.y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    function nearestOtherLing(self) {
        var best = null, bd = 1e9;
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind !== "ling" || c.dead || c === self) continue;
            var dx = c.x - self.x, dy = c.y - self.y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    function countNearbyLings(self, r) {
        var n = 0;
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind !== "ling" || c.dead || c === self) continue;
            var dx = c.x - self.x, dy = c.y - self.y;
            if (dx * dx + dy * dy < r * r) n++;
        }
        return n;
    }

    function countNearbyBanes(self, r) {
        var n = 0;
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind !== "bane" || c.dead) continue;
            var dx = c.x - self.x, dy = c.y - self.y;
            if (dx * dx + dy * dy < r * r) n++;
        }
        return n;
    }

    function countNearbyMarines(self, r) {
        var n = 0;
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind !== "marine" || c.dead) continue;
            var dx = c.x - self.x, dy = c.y - self.y;
            if (dx * dx + dy * dy < r * r) n++;
        }
        return n;
    }

    function countKind(kind) {
        var n = 0;
        for (var i = 0; i < critters.length; i++) {
            if (critters[i].kind === kind && !critters[i].dead) n++;
        }
        return n;
    }

    /* put a new egg in the quadrant diagonally opposite the marines' centroid */
    function placeEggOpposite(egg) {
        var mx = 0, my = 0, mn = 0;
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind === "marine" && !c.dead) { mx += c.x; my += c.y; mn++; }
        }
        if (mn === 0) return; /* no marines: keep the random spot */
        mx /= mn; my /= mn;
        var qx = mx < W / 2 ? 0 : 1;
        var qy = my < H / 2 ? 0 : 1;
        var ox = qx === 0 ? 1 : 0;
        var oy = qy === 0 ? 1 : 0;
        egg.x = rand(ox * W / 2 + 16, ox * W / 2 + W / 2 - 16);
        egg.y = rand(oy * H / 2 + 16, oy * H / 2 + H / 2 - 16);
    }

    function pendingLings() {
        var n = countKind("ling");
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind === "egg" && !c.dead && c.hatchKind === "ling") n += 2; /* each egg yields 2 lings */
        }
        return n;
    }

    function step(c, dt) {
        if (c.kind === "egg") { c.t += dt * (c.hatchMult || 1); return; }

        if (c.kind === "marine") {
            /* only start steering once fully on-screen */
            if (!c.entered && c.x >= 0 && c.x <= W && c.y >= 0 && c.y <= H) c.entered = true;
            if (c.flashT > 0) c.flashT -= dt;
            c.retarget -= dt;
            if (c.retarget <= 0) {
                c.retarget = 0.5;
                if (c.entered) {
                    /* drift toward other marines; flee lings only when hurt */
                    var ax = 0, ay = 0;
                    if (c.hp < MARINE_HP * MARINE_FLEE_PCT) {
                        var z = nearestZerg(c.x, c.y);
                        if (z) {
                            var dxz = c.x - z.x, dyz = c.y - z.y;
                            var dz = Math.sqrt(dxz * dxz + dyz * dyz) || 1;
                            ax += (dxz / dz) * MARINE_AWAY_W;
                            ay += (dyz / dz) * MARINE_AWAY_W;
                        }
                    }
                    var om = nearestOtherMarine(c);
                    if (om) {
                        var dxm = om.x - c.x, dym = om.y - c.y;
                        var dm = Math.sqrt(dxm * dxm + dym * dym) || 1;
                        ax += (dxm / dm) * MARINE_GROUP_W;
                        ay += (dym / dm) * MARINE_GROUP_W;
                    }
                    if (ax !== 0 || ay !== 0) {
                        var want = Math.atan2(ay, ax);
                        var diff = want - c.heading;
                        while (diff > Math.PI) diff -= 6.283;
                        while (diff < -Math.PI) diff += 6.283;
                        c.heading += diff * MARINE_TURN;
                    }
                }
            }
            c.x += Math.cos(c.heading) * c.speed * dt;
            c.y += Math.sin(c.heading) * c.speed * dt;
            /* reflect only when moving outward, so marines can walk in from off-screen */
            if (c.x < 18 && Math.cos(c.heading) < 0) { c.x = 18; c.heading = Math.PI - c.heading; }
            if (c.x > W - 18 && Math.cos(c.heading) > 0) { c.x = W - 18; c.heading = Math.PI - c.heading; }
            if (c.y < 18 && Math.sin(c.heading) < 0) { c.y = 18; c.heading = -c.heading; }
            if (c.y > H - 18 && Math.sin(c.heading) > 0) { c.y = H - 18; c.heading = -c.heading; }
            /* re-aim at the closest ling, but only every AIM_T (anti-jitter) */
            c.aimT -= dt;
            if (c.aimT <= 0) {
                c.aimT = AIM_T;
                var tgt = nearestZerg(c.x, c.y);
                c.aim = tgt ? Math.atan2(tgt.y - c.y, tgt.x - c.x) : c.heading;
            }
        } else {
            /* ling / bane: only pick a direction every RETARGET_T (anti-jitter) */
            c.age += dt;
            if (c.kind === "ling") {
                if (c.seekCd > 0) c.seekCd -= dt;
                if (c.avoidSeekCd > 0) c.avoidSeekCd -= dt;
            }
            c.retarget -= dt;
            if (c.retarget <= 0) {
                c.retarget = RETARGET_T;
                var m = nearestMarine(c.x, c.y);
                if (c.kind === "ling") {
                    var allies = countNearbyLings(c, LING_ALLY_R);
                    var marinesFull = countKind("marine") >= MAX_MARINES;
                    if (m) {
                        var nearbyM = countNearbyMarines(c, LING_FLEE_R);
                        if (c.berserk || countKind("bane") >= LING_BERSERK_BANES) {
                            /* locked-in charge: no retreat until all marines die */
                            c.berserk = true;
                            c.heading = Math.atan2(m.y - c.y, m.x - c.x) + rand(-0.1, 0.1);
                            c.speed = rand(26, 46) * LING_BERSERK_MULT;
                        } else if (allies === 0) {
                            if (nearbyM > 0 && nearbyM < LING_FLEE_MARINE_MIN) {
                                /* a lone marine close by: attack it */
                                c.berserk = true;
                                c.heading = Math.atan2(m.y - c.y, m.x - c.x) + rand(-0.1, 0.1);
                                c.speed = rand(26, 46) * LING_BERSERK_MULT;
                            } else {
                                /* no friends: bunch up by finding the closest ling (debounced) */
                                var fr = null;
                                if (c.seekCd <= 0) {
                                    var cand = nearestOtherLing(c);
                                    if (cand && !(c.avoidSeek === cand && c.avoidSeekCd > 0)) fr = cand;
                                }
                                if (fr) {
                                    c.heading = Math.atan2(fr.y - c.y, fr.x - c.x) + rand(-0.15, 0.15);
                                    c.speed = rand(46, 60);
                                    c.seekCd = LING_SEEK_CD;        /* don't seek again for 3s */
                                    fr.avoidSeek = c;               /* target won't seek back for 5s */
                                    fr.avoidSeekCd = LING_SEEK_PAIR_CD;
                                } else {
                                    if (Math.random() < 0.1) c.heading += rand(-0.7, 0.7);
                                    c.speed = rand(26, 46);
                                }
                            }
                        } else if (marinesFull) {
                            /* marines maxed and no banes: hold back only if close */
                            var fdx = c.x - m.x, fdy = c.y - m.y;
                            if (fdx * fdx + fdy * fdy < MARINE_FLEE_RANGE * MARINE_FLEE_RANGE) {
                                c.heading = Math.atan2(c.y - m.y, c.x - m.x) + rand(-0.2, 0.2);
                                c.speed = rand(52, 68);
                            } else {
                                if (Math.random() < 0.1) c.heading += rand(-0.7, 0.7);
                                c.speed = rand(26, 46);
                            }
                        } else if (allies >= LING_ALLY_MIN) {
                            /* enough allies: charge the marine (locked in) */
                            c.berserk = true;
                            c.heading = Math.atan2(m.y - c.y, m.x - c.x) + rand(-0.1, 0.1);
                            c.speed = rand(26, 46) * LING_BERSERK_MULT;
                        } else {
                            /* not enough allies: flee only if the marine is close */
                            var fdx2 = c.x - m.x, fdy2 = c.y - m.y;
                            if (fdx2 * fdx2 + fdy2 * fdy2 < MARINE_FLEE_RANGE * MARINE_FLEE_RANGE) {
                                c.heading = Math.atan2(c.y - m.y, c.x - m.x) + rand(-0.2, 0.2);
                                c.speed = rand(52, 68);
                            } else {
                                if (Math.random() < 0.1) c.heading += rand(-0.7, 0.7);
                                c.speed = rand(26, 46);
                            }
                        }
                    } else {
                        c.berserk = false;
                        /* no marines alive: just wander, never seek other lings */
                        if (Math.random() < 0.1) c.heading += rand(-0.7, 0.7);
                        c.speed = rand(26, 46);
                    }
                } else {
                    /* bane */
                    if (m) {
                        c.heading = Math.atan2(m.y - c.y, m.x - c.x) + rand(-0.1, 0.1);
                        c.speed = rand(42, 56);
                    } else {
                        if (Math.random() < 0.1) c.heading += rand(-0.7, 0.7);
                        c.speed = rand(24, 40);
                    }
                }
            }
            c.x += Math.cos(c.heading) * c.speed * SETTINGS.critterSpeed * dt;
            c.y += Math.sin(c.heading) * c.speed * SETTINGS.critterSpeed * dt;
            if (c.x < 18) { c.x = 18; c.heading = Math.PI - c.heading; }
            if (c.x > W - 18) { c.x = W - 18; c.heading = Math.PI - c.heading; }
            if (c.y < 18) { c.y = 18; c.heading = -c.heading; }
            if (c.y > H - 18) { c.y = H - 18; c.heading = -c.heading; }
        }

        /* horizontal facing with hysteresis */
        var ang = (c.kind === "marine") ? c.aim : c.heading;
        var cosh = Math.cos(ang);
        if (cosh > 0.3) c.face = 1;
        else if (cosh < -0.3) c.face = -1;

        c.frameTimer -= dt;
        var fs = (c.kind === "marine") ? marineSet(c) : frameSet(c.kind);
        if (c.frameTimer <= 0 && fs.length) {
            c.frameTimer = (c.kind === "marine") ? 0.1 : 0.12;
            /* baneling rolls the other way -> reverse the frame order */
            if (c.kind === "bane") c.frame = (c.frame - 1 + fs.length) % fs.length;
            else c.frame = (c.frame + 1) % fs.length;
        }
    }

    /* Orient so the sprite's facing side points along travel; if that would put
     * the bottom above the horizon, mirror horizontally. Never upside down. */
    function drawCritter(c, cc) {
        var fs = frameSet(c.kind);
        var img;
        if (c.kind === "egg") {
            /* eggA/B ping-pong 0.5s each until 2.5s, then eggC until it hatches */
            var idx = (c.t < 2.5) ? (Math.floor(c.t / 0.5) % 2) : 2;
            img = fs[idx];
        } else if (c.kind === "marine") {
            var set = marineSet(c);
            img = set[c.frame % set.length];
        } else {
            img = fs[c.frame];
        }
        if (!img) return;
        var hh = c.w * img.height / img.width;
        cc.save();
        cc.translate(c.x, c.y);
        if (c.kind !== "egg") {
            var ang = (c.kind === "marine") ? c.aim : c.heading;
            var fd = c.faceDir;               /* +1 faces right, -1 faces left */
            var mirror = (fd === 1) ? (c.face === -1) : (c.face === 1);
            var rot = (fd === 1)
                ? (mirror ? ang + Math.PI : ang)
                : (mirror ? -ang : ang + Math.PI);
            if (mirror) cc.scale(-1, 1);
            cc.rotate(rot);
        }
        cc.drawImage(img, -c.w / 2, -hh / 2, c.w, hh);
        cc.restore();

        /* debug health bar under every non-egg unit */
        if (c.kind !== "egg") {
            var hp = (typeof c.hp === "number") ? c.hp : 100;
            var bw = 30, bh = 3;   /* all health bars the same width */
            var by = c.y + hh / 2 + 4;
            cc.fillStyle = "rgba(0,0,0,0.55)";
            cc.fillRect(c.x - bw / 2, by, bw, bh);
            var frac = Math.max(0, Math.min(1, hp / 100));
            cc.fillStyle = frac > 0.5 ? "#4cff4c" : (frac > 0.25 ? "#ffd23e" : "#ff4c4c");
            cc.fillRect(c.x - bw / 2, by, bw * frac, bh);
            /* marine kill stripes: one 1x2px yellow stripe per ling killed */
            if (c.kind === "marine" && c.kills > 0) {
                var nk = c.kills;
                cc.fillStyle = "#ffe23e";
                for (var si = 0; si < nk; si++) {
                    cc.fillRect(c.x - bw / 2 + si * 2, by - 4, 1, 2);
                }
            }
        }
    }

    function addSplat(x, y, col, scale) {
        splats.push({
            x: x, y: y, life: SPLAT_LIFE, max: SPLAT_LIFE,
            outer: col[0], inner: col[1], seed: Math.floor(Math.random() * 4),
            base: SPLAT_BASE * (scale || 1)
        });
    }

    /* cartoon splat: grows only 20% early, stays put, fades near the end */
    function drawSplats(c, dt) {
        for (var i = splats.length - 1; i >= 0; i--) {
            var s = splats[i];
            s.life -= dt;
            if (s.life <= 0) { splats.splice(i, 1); continue; }
            var elapsed = s.max - s.life;
            var grow = Math.min(1, elapsed / 0.15);
            var r = s.base * (1 + 0.2 * grow);
            var alpha = 0.95;
            var fadeStart = s.max * TUNING.splatFadeStart;
            if (elapsed > fadeStart) {
                alpha = 0.95 * Math.max(0, 1 - (elapsed - fadeStart) / (s.max - fadeStart));
            }
            c.save();
            c.globalAlpha = alpha;
            c.fillStyle = s.outer;
            var spokes = 16;
            c.beginPath();
            for (var k = 0; k <= spokes; k++) {
                var a = (k / spokes) * 6.283;
                var j = 0.65 + 0.45 * Math.abs(Math.sin(a * 2.7 + s.seed * 2.1));
                var rr = r * j;
                var px = s.x + Math.cos(a) * rr;
                var py = s.y + Math.sin(a) * rr * 0.9;
                if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
            }
            c.closePath();
            c.fill();
            /* fixed droplets (do not move) */
            for (var d = 0; d < 4; d++) {
                var a2 = (d / 4) * 6.283 + s.seed * 0.9;
                var dr = s.base * (0.22 + 0.12 * Math.abs(Math.sin(s.seed * 3 + d)));
                c.beginPath();
                c.arc(s.x + Math.cos(a2) * s.base * 1.05, s.y + Math.sin(a2) * s.base * 0.8, dr, 0, 6.283);
                c.fill();
            }
            c.fillStyle = s.inner;
            c.beginPath();
            c.arc(s.x, s.y, s.base * 0.45, 0, 6.283);
            c.fill();
            c.restore();
        }
    }

    function killCritter(c) {
        if (c.dead) return;
        addSplat(c.x, c.y, c.splatCol, c.splatScale);
        c.dead = true;
        if (c.kind === "ling") {
            respawnLeftLings++;
            zergDeaths++;
            /* corpse: freeze the frame, show only the bottom half, fade out (same as marine) */
            var lang = c.heading;
            var lfd = c.faceDir;
            var lmirror = (lfd === 1) ? (c.face === -1) : (c.face === 1);
            var lrot = (lfd === 1) ? (lmirror ? lang + Math.PI : lang) : (lmirror ? -lang : lang + Math.PI);
            corpses.push({
                x: c.x, y: c.y, w: c.w, img: lingFrames[c.frame],
                rot: lrot, mirror: lmirror, life: CORPSE_LIFE, max: CORPSE_LIFE
            });
        } else if (c.kind === "bane") {
            zergDeaths++;
            /* splash: damage EVERY marine in blast range, not just the touched one */
            for (var i = 0; i < critters.length; i++) {
                var m = critters[i];
                if (m.kind !== "marine" || m.dead) continue;
                var dx = m.x - c.x, dy = m.y - c.y;
                if (dx * dx + dy * dy < BANE_SPLASH_R * BANE_SPLASH_R) m.hp -= BANE_SPLASH_DMG;
            }
        } else if (c.kind === "marine") {
            terranDeaths++;
            /* corpse: freeze the frame, show only the bottom half, fade out */
            var ang = (typeof c.aim === "number") ? c.aim : c.heading;
            var fd = c.faceDir;
            var mirror = (fd === 1) ? (c.face === -1) : (c.face === 1);
            var rot = (fd === 1) ? (mirror ? ang + Math.PI : ang) : (mirror ? -ang : ang + Math.PI);
            var ms = marineSet(c);
            corpses.push({
                x: c.x, y: c.y, w: c.w, img: ms[c.frame % ms.length],
                rot: rot, mirror: mirror, life: CORPSE_LIFE, max: CORPSE_LIFE
            });
        }
    }

    /* dead units: bottom half of the frozen sprite, slowly fading */
    function drawCorpses(c, dt) {
        for (var i = corpses.length - 1; i >= 0; i--) {
            var co = corpses[i];
            co.life -= dt;
            if (co.life <= 0) { corpses.splice(i, 1); continue; }
            var img = co.img;
            if (!img) continue;
            var hh = co.w * img.height / img.width;
            c.save();
            c.globalAlpha = 0.95 * (co.life / co.max);
            c.translate(co.x, co.y);
            if (co.mirror) c.scale(-1, 1);
            c.rotate(co.rot);
            /* bottom half only (top half cropped away) */
            c.drawImage(img, 0, img.height / 2, img.width, img.height / 2, -co.w / 2, 0, co.w, hh / 2);
            c.restore();
        }
    }

    /* when an egg hatches, speed up one other active egg */
    function boostSiblingEgg() {
        var eggs = [];
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.kind === "egg" && !c.dead) eggs.push(c);
        }
        if (eggs.length) {
            var pick = eggs[Math.floor(Math.random() * eggs.length)];
            pick.hatchMult = (pick.hatchMult || 1) * TUNING.eggHatchMult;
        }
    }

    function frame(t) {
        if (!lastT) lastT = t;
        var dt = Math.min(0.05, (t - lastT) / 1000);
        lastT = t;
        ctx.clearRect(0, 0, W, H);

        /* new lings spawn as eggs, 2 at a time, slowly */
        if (respawnLeftLings > 0) {
            respawnTimer -= dt;
            if (respawnTimer <= 0) {
                respawnTimer = RESPAWN_T;
                var n = 0;
                while (respawnLeftLings > 0 && n < 2 && pendingLings() < MAX_LINGS) {
                    var egg = make("egg", "ling");
                    placeEggOpposite(egg);
                    critters.push(egg);
                    respawnLeftLings--;
                    n++;
                }
            }
        }

        /* marines enter in waves, staggered, from the corner farthest from the lings */
        marineTimer -= dt;
        if (marineTimer <= 0) {
            var marinesAlive = countKind("marine") > 0;
            var mInt = marinesAlive ? rand(MARINE_LO2, MARINE_HI2) : rand(MARINE_LO, MARINE_HI);
            marineTimer = mInt / TUNING.marineSpawnRateMult;
            /* count: respawn size while alive, wave size when starting fresh */
            var wave = marinesAlive ?
                Math.round(rand(TUNING.marineRespawnSizeLo, TUNING.marineRespawnSizeHi)) :
                Math.round(rand(TUNING.marineWaveSizeLo, TUNING.marineWaveSizeHi));
            wavePending = Math.max(0, Math.min(wave, MAX_MARINES - countKind("marine")));
            waveSpawnT = 0;
            waveFirst = true;
        }

        /* release the queued wave one marine at a time, marineSpawnGap apart */
        if (wavePending > 0) {
            waveSpawnT -= dt;
            if (waveSpawnT <= 0) {
                waveSpawnT = TUNING.marineSpawnGap;
                var mm = make("marine");
                var off = 1.1 * MARINE_W;
                if (waveFirst) {
                    /* farthest corner (diagonally opposite the lings), just off-screen */
                    var lx = 0, ly = 0, ln = 0;
                    for (var lq = 0; lq < critters.length; lq++) {
                        var lc = critters[lq];
                        if (lc.kind === "ling" && !lc.dead) { lx += lc.x; ly += lc.y; ln++; }
                    }
                    if (ln > 0) { lx /= ln; ly /= ln; } else { lx = W / 2; ly = H / 2; }
                    mm.x = (lx < W / 2) ? W + MARINE_INSET : -MARINE_INSET;
                    mm.y = (ly < H / 2) ? H + MARINE_INSET : -MARINE_INSET;
                    waveChainDir = (mm.x < 0) ? 1 : -1;
                    waveFirst = false;
                } else {
                    /* chain along the border, 1.1x marine width apart */
                    mm.x = waveSpawnX + waveChainDir * off;
                    mm.y = waveSpawnY;
                }
                waveSpawnX = mm.x;
                waveSpawnY = mm.y;
                mm.heading = Math.atan2(H / 2 - mm.y, W / 2 - mm.x) + rand(-0.3, 0.3);
                mm.aim = mm.heading;
                critters.push(mm);
                wavePending--;
            }
        }

        /* morph: a ling older than MORPH_AGE becomes an egg -> baneling */
        if (morphCooldown > 0) morphCooldown -= dt;
        var hasBaneEgg = false;
        for (var ei = 0; ei < critters.length; ei++) {
            var ec = critters[ei];
            if (ec.kind === "egg" && !ec.dead && ec.hatchKind === "bane") hasBaneEgg = true;
        }
        if (MAX_BANES > 0 && countKind("bane") < MAX_BANES && !hasBaneEgg && morphCooldown <= 0 &&
                Math.random() < TUNING.morphChancePerSec * dt) {
            var oldest = null;
            for (var li = 0; li < critters.length; li++) {
                var l = critters[li];
                if (l.kind === "ling" && !l.dead && l.age >= MORPH_AGE) {
                    if (!oldest || l.age > oldest.age) oldest = l;
                }
            }
            if (oldest) {
                oldest.kind = "egg";
                oldest.hatchKind = "bane";
                oldest.t = 0;
                oldest.w = EGG_W;
                oldest.splatCol = BANE_SPLAT;
                oldest.splatScale = 1; /* hatch uses the normal green egg-splat; big splat is death-only */
                oldest.speed = 0;
                respawnLeftLings++; /* the consumed ling comes back as an egg */
            }
        }

        /* eggs hatch */
        for (var e = 0; e < critters.length; e++) {
            var eg = critters[e];
            if (eg.kind === "egg" && eg.t >= EGG_TIME) {
                addSplat(eg.x, eg.y, eg.splatCol, eg.splatScale);
                eg.dead = true;
                if (eg.hatchKind === "bane") {
                    morphCooldown = MORPH_CD;
                    var nb = make("bane");
                    nb.x = eg.x; nb.y = eg.y;
                    critters.push(nb);
                } else {
                    /* two lings hatch out of each zergling egg */
                    for (var h2 = 0; h2 < 2; h2++) {
                        var nl = make("ling");
                        nl.x = eg.x + (h2 === 0 ? -6 : 6);
                        nl.y = eg.y + (h2 === 0 ? 4 : -4);
                        critters.push(nl);
                    }
                }
                boostSiblingEgg();
            }
        }

        /* move everyone */
        for (var i = 0; i < critters.length; i++) step(critters[i], dt);

        /* marines shoot the closest zerg (ling or bane) within range */
        for (var mi = 0; mi < critters.length; mi++) {
            var mc = critters[mi];
            if (mc.kind !== "marine" || mc.dead) continue;
            var tgt = nearestZerg(mc.x, mc.y);
            if (tgt) {
                var drx = tgt.x - mc.x, dry = tgt.y - mc.y;
                if (drx * drx + dry * dry < MARINE_RANGE * MARINE_RANGE) {
                    mc.shootTarget = tgt;
                    mc.shootCd -= dt;
                    if (mc.shootCd <= 0) {
                        mc.shootCd = SHOOT_T;
                        var wasAlive = tgt.hp > 0;
                        tgt.hp -= SHOOT_DMG;
                        if (wasAlive && tgt.hp <= 0 && tgt.kind === "ling") mc.kills++;
                        mc.flashT = 0.1;
                        mc.hitX = tgt.x + rand(-tgt.w * 0.3, tgt.w * 0.3);
                        mc.hitY = tgt.y + rand(-tgt.w * 0.3, tgt.w * 0.3);
                    }
                } else {
                    mc.shootTarget = null;
                }
            } else {
                mc.shootTarget = null;
            }
        }

        /* marines + lings regenerate HP over time (shared heal settings) */
        for (var hr = 0; hr < critters.length; hr++) {
            var hc = critters[hr];
            if (hc.dead) continue;
            if (hc.kind === "marine" || hc.kind === "ling") {
                hc.healCd -= dt;
                if (hc.healCd <= 0) {
                    hc.healCd = MARINE_HEAL_T;
                    var maxHp = (hc.kind === "marine") ? MARINE_HP : LING_HP;
                    hc.hp = Math.min(maxHp, hc.hp + maxHp * MARINE_HEAL_PCT);
                }
            }
        }

        /* lings bite marines for BITE_DMG every BITE_T while touching */
        for (var li2 = 0; li2 < critters.length; li2++) {
            var l2 = critters[li2];
            if (l2.dead || l2.kind !== "ling") continue;
            var mt = nearestMarine(l2.x, l2.y);
            if (mt) {
                var dxl = mt.x - l2.x, dyl = mt.y - l2.y;
                var touchl = l2.bumpR + mt.bumpR + 6;
                if (dxl * dxl + dyl * dyl < touchl * touchl) {
                    l2.attackCd -= dt;
                    if (l2.attackCd <= 0) {
                        l2.attackCd = BITE_T;
                        mt.hp -= BITE_DMG;
                    }
                }
            }
        }

        /* banelings explode on marines */
        for (var ci = 0; ci < critters.length; ci++) {
            var a = critters[ci];
            if (a.dead || a.kind !== "bane") continue;
            var tgt2 = nearestMarine(a.x, a.y);
            if (tgt2) {
                var dx2 = tgt2.x - a.x, dy2 = tgt2.y - a.y;
                var touch2 = a.bumpR + tgt2.bumpR + 6;
                if (dx2 * dx2 + dy2 * dy2 < touch2 * touch2) {
                    killCritter(a); /* splash damages all nearby marines */
                }
            }
        }

        /* marines die at 0 hp -> red splat */
        for (var mj = 0; mj < critters.length; mj++) {
            var m2 = critters[mj];
            if (m2.kind === "marine" && !m2.dead && m2.hp <= 0) killCritter(m2);
        }

        /* lings die at 0 hp */
        for (var lj = 0; lj < critters.length; lj++) {
            var l3 = critters[lj];
            if (l3.kind === "ling" && !l3.dead && l3.hp <= 0) killCritter(l3);
        }

        /* banes die at 0 hp (splat + splash) */
        for (var bj = 0; bj < critters.length; bj++) {
            var b3 = critters[bj];
            if (b3.kind === "bane" && !b3.dead && b3.hp <= 0) killCritter(b3);
        }

        /* bump separation (not for marine-vs-attacker pairs) */
        for (var bi = 0; bi < critters.length; bi++) {
            for (var bj = bi + 1; bj < critters.length; bj++) {
                var a2 = critters[bi], b2 = critters[bj];
                if (a2.dead || b2.dead) continue;
                var skip = (a2.kind === "marine" && (b2.kind === "ling" || b2.kind === "bane")) ||
                           (b2.kind === "marine" && (a2.kind === "ling" || a2.kind === "bane")) ||
                           a2.kind === "egg" || b2.kind === "egg"; /* eggs never move */
                if (skip) continue;
                var dx = b2.x - a2.x, dy = b2.y - a2.y;
                var d2 = dx * dx + dy * dy;
                var minD = a2.bumpR + b2.bumpR;
                if (d2 > 0.01 && d2 < minD * minD) {
                    var d = Math.sqrt(d2);
                    var nx = dx / d, ny = dy / d;
                    var push = (minD - d) / 2;
                    a2.x -= nx * push; a2.y -= ny * push;
                    b2.x += nx * push; b2.y += ny * push;
                    var va = Math.cos(a2.heading) * nx + Math.sin(a2.heading) * ny;
                    var vb = Math.cos(b2.heading) * nx + Math.sin(b2.heading) * ny;
                    if (va > 0) a2.heading = Math.atan2(Math.sin(a2.heading) - 2 * va * ny, Math.cos(a2.heading) - 2 * va * nx);
                    if (vb < 0) b2.heading = Math.atan2(Math.sin(b2.heading) - 2 * vb * ny, Math.cos(b2.heading) - 2 * vb * nx);
                }
            }
        }

        /* remove the dead */
        for (var dk = critters.length - 1; dk >= 0; dk--) {
            if (critters[dk].dead) critters.splice(dk, 1);
        }

        /* if all marines just died, cancel pending respawn and schedule a fresh wave */
        var mc2 = countKind("marine");
        if (lastMarineCount > 0 && mc2 === 0) {
            marineTimer = rand(MARINE_LO, MARINE_HI) / TUNING.marineSpawnRateMult;
        }
        lastMarineCount = mc2;

        drawSplats(ctx, dt);
        drawCorpses(ctx, dt);
        for (var k = 0; k < critters.length; k++) drawCritter(critters[k], ctx);

        /* death counters: zerg (purple) top-left, terran (blue) top-right */
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "left";
        ctx.fillStyle = "#c39bff";
        ctx.fillText("Z " + zergDeaths, 6, 15);
        ctx.textAlign = "right";
        ctx.fillStyle = "#6ab8ff";
        ctx.fillText("T " + terranDeaths, W - 6, 15);
        ctx.textAlign = "left";

        /* firing lines: brief, semi-transparent, gun tip -> random point on the ling */
        for (var fl = 0; fl < critters.length; fl++) {
            var fm = critters[fl];
            if (fm.kind !== "marine" || fm.dead || fm.flashT <= 0) continue;
            var alpha = Math.min(1, fm.flashT / 0.1) * 0.7;
            var gx = fm.x + Math.cos(fm.aim) * (fm.w / 2 + 6);
            var gy = fm.y + Math.sin(fm.aim) * (fm.w / 2 + 6);
            ctx.strokeStyle = "rgba(255,220,80," + alpha + ")";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(gx, gy);
            ctx.lineTo(fm.hitX, fm.hitY);
            ctx.stroke();
        }

        if (running) rafId = raf(frame);
    }

    function start() {
        if (running) return;
        running = true;
        lastT = 0;
        rafId = raf(frame);
    }

    function stop() {
        running = false;
        if (rafId) { caf(rafId); rafId = null; }
    }

    /* initial population: lings only (banelings come from morphing) */
    function setCount(n) {
        var wantLings = Math.max(0, Math.min(MAX_LINGS, n));
        while (critters.length > 0) critters.pop();
        corpses.length = 0;
        for (var i = 0; i < wantLings; i++) critters.push(make("ling"));
        respawnLeftLings = 0;
        respawnTimer = 0;
        marineTimer = 3;
        lastMarineCount = 0;
        morphCooldown = 0;
        zergDeaths = 0;
        terranDeaths = 0;
    }

    /* tap: splat only units near the tap point (eggs are safe) */
    function killNear(x, y, r) {
        for (var i = 0; i < critters.length; i++) {
            var c = critters[i];
            if (c.dead || c.kind === "egg") continue;
            var dx = c.x - x, dy = c.y - y;
            var rr = r + c.bumpR;
            if (dx * dx + dy * dy < rr * rr) killCritter(c);
        }
    }

    function init() {
        canvas = document.getElementById("swarm");
        if (!canvas || !canvas.getContext) return;
        canvas.width = W;
        canvas.height = H;
        ctx = canvas.getContext("2d");
        loadFrames(function () {
            setCount(SETTINGS.critterCount || MAX_LINGS);
            start();
        });
    }

    return { init: init, start: start, stop: stop, setCount: setCount, killNear: killNear };
})();
