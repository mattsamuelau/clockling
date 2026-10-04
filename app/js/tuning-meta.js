/* Clockling - TUNING & SETTINGS metadata.
 * For every key: visibility class (Visible/Advanced), default and a plain-English
 * meaning. Optional: options (dropdown), min/max/step (slider), only ("web" or
 * "esp32" when a key applies to one target). Both settings UIs are built from this:
 * clockling.html directly, the ESP32 page via targets/esp32/tools/gen_assets.py.
 */

var TUNING_META = {
    /* Map of key -> { class: "Visible"|"Advanced", default: <value>, meaning: <string> } */
    tuning: {
        /* Map & resolution */
        mapW: { class: "Advanced", default: 216, meaning: "Battlefield width (px)" },
        mapH: { class: "Advanced", default: 432, meaning: "Battlefield height (px)" },

        /* Max units */
        maxLings: { class: "Visible", default: 16, meaning: "Max zerglings on screen" },
        maxBanes: { class: "Visible", default: 3, meaning: "Max banelings on screen" },
        maxMarines: { class: "Visible", default: 6, meaning: "Max marines on screen" },

        /* Movement */
        zergSpeed: { class: "Visible", default: 1.2, meaning: "Zerg base speed multiplier" },
        terranSpeed: { class: "Visible", default: 1.35, meaning: "Terran base speed multiplier" },

        /* Zerg (zerglings, banelings, eggs) */
        respawnInterval: { class: "Visible", default: 1.5, meaning: "Seconds between ling-egg refill batches" },
        respawnBatch: { class: "Visible", default: 8, meaning: "Eggs spawned per refill batch" },
        eggTimeMin: { class: "Visible", default: 7, meaning: "Min seconds until an egg hatches" },
        eggTimeMax: { class: "Visible", default: 9, meaning: "Max seconds until an egg hatches" },
        eggHatchMult: { class: "Advanced", default: 1.5, meaning: "Egg hatch acceleration multiplier" },
        eggHp: { class: "Visible", default: 100, meaning: "Egg hit points (eggs act as a tanky shield)", only: "web" },
        eggDamageMult: { class: "Visible", default: 0.1, meaning: "Fraction of normal damage an egg takes per hit (0.1 = 10%: about 40 shots)", only: "web", min: 0.0001, max: 1, step: 0.0005 },
        eggOverlap: { class: "Visible", default: 0, meaning: "How much a new egg may overlap another (0 = never touch, 1 = may stack)", only: "web", min: 0, max: 1, step: 0.05 },
        eggMarineClearance: { class: "Visible", default: 0.4, meaning: "Eggs are laid at least this far from any marine (fraction of the board's short side), on the far side from the marines", only: "web", min: 0, max: 1, step: 0.05 },
        morphAge: { class: "Visible", default: 4, meaning: "Lings must live this long before morphing" },
        morphCooldown: { class: "Visible", default: 2, meaning: "Seconds between successful morphs" },
        morphChancePerSec: { class: "Visible", default: 1, meaning: "Chance per second to start morphing" },
        lingHp: { class: "Visible", default: 100, meaning: "Zergling hit points" },
        baneHp: { class: "Visible", default: 140, meaning: "Baneling hit points" },
        lingBiteDamage: { class: "Visible", default: 10, meaning: "Damage per zergling bite" },
        lingBiteInterval: { class: "Visible", default: 0.2, meaning: "Seconds between bites" },
        baneSplashDamage: { class: "Visible", default: 90, meaning: "Baneling blast damage" },
        baneSplashR: { class: "Visible", default: 61, meaning: "Baneling blast radius (px)" },
        attackGroupSize: { class: "Visible", default: 14, meaning: "Minimum swarm strength (ling 1, bane 2) to attack; capped at maxLings" },
        berserkBanes: { class: "Visible", default: 2, meaning: "Banelings alive needed to trigger bane berserk" },
        berserkUntilDeath: { class: "Visible", default: false, meaning: "On: berserk never retreats; off: cancels when outnumbered" },
        attackOdds: { class: "Visible", default: 1.5, meaning: "Swarm strength (ling 1, bane 2) needed per marine in the target group" },
        allyRadius: { class: "Visible", default: 45, meaning: "Lings/banes this close to each other count as one swarm" },
        marineScanRadius: { class: "Visible", default: 140, meaning: "Lings flee marines inside this radius (never less than 1.25x marine range)" },
        marineGroupRadius: { class: "Visible", default: 60, meaning: "Radius around a marine used to count its group" },
        berserkCatchRadius: { class: "Visible", default: 80, meaning: "Lings catch berserk from a berserk bane within this radius" },
        berserkSpeedMult: { class: "Visible", default: 1.5, meaning: "Speed multiplier while berserk" },
        lingAttackBoostMult: { class: "Visible", default: 1.5, meaning: "Speed burst for every ling that joins an attack (berserk lings get the larger of this and berserk speed)", only: "web", min: 1, max: 3, step: 0.1 },
        lingAttackBoostTime: { class: "Visible", default: 3, meaning: "Seconds the attack speed burst lasts", only: "web", min: 0, max: 10, step: 0.5 },
        lingAttackBoostCooldown: { class: "Visible", default: 5, meaning: "Seconds after a burst ends before a ling can burst again", only: "web", min: 0, max: 30, step: 0.5 },
        lingFleeSpeedMult: { class: "Visible", default: 1.6, meaning: "Speed multiplier for lings escaping marines" },

        /* Terran (marines) */
        marineSpawnRateMult: { class: "Visible", default: 1.5, meaning: "Marine spawn rate multiplier" },
        marineWaveLo: { class: "Visible", default: 30, meaning: "Min seconds after all marines die" },
        marineWaveHi: { class: "Visible", default: 32, meaning: "Max seconds after all marines die" },
        marineRespawnLo: { class: "Visible", default: 8, meaning: "Min seconds between respawns" },
        marineRespawnHi: { class: "Visible", default: 10, meaning: "Max seconds between respawns" },
        marineSpawnGap: { class: "Visible", default: 0.5, meaning: "Seconds between marines in wave" },
        marineSpawnInset: { class: "Advanced", default: 6, meaning: "Px off-screen spawn distance" },
        marineWaveSizeLo: { class: "Visible", default: 6, meaning: "Min marines per wave" },
        marineWaveSizeHi: { class: "Visible", default: 6, meaning: "Max marines per wave" },
        marineRespawnSizeLo: { class: "Visible", default: 2, meaning: "Min marines per respawn" },
        marineRespawnSizeHi: { class: "Visible", default: 2, meaning: "Max marines per respawn" },
        marineHp: { class: "Visible", default: 120, meaning: "Marine hit points" },
        marineShootDamage: { class: "Visible", default: 25, meaning: "Damage per marine shot" },
        marineShootInterval: { class: "Visible", default: 0.36, meaning: "Seconds between shots" },
        marineRangeMult: { class: "Visible", default: 3, meaning: "Weapon range multiplier" },
        marineFleeHpPct: { class: "Advanced", default: 0.9, meaning: "Marines kite away below this HP fraction" },
        marineKiteFrac: { class: "Visible", default: 0.6, meaning: "Marines back off from zerg closer than this fraction of their range" },
        marineSightMult: { class: "Visible", default: 2, meaning: "Marines patrol when no zerg is within this x weapon range" },
        marineEntrySpeed: { class: "Visible", default: 1.5, meaning: "Speed multiplier while new marines march in from off-screen" },
        marineEntryDepth: { class: "Visible", default: 0.09, meaning: "March-in boost stops this far inside the edge (x shorter side)" },
        marineGroupWeight: { class: "Advanced", default: 0.5, meaning: "Pull toward other marines" },
        marineAwayWeight: { class: "Advanced", default: 1, meaning: "Push away from zerg" },
        marineTurnRate: { class: "Advanced", default: 0.25, meaning: "Marine steering: share of the turn closed every 1/8 s" },
        marineTactics: { class: "Visible", default: true, meaning: "New marine AI: kite, regroup, or advance" },
        marineHealPct: { class: "Advanced", default: 0.10, meaning: "HP all units heal per tick" },
        marineHealInterval: { class: "Advanced", default: 0.5, meaning: "Seconds between heal ticks" },
        stimDuration: { class: "Visible", default: 3, meaning: "Seconds a stimpack lasts", only: "web", min: 0.5, max: 10, step: 0.5 },
        stimCooldown: { class: "Visible", default: 10, meaning: "Seconds before a marine can stim again", only: "web", min: 0, max: 60, step: 1 },
        stimSpeedMult: { class: "Visible", default: 2, meaning: "Speed multiplier while stimmed", only: "web", min: 1, max: 4, step: 0.1 },
        stimHpCost: { class: "Visible", default: 0.5, meaning: "Share of current HP a stimpack costs", only: "web", min: 0, max: 0.9, step: 0.05 },
        stimRegenMult: { class: "Visible", default: 0.1, meaning: "HP regen multiplier after a stim (for stimRegenTime)", only: "web", min: 0, max: 1, step: 0.05 },
        stimRegenTime: { class: "Visible", default: 10, meaning: "Seconds of slowed regen from the moment a marine stims", only: "web", min: 0, max: 60, step: 1 },
        stimFxTime: { class: "Visible", default: 5, meaning: "Seconds the green stim glow shows (never shorter than the stim)", only: "web", min: 0, max: 20, step: 0.5 },
        stimGroupMax: { class: "Visible", default: 3, meaning: "Only marine groups this small (or smaller) stim to escape", only: "web", min: 1, max: 20, step: 1 },
        stimRegroupDist: { class: "Visible", default: 0.3, meaning: "Lone marines farther than this from the main mob (x board short side) stim back to it", only: "web", min: 0.05, max: 1, step: 0.05 },
        marineWalkTilt: { class: "Visible", default: 25, meaning: "Max degrees a marine leans from upright while walking (it turns fully to its target when firing)", only: "web", min: 0, max: 60, step: 1 },
        marineKiteSpeed: { class: "Visible", default: 0.5, meaning: "Speed multiplier while kiting / running back to the mob (on top of skill footwork and stim)", only: "web", min: 0.25, max: 2, step: 0.05 },
        marineSkillTopSpeed: { class: "Advanced", default: 3, meaning: "Movement multiplier at max marine skill (1x at half skill)", only: "web", min: 1, max: 4, step: 0.1 },

        /* Visuals & timing */
        lingW: { class: "Advanced", default: 30, meaning: "Zergling sprite width (px)" },
        baneW: { class: "Advanced", default: 39, meaning: "Baneling sprite width (px)" },
        marineW: { class: "Advanced", default: 42, meaning: "Marine sprite width (px)" },
        eggW: { class: "Advanced", default: 21, meaning: "Egg sprite width (px)" },
        lingBump: { class: "Advanced", default: 10, meaning: "Zergling collision radius" },
        baneBump: { class: "Advanced", default: 12, meaning: "Baneling collision radius" },
        marineBump: { class: "Advanced", default: 12, meaning: "Marine collision radius" },
        splatLife: { class: "Advanced", default: 1.21, meaning: "Death-splat lifetime (s)" },
        splatBase: { class: "Advanced", default: 7, meaning: "Splat start radius (px)" },
        splatFadeStart: { class: "Advanced", default: 0.6, meaning: "Splat fade start fraction" },
        corpseLife: { class: "Advanced", default: 2.2, meaning: "Dead sprite lingers (s)" },
        goreSplatLife: { class: "Advanced", default: 16.2, meaning: "Gore mode: death splat lingers (s)" },
        goreCorpseLife: { class: "Advanced", default: 19.2, meaning: "Gore mode: corpse lingers (s)" },
        baneSplatLifeMult: { class: "Advanced", default: 0.3, meaning: "Green (baneling) splat lifetime x red splat lifetime" },
        marineSplatScale: { class: "Advanced", default: 1.4, meaning: "Marine splat scale" },
        baneSplatScale: { class: "Advanced", default: 2.5, meaning: "Baneling splat scale" },
        retargetInterval: { class: "Advanced", default: 0.5, meaning: "Ling/bane retarget interval (s)" },
        aimInterval: { class: "Advanced", default: 0.3, meaning: "Marine re-aim interval (s)" }
    },

    /* Map of SETTINGS key -> { class, meaning } (defaults live in settings.js) */
    settings: {
        showClock: { class: "Visible", meaning: "Show the clock" },
        hour24: { class: "Visible", meaning: "24-hour clock (off = 12-hour)" },
        showSeconds: { class: "Visible", meaning: "Show seconds" },
        clockPosition: { class: "Visible", meaning: "Where the clock sits",
                         options: ["Top", "Middle", "Bottom", "Top left", "Top right", "Bottom left", "Bottom right"] },
        clockBehind: { class: "Visible", meaning: "Draw the clock behind the units" },
        clockScale: { class: "Visible", meaning: "Clock size", only: "web", min: 0.5, max: 2, step: 0.05 },
        timeZone: { class: "Visible", meaning: "Time zone (auto = this device)", only: "web" },
        gameSpeed: { class: "Visible", meaning: "Speed multiplier", min: 0.25, max: 5, step: 0.25 },
        unitScale: { class: "Visible", meaning: "Unit multiplier (population, waves, spawn rate)", min: 0.5, max: 5, step: 0.5 },
        unitCount: { class: "Advanced", meaning: "Starting zerglings" },
        marineSkill: { class: "Visible", meaning: "Marine smarts: 0 = stand and die, 1 = one marine can dance around a swarm", only: "web", min: 0, max: 1, step: 0.05 },
        unitSpeed: { class: "Advanced", meaning: "Movement speed multiplier for every unit" },
        showHealthBars: { class: "Visible", meaning: "Show unit health bars" },
        showKills: { class: "Visible", meaning: "Marine kill marks (one per ling killed)", only: "web" },
        gore: { class: "Visible", meaning: "Gore mode: splats and corpses linger (splat 16.2 s, corpse 19.2 s)" },
        fieldSize: { class: "Visible", meaning: "Battlefield size (smaller = bigger units)", only: "web",
                     options: { "480": "Small", "640": "Medium", "960": "Large", "1280": "Huge" } },
        soundOn: { class: "Visible", meaning: "Play sound effects", only: "web" },
        soundVolume: { class: "Visible", meaning: "Sound volume", only: "web", min: 0, max: 100, step: 5 },
        soundRate: { class: "Visible", meaning: "How often chatter and voicelines play (0 = never)", only: "web", min: 0, max: 3, step: 0.25 },
        musicTrack: { class: "Visible", meaning: "Background music", only: "web",
                      options: ["Off", "Zerg", "Protoss", "Terran 1", "Terran 2", "Terran 3"] },
        musicVolume: { class: "Visible", meaning: "Music volume", only: "web", min: 0, max: 100, step: 5 },
        landscape: { class: "Visible", meaning: "Horizontal screen (off = vertical)", only: "esp32" }
    },

    /* Groups for UI organization */
    groups: {
        "Zerg Rules": ["attackGroupSize", "lingFleeSpeedMult", "berserkBanes", "berserkUntilDeath", "attackOdds", "allyRadius", "marineScanRadius", "marineGroupRadius", "berserkCatchRadius"],
        "Zerg Units": ["maxLings", "maxBanes", "lingHp", "baneHp", "lingBiteDamage", "lingBiteInterval", "baneSplashDamage", "baneSplashR", "berserkSpeedMult", "lingAttackBoostMult", "lingAttackBoostTime", "lingAttackBoostCooldown"],
        "Zerg Lifecycle": ["respawnInterval", "respawnBatch", "eggTimeMin", "eggTimeMax", "eggHatchMult", "eggHp", "eggDamageMult", "eggOverlap", "eggMarineClearance", "morphAge", "morphCooldown", "morphChancePerSec"],
        "Terran Units": ["maxMarines", "marineHp", "marineShootDamage", "marineShootInterval", "marineRangeMult"],
        "Terran Spawning": ["marineEntrySpeed", "marineEntryDepth", "marineSpawnRateMult", "marineWaveLo", "marineWaveHi", "marineWaveSizeLo", "marineWaveSizeHi", "marineRespawnLo", "marineRespawnHi", "marineRespawnSizeLo", "marineRespawnSizeHi", "marineSpawnGap", "marineSpawnInset"],
        "Terran Behavior": ["marineTactics", "marineKiteFrac", "marineSightMult", "marineFleeHpPct", "marineGroupWeight", "marineAwayWeight", "marineTurnRate", "marineHealPct", "marineHealInterval", "stimDuration", "stimCooldown", "stimSpeedMult", "stimHpCost", "stimRegenMult", "stimRegenTime", "stimFxTime", "stimGroupMax", "stimRegroupDist", "marineKiteSpeed", "marineSkillTopSpeed", "marineWalkTilt"],
        "Movement": ["zergSpeed", "terranSpeed"],
        "Visuals": ["lingW", "baneW", "marineW", "eggW", "lingBump", "baneBump", "marineBump", "splatLife", "splatBase", "splatFadeStart", "corpseLife", "goreSplatLife", "goreCorpseLife", "baneSplatLifeMult", "marineSplatScale", "baneSplatScale", "retargetInterval", "aimInterval"],
        "Map": ["mapW", "mapH"],
        "Clock": ["showClock", "hour24", "showSeconds", "clockPosition", "clockBehind", "clockScale", "timeZone"],
        "Battle": ["gameSpeed", "unitScale", "fieldSize", "showHealthBars", "showKills", "gore", "unitCount", "unitSpeed", "marineSkill", "soundOn", "soundVolume", "soundRate", "musicTrack", "musicVolume"],
        "Display": ["landscape"]
    }
};
