/* Clockling - battle swarm: lings/banes vs marines, egg morphs.
 * Sprite art: user GIFs -> images/ling0-3.png, bane0-3.png, eggA-C.png, marine0-20.png.
 * ES5 on purpose: broad compatibility across widget hosts and browsers.
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
    var units = [];
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
    var waveEdge = 0;      /* 0 left, 1 right, 2 top, 3 bottom */
    var waveAnchor = 0;    /* position along that edge */
    var gameSpeed = 1;
    var eggCx = 0, eggCy = 0, eggN = 0;  /* egg centroid */
    var hiveX = 0, hiveY = 0;              /* safe rally point: eggs are laid and lings regroup here */
    var patrolX = 0, patrolY = 0, patrolT = 0;  /* shared marine patrol waypoint */
    var ZERG_TURN = 0.45;                  /* zerg steering: share of the turn closed per 1/8 s */
    var unitScale = 1;

    /* ALL tunable numbers live here so balance is easy to tweak. */
    var TUNING = {
        mapW: 216,
        mapH: 432,
        marineSpawnRateMult: 1.5, /* >1 spawns marines faster */
        maxLings: 10,
        maxBanes: 2,
        maxMarines: 7,
        lingW: 30,
        baneW: 39,             /* 30% larger than the ling */
        marineW: 42,
        eggW: 21,               /* eggs are 30% smaller than a ling; both egg types */
        lingBump: 10,
        baneBump: 12,
        marineBump: 12,
        respawnInterval: 2,   /* seconds between ling-egg refill batches */
        respawnBatch: 4,        /* eggs spawned per batch */
        marineWaveLo: 30,        /* how long after all marines die until the next wave */
        marineWaveHi: 32,
        marineRespawnLo: 8,    /* how often marines spawn while marines are alive */
        marineRespawnHi: 10,
        marineSpawnGap: 0.5,    /* marines in a wave spawn this many seconds apart */
        marineSpawnInset: 6,    /* how many px off-screen marines spawn */
        marineWaveSizeLo: 6,    /* min marines per wave (no marines alive) */
        marineWaveSizeHi: 6,    /* max marines per wave */
        marineRespawnSizeLo: 2, /* min marines per respawn cycle (while alive) */
        marineRespawnSizeHi: 2, /* max marines per respawn cycle */
        retargetInterval: 0.5,  /* lings/banes retarget this often (anti-jitter) */
        aimInterval: 0.3,       /* marine re-aims this often */
        morphAge: 4,           /* ling must live this long before morphing */
        morphCooldown: 2,
        morphChancePerSec: 1, /* chance/sec an eligible ling starts morphing */
        eggTimeMin: 8,             /* min seconds until an egg hatches */
        eggTimeMax: 10,            /* max seconds until an egg hatches */
        eggHatchMult: 1,           /* when an egg hatches, one other egg speeds up this much */
        splatLife: 1.21,
        splatBase: 7,           /* splat start radius (grows only 20%) */
        splatFadeStart: 0.6,    /* fraction of splat life before it starts fading */
        baneSplashR: 61,        /* baneling blast radius (damages all marines inside) */
        baneSplashDamage: 90,   /* damage a baneling deals to every marine in range */
        baneHp: 140,            /* baneling health (1.5x a zergling) */
        corpseLife: 2.2,        /* dead marine sprite lingers this long, fading */
        marineSplatScale: 1.4,  /* marine death splat is bigger */
        baneSplatScale: 2.5,      /* baneling splat is 2x normal */
        lingHp: 100,            /* zergling hit points */
        marineHp: 120,          /* marine hit points */
        marineShootDamage: 25,  /* marine damage per shot */
        marineShootInterval: 0.36,
        lingBiteDamage: 10,     /* ling damage per bite */
        lingBiteInterval: 0.2,
        marineHealPct: 0.1,    /* marines heal this fraction of max hp per tick */
        marineHealInterval: 0.5,
        marineGroupWeight: 0.5, /* pull toward other marines */
        marineAwayWeight: 1,  /* push away from zerg */
        marineTurnRate: 0.25,   /* marine steering: share of the turn closed per 1/8 s */
        marineFleeHpPct: 0.9,   /* marines kite below this hp fraction */
        marineKiteFrac: 0.6,    /* marines back off from zerg closer than this x range */
        marineRangeMult: 3,      /* marine weapon range = this * marineW */
        allyRadius: 45,          /* lings/banes this close to each other form one swarm */
        attackGroupSize: 5,      /* swarm size needed to attack (capped at maxLings) */
        marineScanRadius: 140,   /* idle lings keep this far from marines (> marine range) */
        marineGroupRadius: 60,   /* radius around a marine used to count its group */
        attackOdds: 1.5,         /* swarm strength needed per marine in the target group */
        berserkSpeedMult: 1.5,   /* speed multiplier while berserk */
        lingFleeSpeedMult: 1.4,  /* speed multiplier for lings escaping marines */
        berserkBanes: 2,         /* banes alive needed to trigger bane berserk */
        berserkCatchRadius: 80,  /* lings catch berserk from a berserk bane within this */
        berserkUntilDeath: false,/* on: berserk never retreats; off: cancels when outnumbered */
        zergSpeed: 1.2,            /* base speed multiplier for zerg units */
        terranSpeed: 1.2,        /* base speed multiplier for terran (marine) units */
        marineTactics: true,     /* new marine AI (kite/regroup/advance); false = classic */
        marineEntrySpeed: 1.5,   /* speed multiplier while marching in from off-screen */
        marineEntryDepth: 0.09,  /* march-in boost stops this x (shorter side) inside the edge */
        marineSightMult: 2,      /* no zerg within this x weapon range: patrol */
    };

    /* Load saved tuning before cached simulation constants are calculated. */
    (function () {
        try {
            var stored = JSON.parse(localStorage.getItem("clocklingTuning") || "{}");
            for (var storedKey in stored) {
                if (TUNING[storedKey] !== undefined) TUNING[storedKey] = stored[storedKey];
            }
        } catch (e) {}
    })();

    /* Preview control panel: ?tun_<key>=<number> overrides. */
    (function () {
        var q = window.location.search || "";
        var re = /[?&]tun_([A-Za-z0-9]+)=([^&]+)/g, mm;
        while ((mm = re.exec(q)) !== null) {
            var k = mm[1], raw = decodeURIComponent(mm[2]);
            if (TUNING[k] === undefined) continue;
            if (typeof TUNING[k] === "boolean") {
                TUNING[k] = (raw === "true" || raw === "1");
            } else {
                var v = parseFloat(raw);
                if (!isNaN(v)) TUNING[k] = v;
            }
        }
    })();

    /* runtime controls: ?speed=N&scale=N (game speed and unit multiplier) */
    (function () {
        var q = window.location.search || "";
        var sp = /[?&]speed=(\d+(?:\.\d+)?)/.exec(q);
        var sc = /[?&]scale=(\d+(?:\.\d+)?)/.exec(q);
        if (sp) gameSpeed = parseFloat(sp[1]) || 1;
        if (sc) unitScale = parseFloat(sc[1]) || 1;
    })();

    /* map resolution (preview can override via tun_mapW / tun_mapH) */
    W = TUNING.mapW;
    H = TUNING.mapH;
    /* orientation setting: landscape = wider than tall, portrait = taller than wide */
    if (typeof SETTINGS !== "undefined" && (SETTINGS.landscape ? W < H : W > H)) {
        var tmpW = W; W = H; H = tmpW;
    }

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
    var RESPAWN_BATCH = TUNING.respawnBatch;
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
    var MARINE_KITE_FRAC = TUNING.marineKiteFrac;
    var LING_FLEE_MULT = TUNING.lingFleeSpeedMult;
    var MARINE_ENTRY_SPEED = TUNING.marineEntrySpeed;
    var MARINE_ENTRY_DEPTH = TUNING.marineEntryDepth;
    var MARINE_SIGHT_MULT = TUNING.marineSightMult;
    var MARINE_RANGE = MARINE_W * TUNING.marineRangeMult;
    var ALLY_RADIUS = TUNING.allyRadius;
    var ATTACK_GROUP_SIZE = TUNING.attackGroupSize;
    var MARINE_SCAN_RADIUS = TUNING.marineScanRadius;
    var MARINE_GROUP_RADIUS = TUNING.marineGroupRadius;
    var ATTACK_ODDS = TUNING.attackOdds;
    var BERSERK_SPEED_MULT = TUNING.berserkSpeedMult;
    var BERSERK_BANES = TUNING.berserkBanes;
    var BERSERK_CATCH_RADIUS = TUNING.berserkCatchRadius;
    var BERSERK_UNTIL_DEATH = TUNING.berserkUntilDeath;
    var MARINE_WAVE_SIZE_LO = TUNING.marineWaveSizeLo;
    var MARINE_WAVE_SIZE_HI = TUNING.marineWaveSizeHi;
    var MARINE_RESPAWN_SIZE_LO = TUNING.marineRespawnSizeLo;
    var MARINE_RESPAWN_SIZE_HI = TUNING.marineRespawnSizeHi;
    var MARINE_SPAWN_RATE = TUNING.marineSpawnRateMult;
    var ZERG_SPEED = TUNING.zergSpeed;
    var TERRAN_SPEED = TUNING.terranSpeed;
    var MARINE_TACTICS = TUNING.marineTactics;
    var RETARGET_T = TUNING.retargetInterval;
    var AIM_T = TUNING.aimInterval;
    var MORPH_AGE = TUNING.morphAge;
    var MORPH_CD = TUNING.morphCooldown;
    var EGG_TIME_MIN = TUNING.eggTimeMin;
    var EGG_TIME_MAX = TUNING.eggTimeMax;
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

    /* scale unit population knobs together (1x/2x/5x/10x) */
    function applyUnitScale() {
        MAX_LINGS = Math.max(1, Math.round(TUNING.maxLings * unitScale));
        MAX_BANES = Math.max(1, Math.round(TUNING.maxBanes * unitScale));
        MAX_MARINES = Math.max(1, Math.round(TUNING.maxMarines * unitScale));
        BERSERK_BANES = Math.max(1, Math.round(TUNING.berserkBanes * unitScale));
        MARINE_WAVE_SIZE_LO = Math.max(1, Math.round(TUNING.marineWaveSizeLo * unitScale));
        MARINE_WAVE_SIZE_HI = Math.max(1, Math.round(TUNING.marineWaveSizeHi * unitScale));
        MARINE_RESPAWN_SIZE_LO = Math.max(1, Math.round(TUNING.marineRespawnSizeLo * unitScale));
        MARINE_RESPAWN_SIZE_HI = Math.max(1, Math.round(TUNING.marineRespawnSizeHi * unitScale));
        MARINE_SPAWN_RATE = Math.max(0.1, TUNING.marineSpawnRateMult * unitScale);
    }
    applyUnitScale();

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
            retarget: 0, aim: 0, aimT: 0, shootCd: 0, hatchKind: hatchKind || null,
            want: 0, moveMul: 1, attacking: false, cluster: -1, fleeing: false
        };
        c.want = c.heading;
        if (kind === "ling") {
            c.faceDir = -1; c.face = -1; c.w = LING_W; c.bumpR = LING_BUMP;
            c.speed = rand(26, 46); c.splatCol = LING_SPLAT;
            c.hp = LING_HP; c.attackCd = 0; c.healCd = 0; c.berserk = false;
        } else if (kind === "bane") {
            c.faceDir = 1; c.face = 1; c.w = BANE_W; c.bumpR = BANE_BUMP;
            c.speed = rand(24, 40); c.splatCol = BANE_SPLAT; c.splatScale = BANE_SPLAT_SCALE;
            c.hp = BANE_HP; c.healCd = 0; c.berserk = false;
        } else if (kind === "marine") {
            c.faceDir = -1; c.face = -1; c.w = MARINE_W; c.bumpR = MARINE_BUMP;
            c.speed = rand(16, 24); c.splatCol = MARINE_SPLAT; c.hp = MARINE_HP;
            c.splatScale = TUNING.marineSplatScale;
            c.shootCd = SHOOT_T; c.aim = c.heading; c.healCd = 0; c.entered = false; c.shootTarget = null;
            c.flashT = 0; c.hitX = 0; c.hitY = 0; c.kills = 0;
            c.deployT = 0; c.deployX = 0; c.deployY = 0;
        } else if (kind === "egg") {
            c.w = EGG_W; c.bumpR = 12; c.speed = 0; c.t = 0; c.hatchMult = 1;
            c.hatchT = rand(EGG_TIME_MIN, EGG_TIME_MAX);
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
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== "marine" || c.dead || c.hp <= 0) continue;
            var dx = c.x - x, dy = c.y - y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    function nearestLing(x, y) {
        var best = null, bd = 1e9;
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== "ling" || c.dead) continue;
            var dx = c.x - x, dy = c.y - y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    function nearestZerg(x, y) {
        var best = null, bd = 1e9;
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if ((c.kind !== "ling" && c.kind !== "bane") || c.dead) continue;
            var dx = c.x - x, dy = c.y - y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    /* guard: flock as one swarm (boids: separation + alignment + cohesion) around
     * the eggs, out of marine weapon range and out of the marine quadrant */
    function fallBack(c, lo, hi) {
        var ax = 0, ay = 0;

        /* flee: a marine inside the threat radius -> run from all of them, toward
         * the hive (if that isn't toward the marines), off the walls, fast, and
         * re-plan quickly so stragglers don't get picked off */
        var threatR = threatRadius();
        var fx = 0, fy = 0, threatened = false;
        for (var ti = 0; ti < units.length; ti++) {
            var tm = units[ti];
            if (tm.kind !== "marine" || tm.dead) continue;
            var tdx = c.x - tm.x, tdy = c.y - tm.y;
            var td = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
            if (td >= threatR) continue;
            var tw = 1.3 - td / threatR;   /* closer marines push harder */
            fx += (tdx / td) * tw;
            fy += (tdy / td) * tw;
            threatened = true;
        }
        if (threatened) {
            var fl = Math.sqrt(fx * fx + fy * fy) || 1;
            ax = (fx / fl) * 3;
            ay = (fy / fl) * 3;
            var hx0 = hiveX - c.x, hy0 = hiveY - c.y;
            var hd0 = Math.sqrt(hx0 * hx0 + hy0 * hy0) || 1;
            if ((hx0 * fx + hy0 * fy) / (hd0 * fl) > -0.2) {
                ax += (hx0 / hd0) * 1.2;
                ay += (hy0 / hd0) * 1.2;
            }
            /* slide along walls instead of pinning into corners */
            var wallR = 40;
            if (c.x < wallR) ax += (1 - c.x / wallR) * 2.5;
            if (c.x > W - wallR) ax -= (1 - (W - c.x) / wallR) * 2.5;
            if (c.y < wallR) ay += (1 - c.y / wallR) * 2.5;
            if (c.y > H - wallR) ay -= (1 - (H - c.y) / wallR) * 2.5;
            c.want = Math.atan2(ay, ax);
            c.speed = rand(lo, hi) * LING_FLEE_MULT;
            c.fleeing = true;
            c.retarget = Math.min(c.retarget, 0.2);
            return;
        }
        c.fleeing = false;

        /* stay out of the quadrant with the most marines */
        if (countKind("marine") > 0) {
            var home = marineHome();
            var inMarineQ = (c.x >= home.qx * W / 2 && c.x < home.qx * W / 2 + W / 2 &&
                             c.y >= home.qy * H / 2 && c.y < home.qy * H / 2 + H / 2);
            if (inMarineQ) {
                var hx = home.qx * W / 2 + W / 4, hy = home.qy * H / 2 + H / 4;
                var dqx = c.x - hx, dqy = c.y - hy;
                var dq = Math.sqrt(dqx * dqx + dqy * dqy) || 1;
                ax += (dqx / dq) * 1.0;
                ay += (dqy / dq) * 1.0;
            }
        }

        /* flock: separation + alignment + cohesion among lings and banes (not eggs) */
        var flockR = ALLY_RADIUS * 2;
        var cx = 0, cy = 0, hx = 0, hy = 0, n = 0;
        for (var i = 0; i < units.length; i++) {
            var o = units[i];
            if (o === c || o.dead) continue;
            if (o.kind !== "ling" && o.kind !== "bane") continue;
            var dx = o.x - c.x, dy = o.y - c.y;
            var d2 = dx * dx + dy * dy;
            var minR = c.bumpR + o.bumpR + 8;
            if (d2 > 0.01 && d2 < minR * minR) {
                var d = Math.sqrt(d2);
                var w2 = (minR - d) / minR;
                ax -= (dx / d) * w2 * 1.5;
                ay -= (dy / d) * w2 * 1.5;
            }
            if (d2 < flockR * flockR) {
                cx += o.x; cy += o.y; n++;
                hx += Math.cos(o.heading); hy += Math.sin(o.heading);
            }
        }
        if (n > 0) {
            cx /= n; cy /= n;
            var dcx = cx - c.x, dcy = cy - c.y;
            var dc = Math.sqrt(dcx * dcx + dcy * dcy) || 1;
            ax += (dcx / dc) * 0.6;
            ay += (dcy / dc) * 0.6;
            var hl = Math.sqrt(hx * hx + hy * hy);
            if (hl > 0.01) { ax += (hx / hl) * 0.5; ay += (hy / hl) * 0.5; }
        }

        /* guard the hive (where the eggs are laid): gentle pull when drifting away */
        {
            var ex = hiveX - c.x, ey = hiveY - c.y;
            var de = Math.sqrt(ex * ex + ey * ey) || 1;
            var pull = 0.35 * Math.min(1, de / 60);
            ax += (ex / de) * pull;
            ay += (ey / de) * pull;
        }

        /* organic wander */
        ax += rand(-0.25, 0.25);
        ay += rand(-0.25, 0.25);

        c.want = Math.atan2(ay, ax);
        c.speed = rand(lo, hi);
    }

    function nearestOtherMarine(self) {
        var best = null, bd = 1e9;
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== "marine" || c.dead || c === self) continue;
            var dx = c.x - self.x, dy = c.y - self.y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    function countNearbyMarines(self, r) {
        var n = 0;
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== "marine" || c.dead) continue;
            var dx = c.x - self.x, dy = c.y - self.y;
            if (dx * dx + dy * dy < r * r) n++;
        }
        return n;
    }

    /* any berserk bane within r of (x,y)? lings catch berserk from these */
    function berserkBaneNear(x, y, r) {
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== "bane" || c.dead || !c.berserk) continue;
            var dx = c.x - x, dy = c.y - y;
            if (dx * dx + dy * dy < r * r) return true;
        }
        return false;
    }

    function countKind(kind) {
        var n = 0;
        for (var i = 0; i < units.length; i++) {
            if (units[i].kind === kind && !units[i].dead) n++;
        }
        return n;
    }

    /* Choose the spawn edge for a wave: the map edge farthest from the zerg's centre
     * of mass, at the point mirrored across from them. 0 left, 1 right, 2 top, 3 bottom. */
    function pickSpawnEdge() {
        var zx = 0, zy = 0, zn = 0;
        for (var i = 0; i < units.length; i++) {
            var z = units[i];
            if ((z.kind === "ling" || z.kind === "bane") && !z.dead) { zx += z.x; zy += z.y; zn++; }
        }
        if (zn > 0) { zx /= zn; zy /= zn; } else { zx = rand(0, W); zy = rand(0, H); }
        var d = [zx, W - zx, zy, H - zy];
        waveEdge = 0;
        for (var e = 1; e < 4; e++) if (d[e] > d[waveEdge]) waveEdge = e;
        var len = waveEdge < 2 ? H : W;
        var mirror = waveEdge < 2 ? H - zy : W - zx;
        var margin = 1.5 * MARINE_W;
        waveAnchor = Math.max(margin, Math.min(len - margin, mirror));
    }

    /* one marine just off-screen on waveEdge at `along`, marching straight in */
    function spawnMarine(along) {
        var mm = make("marine");
        var nx = [1, -1, 0, 0][waveEdge], ny = [0, 0, 1, -1][waveEdge];  /* inward normal */
        if (waveEdge < 2) {
            mm.x = waveEdge === 0 ? -MARINE_INSET : W + MARINE_INSET;
            mm.y = along;
        } else {
            mm.x = along;
            mm.y = waveEdge === 2 ? -MARINE_INSET : H + MARINE_INSET;
        }
        mm.heading = Math.atan2(ny, nx) + rand(-0.08, 0.08);
        mm.want = mm.heading;
        mm.aim = mm.heading;
        /* boosted march in, stopping marineEntryDepth x (shorter side) inside the edge */
        var dd = MARINE_INSET + MARINE_ENTRY_DEPTH * Math.min(W, H);
        mm.deployX = Math.max(20, Math.min(W - 20, mm.x + nx * dd));
        mm.deployY = Math.max(20, Math.min(H - 20, mm.y + ny * dd));
        mm.deployT = 3;
        units.push(mm);
    }

    /* the marine quadrant with the most marines, plus the centroid inside it */
    function marineHome() {
        var counts = [[0, 0], [0, 0]];
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== "marine" || c.dead) continue;
            counts[c.x < W / 2 ? 0 : 1][c.y < H / 2 ? 0 : 1]++;
        }
        var qx = 0, qy = 0, best = -1;
        for (var x = 0; x < 2; x++) {
            for (var y = 0; y < 2; y++) {
                if (counts[x][y] > best) { best = counts[x][y]; qx = x; qy = y; }
            }
        }
        var cx = 0, cy = 0, n = 0;
        for (var j = 0; j < units.length; j++) {
            var c2 = units[j];
            if (c2.kind !== "marine" || c2.dead) continue;
            if ((c2.x < W / 2 ? 0 : 1) === qx && (c2.y < H / 2 ? 0 : 1) === qy) {
                cx += c2.x; cy += c2.y; n++;
            }
        }
        if (n > 0) { cx /= n; cy /= n; } else { cx = W / 2; cy = H / 2; }
        return { qx: qx, qy: qy, cx: cx, cy: cy };
    }

    /* lings treat marines inside this radius as a threat. Never less than 1.25x marine
     * range, so a small marineScanRadius can't leave idle lings inside the kill zone. */
    function threatRadius() {
        return Math.max(MARINE_SCAN_RADIUS, MARINE_RANGE * 1.25);
    }

    function nearestMarineDist(x, y) {
        var m = nearestMarine(x, y);
        if (!m) return 1e9;
        var dx = m.x - x, dy = m.y - y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /* The hive: where eggs are laid and threatened lings regroup. Keep the current
     * eggs / swarm position while it is safe, otherwise move to the spot (on a 3x3
     * grid) farthest from any marine. */
    function updateHive(zx, zy, zn) {
        var safe = threatRadius() * 1.1;
        if (eggN > 0 && nearestMarineDist(eggCx, eggCy) > safe) { hiveX = eggCx; hiveY = eggCy; return; }
        if (zn > 0 && nearestMarineDist(zx, zy) > safe) { hiveX = zx; hiveY = zy; return; }
        if (countKind("marine") === 0) {
            if (eggN > 0) { hiveX = eggCx; hiveY = eggCy; } else if (zn > 0) { hiveX = zx; hiveY = zy; }
            else { hiveX = W / 2; hiveY = H / 2; }
            return;
        }
        var best = -1;
        for (var gi = 0; gi < 3; gi++) {
            for (var gj = 0; gj < 3; gj++) {
                var gx = W * (gi + 0.5) / 3, gy = H * (gj + 0.5) / 3;
                var gd = nearestMarineDist(gx, gy);
                if (gd > best) { best = gd; hiveX = gx; hiveY = gy; }
            }
        }
    }

    /* lay a new egg at the hive, so hatchlings start inside the swarm */
    function placeEggAtHive(egg) {
        egg.x = Math.max(16, Math.min(W - 16, hiveX + rand(-22, 22)));
        egg.y = Math.max(16, Math.min(H - 16, hiveY + rand(-22, 22)));
    }

    function pendingLings() {
        var n = countKind("ling");
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind === "egg" && !c.dead && c.hatchKind === "ling") n += 2; /* each egg yields 2 lings */
        }
        return n;
    }

    /* point c.want toward (tx,ty), or away from it when `away` is true */
    function marineSteerToward(c, tx, ty, away) {
        var dx = away ? (c.x - tx) : (tx - c.x);
        var dy = away ? (c.y - ty) : (ty - c.y);
        c.want = Math.atan2(dy, dx);
    }

    /* smooth turning: each 1/8 s, close `rate` of the gap between heading and want */
    function turnToward(c, rate, dt) {
        var diff = c.want - c.heading;
        while (diff > Math.PI) diff -= 6.283;
        while (diff < -Math.PI) diff += 6.283;
        var r = Math.max(0.01, Math.min(0.99, rate));
        c.heading += diff * (1 - Math.pow(1 - r, dt * 8));
    }

    /* head for marine m (small random spread so the swarm fans out around it) */
    function charge(c, m, lo, hi, mult) {
        c.want = Math.atan2(m.y - c.y, m.x - c.x) + rand(-0.15, 0.15);
        c.speed = rand(lo, hi) * mult;
    }

    /* classic marine steering: group with other marines, flee lings only when hurt */
    function marineClassicSteer(c) {
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
        if (ax !== 0 || ay !== 0) c.want = Math.atan2(ay, ax);
        c.moveMul = 1;
    }

    /* centre of the other marines (the squad), or null when alone */
    function squadCentre(self) {
        var x = 0, y = 0, n = 0;
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== "marine" || c.dead || c === self) continue;
            x += c.x; y += c.y; n++;
        }
        return n ? { x: x / n, y: y / n } : null;
    }

    /* marine tactics: kite when zerg get close, stand and shoot at range, keep the
     * squad together, and advance unless heavily outnumbered */
    /* shared squad waypoint: a new random spot when the squad reaches it or after 8 s */
    function patrolWaypoint() {
        var x = 0, y = 0, n = 0;
        for (var i = 0; i < units.length; i++) {
            var m = units[i];
            if (m.kind !== "marine" || m.dead) continue;
            x += m.x; y += m.y; n++;
        }
        var near = false;
        if (n) {
            var dx = patrolX - x / n, dy = patrolY - y / n;
            near = dx * dx + dy * dy < 25 * 25;
        }
        if (patrolT <= 0 || near) {
            patrolX = rand(30, W - 30);
            patrolY = rand(30, H - 30);
            patrolT = 8;
        }
    }

    function marineTacticsSteer(c) {
        var z = nearestZerg(c.x, c.y);
        var dz = 1e9;
        if (z) {
            var zx = z.x - c.x, zy = z.y - c.y;
            dz = Math.sqrt(zx * zx + zy * zy) || 1;
        }
        var damaged = c.hp < MARINE_HP * MARINE_FLEE_PCT;
        /* supply: ling/bane = 0.5, marine = 1. Marines out-range the zerg, so they
         * only count as outnumbered at 2:1 */
        var outnumbered = (countKind("ling") + countKind("bane")) * 0.5 > 2 * countKind("marine");
        var sq = squadCentre(c);
        var sqD = 0;
        if (sq) {
            var sx = sq.x - c.x, sy = sq.y - c.y;
            sqD = Math.sqrt(sx * sx + sy * sy) || 1;
        }

        if (dz > MARINE_RANGE * MARINE_SIGHT_MULT) {
            /* nothing in sight: close up, then patrol together until we find zerg */
            if (sq && sqD > MARINE_GROUP_RADIUS) {
                marineSteerToward(c, sq.x, sq.y, false);
                c.moveMul = 1;
            } else {
                patrolWaypoint();
                marineSteerToward(c, patrolX, patrolY, false);
                c.moveMul = 0.6;
            }
        } else if (z && (damaged || dz < MARINE_RANGE * MARINE_KITE_FRAC)) {
            /* kite: back off from the nearest zerg, drifting toward the squad */
            var ax = (c.x - z.x) / dz * MARINE_AWAY_W, ay = (c.y - z.y) / dz * MARINE_AWAY_W;
            if (sq) {
                ax += (sq.x - c.x) / sqD * MARINE_GROUP_W;
                ay += (sq.y - c.y) / sqD * MARINE_GROUP_W;
            }
            c.want = Math.atan2(ay, ax);
            c.moveMul = 1;
        } else if (z && dz < MARINE_RANGE) {
            /* in range: stand and shoot, shuffling toward the squad */
            if (sq && sqD > MARINE_GROUP_RADIUS * 0.5) marineSteerToward(c, sq.x, sq.y, false);
            c.moveMul = 0.2;
        } else if (sq && sqD > MARINE_GROUP_RADIUS) {
            /* regroup */
            marineSteerToward(c, sq.x, sq.y, false);
            c.moveMul = 1;
        } else if (z && !outnumbered) {
            /* advance on the nearest zerg */
            marineSteerToward(c, z.x, z.y, false);
            c.moveMul = 0.8;
        } else {
            /* heavily outnumbered: hold with the squad */
            if (sq) marineSteerToward(c, sq.x, sq.y, false);
            c.moveMul = 0.3;
        }
    }

    /* Swarm decisions. Lings and banes chained within allyRadius of each other form
     * one swarm, and the whole swarm attacks together when its strength (ling = 1,
     * bane = 2) is at least attackGroupSize (capped at maxLings, so it is always
     * reachable) AND at least attackOdds x the target marine group (every marine within
     * weapon range of the target). Once committed it keeps attacking while it holds
     * half of both, so it doesn't flicker at the threshold. A cornered swarm (marines
     * already inside 70% of their range) fights at half odds rather than run, and a
     * berserk baneling in the swarm always sends it in. */
    function updateSwarm() {
        var zs = [], i, j;
        eggCx = 0; eggCy = 0; eggN = 0;
        for (i = 0; i < units.length; i++) {
            var u = units[i];
            if (u.dead) continue;
            if (u.kind === "ling" || u.kind === "bane") { u.cluster = -1; zs.push(u); }
            else if (u.kind === "egg") { eggCx += u.x; eggCy += u.y; eggN++; }
        }
        if (eggN) { eggCx /= eggN; eggCy /= eggN; }
        var zcx = 0, zcy = 0;
        for (i = 0; i < zs.length; i++) { zcx += zs[i].x; zcy += zs[i].y; }
        if (zs.length) { zcx /= zs.length; zcy /= zs.length; }
        updateHive(zcx, zcy, zs.length);

        var r2 = ALLY_RADIUS * ALLY_RADIUS, nc = 0, stack = [];
        for (i = 0; i < zs.length; i++) {
            if (zs[i].cluster >= 0) continue;
            zs[i].cluster = nc;
            stack.push(zs[i]);
            while (stack.length) {
                var a = stack.pop();
                for (j = 0; j < zs.length; j++) {
                    var b = zs[j];
                    if (b.cluster >= 0) continue;
                    var dx = b.x - a.x, dy = b.y - a.y;
                    if (dx * dx + dy * dy < r2) { b.cluster = nc; stack.push(b); }
                }
            }
            nc++;
        }

        var need = Math.max(1, Math.min(ATTACK_GROUP_SIZE, MAX_LINGS));
        for (var k = 0; k < nc; k++) {
            var size = 0, power = 0, cx = 0, cy = 0, committed = false, berserkBane = false;
            for (i = 0; i < zs.length; i++) {
                var z = zs[i];
                if (z.cluster !== k) continue;
                size++; cx += z.x; cy += z.y;
                power += z.kind === "bane" ? 2 : 1;
                if (z.attacking) committed = true;
                if (z.kind === "bane" && z.berserk) berserkBane = true;
            }
            cx /= size; cy /= size;
            var attack = false;
            var m = nearestMarine(cx, cy);
            if (m) {
                /* the target group = every marine close enough to join this fight */
                var mg = countNearbyMarines(m, Math.max(MARINE_GROUP_RADIUS, MARINE_RANGE));
                var odds = mg * ATTACK_ODDS;
                /* cornered: marines already this close, running is death, so fight */
                var dmx = m.x - cx, dmy = m.y - cy;
                var cornered = dmx * dmx + dmy * dmy < (MARINE_RANGE * 0.7) * (MARINE_RANGE * 0.7);
                attack = (power >= need && power >= odds) ||
                         (cornered && power >= odds / 2) ||
                         (committed && power >= need / 2 && power >= odds / 2) ||
                         berserkBane;
            }
            for (i = 0; i < zs.length; i++) if (zs[i].cluster === k) zs[i].attacking = attack;
        }
    }

    function step(c, dt) {
        if (c.kind === "egg") { c.t += dt * (c.hatchMult || 1); return; }

        if (c.kind === "marine") {
            /* only start steering once fully on-screen */
            if (!c.entered && c.x >= 0 && c.x <= W && c.y >= 0 && c.y <= H) c.entered = true;
            if (c.flashT > 0) c.flashT -= dt;
            c.retarget -= dt;
            if (c.deployT > 0) {
                /* marching in: head straight for the deploy point at entry speed
                 * (still shooting), then switch to normal tactics */
                c.deployT -= dt;
                var ddx = c.deployX - c.x, ddy = c.deployY - c.y;
                c.want = Math.atan2(ddy, ddx);
                c.moveMul = MARINE_ENTRY_SPEED;
                if (ddx * ddx + ddy * ddy < 64 || c.deployT <= 0) { c.deployT = 0; c.moveMul = 1; c.retarget = 0; }
            } else if (c.retarget <= 0) {
                c.retarget = 0.3;
                if (c.entered) {
                    if (MARINE_TACTICS) {
                        marineTacticsSteer(c);
                    } else {
                        marineClassicSteer(c);
                    }
                }
            }
            turnToward(c, MARINE_TURN, dt);
            var mv = c.speed * TERRAN_SPEED * SETTINGS.unitSpeed * c.moveMul * dt;
            c.x += Math.cos(c.heading) * mv;
            c.y += Math.sin(c.heading) * mv;
            /* reflect only when moving outward, so marines can walk in from off-screen */
            if (c.x < 18 && Math.cos(c.heading) < 0) { c.x = 18; c.heading = c.want = Math.PI - c.heading; }
            if (c.x > W - 18 && Math.cos(c.heading) > 0) { c.x = W - 18; c.heading = c.want = Math.PI - c.heading; }
            if (c.y < 18 && Math.sin(c.heading) < 0) { c.y = 18; c.heading = c.want = -c.heading; }
            if (c.y > H - 18 && Math.sin(c.heading) > 0) { c.y = H - 18; c.heading = c.want = -c.heading; }
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
            c.retarget -= dt;
            if (c.retarget <= 0) {
                c.retarget = RETARGET_T;
                var m = nearestMarine(c.x, c.y);
                if (c.kind === "ling") {
                    if (m) {
                        var catching = berserkBaneNear(c.x, c.y, BERSERK_CATCH_RADIUS);
                        if (c.berserk) {
                            /* berserk charge. Cancel only when the swarm has called off
                             * the attack and no berserk bane is nearby to re-trigger it. */
                            if (!BERSERK_UNTIL_DEATH && !c.attacking && !catching) {
                                c.berserk = false;
                                fallBack(c, 26, 46);
                            } else {
                                charge(c, m, 26, 46, BERSERK_SPEED_MULT);
                            }
                        } else if (catching) {
                            /* catch berserk from a nearby berserk bane */
                            c.berserk = true;
                            charge(c, m, 26, 46, BERSERK_SPEED_MULT);
                        } else if (c.attacking) {
                            /* the swarm is attacking: go with it */
                            charge(c, m, 26, 46, 1);
                        } else {
                            /* guard: flock around the eggs, out of marine range */
                            fallBack(c, 26, 46);
                        }
                    } else {
                        c.berserk = false;
                        fallBack(c, 26, 46);
                    }
                } else {
                    /* bane: charge with an attacking swarm, or once enough banes are alive
                     * (counts itself). Banelings NEVER lose berserk once they have it. */
                    if (m && (c.berserk || c.attacking || countKind("bane") >= BERSERK_BANES)) {
                        c.berserk = true;
                        charge(c, m, 24, 40, BERSERK_SPEED_MULT);
                    } else {
                        fallBack(c, 24, 40);
                    }
                }
            }
            turnToward(c, c.fleeing ? 0.75 : ZERG_TURN, dt);
            c.x += Math.cos(c.heading) * c.speed * ZERG_SPEED * SETTINGS.unitSpeed * dt;
            c.y += Math.sin(c.heading) * c.speed * ZERG_SPEED * SETTINGS.unitSpeed * dt;
            if (c.x < 18) { c.x = 18; c.heading = c.want = Math.PI - c.heading; }
            if (c.x > W - 18) { c.x = W - 18; c.heading = c.want = Math.PI - c.heading; }
            if (c.y < 18) { c.y = 18; c.heading = c.want = -c.heading; }
            if (c.y > H - 18) { c.y = H - 18; c.heading = c.want = -c.heading; }
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
    function drawUnit(c, cc) {
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

        /* health bar under every non-egg unit (showHealthBars) */
        if (c.kind !== "egg" && SETTINGS.showHealthBars !== false) {
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

    function killUnit(c) {
        if (c.dead) return;
        addSplat(c.x, c.y, c.splatCol, c.splatScale);
        c.dead = true;
        if (c.kind === "ling") {
            respawnLeftLings++;
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
            /* splash: damage EVERY marine in blast range, not just the touched one */
            for (var i = 0; i < units.length; i++) {
                var m = units[i];
                if (m.kind !== "marine" || m.dead) continue;
                var dx = m.x - c.x, dy = m.y - c.y;
                if (dx * dx + dy * dy < BANE_SPLASH_R * BANE_SPLASH_R) m.hp -= BANE_SPLASH_DMG;
            }
        } else if (c.kind === "marine") {
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
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind === "egg" && !c.dead) eggs.push(c);
        }
        if (eggs.length) {
            var pick = eggs[Math.floor(Math.random() * eggs.length)];
            pick.hatchMult = (pick.hatchMult || 1) * TUNING.eggHatchMult;
        }
    }

    function frame(t) {
        if (!lastT) lastT = t;
        var dt = Math.min(0.25, Math.min(0.05, (t - lastT) / 1000) * gameSpeed);
        lastT = t;
        ctx.clearRect(0, 0, W, H);

        /* new lings spawn as eggs, 2 at a time, slowly */
        if (respawnLeftLings > 0) {
            respawnTimer -= dt;
            if (respawnTimer <= 0) {
                respawnTimer = RESPAWN_T;
                var n = 0;
                while (respawnLeftLings > 0 && n < RESPAWN_BATCH && pendingLings() < MAX_LINGS) {
                    var egg = make("egg", "ling");
                    placeEggAtHive(egg);
                    units.push(egg);
                    respawnLeftLings--;
                    n++;
                }
            }
        }

        /* marines enter in pairs from the map edge farthest from the zerg */
        marineTimer -= dt;
        if (patrolT > 0) patrolT -= dt;
        if (marineTimer <= 0) {
            var marinesAlive = countKind("marine") > 0;
            var mInt = marinesAlive ? rand(MARINE_LO2, MARINE_HI2) : rand(MARINE_LO, MARINE_HI);
            marineTimer = mInt / MARINE_SPAWN_RATE;
            /* count: respawn size while alive, wave size when starting fresh */
            var wave = marinesAlive ?
                Math.round(rand(MARINE_RESPAWN_SIZE_LO, MARINE_RESPAWN_SIZE_HI)) :
                Math.round(rand(MARINE_WAVE_SIZE_LO, MARINE_WAVE_SIZE_HI));
            wavePending = Math.max(0, Math.min(wave, MAX_MARINES - countKind("marine")));
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
                waveSpawnT = TUNING.marineSpawnGap;
                var pair = Math.min(2, wavePending);
                var along = waveAnchor + rand(-0.5, 0.5) * MARINE_W;
                for (var pi = 0; pi < pair; pi++) {
                    var slot = (pair === 2) ? (pi === 0 ? -0.7 : 0.7) * MARINE_W : 0;
                    spawnMarine(along + slot);
                }
                wavePending -= pair;
            }
        }

        /* morph: eligible lings turn into baneling eggs (1-3 at a time) */
        if (morphCooldown > 0) morphCooldown -= dt;
        if (MAX_BANES > 0 && morphCooldown <= 0) {
            var baneEggs = 0;
            for (var ei = 0; ei < units.length; ei++) {
                var ec = units[ei];
                if (ec.kind === "egg" && !ec.dead && ec.hatchKind === "bane") baneEggs++;
            }
            var baneSlots = MAX_BANES - countKind("bane") - baneEggs;
            if (baneSlots > 0 && Math.random() < TUNING.morphChancePerSec * dt) {
                var candidates = [];
                for (var li = 0; li < units.length; li++) {
                    var l = units[li];
                    if (l.kind === "ling" && !l.dead && l.age >= MORPH_AGE) candidates.push(l);
                }
                candidates.sort(function (a, b) { return b.age - a.age; });
                var batch = 1;
                if (candidates.length > 1) {
                    var r = Math.random();
                    if (r < 0.35) batch = 2;
                    else if (r < 0.5) batch = 3; /* 3 if lucky */
                }
                batch = Math.min(batch, baneSlots, candidates.length);
                for (var bi = 0; bi < batch; bi++) {
                    var l2 = candidates[bi];
                    l2.kind = "egg";
                    l2.hatchKind = "bane";
                    l2.t = 0;
                    l2.hatchT = rand(EGG_TIME_MIN, EGG_TIME_MAX);
                    l2.w = EGG_W;
                    l2.splatCol = BANE_SPLAT;
                    l2.splatScale = 1; /* hatch uses the normal green egg-splat; big splat is death-only */
                    l2.speed = 0;
                    respawnLeftLings++; /* the consumed ling comes back as an egg */
                }
                if (batch > 0) morphCooldown = MORPH_CD;
            }
        }

        /* eggs hatch */
        for (var e = 0; e < units.length; e++) {
            var eg = units[e];
            if (eg.kind === "egg" && eg.t >= eg.hatchT) {
                addSplat(eg.x, eg.y, eg.splatCol, eg.splatScale);
                eg.dead = true;
                if (eg.hatchKind === "bane") {
                    morphCooldown = MORPH_CD;
                    var nb = make("bane");
                    nb.x = eg.x; nb.y = eg.y;
                    units.push(nb);
                } else {
                    /* two lings hatch out of each zergling egg */
                    for (var h2 = 0; h2 < 2; h2++) {
                        var nl = make("ling");
                        nl.x = eg.x + (h2 === 0 ? -6 : 6);
                        nl.y = eg.y + (h2 === 0 ? 4 : -4);
                        units.push(nl);
                    }
                }
                boostSiblingEgg();
            }
        }

        /* swarm-level attack decisions, then move everyone */
        updateSwarm();
        for (var i = 0; i < units.length; i++) step(units[i], dt);

        /* marines shoot the closest zerg (ling or bane) within range */
        for (var mi = 0; mi < units.length; mi++) {
            var mc = units[mi];
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

        /* all units regenerate HP over time (shared heal settings) */
        for (var hr = 0; hr < units.length; hr++) {
            var hc = units[hr];
            if (hc.dead) continue;
            if (hc.kind === "marine" || hc.kind === "ling" || hc.kind === "bane") {
                hc.healCd -= dt;
                if (hc.healCd <= 0) {
                    hc.healCd = MARINE_HEAL_T;
                    var maxHp = (hc.kind === "marine") ? MARINE_HP : (hc.kind === "bane") ? BANE_HP : LING_HP;
                    hc.hp = Math.min(maxHp, hc.hp + maxHp * MARINE_HEAL_PCT);
                }
            }
        }

        /* lings bite marines for BITE_DMG every BITE_T while touching */
        for (var li2 = 0; li2 < units.length; li2++) {
            var l2 = units[li2];
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
        for (var ci = 0; ci < units.length; ci++) {
            var a = units[ci];
            if (a.dead || a.kind !== "bane") continue;
            var tgt2 = nearestMarine(a.x, a.y);
            if (tgt2) {
                var dx2 = tgt2.x - a.x, dy2 = tgt2.y - a.y;
                var touch2 = a.bumpR + tgt2.bumpR + 6;
                if (dx2 * dx2 + dy2 * dy2 < touch2 * touch2) {
                    killUnit(a); /* splash damages all nearby marines */
                }
            }
        }

        /* marines die at 0 hp -> red splat */
        for (var mj = 0; mj < units.length; mj++) {
            var m2 = units[mj];
            if (m2.kind === "marine" && !m2.dead && m2.hp <= 0) killUnit(m2);
        }

        /* lings die at 0 hp */
        for (var lj = 0; lj < units.length; lj++) {
            var l3 = units[lj];
            if (l3.kind === "ling" && !l3.dead && l3.hp <= 0) killUnit(l3);
        }

        /* banes die at 0 hp (splat + splash) */
        for (var bj = 0; bj < units.length; bj++) {
            var b3 = units[bj];
            if (b3.kind === "bane" && !b3.dead && b3.hp <= 0) killUnit(b3);
        }

        /* bump separation: units push apart. Zerg bounce off marines at 50%
         * strength and keep their heading, so they lunge-bite in place instead
         * of phasing through or slipping behind the marine. */
        for (var bi = 0; bi < units.length; bi++) {
            for (var bj = bi + 1; bj < units.length; bj++) {
                var a2 = units[bi], b2 = units[bj];
                if (a2.dead || b2.dead) continue;
                if (a2.kind === "egg" || b2.kind === "egg") continue; /* eggs never move */
                var aZerg = a2.kind === "ling" || a2.kind === "bane";
                var bZerg = b2.kind === "ling" || b2.kind === "bane";
                var zergVsMarine = (aZerg && b2.kind === "marine") || (bZerg && a2.kind === "marine");
                var dx = b2.x - a2.x, dy = b2.y - a2.y;
                var d2 = dx * dx + dy * dy;
                var minD = a2.bumpR + b2.bumpR;
                if (d2 > 0.01 && d2 < minD * minD) {
                    var d = Math.sqrt(d2);
                    var nx = dx / d, ny = dy / d;
                    var overlap = minD - d;
                    if (zergVsMarine) {
                        /* zerg bounces back 50% and keeps its heading, so it keeps
                         * lunging at the marine's face. The marine is NOT pushed,
                         * so a swarm can't shove it off the map. */
                        var zerg = aZerg ? a2 : b2;
                        var marine = (zerg === a2) ? b2 : a2;
                        var zx = zerg.x - marine.x, zy = zerg.y - marine.y;
                        var zd = Math.sqrt(zx * zx + zy * zy) || 1;
                        zx /= zd; zy /= zd;
                        zerg.x += zx * overlap * 0.5;
                        zerg.y += zy * overlap * 0.5;
                        /* keep the zerg on the map */
                        if (zerg.x < 12) zerg.x = 12;
                        if (zerg.x > W - 12) zerg.x = W - 12;
                        if (zerg.y < 12) zerg.y = 12;
                        if (zerg.y > H - 12) zerg.y = H - 12;
                    } else {
                        /* same side: just push apart. No heading bounce: the swarm
                         * packs tightly and steering (flock separation) handles
                         * spacing, so bouncing here only made units jitter. */
                        var push = overlap / 2;
                        a2.x -= nx * push; a2.y -= ny * push;
                        b2.x += nx * push; b2.y += ny * push;
                    }
                }
            }
        }

        /* remove the dead */
        for (var dk = units.length - 1; dk >= 0; dk--) {
            if (units[dk].dead) units.splice(dk, 1);
        }

        /* if all marines just died, cancel pending respawn and schedule a fresh wave */
        var mc2 = countKind("marine");
        if (lastMarineCount > 0 && mc2 === 0) {
            marineTimer = rand(MARINE_LO, MARINE_HI) / MARINE_SPAWN_RATE;
        }
        lastMarineCount = mc2;

        drawSplats(ctx, dt);
        drawCorpses(ctx, dt);
        for (var k = 0; k < units.length; k++) drawUnit(units[k], ctx);

        /* supply bar: zerg (purple) vs terran (blue). 1 marine = 1 supply,
         * 1 ling/bane = 0.5 supply, so the bar shows who is ahead. */
        var zergSupply = (countKind("ling") + countKind("bane")) * 0.5;
        var terranSupply = countKind("marine");
        var totalSupply = zergSupply + terranSupply;
        var frac = totalSupply > 0 ? zergSupply / totalSupply : 0.5;
        var margin = 6, barH = 2, barY = 6, barW = W - margin * 2;
        var split = margin + barW * frac;
        ctx.fillStyle = "#c39bff";
        ctx.fillRect(margin, barY, split - margin, barH);
        ctx.fillStyle = "#6ab8ff";
        ctx.fillRect(split, barY, margin + barW - split, barH);
        /* supply numbers just below the bar, coloured to match (no labels) */
        var zergStr = (zergSupply % 1 === 0) ? String(zergSupply) : zergSupply.toFixed(1);
        var terranStr = (terranSupply % 1 === 0) ? String(terranSupply) : terranSupply.toFixed(1);
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "left";
        ctx.fillStyle = "#c39bff";
        ctx.fillText(zergStr, margin, barY + barH + 12);
        ctx.textAlign = "right";
        ctx.fillStyle = "#6ab8ff";
        ctx.fillText(terranStr, W - margin, barY + barH + 12);
        ctx.textAlign = "left";

        /* firing lines: brief, semi-transparent, gun tip -> random point on the ling */
        for (var fl = 0; fl < units.length; fl++) {
            var fm = units[fl];
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
        while (units.length > 0) units.pop();
        corpses.length = 0;
        for (var i = 0; i < wantLings; i++) units.push(make("ling"));
        respawnLeftLings = 0;
        respawnTimer = 0;
        marineTimer = 3;
        lastMarineCount = 0;
        morphCooldown = 0;
    }

    /* tap: splat only units near the tap point (eggs are safe) */
    function killNear(x, y, r) {
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.dead || c.kind === "egg") continue;
            var dx = c.x - x, dy = c.y - y;
            var rr = r + c.bumpR;
            if (dx * dx + dy * dy < rr * rr) killUnit(c);
        }
    }

    function setGameSpeed(n) {
        gameSpeed = parseFloat(n) || 1;
    }

    function setUnitScale(n) {
        unitScale = parseFloat(n) || 1;
        applyUnitScale();
    }

    function init() {
        canvas = document.getElementById("swarm");
        if (!canvas || !canvas.getContext) return;
        canvas.width = W;
        canvas.height = H;
        ctx = canvas.getContext("2d");
        loadFrames(function () {
            setCount(SETTINGS.unitCount || MAX_LINGS);
            start();
        });
    }

    return { init: init, start: start, stop: stop, setCount: setCount, killNear: killNear, setGameSpeed: setGameSpeed, setUnitScale: setUnitScale, TUNING: TUNING,
             debugUnits: function () { return units; } };
})();
