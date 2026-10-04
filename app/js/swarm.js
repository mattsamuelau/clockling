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
    var growthMul = 1, growthT = 0;            /* growth mode: caps x this, rising until a side is wiped out */
    var marinesWereAlive = false;
    /* blue shell: who's winning (smoothed terran share of the board, each side
     * against its own cap), and comebacks queued after a wipe */
    var trickleM = [], trickleZ = [], zergRushFill = 0;   /* blue shell: game times of the loser's small trickles */
    /* blueShellTrickles evenly spaced through a wait of `wait` game-seconds */
    function trickleTimes(wait) {
        var max = Math.max(0, Math.round(+TUNING.blueShellTrickles || 0)), out = [];
        var n = max ? Math.min(max, 2 + Math.floor(Math.random() * Math.max(1, max - 1))) : 0;   /* 2..max, at random moments */
        for (var i = 0; i < n; i++) out.push(simT + wait * rand(0.1, 0.9));
        return out.sort(function (a, b) { return a - b; });
    }
    var shellShare = 0.5, marineComeback = false, zergComeback = false, zergBoostLeft = 0, zergBrokenT = 0, marineBrokenT = 0;
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
        MARINE_CG, ZERG_CG, MARINE_UPRIGHT, MARINE_MICRO, MARINE_BANE_HUNT, MARINE_STIM_ATTACK, MARINE_SQUADS_ON, MARINE_FLANK_ON, MARINE_STIM_PUSH, MARINE_ELITE_KITE, STIM_REGEN_TIME;
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
        MARINE_CG = !!TB.marineGroupMode;
        ZERG_CG = !!TB.zergGroupMode;
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
    function pickSpawnEdgeRaw() {
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

    /* marineSpawnAnchor: a wave's entry point may only shift marineSpawnDrift of
     * the board (along the border) from the last one, so marines keep a home
     * edge - they can be pinned against it - and lings don't run back and forth
     * between opposite spawns. Positions are mapped onto the perimeter. */
    var lastSpawnU = null;
    function edgeToU(e, along) {
        return e === 0 ? along : e === 3 ? H + along : e === 1 ? H + W + (H - along) : 2 * H + W + (W - along);
    }
    function uToEdge(u) {
        var P = 2 * (W + H);
        u = ((u % P) + P) % P;
        if (u < H) return [0, u];
        if (u < H + W) return [3, u - H];
        if (u < 2 * H + W) return [1, H - (u - H - W)];
        return [2, W - (u - 2 * H - W)];
    }
    var marineSide = -1, marineSideSince = -1e9;   /* home side; when it last changed (real s) */
    function pickSpawnEdge() {
        pickSpawnEdgeRaw();
        if (!TB.marineSpawnAnchor) { lastSpawnU = edgeToU(waveEdge, waveAnchor); return; }
        /* marines keep one home side; they may switch (to the side the raw pick
         * wants, far from the zerg) at most every marineSideSwap real seconds */
        var realT = simT / Math.max(1, gameSpeed);
        if (marineSide < 0 || (waveEdge !== marineSide && realT - marineSideSince >= (+TB.marineSideSwap || 300))) {
            if (marineSide !== waveEdge) { marineSide = waveEdge; marineSideSince = realT; lastSpawnU = null; }
        }
        if (waveEdge !== marineSide) {
            /* stay on the home side: same spot along it as the raw pick would mirror the zerg to */
            var zc = cgZerg || { x: W / 2, y: H / 2 }, len = marineSide < 2 ? H : W;
            waveEdge = marineSide;
            waveAnchor = Math.max(1.5 * MARINE_W, Math.min(len - 1.5 * MARINE_W, marineSide < 2 ? H - zc.y : W - zc.x));
        }
        var u = edgeToU(waveEdge, waveAnchor), P = 2 * (W + H);
        if (lastSpawnU !== null && uToEdge(lastSpawnU)[0] === waveEdge) {
            var d = u - lastSpawnU;
            d = ((d + P / 2) % P + P) % P - P / 2;   /* shortest way round */
            var maxShift = (+TB.marineSpawnDrift || 0.25) * (W + H);
            u = lastSpawnU + Math.max(-maxShift, Math.min(maxShift, d));
        }
        var eu = uToEdge(u), margin = 1.5 * MARINE_W;
        waveEdge = eu[0];
        waveAnchor = Math.max(margin, Math.min((waveEdge < 2 ? H : W) - margin, eu[1]));
        lastSpawnU = edgeToU(waveEdge, waveAnchor);
    }

    /* drop points: marines arrive like units out of a dropship / barracks just
     * off-screen - a whole wave at once, split over 1-3 points close together on
     * the home edge (dropPointsMax). The blue shell comeback floods in from 8-10
     * points all round the map. (Hook for animating the dropships later.) */
    var dropPoints = [];
    function planDrops(flood, n) {
        dropPoints = [];
        var P = 2 * (W + H), margin = 1.5 * MARINE_W, i, eu;
        if (flood) {
            /* D-day: storm in from two opposite sides of the board, 3-5 drop points each */
            var pair = Math.random() < 0.5 ? [0, 1] : [2, 3];
            for (var pe = 0; pe < 2; pe++) {
                var e = pair[pe], len = e < 2 ? H : W, k = 3 + Math.floor(Math.random() * 3);
                for (i = 0; i < k; i++) dropPoints.push({ edge: e, along: Math.max(margin, Math.min(len - margin, len * (i + 0.5) / k + rand(-0.05, 0.05) * len)) });
            }
            return;
        }
        pickSpawnEdge();
        n = n || 1 + Math.floor(Math.random() * Math.max(1, Math.round(+TB.dropPointsMax || 1)));
        var gap = 0.07 * (W + H), elen = waveEdge < 2 ? H : W;
        for (i = 0; i < n; i++) {
            dropPoints.push({ edge: waveEdge, along: Math.max(margin, Math.min(elen - margin, waveAnchor + (i - (n - 1) / 2) * gap)) });
        }
    }
    function releaseDrops(count) {
        if (!dropPoints.length) planDrops(false);
        var n = dropPoints.length;
        for (var i = 0; i < n; i++) {
            var share = Math.floor(count / n) + (i < count % n ? 1 : 0), dp = dropPoints[i];
            for (var j = 0; j < share; j++) {
                /* a tight block: rows of 3 across, each row a step further off-screen */
                spawnMarine(dp.along + ((j % 3) - 1) * MARINE_W * 0.8 + rand(-3, 3), dp.edge, Math.floor(j / 3) * MARINE_W * 0.9);
            }
        }
    }

    /* one marine just off-screen on waveEdge at `along`, marching straight in */
    function spawnMarine(along, edge, depth) {
        var mm = make("marine");
        var e = edge === undefined ? waveEdge : edge, inset = MARINE_INSET + (depth || 0);
        var nx = [1, -1, 0, 0][e], ny = [0, 0, 1, -1][e];  /* inward normal */
        if (e < 2) {
            mm.x = e === 0 ? -inset : W + inset;
            mm.y = along;
        } else {
            mm.x = along;
            mm.y = e === 2 ? -inset : H + inset;
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

    /* zergHomeQuadrant: eggs keep spawning around one home point (a quadrant
     * centre) until the zerg are wiped; the comeback brood picks a fresh home
     * (the quadrant farthest from the marines) */
    var zergHome = null;
    function pickZergHome() {
        var best = -1, mc = marineCentroid();
        for (var qx = 0; qx < 2; qx++) for (var qy = 0; qy < 2; qy++) {
            var hx = W * (qx ? 0.85 : 0.15), hy = H * (qy ? 0.82 : 0.18);   /* a corner */
            var d = mc ? Math.sqrt((hx - mc.x) * (hx - mc.x) + (hy - mc.y) * (hy - mc.y)) : Math.random();
            if (d > best) { best = d; zergHome = { x: hx, y: hy }; }
        }
    }
    function updateHive(zx, zy, zn) {
        if (TB.zergHomeQuadrant) {
            if (!zergHome) pickZergHome();
            hiveX = zergHome.x; hiveY = zergHome.y;
            return;
        }
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

    /* the Overmind's composition check (zergSkill 50%+): enough banes hatched to
     * make an attack worth it (ovBaneShare of the bane cap) */
    function banesReady() {
        if (zergSkill() < 0.5 || MAX_BANES <= 0) return true;
        var b = countKind("bane");
        /* golden ratio: ovBaneRatio banes per ling (1:4 at 0.25), capped by the bane cap */
        if (+TB.ovBaneRatio > 0 && b < Math.min(MAX_BANES, Math.max(2, Math.ceil(countKind("ling") * +TB.ovBaneRatio)))) return false;
        return !(+TB.ovBaneShare > 0) || b >= Math.max(1, Math.round(MAX_BANES * Math.min(1, +TB.ovBaneShare)));
    }

    /* blue shell, terrans gone: lay the egg a random distance from a random
     * existing egg (spaced like the hive's), so the egg field creeps outward */
    function placeEggNearEgg(egg) {
        var eggs = [];
        for (var i = 0; i < units.length; i++) if (units[i].kind === "egg" && !units[i].dead && units[i] !== egg) eggs.push(units[i]);
        if (!eggs.length) { placeEggAtHive(egg); return; }
        var minD = EGG_W * Math.max(1, +TB.eggSpacing || 1) * (1 - EGG_OVERLAP);
        for (var t = 0; t < 20; t++) {
            var from = eggs[Math.floor(Math.random() * eggs.length)];
            var a = rand(0, 6.283), r = rand(minD, minD * 3);
            var x = Math.max(24, Math.min(W - 24, from.x + Math.cos(a) * r)), y = Math.max(24, Math.min(H - 24, from.y + Math.sin(a) * r));
            if (minD <= 0 || nearestEggDist(x, y, egg) >= minD) { egg.x = x; egg.y = y; return; }
        }
        placeEggAtHive(egg);
    }

    /* lay a new egg at the hive, so hatchlings start inside the swarm. Eggs keep
     * EGG_W * (1 - eggOverlap) apart and stay eggClearance() from marines; the
     * search ring grows outward until a spot fits, else the best spot found wins. */
    function placeEggAtHive(egg) {
        var minD = EGG_W * Math.max(1, +TB.eggSpacing || 1) * (1 - EGG_OVERLAP), clear = eggClearance();
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

    /* Overmind encircle (ovEncircle, zergSkill 50%+): the front pins the marines;
     * an attacking ling near them that can't reach one - front-line lings in its
     * way - runs round the outside of the clump, on the side it's already on, to
     * the far side from where the swarm came in, then closes. Encircled marines
     * can't kite and banes clean up */
    function lingEncircle(c) {
        if (!TB.ovEncircle || zergSkill() < 0.5) return;
        var m = nearestMarine(c.x, c.y);
        if (!m) return;
        var dm = dist(m, c.x, c.y), contact = MARINE_BUMP + LING_BUMP + 8;
        if (dm > MARINE_RANGE * 1.3 || dm < contact * 1.6) return;
        /* blocked: another attacking ling is closer to that marine, roughly on our line */
        var am = Math.atan2(m.y - c.y, m.x - c.x), blocked = false;
        for (var i = 0; i < units.length && !blocked; i++) {
            var o = units[i];
            if (o === c || o.dead || o.kind !== "ling" || !o.attacking) continue;
            var od = dist(m, o.x, o.y);
            if (od >= dm || dist(o, c.x, c.y) > dm) continue;
            var ao = Math.atan2(o.y - c.y, o.x - c.x), da0 = Math.atan2(Math.sin(ao - am), Math.cos(ao - am));
            if (Math.abs(da0) < 0.45) blocked = true;
        }
        if (!blocked) return;
        /* hug the edge of the marine clump and slide toward the emptier side, so
         * blocked lings fill in round the flanks and back instead of queuing */
        var T = cgTarget || { x: m.x, y: m.y };
        var a = Math.atan2(c.y - T.y, c.x - T.x), left = 0, right = 0;
        for (i = 0; i < units.length; i++) {
            var o2 = units[i];
            if (o2 === c || o2.dead || o2.kind !== "ling" || !o2.attacking || dist(o2, T.x, T.y) > MARINE_RANGE * 0.9) continue;
            var d2 = Math.atan2(Math.sin(Math.atan2(o2.y - T.y, o2.x - T.x) - a), Math.cos(Math.atan2(o2.y - T.y, o2.x - T.x) - a));
            if (d2 > 0 && d2 < 2) left++; else if (d2 < 0 && d2 > -2) right++;
        }
        if (c.wrapDir === undefined || Math.random() < 0.02) c.wrapDir = left <= right ? 1 : -1;   /* toward the emptier side */
        var hug = Math.max(contact * 2.2, Math.min(dist(c, T.x, T.y), MARINE_RANGE * 0.45));
        var a2 = a + c.wrapDir * 0.7;
        var tx = Math.max(18, Math.min(W - 18, T.x + Math.cos(a2) * hug)), ty = Math.max(18, Math.min(H - 18, T.y + Math.sin(a2) * hug));
        c.want = Math.atan2(ty - c.y, tx - c.x);
    }

    /* lings fighting near a bane (attacking, within marine range of it) */
    function lingsFightingNear(b) {
        for (var i = 0; i < units.length; i++) {
            var u = units[i];
            if (!u.dead && u.kind === "ling" && u.attacking && dist(u, b.x, b.y) < MARINE_RANGE) return true;
        }
        return false;
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
            /* nothing in sight: close up, march on the eggs (the zerg's spawn is the
             * prize), else patrol together until we find zerg */
            var egg = nearestEgg(c.x, c.y);
            if (sq && sqD > MARINE_GROUP_RADIUS) {
                marineSteerToward(c, sq.x, sq.y, false);
                c.moveMul = 1;
            } else if (egg) {
                marineSteerToward(c, egg.x, egg.y, false);
                c.moveMul = 0.8;
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
        } else if (z && (!outnumbered || stalemate()) && nearestEgg(c.x, c.y) && dist(nearestEgg(c.x, c.y), c.x, c.y) < dz * 1.2) {
            /* eggs about as close as the zerg: go for the eggs */
            var ne = nearestEgg(c.x, c.y);
            marineSteerToward(c, ne.x, ne.y, false);
            c.moveMul = 0.8;
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
    /* kiting speed: marineKiteSpeed at every skill (the user's "short hops") */
    function marineKiteMul(S) { return MARINE_KITE_SPEED; }   /* short hops, not sprints: per-marine micro does the kiting */
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

    /* ---------------------------------------------------------------- control groups
     * marineGroupMode / zergGroupMode: each side plays like a human with hotkeys.
     * Every 0.5 s its army is split by proximity into at most *CgMax groups of
     * about *CgSize (banes get their own groups); every frame each group moves on
     * the consensus of what its members want (their intents, weighted by how much
     * they want to move) plus cohesion toward the group's centre - so a group
     * advances, holds, kites back or runs as one box. Shooting / biting stays
     * per unit, and a unit in immediate danger or in melee still acts alone. */
    var cgT = 0, cgSets = { marine: [], ling: [], bane: [] }, cgZerg = null, cgTarget = null;
    var pincerAxis = null;   /* line of approach, locked when the swarm commits */
    function cgSplit(list, k, key) {
        var n = list.length, i, g;
        if (!n) return [];
        if (k <= 1) { for (i = 0; i < n; i++) list[i][key] = 0; return [list]; }
        var cent = [];
        for (g = 0; g < k; g++) {
            var sx = 0, sy = 0, c = 0;
            for (i = 0; i < n; i++) if (list[i][key] === g) { sx += list[i].x; sy += list[i].y; c++; }
            cent.push(c ? { x: sx / c, y: sy / c } : null);
        }
        for (g = 0; g < k; g++) {
            if (cent[g]) continue;
            var bi = 0, bd = -1;
            for (i = 0; i < n; i++) {
                var md = 1e18;
                for (var h = 0; h < k; h++) if (cent[h]) md = Math.min(md, (list[i].x - cent[h].x) * (list[i].x - cent[h].x) + (list[i].y - cent[h].y) * (list[i].y - cent[h].y));
                if (md === 1e18) md = list[i].x;
                if (md > bd) { bd = md; bi = i; }
            }
            cent[g] = { x: list[bi].x, y: list[bi].y };
        }
        var cap = Math.ceil(n / k) + 2, label = [];
        for (var pass = 0; pass < 2; pass++) {
            var pairs = [];
            for (i = 0; i < n; i++) for (g = 0; g < k; g++) {
                var d = Math.sqrt((list[i].x - cent[g].x) * (list[i].x - cent[g].x) + (list[i].y - cent[g].y) * (list[i].y - cent[g].y));
                if (list[i][key] === g) d -= 40;   /* sticky membership */
                pairs.push([d, i, g]);
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
                for (i = 0; i < n; i++) if (label[i] === g) { ax += list[i].x; ay += list[i].y; an++; }
                if (an) cent[g] = { x: ax / an, y: ay / an };
            }
        }
        var out = [];
        for (g = 0; g < k; g++) out.push([]);
        for (i = 0; i < n; i++) { list[i][key] = label[i]; out[label[i]].push(list[i]); }
        return out.filter(function (o) { return o.length; });
    }
    function cgFrame(dt) {
        cgT -= dt;
        if (cgT <= 0) {
            cgT = 0.5;
            var ms = [], ls = [], bs = [];
            for (var i = 0; i < units.length; i++) {
                var u = units[i];
                u.cgGroup = null;
                if (u.dead) continue;
                if (u.kind === "marine" && MARINE_CG && u.entered && !(u.deployT > 0) && !u.hitSquad) ms.push(u);
                else if (u.kind === "ling" && ZERG_CG) ls.push(u);
                else if (u.kind === "bane" && ZERG_CG) ls.push(u);   /* banes travel inside the ling groups */
            }
            var kOf = function (n, size, max) { return Math.max(1, Math.min(max, Math.ceil(n / Math.max(1, size)))); };
            cgSets.marine = cgSplit(ms, kOf(ms.length, TB.marineCgSize, TB.marineCgMax), "cgm");
            if (hitSquad && hitSquad.members.length) cgSets.marine.push(hitSquad.members.filter(function (m) { return !m.dead; }));   /* the hit squad is its own group */
            var zMax = Math.max(1, Math.round(TB.zergCgMax || 1));
            cgSets.ling = cgSplit(ls, kOf(ls.length, TB.zergCgSize, zMax), "cgz");
            cgSets.bane = [];
            ["marine", "ling", "bane"].forEach(function (k) {
                cgSets[k] = cgSets[k].map(function (members) { return { members: members }; });
                cgSets[k].forEach(function (g) { g.members.forEach(function (m) { m.cgGroup = g; }); });
            });

        }
        /* per frame: centre + consensus heading / pace from last frame's intents */
        var zx = 0, zy = 0, zn = 0;
        cgSets.ling.forEach(function (g) { g.members.forEach(function (m) { if (!m.dead) { zx += m.x; zy += m.y; zn++; } }); });
        cgZerg = zn ? { x: zx / zn, y: zy / zn } : null;
        /* the pincer's target: the marine clump nearest the swarm (one target for
         * every ling group, so they agree on what "left" and "right" mean) */
        cgTarget = null;
        if (cgZerg) {
            var m0 = nearestMarine(cgZerg.x, cgZerg.y);
            if (m0) {
                var tx = 0, ty = 0, tn = 0;
                for (var ti = 0; ti < units.length; ti++) {
                    var tu = units[ti];
                    if (tu.kind === "marine" && !tu.dead && dist(tu, m0.x, m0.y) < MARINE_RANGE) { tx += tu.x; ty += tu.y; tn++; }
                }
                cgTarget = { x: tx / tn, y: ty / tn };
            }
        }
        ["marine", "ling", "bane"].forEach(function (k) {
            cgSets[k].forEach(function (g) {
                var cx = 0, cy = 0, vx = 0, vy = 0, go = 0, n = 0;
                for (var j = 0; j < g.members.length; j++) {
                    var m = g.members[j];
                    if (m.dead) continue;
                    n++; cx += m.x; cy += m.y;
                    var w = k === "marine" ? (m.intentMul === undefined ? 1 : m.intentMul) : 1;
                    var a = m.intent === undefined ? m.want : m.intent;
                    vx += Math.cos(a) * w; vy += Math.sin(a) * w; go += w;
                }
                if (!n) { g.n = 0; return; }
                g.n = n; g.cx = cx / n; g.cy = cy / n;
                g.dir = Math.atan2(vy, vx);
                g.go = go / n;
                if (k === "ling") {
                    var at = 0, st = 0;
                    for (var aj = 0; aj < g.members.length; aj++) { at += g.members[aj].attackT || 0; st += g.members[aj].stageT || 0; }
                    g.attackT = at / g.members.length;
                    g.stageT = st / g.members.length;
                }
                if (k !== "marine") {
                    var gm = nearestMarine(g.cx, g.cy);
                    g.tx = gm ? gm.x : 0; g.ty = gm ? gm.y : 0; g.td = gm ? dist(gm, g.cx, g.cy) : 1e9;
                }
                /* the box the group keeps: tight, unless banes are near (then spread) */
                g.baneNear = false;
                if (k === "marine") {
                    var gb = nearestKind(g.cx, g.cy, "bane");
                    g.baneNear = !!(gb && dist(gb, g.cx, g.cy) < MARINE_RANGE * 1.5);
                }
                /* surrounded (zerg close on opposite sides, or 3+ sides): close up back
                 * to back - a tight ring that holds and shoots outward */
                g.surrounded = false;
                if (k === "marine") {
                    var quad = [0, 0, 0, 0];
                    for (var qi = 0; qi < units.length; qi++) {
                        var qz = units[qi];
                        if (qz.dead || (qz.kind !== "ling" && qz.kind !== "bane")) continue;
                        var qdx = qz.x - g.cx, qdy = qz.y - g.cy;
                        if (qdx * qdx + qdy * qdy > MARINE_RANGE * MARINE_RANGE * 2.25) continue;
                        quad[Math.floor((Math.atan2(qdy, qdx) + Math.PI) / (Math.PI / 2)) & 3] = 1;
                    }
                    var sides = quad[0] + quad[1] + quad[2] + quad[3];
                    g.surrounded = sides >= 3 || (quad[0] && quad[2]) || (quad[1] && quad[3]);
                }
                /* box radius from the units' own size, so a full box never squeezes them
                 * into each other: about one body width apart, tighter when surrounded */
                var body = (k === "marine" ? MARINE_BUMP : k === "bane" ? BANE_BUMP : LING_BUMP) * 2;
                g.spread = Math.sqrt(n) * body * (g.surrounded ? 0.9 : g.baneNear ? 2 : 1.3);
                /* marine groups don't loiter: standing 3 s with nothing in reach, the
                 * group attack-moves on the nearest zerg (unless outnumbered), else
                 * heads for the eggs, else patrols */
                g.order = null;
                if (k === "marine" && patrolPlan) {
                    g.patrolHold = patrolPlan.phase === "hold";
                    if (patrolPlan.phase === "walk") {
                        var gi = cgSets.marine.indexOf(g), off = gi * 2.4;   /* each group a little apart round the spot */
                        var px = patrolPlan.x + (gi ? Math.cos(off) * 70 : 0), py = patrolPlan.y + (gi ? Math.sin(off) * 70 : 0);
                        g.order = Math.atan2(py - g.cy, px - g.cx);
                    }
                } else g.patrolHold = false;
                if (k === "marine" && !patrolPlan && !g.surrounded && terranPush) {
                    var engaged = false;
                    for (var ej = 0; ej < g.members.length; ej++) if (g.members[ej].shootTarget || (g.members[ej].aimDist || 1e9) < MARINE_RANGE * 1.1) { engaged = true; break; }
                    if (!engaged) g.order = Math.atan2(hiveY - g.cy, hiveX - g.cx);
                }
                if (k === "marine" && !patrolPlan && !g.surrounded && g.order === null) {
                    var idle = 0;
                    for (var ij = 0; ij < g.members.length; ij++) idle += g.members[ij].idleT || 0;
                    if (idle / g.members.length > 3) {
                        var oz = nearestZerg(g.cx, g.cy), oe = nearestEgg(g.cx, g.cy);
                        var outn = (countKind("ling") + countKind("bane")) * 0.5 > 2 * countKind("marine");
                        var ot = (oz && !outn) ? oz : oe ? oe : null;
                        if (!ot) { patrolWaypoint(); ot = { x: patrolX, y: patrolY }; }
                        g.order = Math.atan2(ot.y - g.cy, ot.x - g.cx);
                    }
                }
            });
        });
    }
    /* pincer roles from where each ling group already is: left of the line of
     * approach takes the left flank, right takes the right, the most central pins
     * from the front. Recomputed every frame, so roles never swap at random */
    function cgProngs() {
        var lg = cgSets.ling.filter(function (g) { return g.n; });
        lg.forEach(function (g) { g.prong = 0; });
        var anyAttack = lg.some(function (g) { return g.attackT > 0; });
        if (!anyAttack) pincerAxis = null;
        if (!cgTarget || !cgZerg || lg.length < 2) return;
        /* lock the line of approach when the attack starts: recomputing it from the
         * swarm's centre while the flanks swing round makes them chase their tails */
        if (pincerAxis === null || !anyAttack) {
            /* ovWallPress: come in from the open side (toward the middle of the map)
             * so the marines get pressed back against their own wall */
            pincerAxis = TB.ovWallPress ? Math.atan2(H / 2 - cgTarget.y, W / 2 - cgTarget.x)
                                        : Math.atan2(cgZerg.y - cgTarget.y, cgZerg.x - cgTarget.x);
        }
        var axis = pincerAxis;
        lg.forEach(function (g) {
            var o = Math.atan2(g.cy - cgTarget.y, g.cx - cgTarget.x) - axis;
            g.off = Math.atan2(Math.sin(o), Math.cos(o));
        });
        lg.sort(function (a, b) { return a.off - b.off; });
        lg[0].prong = -1;
        lg[lg.length - 1].prong = 1;
        for (var i = 1; i < lg.length - 1; i++) lg[i].prong = lg.length === 3 ? 0 : (i / (lg.length - 1)) * 2 - 1;
    }

    /* murmuration loops: one loop of 3 waypoints per pincer role (left / centre /
     * right), laid out round the home facing the marines and rebuilt every ~40 s
     * or when home moves; a group heads for its loop's current point and moves on
     * when it gets there (points too close to marines are skipped) */
    var murmurLoops = {};
    function murmurPoint(g) {
        var key = Math.round((g.prong || 0) * 2);
        var L = murmurLoops[key];
        if (!L || simT > L.until || L.hx !== hiveX || L.hy !== hiveY) {
            var mcn = marineCentroid(), face = mcn ? Math.atan2(mcn.y - hiveY, mcn.x - hiveX) : rand(0, 6.283);
            var base = face + (g.prong || 0) * 1.1, pts = [], R0 = Math.min(W, H);
            for (var i = 0; i < 3; i++) {
                var a = base + (i - 1) * 0.9 + rand(-0.3, 0.3), r = R0 * rand(0.12, 0.3);
                pts.push({ x: Math.max(40, Math.min(W - 40, hiveX + Math.cos(a) * r)), y: Math.max(40, Math.min(H - 40, hiveY + Math.sin(a) * r)) });
            }
            L = murmurLoops[key] = { pts: pts, i: 0, until: simT + 40, hx: hiveX, hy: hiveY };
        }
        for (var tries = 0; tries < 3; tries++) {
            var p = L.pts[L.i];
            var close = Math.sqrt((p.x - g.cx) * (p.x - g.cx) + (p.y - g.cy) * (p.y - g.cy)) < 60;
            if (close || nearestMarineDist(p.x, p.y) < threatRadius()) L.i = (L.i + 1) % L.pts.length; else return p;
        }
        return null;
    }

    /* steer a unit with its group: the consensus heading plus a pull back into
     * the box; returns false when the unit should act alone this frame */
    function cgSteer(c) {
        var g = c.cgGroup;
        if (!g || !g.n || g.n < 2) return false;
        var dx = g.cx - c.x, dy = g.cy - c.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        var pull = Math.max(0, (d - g.spread) / g.spread);   /* 0 inside the box */
        var dir = g.dir;
        /* Overmind pincer: on committing, each ling group first runs to its own
         * staging point just outside marine range - the flanks to the marines'
         * sides, the centre in front - then all collapse at once (in position,
         * or after ~5 s), sandwiching the marines from several sides */
        if (c.kind === "ling" && c.attacking && cgSets.ling.length > 1 && OV_SURROUND > 0 && zergSkill() >= 0.5 && cgTarget && cgZerg) {
            var T = cgTarget;
            var axis = pincerAxis === null ? Math.atan2(cgZerg.y - T.y, cgZerg.x - T.x) : pincerAxis;   /* from the marines toward the swarm, locked */
            var sa = axis + (g.prong || 0) * 1.75;                   /* flanks ~100 deg round to the sides */
            var sr = MARINE_RANGE * 1.25;
            var sx = Math.max(24, Math.min(W - 24, T.x + Math.cos(sa) * sr)), sy = Math.max(24, Math.min(H - 24, T.y + Math.sin(sa) * sr));
            var sd = Math.sqrt((sx - g.cx) * (sx - g.cx) + (sy - g.cy) * (sy - g.cy));
            var collapse = g.stageT > 4 || (sd < MARINE_RANGE * 0.35 && g.stageT > 1.5);   /* in position, or 4 s near them */
            if (!collapse) {
                /* spiral out to our side from the start: head for a point at our flank
                 * angle but only a little closer than we are now, so the groups split
                 * visibly early and swing round outside the marines' range */
                var gd = Math.sqrt((g.cx - T.x) * (g.cx - T.x) + (g.cy - T.y) * (g.cy - T.y));
                var rw = Math.max(sr, gd - MARINE_RANGE * 0.9);
                var wx = Math.max(24, Math.min(W - 24, T.x + Math.cos(sa) * rw)), wy = Math.max(24, Math.min(H - 24, T.y + Math.sin(sa) * rw));
                dir = Math.atan2(wy - g.cy, wx - g.cx);
                if (sd < MARINE_RANGE * 0.2) { c.want = Math.atan2(T.y - c.y, T.x - c.x); c.speed *= 0.15; return { go: 0, pull: 0 }; }   /* in position: wait, facing in */
            } else dir = Math.atan2(T.y - g.cy, T.x - g.cx);
        }
        /* not attacking: ling groups hold their own stations round the home - left,
         * right and centre facing the marines - so the swarm is several groups,
         * never one ball, and a pincer starts from positions already apart */
        /* murmuration: idle ling groups stream round their own loop of waypoints
         * near home (shift-clicked patrols), never parking in one ball */
        if (c.kind === "ling" && !c.attacking && !c.fleeing && !c.rallyTo && zergSkill() >= 0.5) {
            var wp = murmurPoint(g);
            if (wp) dir = Math.atan2(wp.y - g.cy, wp.x - g.cx);
        }
        var vx = Math.cos(dir) + dx / d * pull, vy = Math.sin(dir) + dy / d * pull;
        if (g.baneNear && !g.surrounded && d < g.spread) { vx -= dx / d * 0.7; vy -= dy / d * 0.7; }   /* split: open the box */
        if (g.surrounded) { c.want = Math.atan2(dy, dx); return { go: 0, pull: pull }; }   /* back to back: close in, hold */
        if (g.order !== null && g.order !== undefined) {   /* idle group: move out on its order */
            c.want = Math.atan2(Math.sin(g.order) + dy / d * pull, Math.cos(g.order) + dx / d * pull);
            return { go: 0.7, pull: pull };
        }
        c.want = Math.atan2(vy, vx);
        return { go: g.go, pull: pull };
    }

    /* Commander hit squads (marineHitSquads, marine skill 50%+): once the zerg are
     * spent from throwing themselves at the terran ball - below hitSquadTrigger of
     * their cap, or terran clearly on top - the 4 healthiest marines of the biggest
     * group break off, stim, and hunt: eggs first (the zerg's future), then the
     * nearest zerg. They rejoin when down to one, when the zerg recover, or after
     * 40 s. One squad at a time. */
    var hitSquad = null, hitSquadT = 0, terranPush = false;
    /* no zerg on the map at all: the marines patrol - walk to a new spot (up to
     * 10-20 s), hold there 10-20 s (milling about is fine), pick the next */
    var patrolPlan = null;
    function updatePatrol(dt) {
        /* the marines hold the map (zerg out of the round, or under 15% of their cap
         * with none in sight): patrol end to end and corner to corner, ~95% moving -
         * walk to the far point, a 1-3 s look round, next point */
        var zl = countKind("ling") + countKind("bane");
        var mc = marineCentroid();
        var quiet = zergComeback || zergWipeT > 0 || (zl < (MAX_LINGS + MAX_BANES) * 0.15 && (!mc || !nearestZerg(mc.x, mc.y) || dist(nearestZerg(mc.x, mc.y), mc.x, mc.y) > MARINE_RANGE * 2.5));
        if (!quiet || !mc) { patrolPlan = null; return; }
        if (!patrolPlan) patrolPlan = { x: 0, y: 0, phase: "hold", t: 0 };
        patrolPlan.t -= dt;
        if (patrolPlan.phase === "walk") {
            var there = Math.sqrt((mc.x - patrolPlan.x) * (mc.x - patrolPlan.x) + (mc.y - patrolPlan.y) * (mc.y - patrolPlan.y)) < 80;
            if (there || patrolPlan.t <= 0) { patrolPlan.phase = "hold"; patrolPlan.t = rand(1, 3) * Math.max(1, gameSpeed); }
        } else if (patrolPlan.t <= 0) {
            /* next point: the corner or edge middle farthest-ish from where we are */
            var pts = [[0.12, 0.15], [0.88, 0.15], [0.12, 0.85], [0.88, 0.85], [0.5, 0.15], [0.5, 0.85], [0.12, 0.5], [0.88, 0.5]];
            pts.sort(function (a, b) {
                return Math.hypot(b[0] * W - mc.x, b[1] * H - mc.y) - Math.hypot(a[0] * W - mc.x, a[1] * H - mc.y);
            });
            var pick = pts[Math.floor(Math.random() * 3)];   /* one of the 3 farthest */
            patrolPlan.phase = "walk"; patrolPlan.t = 30 * Math.max(1, gameSpeed);
            patrolPlan.x = pick[0] * W; patrolPlan.y = pick[1] * H;
        }
    }
    function terranCommander(dt) {
        /* push: the zerg are below 60% of their cap and the marines are at 70%+ -
         * every marine group not fighting attack-moves on the zerg home, to camp it
         * (no eggs while marines are there) and finish the swarm */
        var zFrac = (countKind("ling") + countKind("bane")) / Math.max(1, MAX_LINGS + MAX_BANES);
        var mFrac = countKind("marine") / Math.max(1, MAX_MARINES);
        terranPush = MARINE_CG && marineSkill() >= 0.5 && (terranPush ? zFrac < 0.75 && mFrac > 0.5 : zFrac < 0.6 && mFrac >= 0.7);
        hitSquadT -= dt;
        if (hitSquad) {
            hitSquad.t += dt;
            hitSquad.members = hitSquad.members.filter(function (m) { return !m.dead; });
            var zLeft = (countKind("ling") + countKind("bane")) / Math.max(1, MAX_LINGS + MAX_BANES);
            if (hitSquad.members.length < 2 || hitSquad.t > 40 || zLeft > (+TB.hitSquadTrigger || 0.45) + 0.2) {
                hitSquad.members.forEach(function (m) { m.hitSquad = null; });
                hitSquad = null;
                hitSquadT = 8;   /* a breather before the next one */
                return;
            }
            if ((hitSquad.retarget -= dt) <= 0) {
                hitSquad.retarget = 1;
                var cx = 0, cy = 0;
                hitSquad.members.forEach(function (m) { cx += m.x; cy += m.y; });
                cx /= hitSquad.members.length; cy /= hitSquad.members.length;
                hitSquad.target = nearestEgg(cx, cy) || nearestZerg(cx, cy);
            }
            return;
        }
        if (!TB.marineHitSquads || !MARINE_CG || marineSkill() < 0.5 || hitSquadT > 0) return;
        var zs = (countKind("ling") + countKind("bane")) / Math.max(1, MAX_LINGS + MAX_BANES);
        if (countKind("marine") < 6 || !(zs < (+TB.hitSquadTrigger || 0.45) || shellShare > 0.65)) return;
        if (!countKind("ling") && !countKind("bane") && !countKind("egg")) return;
        var big = null;
        cgSets.marine.forEach(function (g) { if (!big || g.members.length > big.members.length) big = g; });
        if (!big || big.members.length < 5) return;
        var pick = big.members.filter(function (m) { return !m.dead && m.hp >= MARINE_HP * 0.8; })
                              .sort(function (a, b) { return b.hp - a.hp; })
                              .slice(0, Math.max(2, Math.round(+TB.hitSquadSize || 4)));
        if (pick.length < 2) return;
        hitSquad = { members: pick, t: 0, retarget: 0, target: null };
        pick.forEach(function (m) { m.hitSquad = hitSquad; stimMarine(m, marineSkill()); });
        cgT = 0;   /* regroup now so the squad becomes its own group */
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
            var myV = 1e9, stimV = 1e9, stimReady = true, feet = Math.min(1, marineFootwork(S) * marineKiteMul(S));
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
        if (b && bd < BANE_SPLASH_R * 1.2) {   /* a marine 1v1s a bane fine: only dodge one that's on us */
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
                /* hysteresis so it doesn't ping-pong: back off under 50% range until
                 * past 60%, push in beyond 85% until inside 75%, else strafe slowly */
                var szd = dist(sz, c.x, c.y), R0 = MARINE_RANGE;
                if (c.stimMove === "back" ? szd < R0 * 0.6 : szd < R0 * 0.5) c.stimMove = "back";
                else if (c.stimMove === "in" ? szd > R0 * 0.75 : szd > R0 * 0.85) c.stimMove = "in";
                else c.stimMove = "strafe";
                if (c.stimMove === "back") { marineSteerToward(c, sz.x, sz.y, true); c.moveMul = 1; }
                else if (c.stimMove === "in") { c.want = MARINE_FLANK_ON ? marineFlankDir(c, sz.x, sz.y, S) : Math.atan2(sz.y - c.y, sz.x - c.x); c.moveMul = 0.8; }
                else { c.want = Math.atan2(sz.y - c.y, sz.x - c.x) + Math.PI / 2 * (c.flankSide || 1); c.moveMul = 0.3; }
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
    /* ling attack cry: once when a new attack starts across the whole swarm
     * (nobody attacking -> someone attacking), at most every 8 game-seconds -
     * not every time a stretched swarm's clusters split and re-commit */
    var zergWasAttacking = false, attackCryT = 0;
    function attackCry() {
        var on = false;
        for (var i = 0; i < units.length; i++) {
            var u = units[i];
            if (!u.dead && u.attacking && (u.kind === "ling" || u.kind === "bane")) { on = true; break; }
        }
        if (on && !zergWasAttacking && simT >= attackCryT) { sound("lingAttack"); attackCryT = simT + 8; }
        zergWasAttacking = on;
    }

    var allInOn = false, allInLaunched = false, marineCycle = 10;
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
        /* Overmind all-in (ovAllIn, zergSkill 50%+): save it all up - no new attack
         * until the swarm is at ovAllInFrac of its full cap with the banes in, and
         * only in a gap between marine reinforcements (next pulse ovReinforceGap s
         * off) - then EVERYTHING goes at once to crush them before help arrives */
        var allInMode = !!TB.ovAllIn && zergSkill() >= 0.5;
        if (allInMode) {
            var zTotal = countKind("ling") + countKind("bane"), zCapAll = MAX_LINGS + MAX_BANES;
            /* a wave just landed: at least half the current reinforcement cycle (capped
             * at ovReinforceGap s) is still to go */
            var gapOK = marineTimer > Math.min(+TB.ovReinforceGap || 0, marineCycle * 0.5) && wavePending === 0;
            var settled = simT / Math.max(1, gameSpeed) > 60;   /* not in the opening minute: let the armies feel each other out */
            if (!allInOn && settled && committedPower === 0 && countKind("marine") > 0 && zTotal >= zCapAll * (+TB.ovAllInFrac || 0.9) && banesReady() && gapOK) {
                allInOn = true;
                pincerAxis = null;   /* lock a fresh approach for this push */
            }
            /* the all-in is to the death: no "no hope" retreat - it ends only when the
             * marines or the committed zerg are all dead */
            if (allInOn && (countKind("marine") === 0 || (committedPower === 0 && allInLaunched))) { allInOn = false; allInLaunched = false; }
            if (allInOn && committedPower > 0) { allInLaunched = true; keepGoing = true; }
        } else { allInOn = false; allInLaunched = false; }
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
                /* Overmind composition: without enough banes the swarm hides - "cornered"
                 * only counts against a wall, and a berserk bane doesn't drag the swarm in */
                var ready = banesReady();
                var wcd = Math.max(ZERG_CORNER, 0.12) * Math.min(W, H);
                var wallPinned = ((cx < wcd) + (cx > W - wcd) + (cy < wcd) + (cy > H - wcd)) >= 1 &&
                                 dmx * dmx + dmy * dmy < (MARINE_RANGE * 0.8) * (MARINE_RANGE * 0.8);
                if (!ready) { cornered = cornered && wallPinned; berserkBane = false; }
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
                /* Overmind: no attack without banes - wait until ovBaneShare of the bane
                 * cap has hatched (cornered or a berserk bane still means fight) */
                if (attack && !committed && !cornered && !berserkBane && !ready) { attack = false; stalk = false; }   /* chill and hide until the banes are in */
                /* all-in mode: new attacks only as part of the big push (or a wall fight) */
                /* save it all up: in all-in mode the only attack is the big push (or a wall fight) */
                if (allInMode) {
                    if (allInOn) { attack = true; stalk = false; }
                    else if (attack && !committed && !(cornered && wallPinned)) { attack = false; stalk = false; }
                }
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
            /* a fight is on next to us: join it (once the banes are in) */
            if (!attack && keepGoing && m && (banesReady() || (cx < Math.min(W, H) * 0.12 || cx > W - Math.min(W, H) * 0.12 || cy < Math.min(W, H) * 0.12 || cy > H - Math.min(W, H) * 0.12))) {
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

            var musterT = zergSkill() >= 0.3 ? (+TB.ovMuster || 0) : 0;
            for (i = 0; i < zs.length; i++) {
                if (zs[i].cluster !== k) continue;
                var far = front && zs[i].kind === "ling" && dist(zs[i], front.x, front.y) >= joinR;
                var was = zs[i].attacking;
                /* Overmind muster: a newborn ling first gathers with its friends at the
                 * hive (ovMuster s) - it doesn't run off to a fight on its own */
                if (zs[i].kind === "ling" && !was && zs[i].age < musterT && !allInOn) {
                    zs[i].attacking = false; zs[i].stalking = false; zs[i].rallyTo = null;
                    continue;
                }
                zs[i].attacking = (attack && (allInOn || !(far && !was))) || (was && keepGoing);   /* straggling lings don't charge in late; banes always go with the swarm; committed stays committed */
                zs[i].stalking = stalk;
                /* reinforcing a fight that's on: only as a pack (4+ idle friends close by) */
                var pack = true;
                if ((attack || stalk) && far && !zs[i].attacking && musterT > 0) {
                    var friends = 0;
                    for (var fj = 0; fj < zs.length && friends < 4; fj++) {
                        var fz = zs[fj];
                        if (fz !== zs[i] && fz.kind === "ling" && !fz.attacking && dist(fz, zs[i].x, zs[i].y) < ALLY_RADIUS) friends++;
                    }
                    pack = friends >= 4;
                }
                zs[i].rallyTo = (attack || stalk) && far && !zs[i].attacking && pack ? front : null;
                if (stalk) zs[i].stalkDir = stalkDir;
            }
        }
    }

    function step(c, dt) {
        if (c.kind === "egg") {
            if (c.frozen) {
                if (zergWipeT > 0) return;   /* frozen through the downtime */
                c.frozen = false;
            }
            if (c.dormant) {
                if (countKind("marine") === 0) return;   /* waiting for the terrans */
                c.dormant = false;
                c.t = (c.hatchT || EGG_TIME_MIN) * rand(0.3, 0.85);   /* wake staggered: hatch over a few seconds */
            }
            c.t += dt * (c.hatchMult || 1);
            return;
        }
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
            if (MARINE_CG && c.intent !== undefined) c.want = c.intent;   /* decide from our own intent, not last frame's group move */
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
            /* control group: move on the group's consensus (shooting stays ours);
             * a bane about to blow or a hunt is the only reason to act alone */
            if (c.hitSquad && c.hitSquad.target && !c.hitSquad.target.dead && !c.huntTarget) {
                var ht = c.hitSquad.target, htd = dist(ht, c.x, c.y);
                if (htd > MARINE_RANGE * 0.75) { c.want = Math.atan2(ht.y - c.y, ht.x - c.x); c.moveMul = 1; }
                else if (c.moveMul > 0.3 && !(c.stimT > 0)) c.moveMul = 0;   /* in range: plant and shoot */
            }
            c.idleT = (c.moveMul < 0.15 && !c.shootTarget && (c.aimDist || 1e9) > MARINE_RANGE * 1.2) ? (c.idleT || 0) + dt : 0;
            c.intent = c.want; c.intentMul = c.moveMul;
            if (MARINE_CG && c.cgGroup && c.entered && !(c.deployT > 0) && !c.huntTarget) {
                var cb0 = nearestKind(c.x, c.y, "bane");
                if (!(cb0 && dist(cb0, c.x, c.y) < BANE_SPLASH_R)) {   /* only a bane right on top of us breaks formation */
                    var gs = cgSteer(c);
                    if (gs) c.moveMul = gs.go < 0.2 && gs.pull <= 0 ? 0 : Math.max(gs.go, Math.min(1, gs.pull));
                }
            }
            /* run in straight legs: once moving, hold the line for a short leg; a
             * sharp change of direction (60+ deg) plants the feet for a beat and
             * pivots first - no ankle-breaking zig-zags. A bane about to blow is
             * the only excuse for dodging at once */
            if (c.entered && c.deployT <= 0 && skill > 0) {
                var lb = nearestKind(c.x, c.y, "bane");
                var urgent = lb && dist(lb, c.x, c.y) < BANE_SPLASH_R * 2;
                if (c.stopT > 0) {
                    c.stopT -= dt;
                    c.moveMul = 0;
                    if (c.stopT <= 0) { c.legDir = c.want; c.legT = 0.35; c.heading = c.want; }
                } else if (c.moveMul > 0) {
                    if (c.legT > 0 && !urgent) {
                        c.legT -= dt;
                        c.want = c.legDir;
                    } else {
                        var ld = c.want - (c.legDir === undefined ? c.want : c.legDir);
                        while (ld > Math.PI) ld -= 6.283;
                        while (ld < -Math.PI) ld += 6.283;
                        if (c.wasMoving && Math.abs(ld) > 1.05 && !urgent) { c.stopT = 0.12; c.moveMul = 0; }
                        else { c.legDir = c.want; c.legT = 0.35; }
                    }
                } else c.legT = 0;
                c.wasMoving = c.moveMul > 0;
            }
            turnToward(c, c.deployT > 0 ? MARINE_TURN : marineTurnRate(skill), dt);
            /* quick feet only where they help: kiting and running back to the mob */
            var feet = c.deployT > 0 ? 1 : marineFootwork(skill);
            if ((c.combat && c.kitePhase === "run") || c.regroupTo) feet *= marineKiteMul(skill);
            /* marines are naturally a bit slower than lings and banes: never above
             * their base pace unless stimmed (stim is how they outrun a chase) */
            feet = Math.min(1, feet);
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
                /* nothing in sight: a marine in a group watches outward, away from the
                 * group's centre, so the group covers every side (not facing in) */
                var og = c.cgGroup;
                if ((!tgt || dist(tgt, c.x, c.y) > MARINE_RANGE * 2.5) && og && og.n > 1 && og.go < 0.2 &&   /* no zerg within vision (2.5x range) */
                    (c.x - og.cx) * (c.x - og.cx) + (c.y - og.cy) * (c.y - og.cy) > 36) c.aim = Math.atan2(c.y - og.cy, c.x - og.cx);
                c.aimDist = tgt ? dist(tgt, c.x, c.y) : 1e9;
            }
            if (MARINE_UPRIGHT) {
                /* sprite angle: firing -> turn quickly to the target; otherwise ease
                 * back upright (feet to the bottom of the screen), facing the way we
                 * walk, leaning up to marineWalkTilt degrees with the slope of the walk
                 * (plus a small personal lean), so marines never walk on their heads */
                /* zerg within 1.5x range: gun already up and on it before the first shot */
                /* gun up inside 1.5x range, down only past 1.8x (no flicking at the line) */
                var readyR = MARINE_RANGE * (c.gunUp ? 1.8 : 1.5);
                var firing = !!c.shootTarget || c.flashT > 0 || (c.aimDist || 1e9) < readyR;
                c.gunUp = firing;
                if (firing) {
                    var da = c.aim - c.drawAng;
                    while (da > Math.PI) da -= 6.283;
                    while (da < -Math.PI) da += 6.283;
                    var vdt = dt / Math.max(1, gameSpeed);   /* real time, so high speeds don't spin the sprite */
                    var turn = da * (1 - Math.exp(-vdt * (c.shootTarget ? 14 : 8))), cap = 9 * vdt;   /* max ~9 rad/s */
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
                    /* grouped and nothing in sight: face outward from the group's centre */
                    var og2 = c.cgGroup;
                    if (og2 && og2.n > 1 && og2.go < 0.2 && (c.aimDist || 1e9) > MARINE_RANGE * 2.5) {
                        var ox = c.x - og2.cx, oy = c.y - og2.cy;
                        if (ox * ox + oy * oy > 36) { nc = ox; ns = oy; }
                    }
                    var nl = Math.sqrt(nc * nc + ns * ns) || 1;
                    nc /= nl; ns /= nl;
                    /* side flips (instant mirror) at most every 0.4 real seconds */
                    var udt = dt / Math.max(1, gameSpeed);
                    c.sideCd = Math.max(0, (c.sideCd || 0) - udt);
                    var side = nc > 0.2 ? 0 : nc < -0.2 ? Math.PI : c.walkSide;
                    if (side !== c.walkSide && c.sideCd <= 0) { c.walkSide = side; c.sideCd = 0.4; }
                    var maxTilt = (TUNING.marineWalkTilt || 0) * Math.PI / 180;
                    var wantTilt = Math.max(-maxTilt, Math.min(maxTilt, ns * maxTilt * 1.2 + c.leanBias * maxTilt * 0.25));
                    c.tiltAng += (wantTilt - c.tiltAng) * (1 - Math.exp(-udt * 4));
                    /* ease into the upright pose (real-time capped), never snap to it */
                    var pose = c.walkSide ? Math.PI - c.tiltAng : c.tiltAng;
                    var pd = pose - c.drawAng;
                    while (pd > Math.PI) pd -= 6.283;
                    while (pd < -Math.PI) pd += 6.283;
                    if (Math.abs(pd) > 2.4) c.drawAng = pose;   /* a side flip: mirror at once (not a roll through vertical) */
                    else c.drawAng += Math.max(-9 * udt, Math.min(9 * udt, pd * (1 - Math.exp(-udt * 10))));
                }
                c.wasIdle = !firing;
            }
        } else {
            /* ling / bane: only pick a direction every RETARGET_T (anti-jitter) */
            c.age += dt;
            if (ZERG_CG && c.intent !== undefined) c.want = c.intent;
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
            if (c.attacking) c.attackT = (c.attackT || 0) + dt; else c.attackT = 0;
            /* pincer staging clock: only runs once the ling is near the target clump */
            if (c.attacking && cgTarget && dist(c, cgTarget.x, cgTarget.y) < MARINE_RANGE * 2.2) c.stageT = (c.stageT || 0) + dt;
            else if (!c.attacking) c.stageT = 0;
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
                    if (m && dist(m, c.x, c.y) < MARINE_RANGE * 0.6 && (!smartBane || lingsFightingNear(c))) wantGo = true, c.berserk = true;
                    /* smart bane, marines close, no lings with it: back off to the lings, don't roll in alone */
                    if (smartBane && !c.berserk && !lingsFightingNear(c) && m && dist(m, c.x, c.y) < MARINE_RANGE * 1.2) wantGo = false;
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
                        c.speed = rand(24, 40) * (bd > hold ? 1 : 0.4);
                        c.fleeing = false;
                    } else if (wantGo) {
                        c.berserk = true;
                        c.holdT = 0;
                        c.fleeing = false;
                        /* smart banes keep pace with the lings: sprint only for the last
                         * stretch (inside half range); ahead of the lings with none
                         * fighting near, ease off and let them catch up */
                        var bmd = dist(m, c.x, c.y);
                        if (smartBane && bmd > MARINE_RANGE * 0.5) {
                            charge(c, m, 24, 40, lingsFightingNear(c) ? 1.1 : 0.9);   /* keep pace with the lings */
                        } else charge(c, m, 24, 40, BERSERK_SPEED_MULT);
                    } else {
                        fallBack(c, 24, 40);
                    }
                }
            }
            /* control group: move with the group unless already in melee range */
            c.intent = c.want;
            if (ZERG_CG && c.cgGroup) {
                var zm = nearestMarine(c.x, c.y);
                if (!(zm && dist(zm, c.x, c.y) < MARINE_RANGE * 0.4) && !(c.kind === "bane" && c.berserk && zm && dist(zm, c.x, c.y) < MARINE_RANGE * 0.8)) cgSteer(c);
            }
            if (c.kind === "ling" && c.attacking) lingEncircle(c);
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
            var rdt = dt / Math.max(1, gameSpeed);   /* visuals run on real time: same look at any speed */
            c.smoothAim += Math.max(-9 * rdt, Math.min(9 * rdt, sda * (1 - Math.exp(-rdt * 12))));
        }
        /* horizontal facing with hysteresis (wider for marines: no flip-flopping) */
        var ang = (c.kind === "marine") ? (MARINE_UPRIGHT ? c.drawAng : c.smoothAim) : c.heading;
        var cosh = Math.cos(ang), fh = c.kind === "marine" ? 0.45 : 0.3;
        /* a marine can't flip left/right more than every ~0.3 real seconds: at high
         * speed the flips otherwise strobe into a double image */
        if (c.kind === "marine") c.faceCd = Math.max(0, (c.faceCd || 0) - dt / Math.max(1, gameSpeed));
        var want = cosh > fh ? 1 : cosh < -fh ? -1 : c.face;
        if (want !== c.face && !(c.kind === "marine" && c.faceCd > 0)) { c.face = want; if (c.kind === "marine") c.faceCd = 0.3; }

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

    function simStep(dt) {

        /* zerg wiped out (no lings, banes or eggs): the brood comes back only after
         * zergWaveLo..Hi s, like a marine wave after a wipe. While any zerg live,
         * lost lings refill every respawnInterval s. */
        /* blue shell: the zerg are wiped once every ling and bane is dead - leftover
         * eggs freeze for the downtime and hatch with the comeback brood (otherwise
         * slow eggs always on the board mean terran can never finish them) */
        var zergAlive = countKind("ling") + countKind("bane") + (SETTINGS.blueShell ? 0 : countKind("egg")) > 0;
        /* blueShellWait is in REAL seconds (whatever the speed): x gameSpeed in game time */
        var shell = !!SETTINGS.blueShell, shellWait = (+TUNING.blueShellWait || 60) * Math.max(1, gameSpeed), shellBoost = +TUNING.blueShellBoost || 0;
        if (zergWasAlive && !zergAlive && !zergComeback) {
            zergWipeT = shell ? shellWait * rand(0.67, 1.33) : rand(TUNING.zergWaveLo || 0, TUNING.zergWaveHi || 0);
            if (shell) for (var fe = 0; fe < units.length; fe++) if (units[fe].kind === "egg" && !units[fe].dead) units[fe].frozen = true;
            if (shell) { zergComeback = true; trickleZ = trickleTimes(zergWipeT); }
            victory("terran");
        }
        /* trickles: a few small broods while the zerg are out of the round */
        while (zergComeback && trickleZ.length && simT >= trickleZ[0]) {
            trickleZ.shift();
            var tk = 1 + Math.floor(Math.random() * 2);   /* 1-2 eggs = 2-4 lings */
            for (var tki = 0; tki < tk; tki++) { var te = make("egg", "ling"); placeEggAtHive(te); units.push(te); }
        }
        zergWasAlive = zergAlive;
        if (zergWipeT > 0) {
            zergWipeT -= dt;
            /* blue shell: the brood comes back big - up to (1 + blueShellBoost) x its cap */
            if (zergWipeT <= 0 && zergComeback) {
                zergComeback = false; trickleZ = [];
                if (TB.zergHomeQuadrant) pickZergHome();   /* the comeback brood finds a new home: one corner */
                zergRushFill = rand(5, 10);   /* eggs come 5-10x faster until the swarm is full */
                zergBoostLeft = Math.round(MAX_LINGS * (1 + shellBoost));
                respawnLeftLings = Math.max(respawnLeftLings, zergBoostLeft);
            }
        }
        var marinesAliveNow = countKind("marine") > 0;
        if (marinesWereAlive && !marinesAliveNow && !marineComeback) {
            victory("zerg");
            if (shell) { marineComeback = true; wavePending = 0; marineTimer = shellWait * rand(0.67, 1.33); trickleM = trickleTimes(marineTimer); }
        }
        /* trickles: a few small squads while the terrans are out of the round */
        while (marineComeback && trickleM.length && simT >= trickleM[0]) {
            trickleM.shift();
            wavePending = 2 + Math.floor(Math.random() * 3);   /* 2-4 marines */
            planDrops(false, 1);
        }
        marinesWereAlive = marinesAliveNow;
        /* who's winning, smoothed over ~10 s: each side's units against its own cap */
        var shM = countKind("marine") / Math.max(1, MAX_MARINES), shZ = (countKind("ling") + countKind("bane")) / Math.max(1, MAX_LINGS + MAX_BANES);
        shellShare += ((shM + shZ > 0 ? shM / (shM + shZ) : 0.5) - shellShare) * (1 - Math.exp(-dt / 10));
        var tDom = shell ? Math.max(0, (shellShare - 0.55) / 0.45) : 0;   /* terran on top: 0..1 */
        var zDom = shell ? Math.max(0, (0.45 - shellShare) / 0.45) : 0;   /* zerg on top */
        var shellDom = +TUNING.blueShellDom || 0;

        /* growth mode: both sides' caps keep rising (growthRate x base per minute,
         * up to growthMax) so the armies snowball until one side pulls off the
         * meat grinder and wipes the other off the board; then caps reset */
        if (SETTINGS.growthMode) {
            /* growth comes in spurts: every growthEvery real seconds the caps step up
             * (same average rate), leaving plateaus long enough for a side to max out
             * and finish the other before the next spurt */
            growthT += dt / Math.max(1, gameSpeed);
            var every = Math.max(1, +TUNING.growthEvery || 1), gstep = 0;
            if (growthT >= every) { growthT -= every; gstep = (+TUNING.growthRate || 0) * every / 60; }
            var gm = Math.min(Math.max(1, +TUNING.growthMax || 1), growthMul + gstep);
            if (Math.abs(gm - growthMul) > 1e-9) {
                var before = MAX_LINGS;
                growthMul = gm;
                applyUnitScale();
                if (MAX_LINGS > before) respawnLeftLings += MAX_LINGS - before;   /* eggs fill the new room */
            }
        } else if (growthMul !== 1) { growthMul = 1; applyUnitScale(); }

        /* blue shell, terran gone: the zerg lay spare eggs all over the map (up to
         * 1.5x the cap), dormant until marines show up - a field of targets for the
         * comeback wave */
        var noMarines = countKind("marine") === 0 && wavePending === 0;
        if (shell && noMarines && zergAlive && pendingLings() + respawnLeftLings < MAX_LINGS) respawnLeftLings++;

        /* new lings spawn as eggs, 2 at a time, slowly. Blue shell: while terran
         * dominates, refills come less often but in bigger batches (the loser's
         * waves grow), and a comeback brood may overfill the cap */
        /* marines on the zerg spawn: no eggs are laid while any marine is within
         * range of the hive - camping the hive is how terran finishes the zerg */
        var hiveCamped = nearestMarineDist(hiveX, hiveY) < MARINE_RANGE * 1.2;
        /* blue shell, broken swarm: down below 30% of the cap while terran holds the
         * upper hand, the zerg stop laying eggs - the marines can finish them, and
         * the wipe brings the big comeback */
        var brokenNow = shell && zergAlive && zergBoostLeft <= 0 &&
                        (countKind("ling") + countKind("bane")) < (MAX_LINGS + MAX_BANES) * 0.4 && shellShare > 0.55;
        zergBrokenT = brokenNow ? zergBrokenT + dt : 0;
        var zergBroken = brokenNow && zergBrokenT < 40;   /* at most 40 s: fast lings can't be hunted down forever */
        if (respawnLeftLings > 0 && zergWipeT <= 0 && !hiveCamped && !zergBroken) {
            respawnTimer -= dt;
            if (respawnTimer <= 0) {
                if (zergRushFill && pendingLings() >= MAX_LINGS) zergRushFill = 0;   /* full: back to normal */
                respawnTimer = RESPAWN_T * (1 + shellDom * tDom) / (zergRushFill || 1);
                var n = 0, batch = Math.round(RESPAWN_BATCH * (1 + shellDom * tDom * 1.5)) * (zergBoostLeft > 0 ? 2 : 1);
                var zcap = MAX_LINGS * (1 + shellBoost * tDom) + Math.max(0, zergBoostLeft);

                while (respawnLeftLings > 0 && n < batch && pendingLings() < zcap) {
                    var egg = make("egg", "ling");
                    if (shell && noMarines) {
                        placeEggNearEgg(egg);   /* the egg field creeps outward over time */
                        egg.dormant = true;
                    } else placeEggAtHive(egg);
                    units.push(egg);
                    respawnLeftLings--;
                    if (zergBoostLeft > 0) zergBoostLeft--;
                    n++;
                }
            }
        }

        /* marines enter in pairs from the map edge farthest from the zerg */
        marineTimer -= dt;
        if (patrolT > 0) patrolT -= dt;
        /* blue shell, broken army: marines down below 30% of their cap while the zerg
         * are clearly on top get no reinforcements for up to 40 s - the zerg can
         * finish them, and the wipe brings the big terran comeback */
        var mBrokenNow = shell && countKind("marine") > 0 && !marineComeback &&
                         ((countKind("marine") < MAX_MARINES * 0.3 && shellShare < 0.4) ||
                          (allInOn && countKind("marine") < MAX_MARINES * 0.5));   /* a crushing all-in cuts off reinforcements */
        marineBrokenT = mBrokenNow ? marineBrokenT + dt : 0;
        if (mBrokenNow && marineBrokenT < 40) marineTimer = Math.max(marineTimer, dt);
        if (marineTimer <= 0) {
            var marinesAlive = countKind("marine") > 0;
            var mInt = marinesAlive ? rand(MARINE_LO2, MARINE_HI2) : rand(MARINE_LO, MARINE_HI);
            if (shell && marinesAlive) mInt = Math.max(mInt, +TUNING.blueShellPulse || 0);   /* reinforcements in pulses */
            marineTimer = mInt * (1 + shellDom * zDom) / MARINE_SPAWN_RATE;   /* blue shell: the loser waits longer... */
            marineCycle = marineTimer;
            /* count: respawn size while alive, wave size when starting fresh */
            var wave = marinesAlive ?
                Math.round(rand(MARINE_RESPAWN_SIZE_LO, MARINE_RESPAWN_SIZE_HI) * (1 + shellDom * zDom * 2)) :   /* ...but comes back bigger */
                Math.round(rand(MARINE_WAVE_SIZE_LO, MARINE_WAVE_SIZE_HI));
            var mcap = MAX_MARINES * (1 + shellBoost * zDom);
            if (shell && marinesAlive) wave = Math.max(wave, Math.round(mcap) - countKind("marine"));   /* a pulse refills the losses */
            var flood = false;
            if (marineComeback) {
                /* blue shell comeback after a wipe: up to (1 + blueShellBoost) x the cap */
                marineComeback = false; trickleM = []; flood = true;
                /* D-day: ~10x a normal reinforcement wave (at least the boosted cap) */
                /* D-day: 2-5x a normal (after-a-wipe) wave, from both sides */
                var dday = Math.round((MARINE_WAVE_SIZE_LO + MARINE_WAVE_SIZE_HI) / 2 * rand(+TB.ddayMin || 2, +TB.ddayMax || 5));
                mcap = Math.max(MAX_MARINES, dday);
                wave = Math.round(mcap * rand(0.9, 1));
            }
            wavePending = Math.max(0, Math.min(wave, Math.round(mcap) - countKind("marine")));
            /* marines arrive two by two: round down to pairs (a lone marine only
             * when maxMarines is 1) */
            if (wavePending > 0) planDrops(flood);
        }

        /* release the queued wave: all of it at once, out of the drop points */
        if (wavePending > 0) {
            releaseDrops(wavePending);
            wavePending = 0;
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
            /* waiting on banes for an attack: morph three times as often */
            if (baneSlots > 0 && Math.random() < TB.morphChancePerSec * (banesReady() ? 1 : 3) * dt) {
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
        attackCry();
        updatePatrol(dt);
        terranCommander(dt);
        cgFrame(dt);
        cgProngs();
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
                    mc.shootCd = SHOOT_T / (mc.stimT > 0 ? Math.max(1, +TB.stimFireMult || 1) : 1);   /* stim: faster trigger */
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
        if (lastMarineCount > 0 && mc2 === 0 && !SETTINGS.blueShell) {   /* blue shell sets its own (longer) wait */
            marineTimer = rand(MARINE_LO, MARINE_HI) / MARINE_SPAWN_RATE;
        }
        lastMarineCount = mc2;

    }

    /* one frame: the sim advances in sub-steps of at most 0.12 game-seconds, so any
     * speed multiplier (the unlocked Speed box) runs truly faster without units
     * jumping through each other; then everything is drawn once */
    function frame(t) {
        if (!lastT) lastT = t;
        var total = Math.min(2.4, Math.min(0.05, (t - lastT) / 1000) * gameSpeed);
        lastT = t;
        ctx.clearRect(0, 0, W, H);
        var steps = Math.max(1, Math.ceil(total / 0.12));
        for (var si = 0; si < steps; si++) simStep(total / steps);
        var dt = total;
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
        zergHome = TB.zergHomeQuadrant ? { x: hx < W / 2 ? W * 0.25 : W * 0.75, y: hy < H / 2 ? H * 0.25 : H * 0.75 } : null;
        lastSpawnU = null; marineSide = -1; marineSideSince = -1e9;
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
        hitSquad = null; hitSquadT = 0; trickleM = []; trickleZ = []; terranPush = false; patrolPlan = null; zergRushFill = 0;
        allInOn = false; allInLaunched = false;
        shellShare = 0.5; marineComeback = false; zergComeback = false; zergBoostLeft = 0; zergBrokenT = 0; marineBrokenT = 0;
        marineTimer = 3;
        wavePending = 0;
        lastMarineCount = 0;
        morphCooldown = 0;
        if (sa > 0) {
            wavePending = Math.max(2, Math.round(MAX_MARINES * sa));
            planDrops(false);
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
