/* Clockling - TUNING & SETTINGS metadata.
 * Maps all tunable keys to their visibility class (Visible/Advanced) and defaults.
 * Used to generate settings UI and manage persistence.
 */

var TUNING_META = {
    /* Map of key -> { class: "Visible"|"Advanced", default: <value>, meaning: <string> } */
    tuning: {
        /* Map & resolution */
        mapW: { class: "Advanced", default: 216, meaning: "Battlefield width (px)" },
        mapH: { class: "Advanced", default: 432, meaning: "Battlefield height (px)" },

        /* Max units */
        maxLings: { class: "Visible", default: 8, meaning: "Max zerglings on screen" },
        maxBanes: { class: "Visible", default: 3, meaning: "Max banelings on screen" },
        maxMarines: { class: "Visible", default: 3, meaning: "Max marines on screen" },

        /* Movement */
        zergSpeed: { class: "Visible", default: 1, meaning: "Zerg base speed multiplier" },
        terranSpeed: { class: "Visible", default: 1.5, meaning: "Terran base speed multiplier" },

        /* Zerg (zerglings, banelings, eggs) */
        respawnInterval: { class: "Visible", default: 2, meaning: "Seconds between ling-egg refill batches" },
        respawnBatch: { class: "Visible", default: 4, meaning: "Eggs spawned per refill batch" },
        eggTimeMin: { class: "Visible", default: 8, meaning: "Min seconds until an egg hatches" },
        eggTimeMax: { class: "Visible", default: 10, meaning: "Max seconds until an egg hatches" },
        eggHatchMult: { class: "Advanced", default: 1, meaning: "Egg hatch acceleration multiplier" },
        morphAge: { class: "Visible", default: 4, meaning: "Lings must live this long before morphing" },
        morphCooldown: { class: "Visible", default: 2, meaning: "Seconds between successful morphs" },
        morphChancePerSec: { class: "Visible", default: 1, meaning: "Chance per second to start morphing" },
        lingHp: { class: "Visible", default: 100, meaning: "Zergling hit points" },
        baneHp: { class: "Visible", default: 140, meaning: "Baneling hit points" },
        lingBiteDamage: { class: "Visible", default: 10, meaning: "Damage per zergling bite" },
        lingBiteInterval: { class: "Visible", default: 0.2, meaning: "Seconds between bites" },
        baneSplashDamage: { class: "Visible", default: 90, meaning: "Baneling blast damage" },
        baneSplashR: { class: "Visible", default: 75, meaning: "Baneling blast radius (px)" },
        attackGroupSize: { class: "Visible", default: 5, meaning: "Swarm size (lings + banes) needed to attack; capped at maxLings" },
        berserkBanes: { class: "Visible", default: 2, meaning: "Banelings alive needed to trigger bane berserk" },
        berserkUntilDeath: { class: "Visible", default: false, meaning: "On: berserk never retreats; off: cancels when outnumbered" },
        maxEngageMarines: { class: "Visible", default: 4, meaning: "Largest marine group a swarm will attack" },
        allyRadius: { class: "Visible", default: 45, meaning: "Lings/banes this close to each other count as one swarm" },
        marineScanRadius: { class: "Visible", default: 140, meaning: "Idle lings keep this far from marines (keep above marine range = marineW x marineRangeMult)" },
        marineGroupRadius: { class: "Visible", default: 60, meaning: "Radius around a marine used to count its group" },
        berserkCatchRadius: { class: "Visible", default: 80, meaning: "Lings catch berserk from a berserk bane within this radius" },
        berserkSpeedMult: { class: "Visible", default: 1.5, meaning: "Speed multiplier while berserk" },

        /* Terran (marines) */
        marineSpawnRateMult: { class: "Visible", default: 1.5, meaning: "Marine spawn rate multiplier" },
        marineWaveLo: { class: "Visible", default: 30, meaning: "Min seconds after all marines die" },
        marineWaveHi: { class: "Visible", default: 32, meaning: "Max seconds after all marines die" },
        marineRespawnLo: { class: "Visible", default: 10, meaning: "Min seconds between respawns" },
        marineRespawnHi: { class: "Visible", default: 14, meaning: "Max seconds between respawns" },
        marineSpawnGap: { class: "Visible", default: 1, meaning: "Seconds between marines in wave" },
        marineSpawnInset: { class: "Advanced", default: 6, meaning: "Px off-screen spawn distance" },
        marineWaveSizeLo: { class: "Visible", default: 6, meaning: "Min marines per wave" },
        marineWaveSizeHi: { class: "Visible", default: 8, meaning: "Max marines per wave" },
        marineRespawnSizeLo: { class: "Visible", default: 2, meaning: "Min marines per respawn" },
        marineRespawnSizeHi: { class: "Visible", default: 4, meaning: "Max marines per respawn" },
        marineHp: { class: "Visible", default: 100, meaning: "Marine hit points" },
        marineShootDamage: { class: "Visible", default: 25, meaning: "Damage per marine shot" },
        marineShootInterval: { class: "Visible", default: 0.4, meaning: "Seconds between shots" },
        marineRangeMult: { class: "Visible", default: 3, meaning: "Weapon range multiplier" },
        marineFleeHpPct: { class: "Advanced", default: 0.5, meaning: "Marines kite away below this HP fraction" },
        marineKiteFrac: { class: "Visible", default: 0.6, meaning: "Marines back off from zerg closer than this fraction of their range" },
        marineSightMult: { class: "Visible", default: 2, meaning: "Marines patrol when no zerg is within this x weapon range" },
        marineEntrySpeed: { class: "Visible", default: 2, meaning: "Speed multiplier while new marines march in from off-screen" },
        marineGroupWeight: { class: "Advanced", default: 0.5, meaning: "Pull toward other marines" },
        marineAwayWeight: { class: "Advanced", default: 1, meaning: "Push away from zerg" },
        marineTurnRate: { class: "Advanced", default: 0.25, meaning: "Marine steering: share of the turn closed every 1/8 s" },
        marineTactics: { class: "Visible", default: true, meaning: "New marine AI: kite, regroup, or advance" },
        marineHealPct: { class: "Advanced", default: 0.10, meaning: "HP all units heal per tick" },
        marineHealInterval: { class: "Advanced", default: 0.5, meaning: "Seconds between heal ticks" },

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
        marineSplatScale: { class: "Advanced", default: 1.4, meaning: "Marine splat scale" },
        baneSplatScale: { class: "Advanced", default: 2.5, meaning: "Baneling splat scale" },
        retargetInterval: { class: "Advanced", default: 0.5, meaning: "Ling/bane retarget interval (s)" },
        aimInterval: { class: "Advanced", default: 0.3, meaning: "Marine re-aim interval (s)" }
    },

    /* Map of SETTINGS key -> { class, default, meaning } */
    settings: {
        hour24: { class: "Visible", default: true, meaning: "24h vs 12h clock" },
        showSeconds: { class: "Visible", default: true, meaning: "Show seconds in clock" },
        showClock: { class: "Visible", default: true, meaning: "Show clock block" },
        unitCount: { class: "Advanced", default: 10, meaning: "Initial unit count" },
        unitSpeed: { class: "Advanced", default: 1.0, meaning: "Global speed multiplier for all units" }
    },

    /* Groups for UI organization */
    groups: {
        "Zerg Rules": ["attackGroupSize", "berserkBanes", "berserkUntilDeath", "maxEngageMarines", "allyRadius", "marineScanRadius", "marineGroupRadius", "berserkCatchRadius"],
        "Zerg Units": ["maxLings", "maxBanes", "lingHp", "baneHp", "lingBiteDamage", "lingBiteInterval", "baneSplashDamage", "baneSplashR", "berserkSpeedMult"],
        "Zerg Lifecycle": ["respawnInterval", "respawnBatch", "eggTimeMin", "eggTimeMax", "eggHatchMult", "morphAge", "morphCooldown", "morphChancePerSec"],
        "Terran Units": ["maxMarines", "marineHp", "marineShootDamage", "marineShootInterval", "marineRangeMult"],
        "Terran Spawning": ["marineEntrySpeed", "marineSpawnRateMult", "marineWaveLo", "marineWaveHi", "marineWaveSizeLo", "marineWaveSizeHi", "marineRespawnLo", "marineRespawnHi", "marineRespawnSizeLo", "marineRespawnSizeHi", "marineSpawnGap", "marineSpawnInset"],
        "Terran Behavior": ["marineTactics", "marineKiteFrac", "marineSightMult", "marineFleeHpPct", "marineGroupWeight", "marineAwayWeight", "marineTurnRate", "marineHealPct", "marineHealInterval"],
        "Movement": ["zergSpeed", "terranSpeed"],
        "Visuals": ["lingW", "baneW", "marineW", "eggW", "lingBump", "baneBump", "marineBump", "splatLife", "splatBase", "splatFadeStart", "corpseLife", "marineSplatScale", "baneSplatScale", "retargetInterval", "aimInterval"],
        "Map": ["mapW", "mapH"],
        "Display": ["hour24", "showSeconds", "showClock"]
    }
};
