/* Clockling - battle swarm: lings/banes vs marines, egg morphs.
 * This file is the reference implementation of the game rules. The ESP32 firmware
 * (targets/esp32/src/sim.cpp) is a C++ port of it; keep the two in step.
 * Sprite art: images/ling0-3.png, bane0-3.png, eggA-C.png, marine_walk/new*.png.
 * ES5 on purpose: runs anywhere, no build step.
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
    var simT = 0, lastDeathT = 0;   /* sim clock; when anything last died (stalemate breaker) */
    var zergWipeT = 0;            /* zerg wiped out: countdown before eggs come back */
    var zergWasAlive = true;
    var growthMul = 1;            /* growth mode: caps x this, rising until a side is wiped out */
    var marinesWereAlive = false;
    var chillT = 0;              /* web: occasional idle zerg chatter */
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
    var baseUnitScale = unitScale;   /* the Units slider, before growth mode */
    var assetBase = "images/";  /* sprite folder, relative to the page */

    /* ALL tunable numbers live in app/js/tuning-meta.js (single source of truth).
     * TUNING here is derived from TUNING_META.tuning defaults at load. */
    var TUNING = {};
    (function () {
        var m = (typeof TUNING_META !== "undefined" && TUNING_META && TUNING_META.tuning) || {};
        for (var k in m) {
            if (Object.prototype.hasOwnProperty.call(m, k)) TUNING[k] = m[k].default;
        }
    })();

    /* Dev/test hook: ?tun_<key>=<number> overrides (used by headless test harnesses). */
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

    /* battlefield size in logical px (clockling.html calls resize() to fit the window) */
    W = TUNING.mapW;
    H = TUNING.mapH;

    /* cached copies of TUNING, refreshed by computeTuning() whenever settings change */
    var MAX_LINGS, MAX_BANES, MAX_MARINES, LING_W, BANE_W, MARINE_W;
    var EGG_W, EGG_HP, EGG_DMG_MULT, LING_BUMP, BANE_BUMP, MARINE_BUMP, RESPAWN_T, RESPAWN_BATCH;
    var MARINE_LO, MARINE_HI, MARINE_LO2, MARINE_HI2, MARINE_INSET, SHOOT_DMG;
    var SHOOT_T, BITE_DMG, BITE_T, LING_HP, MARINE_HP, MARINE_HEAL_PCT;
    var MARINE_HEAL_T, MARINE_GROUP_W, MARINE_AWAY_W, MARINE_TURN, MARINE_FLEE_PCT, MARINE_KITE_FRAC;
    var LING_FLEE_MULT, MARINE_ENTRY_SPEED, MARINE_ENTRY_DEPTH, MARINE_SIGHT_MULT, MARINE_RANGE, ALLY_RADIUS;
    var ATTACK_GROUP_SIZE, MARINE_SCAN_RADIUS, MARINE_GROUP_RADIUS, ATTACK_ODDS, BERSERK_SPEED_MULT, BERSERK_BANES;
    var BERSERK_CATCH_RADIUS, BERSERK_UNTIL_DEATH, MARINE_WAVE_SIZE_LO, MARINE_WAVE_SIZE_HI, MARINE_RESPAWN_SIZE_LO, MARINE_RESPAWN_SIZE_HI;
    var MARINE_SPAWN_RATE, ZERG_SPEED, TERRAN_SPEED, MARINE_TACTICS, RETARGET_T, AIM_T;
    var MORPH_AGE, MORPH_CD, EGG_TIME_MIN, EGG_TIME_MAX, SPLAT_LIFE, SPLAT_BASE;
    var BANE_SPLASH_R, BANE_SPLASH_DMG, BANE_HP, CORPSE_LIFE, BANE_SPLAT_SCALE, BANE_SPLAT_LIFE_MULT;
    /* gore mode (SETTINGS.gore, on by default): splats and corpses linger.
     * Timings come from TUNING.goreSplatLife / TUNING.goreCorpseLife. */
    var GORE_SPLAT_LIFE, GORE_CORPSE_LIFE;
    var EGG_OVERLAP, EGG_MARINE_CLEAR;
    var STIM_DURATION, STIM_COOLDOWN, STIM_SPEED_MULT, STIM_HP_COST, STIM_REGEN_MULT, STIM_GROUP_MAX,
        STIM_REGROUP_DIST, MARINE_SKILL_TOP_SPEED;
    var LING_BOOST_MULT, LING_BOOST_TIME, LING_BOOST_CD, MARINE_KITE_SPEED, MARINE_MAX_TILT, MARINE_FLANK, MARINE_CTRL_MAX, MARINE_CTRL_SIZE,
        OV_JOIN, OV_SURROUND, OV_BANE_HOLD, OV_BANE_CLUMP, OV_BANE_MAX_HOLD, OV_FRONT_MORPH, OV_GUARD_BANES, OV_VANGUARD,
        ZERG_NO_HOPE, ZERG_SMARTS, ZERG_PATIENCE, ZERG_ALL_IN_ODDS, ZERG_STANDOFF, ZERG_CORNER,
        MARINE_UPRIGHT, MARINE_MICRO, MARINE_BANE_HUNT, MARINE_STIM_ATTACK, MARINE_SQUADS_ON, MARINE_FLANK_ON, MARINE_STIM_PUSH, MARINE_ELITE_KITE, STIM_REGEN_TIME;
    function splatLife() { return SETTINGS.gore !== false ? GORE_SPLAT_LIFE : SPLAT_LIFE; }
    function corpseLife() { return SETTINGS.gore !== false ? GORE_CORPSE_LIFE : CORPSE_LIFE; }
    var LING_SPLAT = ["#e02828", "#ff6b4a"];
    var BANE_SPLAT = ["#39ff14", "#b8ff4d"]; /* fluoro lime green */
    var MARINE_SPLAT = ["#d62020", "#ff6b4a"];

    /* commander brains: SETTINGS.zergBrain / terranBrain pick a trained brain
     * (app/js/brains.js, from tools/sim/train.js) whose decision settings are
     * layered over TUNING. 0 = Default (just TUNING). */
    var TB = TUNING;
    function brainTuning() {
        var out = {}, k;
        for (k in TUNING) out[k] = TUNING[k];
        var B = typeof BRAINS !== "undefined" ? BRAINS : null;
        if (!B) return out;
        var pick = [["zerg", SETTINGS.zergBrain], ["terran", SETTINGS.terranBrain]];
        for (var i = 0; i < pick.length; i++) {
            var set = B[pick[i][0]], name = +pick[i][1] === 1 ? "Trained" : null;
            if (!set || !name || !set[name]) continue;
            for (k in set[name]) if (k in out) out[k] = set[name][k];
        }
        return out;
    }

    function computeTuning() {
        TB = brainTuning();
        MAX_LINGS = TB.maxLings;
        MAX_BANES = TB.maxBanes;
        MAX_MARINES = TB.maxMarines;
        LING_W = TB.lingW;
        BANE_W = TB.baneW;
        MARINE_W = TB.marineW;
        EGG_W = TB.eggW;
        EGG_OVERLAP = Math.max(0, Math.min(1, TB.eggOverlap || 0));
        STIM_DURATION = TB.stimDuration;
        STIM_COOLDOWN = TB.stimCooldown;
        STIM_SPEED_MULT = TB.stimSpeedMult;
        STIM_HP_COST = Math.max(0, Math.min(0.95, TB.stimHpCost));
        STIM_REGEN_MULT = TB.stimRegenMult;
        STIM_REGEN_TIME = TB.stimRegenTime;
        STIM_GROUP_MAX = TB.stimGroupMax;
        STIM_REGROUP_DIST = TB.stimRegroupDist;
        MARINE_SKILL_TOP_SPEED = TB.marineSkillTopSpeed;
        LING_BOOST_MULT = TB.lingAttackBoostMult;
        MARINE_KITE_SPEED = TB.marineKiteSpeed;
        MARINE_MAX_TILT = (TB.marineMaxTilt || 0) * Math.PI / 180;
        MARINE_FLANK = (TB.marineFlankAngle || 0) * Math.PI / 180;
        MARINE_UPRIGHT = !!TB.marineUpright;
        MARINE_MICRO = !!TB.marineMicro;
        MARINE_BANE_HUNT = !!TB.marineBaneHunt;
        MARINE_STIM_ATTACK = !!TB.marineStimAttack;
        ZERG_SMARTS = !!TB.zergSmarts;
        ZERG_NO_HOPE = TB.zergNoHope === undefined ? 0.35 : +TB.zergNoHope;
        OV_JOIN = +TB.ovJoinRadius || 0;
        OV_SURROUND = (+TB.ovSurround || 0) * Math.PI / 180;
        OV_BANE_HOLD = !!TB.ovBaneHold;
        OV_BANE_CLUMP = Math.max(1, Math.round(+TB.ovBaneClump || 1));
        OV_BANE_MAX_HOLD = +TB.ovBaneMaxHold || 0;
        OV_FRONT_MORPH = +TB.ovFrontMorph || 0;
        OV_GUARD_BANES = !!TB.ovGuardBanes;
        OV_VANGUARD = +TB.ovBaneVanguard || 0;
        ZERG_PATIENCE = +TB.zergPatience || 0;
        ZERG_ALL_IN_ODDS = +TB.zergAllInOdds || 0;
        ZERG_STANDOFF = +TB.zergStandoff || 1.3;
        ZERG_CORNER = +TB.zergCornerDist || 0;
        MARINE_SQUADS_ON = !!TB.marineSquads;
        MARINE_FLANK_ON = !!TB.marineFlank;
        MARINE_STIM_PUSH = !!TB.marineStimPush;
        MARINE_ELITE_KITE = !!TB.marineEliteKite;
        MARINE_CTRL_MAX = Math.max(1, Math.round(TB.marineCtrlGroups || 1));
        MARINE_CTRL_SIZE = Math.max(1, Math.round(TB.marineCtrlGroupSize || 6));
        LING_BOOST_TIME = TB.lingAttackBoostTime;
        LING_BOOST_CD = TB.lingAttackBoostCooldown;
        EGG_MARINE_CLEAR = Math.max(0, TB.eggMarineClearance || 0);
        EGG_HP = TB.eggHp;
        EGG_DMG_MULT = TB.eggDamageMult;
        LING_BUMP = TB.lingBump;
        BANE_BUMP = TB.baneBump;
        MARINE_BUMP = TB.marineBump;
        RESPAWN_T = TB.respawnInterval;
        RESPAWN_BATCH = TB.respawnBatch;
        MARINE_LO = TB.marineWaveLo;
        MARINE_HI = TB.marineWaveHi;
        MARINE_LO2 = TB.marineRespawnLo;
        MARINE_HI2 = TB.marineRespawnHi;
        MARINE_INSET = TB.marineSpawnInset;
        SHOOT_DMG = TB.marineShootDamage;
        SHOOT_T = TB.marineShootInterval;
        BITE_DMG = TB.lingBiteDamage;
        BITE_T = TB.lingBiteInterval;
        LING_HP = TB.lingHp;
        MARINE_HP = TB.marineHp;
        MARINE_HEAL_PCT = TB.marineHealPct;
        MARINE_HEAL_T = TB.marineHealInterval;
        MARINE_GROUP_W = TB.marineGroupWeight;
        MARINE_AWAY_W = TB.marineAwayWeight;
        MARINE_TURN = TB.marineTurnRate;
        MARINE_FLEE_PCT = TB.marineFleeHpPct;
        MARINE_KITE_FRAC = TB.marineKiteFrac;
        LING_FLEE_MULT = TB.lingFleeSpeedMult;
        MARINE_ENTRY_SPEED = TB.marineEntrySpeed;
        MARINE_ENTRY_DEPTH = TB.marineEntryDepth;
        MARINE_SIGHT_MULT = TB.marineSightMult;
        MARINE_RANGE = MARINE_W * TB.marineRangeMult;
        ALLY_RADIUS = TB.allyRadius;
        ATTACK_GROUP_SIZE = TB.attackGroupSize;
        MARINE_SCAN_RADIUS = TB.marineScanRadius;
        MARINE_GROUP_RADIUS = TB.marineGroupRadius;
        ATTACK_ODDS = TB.attackOdds;
        BERSERK_SPEED_MULT = TB.berserkSpeedMult;
        BERSERK_BANES = TB.berserkBanes;
        BERSERK_CATCH_RADIUS = TB.berserkCatchRadius;
        BERSERK_UNTIL_DEATH = TB.berserkUntilDeath;
        MARINE_WAVE_SIZE_LO = TB.marineWaveSizeLo;
        MARINE_WAVE_SIZE_HI = TB.marineWaveSizeHi;
        MARINE_RESPAWN_SIZE_LO = TB.marineRespawnSizeLo;
        MARINE_RESPAWN_SIZE_HI = TB.marineRespawnSizeHi;
        MARINE_SPAWN_RATE = TB.marineSpawnRateMult;
        ZERG_SPEED = TB.zergSpeed;
        TERRAN_SPEED = TB.terranSpeed;
        MARINE_TACTICS = TB.marineTactics;
        RETARGET_T = TB.retargetInterval;
        AIM_T = TB.aimInterval;
        MORPH_AGE = TB.morphAge;
        MORPH_CD = TB.morphCooldown;
        EGG_TIME_MIN = TB.eggTimeMin;
        EGG_TIME_MAX = TB.eggTimeMax;
        SPLAT_LIFE = TB.splatLife;
        SPLAT_BASE = TB.splatBase;
        BANE_SPLASH_R = TB.baneSplashR;
        BANE_SPLASH_DMG = TB.baneSplashDamage;
        BANE_HP = TB.baneHp;
        CORPSE_LIFE = TB.corpseLife;
        BANE_SPLAT_SCALE = TB.baneSplatScale;
        BANE_SPLAT_LIFE_MULT = TB.baneSplatLifeMult;
        GORE_SPLAT_LIFE = TB.goreSplatLife;
        GORE_CORPSE_LIFE = TB.goreCorpseLife;
        applyUnitScale();
    }

    /* scale unit population knobs together (the Units slider) */
    function applyUnitScale() {
        var unitScale = baseUnitScale * growthMul;   /* growth mode scales every cap */
        MAX_LINGS = Math.max(1, Math.round(TB.maxLings * unitScale));
        MAX_BANES = Math.max(1, Math.round(TB.maxBanes * unitScale));
        MAX_MARINES = Math.max(1, Math.round(TB.maxMarines * unitScale));
        BERSERK_BANES = Math.max(1, Math.round(TB.berserkBanes * unitScale));
        MARINE_WAVE_SIZE_LO = Math.max(1, Math.round(TB.marineWaveSizeLo * unitScale));
        MARINE_WAVE_SIZE_HI = Math.max(1, Math.round(TB.marineWaveSizeHi * unitScale));
        MARINE_RESPAWN_SIZE_LO = Math.max(1, Math.round(TB.marineRespawnSizeLo * unitScale));
        MARINE_RESPAWN_SIZE_HI = Math.max(1, Math.round(TB.marineRespawnSizeHi * unitScale));
        MARINE_SPAWN_RATE = Math.max(0.1, TB.marineSpawnRateMult * unitScale);
    }
    computeTuning();

    var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
        function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
    var caf = window.cancelAnimationFrame || window.webkitCancelAnimationFrame || clearTimeout;

    function rand(a, b) { return a + Math.random() * (b - a); }

    /* sounds: the page passes a handler via setSoundHandler(); the sim just names
     * events (lingChill, lingAttack, lingDie, baneDie, marineShoot, marineDie,
     * marineVoice). No handler = silent. */
    var soundFn = null;
    function sound(name) { if (soundFn) soundFn(name); }
    function setSoundHandler(fn) { soundFn = fn; }

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
        loadSet([assetBase + "ling0.png", assetBase + "ling1.png", assetBase + "ling2.png", assetBase + "ling3.png"], lingFrames, inc);
        loadSet([assetBase + "bane0.png", assetBase + "bane1.png", assetBase + "bane2.png", assetBase + "bane3.png"], baneFrames, inc);
        loadSet([assetBase + "eggA.png", assetBase + "eggB.png", assetBase + "eggC.png"], eggFrames, inc);
        var walkUrls = [];
        for (var w = 0; w < 6; w++) walkUrls.push(assetBase + "marine_walk0." + (w + 1) + ".png");
        loadSet(walkUrls, marineIdleFrames, inc);
        var atkUrls = [];
        for (var a = 0; a < 8; a++) atkUrls.push(assetBase + "marine_new" + a + ".png");
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
            want: 0, moveMul: 1, attacking: false, cluster: -1, fleeing: false,
            stalking: false, stalkT: 0, stalkDir: 1
        };
        c.want = c.heading;
        if (kind === "ling") {
            c.faceDir = -1; c.face = -1; c.w = LING_W; c.bumpR = LING_BUMP;
            c.speed = rand(26, 46); c.splatCol = LING_SPLAT;
            c.hp = LING_HP; c.attackCd = 0; c.healCd = 0; c.berserk = false;
            c.boostT = 0; c.boostCd = 0; c.wasAttacking = false;
        } else if (kind === "bane") {
            c.faceDir = 1; c.face = 1; c.w = BANE_W; c.bumpR = BANE_BUMP;
            c.speed = rand(24, 40); c.splatCol = BANE_SPLAT; c.splatScale = BANE_SPLAT_SCALE;
            c.hp = BANE_HP; c.healCd = 0; c.berserk = false;
        } else if (kind === "marine") {
            c.faceDir = -1; c.face = -1; c.w = MARINE_W; c.bumpR = MARINE_BUMP;
            c.speed = rand(16, 24); c.splatCol = MARINE_SPLAT; c.hp = MARINE_HP;
            c.splatScale = TUNING.marineSplatScale;
            c.shootCd = SHOOT_T; c.aim = c.heading; c.drawAng = 0; c.walkSide = 0; c.tiltAng = 0; c.wasIdle = true; c.leanBias = rand(-1, 1); c.healCd = 0; c.entered = false; c.shootTarget = null;
            c.flashT = 0; c.hitX = 0; c.hitY = 0; c.kills = 0;
            c.deployT = 0; c.deployX = 0; c.deployY = 0;
            c.stimT = 0; c.stimCd = 0; c.stimRegenT = 0; c.stimFxT = 0; c.stimFxAge = 0; c.combat = false; c.kitePhase = "shoot"; c.runT = 0; c.shootT = 0;
            c.runDir = null; c.regroupTo = null;
        } else if (kind === "egg") {
            c.w = EGG_W; c.bumpR = 12; c.speed = 0; c.t = 0; c.hatchMult = 1;
            c.hatchT = rand(EGG_TIME_MIN, EGG_TIME_MAX);
            c.hp = EGG_HP;
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
    /* sprite angle for a marine: its look angle, but leaning at most
     * marineMaxTilt from level so the feet stay pointing down (marineUpright
     * instead stands them upright whenever they aren't firing) */
    function marineDrawAng(c) {
        if (MARINE_UPRIGHT && typeof c.drawAng === "number") return c.drawAng;   /* marineUpright: own easing */
        var a = typeof c.smoothAim === "number" ? c.smoothAim : typeof c.aim === "number" ? c.aim : c.heading;
        var right = c.face === 1;
        var rel = right ? a : Math.PI - a;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        rel = Math.max(-MARINE_MAX_TILT, Math.min(MARINE_MAX_TILT, rel));
        return right ? rel : Math.PI - rel;
    }

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

    function nearestEgg(x, y) {
        var best = null, bd = 1e9;
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== "egg" || c.dead) continue;
            var dx = c.x - x, dy = c.y - y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }

    /* zerg smarts: circle the marine group at a standoff ring just outside their
     * range (stalkDir sets the way round), backing off if a marine gets inside it.
     * Marines advancing push the swarm toward walls, where it gets pinned and
     * commits (see updateSwarm). */
    function stalk(c, lo, hi) {
        var mc = marineCentroid(), m = nearestMarine(c.x, c.y);
        if (!mc || !m) { fallBack(c, lo, hi); return; }
        var ring = Math.max(threatRadius() * 1.05, MARINE_RANGE * ZERG_STANDOFF);
        var dm = dist(m, c.x, c.y);
        var ax, ay;
        if (dm < ring * 0.9) {
            ax = (c.x - m.x) / (dm || 1); ay = (c.y - m.y) / (dm || 1);   /* too close: back off */
        } else {
            var th = Math.atan2(c.y - mc.y, c.x - mc.x) + c.stalkDir * 0.45;
            var r = Math.max(ring, dist(mc, c.x, c.y) - (dm - ring));     /* keep the nearest marine at ring */
            var tx = Math.max(24, Math.min(W - 24, mc.x + Math.cos(th) * r));
            var ty = Math.max(24, Math.min(H - 24, mc.y + Math.sin(th) * r));
            ax = tx - c.x; ay = ty - c.y;
            var al = Math.sqrt(ax * ax + ay * ay) || 1;
            ax /= al; ay /= al;
        }
        c.want = Math.atan2(ay, ax);
        c.speed = rand(lo, hi) * 0.8;
        c.fleeing = false;
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
    /* where a marine wave enters (marineSpawnMode):
     *   0 far   - the edge farthest from the zerg, mirrored across the field
     *   1 near  - behind the marines already fighting (the edge closest to them
     *             that is farther from the zerg than they are), to reinforce
     *   2 smart - the terran strategist: reinforce while the marines in play are
     *             holding, land far away (and regroup there) when they're overrun */
    function pickSpawnEdge() {
        var zx = 0, zy = 0, zn = 0, mx = 0, my = 0, mn = 0, mhp = 0;
        for (var i = 0; i < units.length; i++) {
            var z = units[i];
            if (z.dead) continue;
            if (z.kind === "ling" || z.kind === "bane") { zx += z.x; zy += z.y; zn++; }
            else if (z.kind === "marine" && z.entered) { mx += z.x; my += z.y; mn++; mhp += z.hp; }
        }
        if (zn > 0) { zx /= zn; zy /= zn; } else { zx = rand(0, W); zy = rand(0, H); }
        var mode = Math.round(+TB.marineSpawnMode || 0), near = false;
        if (mn > 0 && mode >= 1) {
            mx /= mn; my /= mn;
            near = mode === 1;
            if (mode === 2) {
                /* holding = they out-supply the zerg around them and aren't badly hurt */
                var local = 0;
                for (i = 0; i < units.length; i++) {
                    var u = units[i];
                    if (u.dead || (u.kind !== "ling" && u.kind !== "bane")) continue;
                    if (dist(u, mx, my) < MARINE_RANGE * 1.5) local += u.kind === "bane" ? 1 : 0.5;
                }
                near = mn * 2 >= local && mhp / mn >= MARINE_HP * 0.4;
            }
        }
        var margin = 1.5 * MARINE_W, e;
        if (near) {
            /* the edge nearest the marines, scored so we come in behind them */
            var dm = [mx, W - mx, my, H - my], dz = [zx, W - zx, zy, H - zy], bs = -1e18;
            for (e = 0; e < 4; e++) {
                var sc = -dm[e] + (dz[e] > dm[e] ? 200 : 0) + dz[e] * 0.2;
                if (sc > bs) { bs = sc; waveEdge = e; }
            }
            waveAnchor = Math.max(margin, Math.min((waveEdge < 2 ? H : W) - margin, waveEdge < 2 ? my : mx));
            return;
        }
        var d = [zx, W - zx, zy, H - zy];
        waveEdge = 0;
        for (e = 1; e < 4; e++) if (d[e] > d[waveEdge]) waveEdge = e;
        var len = waveEdge < 2 ? H : W;
        var mirror = waveEdge < 2 ? H - zy : W - zx;
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
        /* arrival voiceline (the page throttles it and shares the voice channel) */
        sound("marineSpawn");
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
    /* how far from any marine the hive (and so every new egg) should be */
    function eggClearance() {
        return Math.max(threatRadius() * 1.1, EGG_MARINE_CLEAR * Math.min(W, H));
    }

    /* centroid of the live marines (null if none) */
    function marineCentroid() {
        var x = 0, y = 0, n = 0;
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== "marine" || c.dead || c.hp <= 0) continue;
            x += c.x; y += c.y; n++;
        }
        return n ? { x: x / n, y: y / n } : null;
    }

    function updateHive(zx, zy, zn) {
        var safe = eggClearance();
        if (eggN > 0 && nearestMarineDist(eggCx, eggCy) > safe) { hiveX = eggCx; hiveY = eggCy; return; }
        if (zn > 0 && nearestMarineDist(zx, zy) > safe) { hiveX = zx; hiveY = zy; return; }
        if (countKind("marine") === 0) {
            if (eggN > 0) { hiveX = eggCx; hiveY = eggCy; } else if (zn > 0) { hiveX = zx; hiveY = zy; }
            else { hiveX = W / 2; hiveY = H / 2; }
            return;
        }
        /* farthest spot from the nearest marine, nudged to the far side of the
         * marine group as a whole */
        var best = -1, mc = marineCentroid();
        for (var gi = 0; gi < 3; gi++) {
            for (var gj = 0; gj < 3; gj++) {
                var gx = W * (gi + 0.5) / 3, gy = H * (gj + 0.5) / 3;
                var gd = nearestMarineDist(gx, gy);
                if (mc) gd += 0.5 * Math.sqrt((gx - mc.x) * (gx - mc.x) + (gy - mc.y) * (gy - mc.y));
                if (gd > best) { best = gd; hiveX = gx; hiveY = gy; }
            }
        }
    }

    /* distance from (x,y) to the nearest live egg other than `self` */
    function nearestEggDist(x, y, self) {
        var bd = 1e18;
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c === self || c.kind !== "egg" || c.dead) continue;
            var dx = c.x - x, dy = c.y - y, d2 = dx * dx + dy * dy;
            if (d2 < bd) bd = d2;
        }
        return Math.sqrt(bd);
    }

    /* lay a new egg at the hive, so hatchlings start inside the swarm. Eggs keep
     * EGG_W * (1 - eggOverlap) apart and stay eggClearance() from marines; the
     * search ring grows outward until a spot fits, else the best spot found wins. */
    function placeEggAtHive(egg) {
        var minD = EGG_W * (1 - EGG_OVERLAP), clear = eggClearance();
        var bx = hiveX, by = hiveY, bs = -1e9;
        for (var t = 0; t < 40; t++) {
            var a = rand(0, 6.283), r = rand(0, 22 + t * Math.max(4, minD * 0.5));
            var x = Math.max(16, Math.min(W - 16, hiveX + Math.cos(a) * r));
            var y = Math.max(16, Math.min(H - 16, hiveY + Math.sin(a) * r));
            var spacing = minD > 0 ? Math.min(1, nearestEggDist(x, y, egg) / minD) : 1;
            var safety = clear > 0 ? Math.min(1, nearestMarineDist(x, y) / clear) : 1;
            if (spacing >= 1 && safety >= 1) { bx = x; by = y; break; }
            var score = spacing * 2 + safety - r * 0.001;   /* not stacking matters most */
            if (score > bs) { bs = score; bx = x; by = y; }
        }
        egg.x = bx;
        egg.y = by;
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

    /* heading that closes on (tx,ty) from the side instead of straight on: up to
     * marineFlankAngle off the direct line (scaled by skill), on the side that
     * walks more horizontally, kept with hysteresis so it doesn't flip-flop.
     * Marines walking straight up/down at the zerg end up stacked and facing
     * each other; coming in on a slant spreads them along a firing line. */
    function marineFlankDir(c, tx, ty, S) {
        var a = Math.atan2(ty - c.y, tx - c.x);
        var f = MARINE_FLANK * lerp(0.4, 1, S);
        var ca = Math.abs(Math.cos(a + f)), cb = Math.abs(Math.cos(a - f));
        if (!c.flankSide) c.flankSide = ca >= cb ? 1 : -1;
        else if (c.flankSide === 1 && cb > ca + 0.2) c.flankSide = -1;
        else if (c.flankSide === -1 && ca > cb + 0.2) c.flankSide = 1;
        return a + c.flankSide * f;
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
    /* a holding baneling goes when lings are biting the target marine and
     * ovBaneClump+ marines stand inside its splash, when the marines are on
     * top of it anyway, or after ovBaneMaxHold s of waiting */
    function baneGoTime(c, m, dt) {
        c.holdT = (c.holdT || 0) + dt;
        if (dist(m, c.x, c.y) < MARINE_RANGE * 0.45) return true;
        var engaged = false, arrived = false, clump = 0, contact = MARINE_BUMP + LING_BUMP + 8;
        for (var i = 0; i < units.length; i++) {
            var u = units[i];
            if (u.dead) continue;
            if (u.kind === "marine" && dist(u, m.x, m.y) < BANE_SPLASH_R) clump++;
            else if (u.kind === "ling") {
                var ld = dist(u, m.x, m.y);
                if (ld < MARINE_RANGE * 0.6) arrived = true;
                if (!engaged && ld < MARINE_RANGE * 1.5) {
                    var lm = nearestMarine(u.x, u.y);
                    if (lm && dist(lm, u.x, u.y) < contact) engaged = true;   /* biting someone in the target group */
                }
            }
        }
        /* lings are in: every bane nearby sends it at full speed */
        if (engaged) return true;
        if (arrived && clump >= OV_BANE_CLUMP) return true;
        return c.holdT >= OV_BANE_MAX_HOLD && arrived;   /* the hold limit only releases once lings got there */
    }

    function charge(c, m, lo, hi, mult) {
        var a = Math.atan2(m.y - c.y, m.x - c.x) + rand(-0.15, 0.15);
        /* Overmind surround: each ling comes in on its own arc (flankOff), which
         * closes as it gets near, so the swarm wraps around the marines */
        if (OV_SURROUND > 0 && c.kind === "ling" && zergSkill() >= 0.5) {
            if (c.flankOff === undefined) c.flankOff = rand(-1, 1);
            var d = dist(m, c.x, c.y);
            a += c.flankOff * OV_SURROUND * Math.min(1, Math.max(0, (d - MARINE_RANGE * 0.4) / (MARINE_RANGE * 1.5)));
        }
        c.want = a;
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
        } else if (z && (!outnumbered || stalemate())) {
            /* advance on the nearest zerg: on a flank, or straight in when we
             * overwhelm them (3:1 supply) */
            var overwhelm = countKind("marine") > 3 * (countKind("ling") + countKind("bane")) * 0.5;
            if (overwhelm || !MARINE_FLANK_ON) marineSteerToward(c, z.x, z.y, false);
            else c.want = marineFlankDir(c, z.x, z.y, marineSkill());
            c.moveMul = 0.8;
        } else {
            /* heavily outnumbered: hold with the squad */
            if (sq) marineSteerToward(c, sq.x, sq.y, false);
            c.moveMul = 0.3;
        }
    }

    /* ---------------------------------------------------------------- marine AI
     * SETTINGS.marineSkill (0..1) scales how well marines play:
     *   0    stand still and shoot (they just die)
     *   0.5  the old tactics, plus basic stutter-step kiting
     *   1    fast reactions, tight unison kiting, wall-aware escapes, bane focus,
     *        quick feet: one marine can dance around a whole swarm
     * Combat is run per local group (marines within marineGroupRadius) so a
     * squad kites in unison: RUN (face away, no shooting) until the zerg are
     * outrun, then SHOOT (turn back, stand, fire), repeat. Stim (stimDuration s,
     * stimCooldown s, costs stimHpCost of current HP, stimSpeedMult speed,
     * stimRegenMult regen) is used by small groups that can no longer stand
     * and fight, and by lone marines running back to the main marine mob. */
    function marineSkill() {
        var s = +SETTINGS.marineSkill;
        return isNaN(s) ? 0.6 : Math.max(0, Math.min(1, s));
    }
    function lerp(a, b, t) { return a + (b - a) * t; }
    /* SETTINGS.zergSkill (0..1): how well the Overmind plays. 0 = every swarm
     * piles in at once; from 0.3 only nearby backup counts, from 0.5 lings
     * surround and banes wait in the pack for a clumped, engaged target; morphs
     * move to the front line with skill (see updateSwarm / step / morph) */
    function zergSkill() {
        var s = +SETTINGS.zergSkill;
        return isNaN(s) ? 0.5 : Math.max(0, Math.min(1, s));
    }
    /* movement multiplier from skill: slow and clumsy below 0.5, light-footed above */
    function marineFootwork(S) {
        return S < 0.5 ? lerp(0.6, 1, S / 0.5) : lerp(1, MARINE_SKILL_TOP_SPEED, (S - 0.5) / 0.5);
    }
    /* kiting speed: marineKiteSpeed for green marines, rising to full footwork at
     * max skill, so elite marines can actually open a gap on chasing lings */
    function marineKiteMul(S) { return MARINE_ELITE_KITE ? lerp(MARINE_KITE_SPEED, 1, S * S) : MARINE_KITE_SPEED; }
    function marineTurnRate(S) {
        return S < 0.5 ? MARINE_TURN * (0.6 + 0.8 * S) : lerp(MARINE_TURN, 0.92, (S - 0.5) / 0.5);
    }

    /* px/s a zerg unit is moving at, including the attack burst. Berserk lings
     * already charge at berserkSpeedMult, so they get the larger of the two. */
    function zergMoveSpeed(z) {
        var v = z.speed * ZERG_SPEED;
        if (z.kind === "ling" && z.boostT > 0 && z.attacking) {
            v *= z.berserk ? Math.max(1, LING_BOOST_MULT / BERSERK_SPEED_MULT) : LING_BOOST_MULT;
        }
        return v;
    }

    function nearestKind(x, y, kind) {
        var best = null, bd = 1e18;
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind !== kind || c.dead) continue;
            var dx = c.x - x, dy = c.y - y, d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
        }
        return best;
    }
    function dist(a, x, y) { var dx = a.x - x, dy = a.y - y; return Math.sqrt(dx * dx + dy * dy); }

    /* a stim costs stimHpCost of MAX HP, so it can kill: skilled marines keep a
     * margin, green ones may stim themselves to death */
    function canAffordStim(m, S) {
        return m.hp - MARINE_HP * STIM_HP_COST > MARINE_HP * lerp(-0.05, 0.15, S);
    }
    function stimMarine(m, S) {
        if (m.stimT > 0 || m.stimCd > 0) return false;
        if (!canAffordStim(m, S)) return false;   /* too hurt to pay for it */
        m.hp -= MARINE_HP * STIM_HP_COST;
        if (m.hp <= 0) stats.stimDeaths++;
        m.stimT = STIM_DURATION;
        m.stimCd = STIM_COOLDOWN;
        m.stimRegenT = Math.max(STIM_DURATION, STIM_REGEN_TIME);
        m.stimFxT = STIM_DURATION;   /* the glow lasts exactly as long as the stim */
        m.stimFxAge = 0;
        stats.stims++;
        return true;
    }

    /* best direction to run from (cx,cy): sample `nd` headings, keep the one whose
     * look-ahead point is farthest from the closest zerg (banes count double),
     * clear of the walls, and (when given) heading toward `goal` */
    function marineEscapeDir(cx, cy, S, goal, prev, zs, sibs, stimmed) {
        var nd = 8 + Math.round(16 * S);
        var look = 40 + 80 * S;
        var best = prev, bs = -1e18;
        var ga = goal ? Math.atan2(goal.y - cy, goal.x - cx) : 0;
        for (var k = 0; k < nd; k++) {
            var a = k / nd * 6.283 + (prev || 0) * 0;
            var px = cx + Math.cos(a) * look, py = cy + Math.sin(a) * look;
            var clear = 400, crowd = 0;
            for (var i = 0; i < zs.length; i++) {
                var z = zs[i];
                var d = Math.sqrt((z.x - px) * (z.x - px) + (z.y - py) * (z.y - py));
                var w = z.kind === "bane" ? 2 : 1;
                if (d / w < clear) clear = d / w;
                crowd += w / Math.max(12, d);
            }
            var m = Math.min(px, W - px, py, H - py);
            var score = clear - crowd * 8 - Math.max(0, 70 - m) * 4;
            if (goal) score += Math.cos(a - ga) * (stimmed ? 180 : 70);   /* stimmed: punch through to the mob */
            /* split kiting: run away from sibling control groups to pull the swarm apart */
            if (sibs) for (var si = 0; si < sibs.length; si++) {
                score += Math.min(160, Math.sqrt((px - sibs[si].cx) * (px - sibs[si].cx) + (py - sibs[si].cy) * (py - sibs[si].cy))) * 0.35;
            }
            if (prev !== null && prev !== undefined) score += Math.cos(a - prev) * 12 * S;
            if (score > bs) { bs = score; best = a; }
        }
        return best + rand(-1, 1) * (1 - S) * 0.5;
    }

    /* group marines (union of marines within r); each group is an array */
    function marineGroups(ms, r) {
        var parent = ms.map(function (_, i) { return i; });
        function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
        for (var i = 0; i < ms.length; i++) {
            for (var j = i + 1; j < ms.length; j++) {
                var dx = ms[i].x - ms[j].x, dy = ms[i].y - ms[j].y;
                if (dx * dx + dy * dy < r * r) parent[find(i)] = find(j);
            }
        }
        var map = {}, out = [];
        for (var k = 0; k < ms.length; k++) {
            var root = find(k);
            if (!map[root]) { map[root] = []; out.push(map[root]); }
            map[root].push(ms[k]);
        }
        return out;
    }

    /* split one chain of marines into `k` control groups: balanced k-means on
     * position, seeded from last tick's groups (c.cg) and biased to keep each
     * marine where it was, so groups hold together instead of reshuffling */
    function marineCtrlGroups(chain, k) {
        var n = chain.length, i, g;
        if (k <= 1 || n < 2) { for (i = 0; i < n; i++) chain[i].cg = 0; return [chain]; }
        var cap = Math.ceil(n / k) + 1, cent = [];
        for (g = 0; g < k; g++) {
            var sx = 0, sy = 0, c = 0;
            for (i = 0; i < n; i++) if (chain[i].cg === g) { sx += chain[i].x; sy += chain[i].y; c++; }
            cent.push(c ? { x: sx / c, y: sy / c } : null);
        }
        for (g = 0; g < k; g++) {
            if (cent[g]) continue;
            /* empty group: seed it with the marine farthest from every other seed */
            var bi = 0, bd = -1;
            for (i = 0; i < n; i++) {
                var md = 1e18;
                for (var h = 0; h < k; h++) if (cent[h]) md = Math.min(md, (chain[i].x - cent[h].x) * (chain[i].x - cent[h].x) + (chain[i].y - cent[h].y) * (chain[i].y - cent[h].y));
                if (md === 1e18) md = chain[i].x + chain[i].y * 1e-3;
                if (md > bd) { bd = md; bi = i; }
            }
            cent[g] = { x: chain[bi].x, y: chain[bi].y };
        }
        var label = [];
        for (var pass = 0; pass < 2; pass++) {
            var pairs = [];
            for (i = 0; i < n; i++) {
                for (g = 0; g < k; g++) {
                    var d = Math.sqrt((chain[i].x - cent[g].x) * (chain[i].x - cent[g].x) + (chain[i].y - cent[g].y) * (chain[i].y - cent[g].y));
                    if (chain[i].cg === g) d -= MARINE_GROUP_RADIUS * 0.5;   /* stickiness */
                    pairs.push([d, i, g]);
                }
            }
            pairs.sort(function (p, q) { return p[0] - q[0]; });
            var size = [];
            for (g = 0; g < k; g++) size.push(0);
            label = [];
            for (var pi = 0; pi < pairs.length; pi++) {
                var pr = pairs[pi];
                if (label[pr[1]] !== undefined || size[pr[2]] >= cap) continue;
                label[pr[1]] = pr[2]; size[pr[2]]++;
            }
            for (g = 0; g < k; g++) {
                var ax = 0, ay = 0, an = 0;
                for (i = 0; i < n; i++) if (label[i] === g) { ax += chain[i].x; ay += chain[i].y; an++; }
                if (an) cent[g] = { x: ax / an, y: ay / an };
            }
        }
        var out = [];
        for (g = 0; g < k; g++) out.push([]);
        for (i = 0; i < n; i++) { chain[i].cg = label[i]; out[label[i]].push(chain[i]); }
        return out.filter(function (o) { return o.length; });
    }

    /* Overmind (ovGuardBanes, zergSkill 40%+): a bane being hunted calls up to 3
     * idle lings nearby; they step between it and the hunter to draw its fire,
     * and peel off below half HP - a distraction, not a sacrifice */
    function callBaneGuards(bane, hunter, zs) {
        if (!OV_GUARD_BANES || zergSkill() < 0.4) return;
        var cands = [];
        for (var i = 0; i < zs.length; i++) {
            var l = zs[i];
            if (l.kind !== "ling" || l.berserk) continue;
            var d = dist(l, bane.x, bane.y);
            if (d < MARINE_RANGE * 3) cands.push([d, l]);
        }
        cands.sort(function (a, b) { return a[0] - b[0]; });
        /* a bane is worth gas, lings are cheap: up to 4 lings charge the hunter to
         * soak its fire while the bane goes for the closest marine. No lings to
         * help: the bane backs off instead of dying for nothing */
        for (i = 0; i < Math.min(4, cands.length); i++) {
            var g = cands[i][1];
            g.guardBane = bane; g.guardFrom = hunter; g.guardT = 1.5;
        }
        if (cands.length) bane.berserk = true;
        else bane.huntedT = 1.5;
    }

    var marineCtrlT = 0;
    function marineController(dt) {
        var S = marineSkill();
        marineCtrlT -= dt;
        if (marineCtrlT > 0) return;
        marineCtrlT = lerp(0.5, 0.05, S);

        var ms = [], zs = [];
        for (var i = 0; i < units.length; i++) {
            var u = units[i];
            if (u.dead) continue;
            if (u.kind === "marine") {
                if (u.entered && u.deployT <= 0) ms.push(u); else u.combat = false;
            } else if (u.kind === "ling" || u.kind === "bane") zs.push(u);
        }
        if (!ms.length) return;

        var R = MARINE_RANGE;
        var kiteIn = R * lerp(0.3, 0.7, S);     /* start running when zerg get this close */
        var kiteOut = R * lerp(0.45, 0.9, S);   /* turn and shoot again once they're this far */
        var baneIn = R * lerp(0.35, 1.0, S);    /* banes: run earlier */
        var baneOut = R * lerp(0.5, 1.15, S);
        var maxRun = lerp(0.8, 1.6, S);         /* never run longer than this without a volley */
        var minShoot = SHOOT_T * 1.05;          /* get a shot off before running again */

        /* below 0.4 skill marines act alone; above it they move as squads. A
         * "chain" is every marine linked within reach of another (the mob); skilled
         * marines split their chain into small squads that kite independently */
        var chains = S < 0.4 ? ms.map(function (m) { return [m]; }) : marineGroups(ms, MARINE_GROUP_RADIUS * 1.3);
        var mob = null;
        for (var g = 0; g < chains.length; g++) if (!mob || chains[g].length > mob.length) mob = chains[g];
        /* control groups: a big mob splits into up to marineCtrlGroups groups of
         * about marineCtrlGroupSize (2 from half skill, all of them from 75%) */
        var ctrlMax = !MARINE_SQUADS_ON || S < 0.5 ? 1 : S < 0.75 ? Math.min(2, MARINE_CTRL_MAX) : MARINE_CTRL_MAX;
        var groups = [];
        for (g = 0; g < chains.length; g++) {
            var k = S < 0.4 ? 1 : Math.max(1, Math.min(ctrlMax, Math.floor(chains[g].length / MARINE_CTRL_SIZE)));
            var sq = S < 0.4 ? [chains[g]] : marineCtrlGroups(chains[g], k);
            chains[g].runCount = 0;
            for (var sqi = 0; sqi < sq.length; sqi++) {
                var gr = sq[sqi], gx = 0, gy = 0, wasRun = false;
                for (var gm = 0; gm < gr.length; gm++) { gx += gr[gm].x; gy += gr[gm].y; if (gr[gm].combat && gr[gm].kitePhase === "run") wasRun = true; }
                gr.chain = chains[g]; gr.cx = gx / gr.length; gr.cy = gy / gr.length; gr.wasRun = wasRun;
                if (wasRun) chains[g].runCount++;
                groups.push(gr);
            }
            chains[g].groups = sq;
        }
        var mobC = null;
        if (mob) {
            mobC = { x: 0, y: 0 };
            for (var q = 0; q < mob.length; q++) { mobC.x += mob[q].x; mobC.y += mob[q].y; }
            mobC.x /= mob.length; mobC.y /= mob.length;
        }

        for (g = 0; g < groups.length; g++) {
            var grp = groups[g], n = grp.length;
            var cx = 0, cy = 0, near = 1e9, nearB = 1e9, allClear = true, running = false, runT = 0, shootT = 1e9;
            var allStim = true, minHp = 1e9;
            var myV = 1e9, stimV = 1e9, stimReady = true, feet = marineFootwork(S) * marineKiteMul(S);
            for (var a = 0; a < n; a++) {
                var m = grp[a];
                cx += m.x; cy += m.y;
                /* slowest member sets the squad's pace */
                var base = m.speed * TERRAN_SPEED * feet;
                myV = Math.min(myV, base * (m.stimT > 0 ? STIM_SPEED_MULT : 1));
                stimV = Math.min(stimV, base * STIM_SPEED_MULT);
                if (m.stimT <= 0 && (m.stimCd > 0 || !canAffordStim(m, S))) stimReady = false;
                if (m.stimT <= 0) allStim = false;
                minHp = Math.min(minHp, m.hp);
                var z = nearestZerg(m.x, m.y), b = nearestKind(m.x, m.y, "bane");
                var dz = z ? dist(z, m.x, m.y) : 1e9, db = b ? dist(b, m.x, m.y) : 1e9;
                if (dz < near) near = dz;
                if (db < nearB) nearB = db;
                if (dz < kiteOut || db < baneOut) allClear = false;
                if (m.kitePhase === "run") { running = true; runT = Math.max(runT, m.runT || 0); }
                else shootT = Math.min(shootT, m.shootT || 0);
            }
            cx /= n; cy /= n;

            /* zerg near this group, and whether it can still stand and fight */
            var local = [], strength = 0, threatV = 0, baneHp = 0, baneEta = 1e9;
            for (var zi = 0; zi < zs.length; zi++) {
                var zz = zs[zi];
                var dd = dist(zz, cx, cy);
                if (zz.kind === "bane" && dd < R * 1.4) {
                    baneHp += Math.max(0, zz.hp);
                    baneEta = Math.min(baneEta, Math.max(0, dd - MARINE_GROUP_RADIUS * 0.5) / Math.max(1, zergMoveSpeed(zz)));
                }
                if (dd < R * 2.5) { local.push(zz); if (dd < R * 1.5) strength += zz.kind === "bane" ? 2 : 1; }
                if (dd < R * 1.3) threatV = Math.max(threatV, zergMoveSpeed(zz));   /* the fastest chaser */
            }
            /* kite band from the chasers' speed: start running while there is still
             * room to turn away, run until there is room for another volley */
            if (threatV > 0) {
                var contact = MARINE_BUMP + LING_BUMP + 6;
                kiteIn = Math.max(kiteIn * 0.6, contact + threatV * (SHOOT_T * lerp(2, 1.1, S) + lerp(0.4, 0.12, S)));
                kiteOut = kiteIn + threatV * SHOOT_T * lerp(1.6, 1.1, S);
            }
            /* running only pays if it actually opens a gap; otherwise hold and shoot */
            var canOutrun = myV > threatV * 1.05;
            var canStimOutrun = S >= 0.25 && stimReady && stimV > threatV * 1.05;
            /* banes: green marines run from any bane close by; skilled ones only when
             * the squad can't shoot them down before they arrive */
            var killTime = baneHp / Math.max(1, n * SHOOT_DMG / SHOOT_T);
            var baneDanger = S < 0.5 ? nearB < baneIn : (nearB < baneIn && baneEta < killTime * lerp(1.6, 1.15, (S - 0.5) / 0.5));
            /* supply (ling 0.5, bane 1) the group can take on standing; skilled
             * marines know a tight squad can hold against more */
            var outmatched = strength * 0.5 > n * lerp(2.5, 4, S);

            /* a lone marine / pair far from the main mob runs back to it */
            var regroup = null;
            var cn = grp.chain.length;
            if (S >= 0.25 && mob && mob !== grp.chain && cn <= 2 && mob.length >= Math.max(3, cn + 1)) {
                var md = Math.sqrt((mobC.x - cx) * (mobC.x - cx) + (mobC.y - cy) * (mobC.y - cy));
                if (md > STIM_REGROUP_DIST * Math.min(W, H)) regroup = mobC;
            }

            /* bane hunt (marineBaneHunt, 75%+ skill): a baneling in the open with no
             * lings near it or us is free kills - stim (if affordable) and run it
             * down before it can reach anyone */
            var hunt = null;
            if (MARINE_BANE_HUNT && S >= 0.6 && nearB < R * 2.2) {
                var hb = null, hbd = 1e9;
                for (zi = 0; zi < zs.length; zi++) {
                    /* any bane that isn't charging (in the open, or holding among us) */
                    if (zs[zi].kind !== "bane" || zs[zi].berserk) continue;
                    var hd = dist(zs[zi], cx, cy);
                    if (hd < hbd) { hbd = hd; hb = zs[zi]; }
                }
                var escort = false;
                for (zi = 0; hb && zi < zs.length; zi++) {
                    if (zs[zi].kind !== "ling") continue;
                    if (dist(zs[zi], hb.x, hb.y) < R * 0.8 || dist(zs[zi], cx, cy) < R * 1.2) { escort = true; break; }
                }
                if (hb && !escort) hunt = hb;
            }
            /* one or two hunters (the closest healthy marines) take the initiative;
             * the rest of the group carries on as normal */
            for (a = 0; a < n; a++) grp[a].huntTarget = null;
            if (hunt) {
                var ranked = grp.slice().sort(function (p, q) {
                    return (dist(hunt, p.x, p.y) - p.hp) - (dist(hunt, q.x, q.y) - q.hp);   /* close and healthy */
                });
                var hunters = ranked.slice(0, n >= 3 ? 2 : 1);
                for (var hi = 0; hi < hunters.length; hi++) {
                    var hunter = hunters[hi];
                    if (hunter.kitePhase !== "shoot") { hunter.runT = 0; hunter.shootT = 0; }
                    hunter.kitePhase = "shoot"; hunter.combat = true; hunter.regroupTo = null; hunter.huntTarget = hunt;
                    /* stim forward to catch it (or finish it fast) if we can afford it */
                    if (dist(hunt, hunter.x, hunter.y) > BANE_SPLASH_R * 2.5) stimMarine(hunter, S);
                }
                callBaneGuards(hunt, hunters[0], zs);
                if (hunters.length >= n) continue;
                for (hi = 0; hi < hunters.length; hi++) grp.splice(grp.indexOf(hunters[hi]), 1);   /* in place: keeps the group's chain / centre */
                n = grp.length;
            }
            var combat = near < R * 1.25 || nearB < R * 1.4;
            if (!combat) {
                for (a = 0; a < n; a++) { grp[a].combat = false; grp[a].kitePhase = "shoot"; grp[a].regroupTo = regroup; }
                continue;
            }

            /* stim: small groups that can no longer stand and fight, banes on top
             * of them, or a lone marine running back to the mob */
            /* (group size here is the whole chain: a squad split off a big mob isn't "small") */
            var stimReason = (cn <= STIM_GROUP_MAX && outmatched) ||
                             (cn <= STIM_GROUP_MAX && baneDanger) ||
                             (regroup && near < R * 1.25);
            var stimNow = false;

            var phase = running ? "run" : "shoot";
            if (S < 0.15) phase = "shoot";                          /* too green to kite */
            else if (phase === "shoot") {
                /* green marines back off from anything close; skilled squads only
                 * give ground when they can't win standing (outmatched or hurt) */
                /* hurt only moves a small group; a big squad holds while its wounded
                 * shuffle behind (see marineCombatSteer) */
                var hurt = false;
                if (cn <= STIM_GROUP_MAX) for (a = 0; a < n; a++) if (grp[a].hp < MARINE_HP * 0.5) hurt = true;
                /* elite marines (0.75+) stutter-step whenever the lings close in:
                 * kiting is free damage when you can outrun them */
                var godmode = MARINE_STIM_PUSH && S >= 0.75 && allStim && !outmatched;   /* stimmed elite: stay in their face */
                var mustKite = near < kiteIn * (godmode ? 0.75 : 1) && (S < 0.5 || (MARINE_ELITE_KITE && S >= 0.75) || outmatched || hurt);
                var threatened = (mustKite || baneDanger || regroup) && (shootT >= minShoot || regroup);
                /* split kiting: while sibling control groups backstep (up to half the
                 * groups at once), this one keeps firing to cover them (the chasers string out after the runners), then
                 * they swap - unless the lings are right on top of us */
                var sibRun = grp.chain.runCount - (grp.wasRun ? 1 : 0);
                var runCap = Math.max(1, Math.floor((grp.chain.groups ? grp.chain.groups.length : 1) / 2));
                if (threatened && sibRun >= runCap && !allStim && !baneDanger && !regroup && near > kiteIn * 0.5) threatened = false;
                if (threatened) {
                    if (canOutrun) { phase = "run"; runT = 0; }
                    else if (canStimOutrun && stimReason && Math.random() < lerp(0.4, 1, S)) {
                        phase = "run"; runT = 0; stimNow = true;
                    }
                }
            } else if ((!canOutrun && !allStim) || ((allClear || runT > maxRun) && !(regroup && outmatched))) {
                phase = "shoot";   /* gap opened (or they're catching up): turn and fire */
            }
            /* stim attack (marineStimAttack): a healthy group of 3+ in a fight it can
             * win stims together and pushes in hard (marineStimPush moves it) */
            if (!stimNow && MARINE_STIM_ATTACK && S >= 0.6 && phase === "shoot" && n >= 3 && !outmatched && !baneDanger &&
                stimReady && !allStim && minHp >= MARINE_HP * 0.8 && strength >= n * 1.5 && near < R * 1.1) stimNow = true;
            if (stimNow) for (a = 0; a < n; a++) stimMarine(grp[a], S);

            var sibs = [];
            if (grp.chain.groups) for (var sgi = 0; sgi < grp.chain.groups.length; sgi++) if (grp.chain.groups[sgi] !== grp) sibs.push(grp.chain.groups[sgi]);
            var dir = phase === "run" ? marineEscapeDir(cx, cy, S, regroup, grp[0].runDir, local, sibs, allStim) : null;
            if (phase === "run" && !grp.wasRun) grp.chain.runCount++;
            for (a = 0; a < n; a++) {
                var mm = grp[a];
                if (mm.kitePhase !== phase) { mm.runT = 0; mm.shootT = 0; }
                mm.kitePhase = phase;
                mm.combat = true;
                mm.regroupTo = regroup;
                if (dir !== null) {
                    /* run together: shared heading, pulled back toward the group centre */
                    var ox = cx - mm.x, oy = cy - mm.y, od = Math.sqrt(ox * ox + oy * oy);
                    var vx = Math.cos(dir), vy = Math.sin(dir);
                    if (od > MARINE_GROUP_RADIUS * 0.6) { vx += ox / od * 0.4; vy += oy / od * 0.4; }
                    mm.runDir = Math.atan2(vy, vx);
                }
            }
        }
    }

    /* per-marine micro, the way SC2 bots play marines (python-sc2 arcade_bot):
     * fire when the weapon is ready; while it cools down with zerg in range, take
     * a short step to the nearby spot farthest from them (stutter-step), then turn
     * and fire again. Banes close by: run from them and away from the nearest
     * marine (the "marine split"), so one bane catches as few marines as possible.
     * Returns true when it set the move. */
    function marineMicro(c, S) {
        var R = MARINE_RANGE, z = nearestZerg(c.x, c.y);
        if (!z) return false;
        var b = nearestKind(c.x, c.y, "bane"), bd = b ? dist(b, c.x, c.y) : 1e9;
        if (b && bd < BANE_SPLASH_R * lerp(1.5, 3, S)) {
            var om = nearestOtherMarine(c), od = om ? dist(om, c.x, c.y) : 1e9;
            var sx = (c.x - b.x) / (bd || 1) * 2, sy = (c.y - b.y) / (bd || 1) * 2;
            if (od < BANE_SPLASH_R * 2) { sx += (c.x - om.x) / (od || 1); sy += (c.y - om.y) / (od || 1); }
            c.want = Math.atan2(sy, sx);
            c.moveMul = 1;
            return true;
        }
        var zd = dist(z, c.x, c.y);
        var close = R * lerp(0.55, 0.85, (S - 0.5) / 0.5);   /* keep the zerg out past this */
        var cooling = c.shootCd > SHOOT_T * 0.25;            /* just fired: free time to move */
        if (zd < close && cooling) {
            /* stutter-step: of 8 short steps, the one farthest from the zerg near us
             * (their centre), off the walls */
            var cx = 0, cy = 0, n = 0;
            for (var i = 0; i < units.length; i++) {
                var u = units[i];
                if (u.dead || (u.kind !== "ling" && u.kind !== "bane")) continue;
                if (dist(u, c.x, c.y) < R) { cx += u.x; cy += u.y; n++; }
            }
            if (!n) { cx = z.x; cy = z.y; n = 1; } else { cx /= n; cy /= n; }
            var step = R * 0.3, best = 0, bs = -1e18;
            for (var k = 0; k < 8; k++) {
                var a = k / 8 * 6.283, px = c.x + Math.cos(a) * step, py = c.y + Math.sin(a) * step;
                var sc = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) - Math.max(0, 60 - Math.min(px, W - px, py, H - py)) * 3;
                if (sc > bs) { bs = sc; best = a; }
            }
            c.want = best;
            c.moveMul = 1;
            return true;
        }
        return false;
    }

    /* per-marine steering from the controller's decision (combat only) */
    function marineCombatSteer(c, S) {
        if (c.kitePhase === "run") {
            c.want = c.runDir;
            c.moveMul = 1;
            return;
        }
        /* SHOOT: stand and fire. Skilled marines spread out against banelings so
         * one bane can't catch several of them in its splash, and a badly hurt one
         * steps back behind its squad while still shooting */
        c.moveMul = 0;
        /* a stimmed marine never stands still: kite back from zerg that are close,
         * push in on ones out past 65% range, strafe in between */
        if (c.stimT > 0 && !c.huntTarget) {
            var sz = nearestZerg(c.x, c.y);
            if (sz) {
                var szd = dist(sz, c.x, c.y);
                if (szd < MARINE_RANGE * 0.55) marineSteerToward(c, sz.x, sz.y, true);
                else if (szd > MARINE_RANGE * 0.65) c.want = MARINE_FLANK_ON ? marineFlankDir(c, sz.x, sz.y, S) : Math.atan2(sz.y - c.y, sz.x - c.x);
                else c.want = Math.atan2(sz.y - c.y, sz.x - c.x) + Math.PI / 2 * (c.flankSide || 1);
                c.moveMul = 1;
                return;
            }
        }
        /* bane hunt: close to firing range on the lone bane (the shoot loop takes banes first) */
        if (c.huntTarget && !c.huntTarget.dead) {
            /* close to 80% range, but never inside 2.5 splash radii of it */
            var hd = dist(c.huntTarget, c.x, c.y);
            if (hd > MARINE_RANGE * 0.8) { marineSteerToward(c, c.huntTarget.x, c.huntTarget.y, false); c.moveMul = 1; }
            else if (hd < BANE_SPLASH_R * 2.5) { marineSteerToward(c, c.huntTarget.x, c.huntTarget.y, true); c.moveMul = 1; }
            return;
        }
        if (MARINE_MICRO && S >= 0.5 && marineMicro(c, S)) return;
        /* stimmed elite marines hunt: push in on a flank while firing, closing to
         * just over half range so more lings are in reach */
        if (MARINE_STIM_PUSH && S >= 0.75 && c.stimT > 0 && c.hp >= MARINE_HP * 0.3) {
            var hz = nearestZerg(c.x, c.y);
            if (hz && dist(hz, c.x, c.y) > MARINE_RANGE * 0.55) {
                if (MARINE_FLANK_ON) c.want = marineFlankDir(c, hz.x, hz.y, S); else marineSteerToward(c, hz.x, hz.y, false);
                c.moveMul = 0.7;
            }
        }
        if (S >= 0.5 && c.hp < MARINE_HP * 0.35) {
            var z = nearestZerg(c.x, c.y);
            if (z && dist(z, c.x, c.y) < MARINE_RANGE * 0.6) { marineSteerToward(c, z.x, z.y, true); c.moveMul = 0.5; }
        }
        if (S >= 0.5) {
            var b = nearestKind(c.x, c.y, "bane");
            if (b && dist(b, c.x, c.y) < MARINE_RANGE * 1.5) {
                var om = nearestOtherMarine(c);
                var od = om ? dist(om, c.x, c.y) : 1e9;
                if (od < BANE_SPLASH_R * 1.2) {
                    /* step away from the neighbour, and never toward the bane */
                    var bd = dist(b, c.x, c.y) || 1;
                    var sx = (c.x - om.x) / (od || 1) + (c.x - b.x) / bd;
                    var sy = (c.y - om.y) / (od || 1) + (c.y - b.y) / bd;
                    c.want = Math.atan2(sy, sx);
                    c.moveMul = 0.6;
                }
            }
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
        /* commitment belongs to the units, not the moment's cluster: an attack
         * stretches the swarm out and splits it, so every committed zerg keeps
         * going while the committed force as a whole still has hope (zergNoHope
         * of attackOdds x all marines), and any zerg near the fight joins in */
        var committedPower = 0, committedUnits = [];
        for (i = 0; i < zs.length; i++) if (zs[i].attacking) { committedPower += zs[i].kind === "bane" ? 2 : 1; committedUnits.push(zs[i]); }
        var keepGoing = committedPower > 0 && committedPower >= countKind("marine") * ATTACK_ODDS * ZERG_NO_HOPE;
        for (var k = 0; k < nc; k++) {
            var size = 0, power = 0, cx = 0, cy = 0, committed = false, berserkBane = false;
            var patience = 0, stalkDir = 0, powerAll = 0;
            for (i = 0; i < zs.length; i++) {
                var z = zs[i];
                if (z.cluster !== k) continue;
                size++; cx += z.x; cy += z.y;
                power += z.kind === "bane" ? 2 : 1;
                if (z.attacking) committed = true;
                if (z.kind === "bane" && z.berserk) berserkBane = true;
                if (z.stalking) { patience = Math.max(patience, z.stalkT); if (!stalkDir) stalkDir = z.stalkDir; }
            }
            cx /= size; cy /= size;
            var attack = false, stalk = false;
            var m = nearestMarine(cx, cy);
            /* Overmind: only backup near the front of the swarm counts - lings on
             * the far side of the map would arrive long after the fight is decided.
             * Those stragglers rally to the front instead of charging */
            var front = null, joinR = 0, ZS = zergSkill();
            if (m && ZS >= 0.3 && OV_JOIN > 0) {
                var fd = 1e18;
                for (i = 0; i < zs.length; i++) {
                    if (zs[i].cluster !== k) continue;
                    var fdx = zs[i].x - m.x, fdy = zs[i].y - m.y, fd2 = fdx * fdx + fdy * fdy;
                    if (fd2 < fd) { fd = fd2; front = zs[i]; }
                }
                joinR = MARINE_RANGE * OV_JOIN;
                var near = 0;
                for (i = 0; i < zs.length; i++) {
                    if (zs[i].cluster !== k) continue;
                    if (dist(zs[i], front.x, front.y) < joinR) near += zs[i].kind === "bane" ? 2 : 1;
                }
                powerAll = power;   /* the whole swarm decides; the join radius only picks who charges first */
            }
            if (m) {
                /* the target group = every marine close enough to join this fight */
                var mg = countNearbyMarines(m, Math.max(MARINE_GROUP_RADIUS, MARINE_RANGE));
                var odds = mg * ATTACK_ODDS;
                /* cornered: marines already this close, running is death, so fight */
                var dmx = m.x - cx, dmy = m.y - cy;
                var cornered = dmx * dmx + dmy * dmy < (MARINE_RANGE * 0.7) * (MARINE_RANGE * 0.7);
                attack = (power >= need && power >= odds) ||
                         (cornered && power >= odds / 2) ||
                         /* committed: to the death, unless the whole swarm is down to
                          * zergNoHope of what the fight needs */
                         (committed && Math.max(power, powerAll) >= odds * ZERG_NO_HOPE) ||
                         berserkBane;
                /* zerg smarts: a swarm ready to attack stalks first - circling the
                 * marines just outside their range - and only throws itself in when
                 * pushed against a wall / into a corner, when it overwhelms them
                 * (zergAllInOdds x), or once its patience (zergPatience s) runs out */
                /* stalemate: a swarm with half the strength it wants goes anyway */
                if (!attack && stalemate() && power >= Math.max(need, odds) * 0.5) attack = true;
                if (ZERG_SMARTS && attack && !committed && !berserkBane && !cornered) {
                    /* against a wall is cornered whatever the brain says (min 12% of the field) */
                    var md = Math.sqrt(dmx * dmx + dmy * dmy), cd = Math.max(ZERG_CORNER, 0.12) * Math.min(W, H);
                    var walls = (cx < cd) + (cx > W - cd) + (cy < cd) + (cy > H - cd);
                    var pinned = (walls >= 2 && md < MARINE_RANGE * 1.6) || (walls >= 1 && md < MARINE_RANGE * 1.1);
                    /* marines stepping inside the stalking ring: that's the moment - commit */
                    if (front && dist(front, m.x, m.y) < MARINE_RANGE * 1.1) pinned = true;
                    var overwhelm = ZERG_ALL_IN_ODDS > 0 && power >= Math.max(need, mg * ATTACK_ODDS * ZERG_ALL_IN_ODDS);
                    if (!pinned && !overwhelm && !stalemate() && patience < Math.min(ZERG_PATIENCE, 45)) { attack = false; stalk = true; }
                }
            }
            /* a fight is on next to us: join it */
            if (!attack && keepGoing && m) {
                for (i = 0; i < committedUnits.length; i++) {
                    if (dist(committedUnits[i], cx, cy) < MARINE_RANGE * 2) { attack = true; stalk = false; break; }
                }
            }
            if (stalk && !stalkDir) stalkDir = Math.random() < 0.5 ? 1 : -1;
            /* Overmind bane roles: when the swarm commits, the banes nearest the
             * marines (ovBaneVanguard share) lead at ling pace to break the line;
             * the rest hold in the pack for a clump */
            if (attack && m && OV_VANGUARD > 0) {
                var cb = [];
                for (i = 0; i < zs.length; i++) if (zs[i].cluster === k && zs[i].kind === "bane") cb.push(zs[i]);
                cb.sort(function (a, b) { return dist(a, m.x, m.y) - dist(b, m.x, m.y); });
                var nv = Math.round(cb.length * OV_VANGUARD);
                for (i = 0; i < cb.length; i++) cb[i].vanguard = i < nv;
            }
            if (attack && !committed) sound("lingAttack");
            for (i = 0; i < zs.length; i++) {
                if (zs[i].cluster !== k) continue;
                var far = front && zs[i].kind === "ling" && dist(zs[i], front.x, front.y) >= joinR;
                var was = zs[i].attacking;
                zs[i].attacking = (attack && !(far && !was)) || (was && keepGoing);   /* straggling lings don't charge in late; banes always go with the swarm; committed stays committed */
                zs[i].stalking = stalk;
                zs[i].rallyTo = (attack || stalk) && far && !zs[i].attacking ? front : null;
                if (stalk) zs[i].stalkDir = stalkDir;
            }
        }
    }

    function step(c, dt) {
        if (c.kind === "egg") { c.t += dt * (c.hatchMult || 1); return; }
        /* banes stay in sync with the lings: any bane within 4x range of a
         * committed zerg is in the fight too (never left behind to flee) */
        if (c.kind === "bane" && !c.attacking && !c.berserk && (c.syncT = (c.syncT || 0) - dt) <= 0) {
            c.syncT = 0.25;
            for (var si = 0; si < units.length; si++) {
                var su = units[si];
                if (su.dead || su === c || !su.attacking || (su.kind !== "ling" && su.kind !== "bane")) continue;
                if (dist(su, c.x, c.y) < MARINE_RANGE * 4) { c.attacking = true; break; }
            }
        }

        if (c.kind === "marine") {
            /* only start steering once fully on-screen */
            if (!c.entered && c.x >= 0 && c.x <= W && c.y >= 0 && c.y <= H) c.entered = true;
            if (c.flashT > 0) c.flashT -= dt;
            if (c.stimT > 0) c.stimT -= dt;
            if (c.stimCd > 0) c.stimCd -= dt;
            if (c.stimRegenT > 0) c.stimRegenT -= dt;
            if (c.stimFxT > 0) { c.stimFxT -= dt; c.stimFxAge += dt; }
            if (c.kitePhase === "run") c.runT += dt; else c.shootT += dt;
            var skill = marineSkill();
            c.retarget -= dt;
            if (c.deployT > 0) {
                /* marching in: head straight for the deploy point at entry speed
                 * (still shooting), then switch to normal tactics */
                c.deployT -= dt;
                var ddx = c.deployX - c.x, ddy = c.deployY - c.y;
                c.want = Math.atan2(ddy, ddx);
                c.moveMul = MARINE_ENTRY_SPEED;
                if (ddx * ddx + ddy * ddy < 64 || c.deployT <= 0) { c.deployT = 0; c.moveMul = 1; c.retarget = 0; }
            } else if (c.entered && skill <= 0) {
                c.moveMul = 0;   /* skill 0: stand there and take it */
            } else if (c.entered && c.combat) {
                marineCombatSteer(c, skill);   /* every frame: kiting needs crisp turns */
            } else if (c.retarget <= 0) {
                c.retarget = lerp(0.5, 0.1, skill);
                if (c.entered) {
                    if (MARINE_TACTICS) {
                        marineTacticsSteer(c);
                    } else {
                        marineClassicSteer(c);
                    }
                    /* a lone marine heads back to the main marine mob */
                    if (c.regroupTo) { marineSteerToward(c, c.regroupTo.x, c.regroupTo.y, false); c.moveMul = 1; }
                }
            }
            turnToward(c, c.deployT > 0 ? MARINE_TURN : marineTurnRate(skill), dt);
            /* quick feet only where they help: kiting and running back to the mob */
            var feet = c.deployT > 0 ? 1 : marineFootwork(skill);
            if ((c.combat && (c.kitePhase === "run" || c.moveMul >= 1)) || c.regroupTo) feet *= marineKiteMul(skill);
            else feet = Math.min(1, feet);
            var mv = c.speed * TERRAN_SPEED * SETTINGS.unitSpeed * c.moveMul * feet *
                     (c.stimT > 0 ? STIM_SPEED_MULT : 1) * dt;
            c.x += Math.cos(c.heading) * mv;
            c.y += Math.sin(c.heading) * mv;
            /* reflect only when moving outward, so marines can walk in from off-screen */
            if (c.x < 18 && Math.cos(c.heading) < 0) { c.x = 18; c.heading = c.want = Math.PI - c.heading; }
            if (c.x > W - 18 && Math.cos(c.heading) > 0) { c.x = W - 18; c.heading = c.want = Math.PI - c.heading; }
            if (c.y < 18 && Math.sin(c.heading) < 0) { c.y = 18; c.heading = c.want = -c.heading; }
            if (c.y > H - 18 && Math.sin(c.heading) > 0) { c.y = H - 18; c.heading = c.want = -c.heading; }
            /* where the marine looks: retreating (kiting away or running back to
             * the mob) -> where it walks; otherwise the closest zerg at any range,
             * re-aimed every AIM_T (anti-jitter). Firing snaps to the target. */
            c.aimT -= dt;
            if ((c.combat && c.kitePhase === "run") || (c.regroupTo && !c.shootTarget)) {
                c.aim = c.heading;
                c.aimDist = 1e9;
            } else if (c.aimT <= 0) {
                c.aimT = AIM_T;
                var tgt = nearestZerg(c.x, c.y);
                /* sticky: keep the current target unless a new one is clearly closer,
                 * so a marine in a swarm doesn't flick between lings on either side */
                if (tgt && c.aimTarget && !c.aimTarget.dead && c.aimTarget !== tgt &&
                    dist(c.aimTarget, c.x, c.y) < dist(tgt, c.x, c.y) * 1.35) tgt = c.aimTarget;
                c.aimTarget = tgt;
                c.aim = tgt ? Math.atan2(tgt.y - c.y, tgt.x - c.x) : c.heading;
                c.aimDist = tgt ? dist(tgt, c.x, c.y) : 1e9;
            }
            if (MARINE_UPRIGHT) {
                /* sprite angle: firing -> turn quickly to the target; otherwise ease
                 * back upright (feet to the bottom of the screen), facing the way we
                 * walk, leaning up to marineWalkTilt degrees with the slope of the walk
                 * (plus a small personal lean), so marines never walk on their heads */
                /* zerg within 1.5x range: gun already up and on it before the first shot */
                var firing = !!c.shootTarget || c.flashT > 0 || (c.aimDist || 1e9) < MARINE_RANGE * 1.5;
                if (firing) {
                    var da = c.aim - c.drawAng;
                    while (da > Math.PI) da -= 6.283;
                    while (da < -Math.PI) da += 6.283;
                    var turn = da * (1 - Math.exp(-dt * (c.shootTarget ? 14 : 8))), cap = 9 * dt;   /* max ~9 rad/s */
                    c.drawAng += Math.max(-cap, Math.min(cap, turn));
                } else {
                    if (!c.wasIdle) {
                        /* just stopped firing: keep the side the gun is on, ease the lean down */
                        c.walkSide = Math.cos(c.drawAng) >= 0 ? 0 : Math.PI;
                        c.tiltAng = Math.atan2(Math.sin(c.walkSide ? Math.PI - c.drawAng : c.drawAng),
                                               Math.cos(c.walkSide ? Math.PI - c.drawAng : c.drawAng));
                    }
                    /* face and lean like the neighbours: average walk direction of the
                     * marines around us (self included), so a squad looks the same way */
                    var nc = 0, ns = 0, gr2 = MARINE_GROUP_RADIUS * MARINE_GROUP_RADIUS;
                    for (var ni = 0; ni < units.length; ni++) {
                        var nb = units[ni];
                        if (nb.kind !== "marine" || nb.dead) continue;
                        var ndx = nb.x - c.x, ndy = nb.y - c.y;
                        if (ndx * ndx + ndy * ndy > gr2) continue;
                        nc += Math.cos(nb.heading); ns += Math.sin(nb.heading);
                    }
                    var nl = Math.sqrt(nc * nc + ns * ns) || 1;
                    nc /= nl; ns /= nl;
                    if (nc > 0.2) c.walkSide = 0;                /* hysteresis: straight up/down keeps the side */
                    else if (nc < -0.2) c.walkSide = Math.PI;    /* side flips are an instant mirror, never a roll */
                    var maxTilt = (TUNING.marineWalkTilt || 0) * Math.PI / 180;
                    var wantTilt = Math.max(-maxTilt, Math.min(maxTilt, ns * maxTilt * 1.2 + c.leanBias * maxTilt * 0.25));
                    c.tiltAng += (wantTilt - c.tiltAng) * (1 - Math.exp(-dt * 4));
                    c.drawAng = c.walkSide ? Math.PI - c.tiltAng : c.tiltAng;
                }
                c.wasIdle = !firing;
            }
        } else {
            /* ling / bane: only pick a direction every RETARGET_T (anti-jitter) */
            c.age += dt;
            if (c.kind === "ling") {
                /* attack burst: every ling that joins an attack sprints for
                 * lingAttackBoostTime s, then lingAttackBoostCooldown s before the next */
                if (c.boostT > 0) c.boostT -= dt;
                else if (c.boostCd > 0) c.boostCd -= dt;
                c.boostWait = false;
                if (zergSkill() >= 0.5) {
                    /* Overmind: save the sprint for the run into the marines - it fires
                     * once the ling is close enough for the burst to carry it through
                     * their fire, and a ling just outside range waits for a sprint that's
                     * almost ready rather than walking in slow */
                    if (c.attacking && c.boostT <= 0) {
                        var bm = nearestMarine(c.x, c.y), bmd = bm ? dist(bm, c.x, c.y) : 1e9;
                        var sprint = c.speed * ZERG_SPEED * LING_BOOST_MULT * LING_BOOST_TIME * 0.8;
                        if (c.boostCd <= 0 && bmd < Math.min(sprint, MARINE_RANGE * 1.4)) {
                            c.boostT = LING_BOOST_TIME;
                            c.boostCd = LING_BOOST_CD;
                        } else if (c.boostCd > 0 && c.boostCd < 2.5 && bmd > MARINE_RANGE * 1.05 && bmd < MARINE_RANGE * 2) {
                            c.boostWait = true;
                        }
                    }
                } else if (c.attacking && !c.wasAttacking && c.boostT <= 0 && c.boostCd <= 0) {
                    c.boostT = LING_BOOST_TIME;
                    c.boostCd = LING_BOOST_CD;
                }
                c.wasAttacking = c.attacking;
            }
            if (c.stalking) c.stalkT += dt; else c.stalkT = 0;
            if (c.guardT > 0) c.guardT -= dt;
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
                        } else if (c.guardT > 0 && c.guardFrom && !c.guardFrom.dead) {
                            /* bodyguard: charge the bane's hunter and soak its fire */
                            charge(c, c.guardFrom, 26, 46, LING_BOOST_MULT);
                            c.fleeing = false;
                        } else if (c.rallyTo && !c.rallyTo.dead) {
                            /* Overmind: join the front of the swarm before the fight */
                            c.want = Math.atan2(c.rallyTo.y - c.y, c.rallyTo.x - c.x);
                            c.speed = rand(26, 46);
                            c.fleeing = false;
                        } else if (c.stalking) {
                            stalk(c, 26, 46);
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
                    /* Overmind: banes only go with an attacking swarm, never on their own
                     * because enough of them exist (that just wastes them up front) */
                    var smartBane = OV_BANE_HOLD && zergSkill() >= 0.5;
                    if (c.huntedT > 0) c.huntedT -= RETARGET_T;
                    var wantGo = m && (c.berserk || (c.attacking && !(c.huntedT > 0)) || (!smartBane && countKind("bane") >= BERSERK_BANES));
                    /* marines this close: blow up now (and never get stuck in a ring of them) */
                    if (m && dist(m, c.x, c.y) < MARINE_RANGE * 0.6) wantGo = true, c.berserk = true;
                    if (wantGo && !c.berserk && smartBane && c.vanguard && c.attacking) {
                        /* vanguard: roll in alongside the lings at their pace, then sprint */
                        if (dist(m, c.x, c.y) < MARINE_RANGE * 0.5) { c.berserk = true; charge(c, m, 24, 40, BERSERK_SPEED_MULT); }
                        else charge(c, m, 26, 46, 1);
                        c.fleeing = false;
                    } else if (wantGo && !c.berserk && smartBane && !baneGoTime(c, m, RETARGET_T)) {
                        /* Overmind: ride in the pack behind the lings until they're
                         * biting a clump of marines, then roll in */
                        var bd = dist(m, c.x, c.y), hold = MARINE_RANGE * 1.15;
                        c.want = Math.atan2(m.y - c.y, m.x - c.x);   /* face in, behind the lings */
                        c.speed = rand(24, 40) * (bd > hold ? 1 : 0.05);
                        c.fleeing = false;
                    } else if (wantGo) {
                        c.berserk = true;
                        c.holdT = 0;
                        c.fleeing = false;
                        charge(c, m, 24, 40, BERSERK_SPEED_MULT);
                    } else {
                        fallBack(c, 24, 40);
                    }
                }
            }
            turnToward(c, c.fleeing ? 0.75 : ZERG_TURN, dt);
            var zv = zergMoveSpeed(c) * SETTINGS.unitSpeed * (c.boostWait ? 0.25 : 1);   /* waiting on the sprint */
            c.x += Math.cos(c.heading) * zv * dt;
            c.y += Math.sin(c.heading) * zv * dt;
            if (c.x < 18) { c.x = 18; c.heading = c.want = Math.PI - c.heading; }
            if (c.x > W - 18) { c.x = W - 18; c.heading = c.want = Math.PI - c.heading; }
            if (c.y < 18) { c.y = 18; c.heading = c.want = -c.heading; }
            if (c.y > H - 18) { c.y = H - 18; c.heading = c.want = -c.heading; }
        }

        /* smoothed aim for drawing (no snapping when the target changes) */
        if (c.kind === "marine") {
            if (typeof c.smoothAim !== "number") c.smoothAim = c.aim;
            var sda = c.aim - c.smoothAim;
            while (sda > Math.PI) sda -= 6.283;
            while (sda < -Math.PI) sda += 6.283;
            c.smoothAim += Math.max(-9 * dt, Math.min(9 * dt, sda * (1 - Math.exp(-dt * 12))));
        }
        /* horizontal facing with hysteresis (wider for marines: no flip-flopping) */
        var ang = (c.kind === "marine") ? (MARINE_UPRIGHT ? c.drawAng : c.smoothAim) : c.heading;
        var cosh = Math.cos(ang), fh = c.kind === "marine" ? 0.45 : 0.3;
        if (cosh > fh) c.face = 1;
        else if (cosh < -fh) c.face = -1;

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
        /* stim fx (under the sprite): a soft green glow while stimmed
         * and fades out over its last second */
        var stimFx = c.kind === "marine" && c.stimFxT > 0;
        var fxA = stimFx ? Math.min(1, c.stimFxT) * (0.75 + 0.25 * Math.sin(c.stimFxAge * 9)) : 0;
        if (stimFx) {
            var gr = c.w * 0.3;
            var glow = cc.createRadialGradient(c.x, c.y, 0, c.x, c.y, gr);
            glow.addColorStop(0, "rgba(150,255,90," + (0.45 * fxA).toFixed(3) + ")");
            glow.addColorStop(1, "rgba(150,255,90,0)");
            cc.fillStyle = glow;
            cc.beginPath();
            cc.arc(c.x, c.y, gr, 0, 6.283);
            cc.fill();
        }
        cc.save();
        cc.translate(c.x, c.y);
        if (c.kind !== "egg") {
            var ang = (c.kind === "marine") ? marineDrawAng(c) : c.heading;
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
        /* stim fx (over the sprite): two tiny glowing "+" drifting up and fading */
        if (stimFx) {
            cc.save();
            cc.strokeStyle = "#a6ff6e";
            cc.shadowColor = "rgba(150,255,90,0.9)";
            cc.shadowBlur = 4;
            cc.lineWidth = 1.2;
            for (var pi = 0; pi < 2; pi++) {
                var ph = (c.stimFxAge * 0.7 + pi * 0.5) % 1;          /* 0..1 rise cycle */
                var px = c.x + (pi ? 0.22 : -0.18) * c.w;
                var py = c.y - c.w * 0.15 - ph * c.w * 0.35;
                var ps = 2.2;
                cc.globalAlpha = fxA * Math.sin(ph * Math.PI);
                cc.beginPath();
                cc.moveTo(px - ps, py); cc.lineTo(px + ps, py);
                cc.moveTo(px, py - ps); cc.lineTo(px, py + ps);
                cc.stroke();
            }
            cc.restore();
        }
        /* stim debuff (stim over, regen still blocked for stimRegenTime): a small
         * red "-" where the green "+" floated, fading over its last second */
        if (c.kind === "marine" && c.stimT <= 0 && c.stimRegenT > 0) {
            cc.save();
            cc.strokeStyle = "#ff4a3d";
            cc.shadowColor = "rgba(255,60,40,0.8)";
            cc.shadowBlur = 3;
            cc.lineWidth = 1.4;
            cc.globalAlpha = Math.min(1, c.stimRegenT) * 0.9;
            var mx = c.x + 0.22 * c.w, my = c.y - c.w * 0.3;
            cc.beginPath();
            cc.moveTo(mx - 2.4, my); cc.lineTo(mx + 2.4, my);
            cc.stroke();
            cc.restore();
        }

        /* health bar under every unit, including eggs (same bar as a ling; eggs
         * take eggDamageMult of each hit, so they stay green for a long time) */
        if (SETTINGS.showHealthBars !== false) {
            var hp = (typeof c.hp === "number") ? c.hp : 100;
            var maxHp = (c.kind === "egg") ? EGG_HP :
                (c.kind === "marine") ? MARINE_HP : (c.kind === "bane") ? BANE_HP : LING_HP;
            var bw = 30, bh = 2;   /* all health bars the same width (2 px tall, as on the ESP32) */
            var by = c.y + hh / 2 + 3;
            cc.fillStyle = "rgba(0,0,0,0.55)";
            cc.fillRect(c.x - bw / 2, by, bw, bh);
            var frac = Math.max(0, Math.min(1, hp / maxHp));
            cc.fillStyle = frac > 0.5 ? "#4cff4c" : (frac > 0.25 ? "#ffd23e" : "#ff4c4c");
            cc.fillRect(c.x - bw / 2, by, bw * frac, bh);
            /* marine kill stripes: one 1x2px yellow stripe per ling killed */
            if (c.kind === "marine" && c.kills > 0 && SETTINGS.showKills !== false) {
                var nk = c.kills;
                cc.fillStyle = "#ffe23e";
                for (var si = 0; si < nk; si++) {
                    cc.fillRect(c.x - bw / 2 + si * 2, by - 4, 1, 2);
                }
            }
        }
    }

    function addSplat(x, y, col, scale) {
        /* green (baneling) splats fade BANE_SPLAT_LIFE_MULT x as fast as red ones */
        var life = splatLife() * (col === BANE_SPLAT ? BANE_SPLAT_LIFE_MULT : 1);
        splats.push({
            x: x, y: y, life: life, max: life,
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

    /* battle stats for the page's stats panel (units lost, stims, bane kills).
     * battle increments on every restart so the page can reset its history. */
    var stats = { battle: 1, lost: { ling: 0, bane: 0, marine: 0, egg: 0 }, stims: 0, baneKills: 0, stimDeaths: 0, spawnKills: 0,
                  victories: { zerg: 0, terran: 0 } };
    function resetStats() {
        stats.battle++;
        stats.lost = { ling: 0, bane: 0, marine: 0, egg: 0 };
        stats.stims = 0; stats.baneKills = 0; stats.stimDeaths = 0; stats.spawnKills = 0;
        stats.victories = { zerg: 0, terran: 0 };
        growthMul = 1; marinesWereAlive = false;
    }
    function getStats() {
        var field = { ling: 0, bane: 0, marine: 0, egg: 0 };
        for (var i = 0; i < units.length; i++) {
            var u = units[i];
            if (!u.dead && field[u.kind] !== undefined) field[u.kind]++;
        }
        return { battle: stats.battle, lost: stats.lost, stims: stats.stims, baneKills: stats.baneKills,
                 stimDeaths: stats.stimDeaths, spawnKills: stats.spawnKills, victories: stats.victories,
                 growth: +growthMul.toFixed(2), field: field, zergSupply: (field.ling + field.bane) * 0.5, terranSupply: field.marine };
    }

    /* a side wiped the other off the board: count it, and in growth mode start
     * the next build-up from the base caps */
    function victory(side) {
        stats.victories[side]++;
        if (SETTINGS.growthMode && growthMul !== 1) { growthMul = 1; applyUnitScale(); }
    }

    /* nobody has died for 20 s: the zerg stop stalking and attack, marines advance */
    function stalemate() { return simT - lastDeathT > 20; }

    function killUnit(c, tapped) {
        if (c.dead) return;
        if (c.kind !== "egg") lastDeathT = simT;
        if (stats.lost[c.kind] !== undefined) stats.lost[c.kind]++;
        if (c.kind === "marine" && (c.deployT > 0 || !c.entered)) stats.spawnKills++;   /* zerg camping the terran spawn */
        addSplat(c.x, c.y, c.splatCol, c.splatScale);
        c.dead = true;
        if (c.kind === "ling") {
            respawnLeftLings++;
            sound("lingDie");
            /* corpse: freeze the frame, show only the bottom half, fade out (same as marine) */
            var lang = c.heading;
            var lfd = c.faceDir;
            var lmirror = (lfd === 1) ? (c.face === -1) : (c.face === 1);
            var lrot = (lfd === 1) ? (lmirror ? lang + Math.PI : lang) : (lmirror ? -lang : lang + Math.PI);
            corpses.push({
                x: c.x, y: c.y, w: c.w, img: lingFrames[c.frame],
                rot: lrot, mirror: lmirror, life: corpseLife(), max: corpseLife()
            });
        } else if (c.kind === "bane") {
            /* splash: damage EVERY marine in blast range, not just the touched one */
            var baneKills = 0;
            for (var i = 0; i < units.length; i++) {
                var m = units[i];
                if (m.kind !== "marine" || m.dead) continue;
                var dx = m.x - c.x, dy = m.y - c.y;
                if (dx * dx + dy * dy < BANE_SPLASH_R * BANE_SPLASH_R) {
                    var hadHp = m.hp > 0;
                    m.hp -= BANE_SPLASH_DMG;
                    m.lastHitBy = "bane";
                    if (hadHp && m.hp <= 0) baneKills++;
                }
            }
            stats.baneKills += baneKills;
            /* the big boom only when the blast killed a marine; otherwise a plain ling death */
            sound(baneKills > 0 || tapped ? "baneDie" : "lingDie");
        } else if (c.kind === "marine") {
            sound("marineDie");
            if (c.lastHitBy === "ling") sound("marineDieLing");   /* torn down by zerglings */
            /* corpse: freeze the frame, show only the bottom half, fade out */
            var ang = marineDrawAng(c);
            var fd = c.faceDir;
            var mirror = (fd === 1) ? (c.face === -1) : (c.face === 1);
            var rot = (fd === 1) ? (mirror ? ang + Math.PI : ang) : (mirror ? -ang : ang + Math.PI);
            var ms = marineSet(c);
            corpses.push({
                x: c.x, y: c.y, w: c.w, img: ms[c.frame % ms.length],
                rot: rot, mirror: mirror, life: corpseLife(), max: corpseLife()
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

        /* zerg wiped out (no lings, banes or eggs): the brood comes back only after
         * zergWaveLo..Hi s, like a marine wave after a wipe. While any zerg live,
         * lost lings refill every respawnInterval s. */
        var zergAlive = countKind("ling") + countKind("bane") + countKind("egg") > 0;
        if (zergWasAlive && !zergAlive) { zergWipeT = rand(TUNING.zergWaveLo || 0, TUNING.zergWaveHi || 0); victory("terran"); }
        zergWasAlive = zergAlive;
        if (zergWipeT > 0) zergWipeT -= dt;
        var marinesAliveNow = countKind("marine") > 0;
        if (marinesWereAlive && !marinesAliveNow) victory("zerg");
        marinesWereAlive = marinesAliveNow;

        /* growth mode: both sides' caps keep rising (growthRate x base per minute,
         * up to growthMax) so the armies snowball until one side pulls off the
         * meat grinder and wipes the other off the board; then caps reset */
        if (SETTINGS.growthMode) {
            var gm = Math.min(Math.max(1, +TUNING.growthMax || 1), growthMul + (+TUNING.growthRate || 0) * dt / 60);
            if (Math.abs(gm - growthMul) > 1e-9) {
                var before = MAX_LINGS;
                growthMul = gm;
                applyUnitScale();
                if (MAX_LINGS > before) respawnLeftLings += MAX_LINGS - before;   /* eggs fill the new room */
            }
        } else if (growthMul !== 1) { growthMul = 1; applyUnitScale(); }

        /* new lings spawn as eggs, 2 at a time, slowly */
        if (respawnLeftLings > 0 && zergWipeT <= 0) {
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
            if (baneSlots > 0 && Math.random() < TB.morphChancePerSec * dt) {
                var candidates = [];
                for (var li = 0; li < units.length; li++) {
                    var l = units[li];
                    if (l.kind === "ling" && !l.dead && l.age >= MORPH_AGE) candidates.push(l);
                }
                /* Overmind: with skill, morph the lings closest to the marines (or to
                 * where marine waves land) so banes hatch at the front line */
                var mzs = zergSkill() * OV_FRONT_MORPH;
                if (mzs > 0 && countKind("marine") > 0) {
                    var sx = waveEdge === 0 ? 0 : waveEdge === 1 ? W : waveAnchor, sy = waveEdge === 2 ? 0 : waveEdge === 3 ? H : waveAnchor;
                    candidates.forEach(function (c2) {
                        var nm = nearestMarineDist(c2.x, c2.y), ns = Math.sqrt((c2.x - sx) * (c2.x - sx) + (c2.y - sy) * (c2.y - sy));
                        c2.morphScore = c2.age * (1 - mzs) * 10 - Math.min(nm, ns * 1.2) * mzs;
                    });
                    candidates.sort(function (a, b) { return b.morphScore - a.morphScore; });
                } else candidates.sort(function (a, b) { return b.age - a.age; });
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
                    l2.hp = EGG_HP;
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
                    sound("lingChill");
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

        /* occasional idle zerg chatter (web sound) */
        chillT -= dt;
        if (chillT <= 0) {
            chillT = rand(3.5, 8);
            var hasLing = false;
            for (var ch = 0; ch < units.length; ch++) {
                if (units[ch].kind === "ling" && !units[ch].dead) { hasLing = true; break; }
            }
            if (hasLing) sound("lingChill");
        }

        simT += dt;
        /* swarm-level attack decisions, then move everyone */
        updateSwarm();
        marineController(dt);
        for (var i = 0; i < units.length; i++) step(units[i], dt);

        /* marines shoot the closest zerg (ling or bane) within range. Eggs are never
         * sought out, but one already inside weapon range gets shot while no zerg is
         * in range - and shrugs off eggDamageMult of the damage (a tanky shield). */
        for (var mi = 0; mi < units.length; mi++) {
            var mc = units[mi];
            if (mc.kind !== "marine" || mc.dead) continue;
            if (mc.combat && mc.kitePhase === "run") {
                mc.shootTarget = null;
                if (mc.shootCd > 0) mc.shootCd -= dt;
                continue;
            }
            var tgt = nearestZerg(mc.x, mc.y);
            /* sticky target: keep shooting the same zerg while it's in range and not much farther */
            var st = mc.shootTarget;
            if (tgt && st && !st.dead && st !== tgt && st.kind !== "egg" &&
                dist(st, mc.x, mc.y) < MARINE_RANGE && dist(st, mc.x, mc.y) < dist(tgt, mc.x, mc.y) * 1.35) tgt = st;
            if (marineSkill() >= 0.4) {
                var pb = nearestKind(mc.x, mc.y, "bane");   /* banes first: they kill squads */
                if (pb && dist(pb, mc.x, mc.y) < MARINE_RANGE) tgt = pb;
            }
            if (tgt) {
                var drx = tgt.x - mc.x, dry = tgt.y - mc.y;
                if (drx * drx + dry * dry >= MARINE_RANGE * MARINE_RANGE) tgt = null;
            }
            if (!tgt) {
                var egt = nearestEgg(mc.x, mc.y);
                if (egt) {
                    var ex = egt.x - mc.x, ey = egt.y - mc.y;
                    if (ex * ex + ey * ey < MARINE_RANGE * MARINE_RANGE) tgt = egt;
                }
            }
            if (tgt) {
                mc.shootTarget = tgt;
                mc.shootCd -= dt;
                if (mc.shootCd <= 0) {
                    mc.shootCd = SHOOT_T;
                    var wasAlive = tgt.hp > 0;
                    /* green marines miss: up to 60% at skill 0, none from half skill up */
                    var miss = Math.max(0, 0.6 * (1 - marineSkill() / 0.5));
                    if (Math.random() >= miss) tgt.hp -= (tgt.kind === "egg") ? SHOOT_DMG * EGG_DMG_MULT : SHOOT_DMG;
                    if (wasAlive && tgt.hp <= 0 && tgt.kind === "ling") mc.kills++;
                    mc.flashT = 0.1;
                    mc.aim = Math.atan2(tgt.y - mc.y, tgt.x - mc.x);
                    mc.hitX = tgt.x + rand(-tgt.w * 0.3, tgt.w * 0.3);
                    mc.hitY = tgt.y + rand(-tgt.w * 0.3, tgt.w * 0.3);
                    sound("marineShoot");
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
                    var heal = maxHp * MARINE_HEAL_PCT * ((hc.kind === "marine" && hc.stimRegenT > 0) ? STIM_REGEN_MULT : 1);
                    hc.hp = Math.min(maxHp, hc.hp + heal);
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
                        mt.lastHitBy = "ling";
                        if (mt.shootTarget) sound("marineBitten");   /* chewed on mid-volley */
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

        /* eggs die at 0 hp: no hatch, no respawn refund */
        for (var ej = 0; ej < units.length; ej++) {
            var e3 = units[ej];
            if (e3.kind === "egg" && !e3.dead && e3.hp <= 0) killUnit(e3);
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

        /* firing lines: brief, semi-transparent, gun tip -> random point on the ling */
        for (var fl = 0; fl < units.length; fl++) {
            var fm = units[fl];
            if (fm.kind !== "marine" || fm.dead || fm.flashT <= 0) continue;
            var alpha = Math.min(1, fm.flashT / 0.1) * 0.7;
            var gx = fm.x + Math.cos(marineDrawAng(fm)) * (fm.w / 2 + 6);
            var gy = fm.y + Math.sin(marineDrawAng(fm)) * (fm.w / 2 + 6);
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
        /* startArmy: both sides open with that share of their caps - the lings
         * gathered at a hive on one side, a full marine wave marching in from the
         * far edge - so the first real fight comes within seconds */
        var sa = Math.max(0, Math.min(1, +TUNING.startArmy || 0));
        var wantLings = Math.max(0, Math.min(MAX_LINGS, Math.max(n, Math.round(MAX_LINGS * sa))));
        while (units.length > 0) units.pop();
        corpses.length = 0;
        var hx = W * (Math.random() < 0.5 ? 0.2 : 0.8), hy = H * rand(0.3, 0.7), hr = Math.min(W, H) * 0.15;
        for (var i = 0; i < wantLings; i++) {
            var l = make("ling");
            if (sa > 0) {
                var a = rand(0, 6.283), r = Math.sqrt(Math.random()) * hr;
                l.x = Math.max(24, Math.min(W - 24, hx + Math.cos(a) * r));
                l.y = Math.max(24, Math.min(H - 24, hy + Math.sin(a) * r));
            }
            units.push(l);
        }
        respawnLeftLings = 0;
        respawnTimer = 0;
        zergWipeT = 0;
        zergWasAlive = true;
        simT = 0; lastDeathT = 0;
        marineTimer = 3;
        wavePending = 0;
        lastMarineCount = 0;
        morphCooldown = 0;
        if (sa > 0) {
            wavePending = Math.max(2, Math.round(MAX_MARINES * sa));
            if (MAX_MARINES >= 2) wavePending -= wavePending % 2;
            waveSpawnT = 0;
            pickSpawnEdge();
            marineTimer = rand(MARINE_LO2, MARINE_HI2) / MARINE_SPAWN_RATE;
        }
    }

    /* tap: splat only units near the tap point (eggs are safe) */
    function killNear(x, y, r) {
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.dead || c.kind === "egg") continue;
            var dx = c.x - x, dy = c.y - y;
            var rr = r + c.bumpR;
            if (dx * dx + dy * dy < rr * rr) killUnit(c, true);
        }
    }

    /* for the page's sound logic: live marines, and how many are firing right now */
    function marineStatus() {
        var alive = 0, shooting = 0;
        for (var i = 0; i < units.length; i++) {
            var u = units[i];
            if (u.kind !== "marine" || u.dead) continue;
            alive++;
            if (u.shootTarget) shooting++;
        }
        return { alive: alive, shooting: shooting };
    }

    function setGameSpeed(n) {
        gameSpeed = parseFloat(n) || 1;
    }

    function setUnitScale(n) {
        baseUnitScale = unitScale = parseFloat(n) || 1;
        applyUnitScale();
    }

    /* restart the battle with the configured starting population */
    function restart() {
        resetStats();
        setCount(SETTINGS.unitCount || MAX_LINGS);
    }

    /* change TUNING live: copy the given keys in and refresh the cached values.
     * Sizes/HP apply to units spawned from now on; restart() applies them to all. */
    function setTuning(obj) {
        for (var k in obj) {
            if (Object.prototype.hasOwnProperty.call(TUNING, k)) TUNING[k] = obj[k];
        }
        computeTuning();
    }

    /* resize the battlefield to w x h logical px, rendered at `ratio` device pixels
     * per logical px (crisp when scaled up). Units are kept inside the new bounds. */
    var pixelRatio = 1;
    function resize(w, h, ratio) {
        W = Math.max(60, Math.round(w));
        H = Math.max(60, Math.round(h));
        pixelRatio = ratio || 1;
        TUNING.mapW = W;
        TUNING.mapH = H;
        if (canvas) {
            canvas.width = Math.round(W * pixelRatio);
            canvas.height = Math.round(H * pixelRatio);
            if (ctx) ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        }
        for (var i = 0; i < units.length; i++) {
            var c = units[i];
            if (c.kind === "marine" && !c.entered) continue;
            c.x = Math.max(12, Math.min(W - 12, c.x));
            c.y = Math.max(12, Math.min(H - 12, c.y));
        }
    }

    /* opts: { canvas: element or id (default "swarm"), assets: sprite folder (default "images/") } */
    function init(opts) {
        opts = opts || {};
        canvas = typeof opts.canvas === "object" ? opts.canvas : document.getElementById(opts.canvas || "swarm");
        if (opts.assets) assetBase = opts.assets;
        if (!canvas || !canvas.getContext) return;
        ctx = canvas.getContext("2d");
        resize(W, H, pixelRatio);
        loadFrames(function () {
            restart();
            start();
        });
    }

    return { init: init, start: start, stop: stop, restart: restart, setCount: setCount, killNear: killNear,
             setGameSpeed: setGameSpeed, setUnitScale: setUnitScale, setTuning: setTuning, resize: resize,
             setSoundHandler: setSoundHandler, marineStatus: marineStatus,
             stats: getStats, resetStats: resetStats,
             TUNING: TUNING, debugUnits: function () { return units; } };
})();
