/* Self-play training for the two commanders: the Overmind (zerg) and the
 * terran Commander. Each is a "brain" - a set of decision settings (when to
 * attack, how long to stalk, bane timing, control-group size, spawn choice,
 * ...), never unit stats like speed, HP or damage. Two populations evolve
 * against each other: every brain plays matches against brains of the other
 * race (current rivals plus a hall of fame of past champions, so they can't
 * forget how to beat old tricks), is scored with rewards.js, and the best
 * breed the next generation by mutation.
 *
 *   node tools/sim/train.js                      # defaults below
 *   GENS=12 POP=12 SECS=360 node tools/sim/train.js
 *
 * Writes tools/sim/brains/{zerg,terran}.json (per-generation history + the
 * champion) and app/js/brains.js (the "Trained" brains the app can pick).
 */
var fork = require("child_process").fork, path = require("path"), fs = require("fs"), os = require("os");
var rewards = require("./rewards").rewards;

var GENS = +process.env.GENS || 12, POP = +process.env.POP || 12, SECS = +process.env.SECS || 360;
var MATCHES = +process.env.MATCHES || 2;      /* matches per brain per generation */
var WORKERS = +process.env.WORKERS || Math.max(1, os.cpus().length - 2);
var OUT = path.join(__dirname, "brains");
var ROOT = path.join(__dirname, "..", "..");

/* the arena: Balanced battle, both commanders at full skill */
var ARENA = { gameSpeed: 2.5, unitScale: 2, unitSpeed: 1, marineSkill: 1, zergSkill: 1 };

var SPACE = {
    zerg: {
        attackOdds: [0.9, 3.75], attackGroupSize: [8, 40, "int"],
        zergNoHope: [0.1, 0.6], zergSmarts: [true, false], zergPatience: [5, 90], zergAllInOdds: [0, 8],
        zergStandoff: [1, 2.5], zergCornerDist: [0, 0.4],
        ovJoinRadius: [0.5, 6], ovSurround: [0, 80], ovBaneHold: [true, false],
        ovGuardBanes: [true, false], ovBaneVanguard: [0, 1], ovBaneClump: [1, 6, "int"], ovBaneMaxHold: [0, 20], ovFrontMorph: [0, 1],
        berserkBanes: [1, 6, "int"], morphChancePerSec: [0.05, 1]
    },
    terran: {
        marineMicro: [true, false], marineBaneHunt: [true, false], marineStimAttack: [true, false], marineSquads: [true, false], marineCtrlGroups: [1, 6, "int"], marineCtrlGroupSize: [2, 15, "int"],
        marineFlank: [true, false], marineFlankAngle: [0, 80], marineStimPush: [true, false],
        marineEliteKite: [true, false], marineSpawnMode: [0, 2, "int"],
        stimGroupMax: [1, 10, "int"], stimRegroupDist: [0.05, 1],
        marineKiteFrac: [0.2, 1], marineFleeHpPct: [0.2, 1], marineSightMult: [1, 4],
        marineGroupWeight: [0, 2], marineAwayWeight: [0, 2]
    }
};

function sample(r) {
    if (typeof r[0] === "boolean") return r[Math.floor(Math.random() * r.length)];
    var v = r[0] + Math.random() * (r[1] - r[0]);
    return r[2] === "int" ? Math.round(v) : +v.toFixed(2);
}
function randomBrain(space) { var g = {}; for (var k in space) g[k] = sample(space[k]); return g; }
function mutate(g0, space, rate) {
    var g = JSON.parse(JSON.stringify(g0));
    for (var k in space) {
        if (Math.random() > rate) continue;
        var r = space[k];
        if (typeof r[0] === "boolean") { g[k] = !g[k]; continue; }
        var v = g[k] + (Math.random() * 2 - 1) * (r[1] - r[0]) * 0.2;
        v = Math.max(r[0], Math.min(r[1], v));
        g[k] = r[2] === "int" ? Math.round(v) : +v.toFixed(2);
    }
    return g;
}
/* the current hand-tuned defaults as a starting brain, so training begins from
 * what we know works */
function defaultBrain(space) {
    var src = fs.readFileSync(path.join(ROOT, "app/js/tuning-meta.js"), "utf8");
    var g = {};
    for (var k in space) {
        var m = new RegExp("\\n\\s+" + k + ": \\{[^\\n]*?default: ([^,]+),").exec(src);
        g[k] = m ? JSON.parse(m[1]) : sample(space[k]);
    }
    return g;
}

function runAll(jobs) {
    return new Promise(function (resolve) {
        var results = new Array(jobs.length), next = 0, done = 0;
        if (!jobs.length) return resolve(results);
        function launch() {
            if (next >= jobs.length) return;
            var idx = next++, child = fork(path.join(__dirname, "harness.js"));
            child.on("message", function (r) { results[idx] = r; });
            child.on("exit", function () {
                done++;
                if (done === jobs.length) resolve(results); else launch();
            });
            child.send(jobs[idx]);
        }
        for (var w = 0; w < Math.min(WORKERS, jobs.length); w++) launch();
    });
}

function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

function main() {
    var pop = { zerg: [], terran: [] }, hof = { zerg: [], terran: [] }, history = { zerg: [], terran: [] };
    ["zerg", "terran"].forEach(function (race) {
        pop[race].push({ genes: defaultBrain(SPACE[race]), born: 0 });
        while (pop[race].length < POP) pop[race].push({ genes: randomBrain(SPACE[race]), born: 0 });
    });
    var gen = 0;
    function generation() {
        var t0 = Date.now();
        /* pairings: each brain meets MATCHES rivals; a third come from the hall of fame */
        var pairs = [];
        for (var m = 0; m < MATCHES; m++) {
            var tz = shuffle(pop.terran.slice()), zt = shuffle(pop.zerg.slice());
            for (var i = 0; i < POP; i++) {
                var tOpp = (hof.terran.length && Math.random() < 0.33) ? hof.terran[Math.floor(Math.random() * hof.terran.length)] : tz[i];
                pairs.push({ z: pop.zerg[i], t: tOpp });
                var zOpp = (hof.zerg.length && Math.random() < 0.33) ? hof.zerg[Math.floor(Math.random() * hof.zerg.length)] : zt[i];
                if (zOpp !== pop.zerg[i] || tz[i] !== pop.terran[i]) pairs.push({ z: zOpp, t: pop.terran[i] });
            }
        }
        var jobs = pairs.map(function (p) {
            var t = {}, k;
            for (k in p.z.genes) t[k] = p.z.genes[k];
            for (k in p.t.genes) t[k] = p.t.genes[k];
            return { settings: ARENA, tuning: t, seconds: SECS };
        });
        return runAll(jobs).then(function (res) {
            ["zerg", "terran"].forEach(function (race) { pop[race].forEach(function (b) { b.scores = []; }); });
            res.forEach(function (r, i) {
                if (!r) return;
                var rw = rewards(r), p = pairs[i];
                if (p.z.scores) p.z.scores.push(rw.zerg);
                if (p.t.scores) p.t.scores.push(rw.terran);
            });
            var line = "gen " + gen + " (" + ((Date.now() - t0) / 1000).toFixed(0) + " s)";
            ["zerg", "terran"].forEach(function (race) {
                pop[race].forEach(function (b) {
                    b.fitness = b.scores.length ? b.scores.reduce(function (a, x) { return a + x; }, 0) / b.scores.length : -1e9;
                });
                pop[race].sort(function (a, b) { return b.fitness - a.fitness; });
                var best = pop[race][0];
                var mean = pop[race].reduce(function (a, b) { return a + b.fitness; }, 0) / POP;
                history[race].push({ gen: gen, best: +best.fitness.toFixed(3), mean: +mean.toFixed(3), genes: best.genes });
                hof[race].push({ genes: best.genes });
                if (hof[race].length > 6) hof[race].shift();
                line += "  " + race + " best " + best.fitness.toFixed(2) + " mean " + mean.toFixed(2);
            });
            console.log(line);
            gen++;
            if (gen >= GENS) return finish();
            ["zerg", "terran"].forEach(function (race) {
                var keep = Math.max(2, Math.round(POP / 3)), next = pop[race].slice(0, keep).map(function (b) { return { genes: b.genes, born: b.born }; });
                while (next.length < POP) next.push({ genes: mutate(next[next.length % keep].genes, SPACE[race], 0.3), born: gen });
                pop[race] = next;
            });
            return generation();
        });
    }
    function finish() {
        if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
        var champ = {};
        ["zerg", "terran"].forEach(function (race) {
            /* champion: the brain that topped the most recent generations (stable, not a fluke) */
            champ[race] = history[race][history[race].length - 1].genes;
            fs.writeFileSync(path.join(OUT, race + ".json"), JSON.stringify({
                race: race, arena: ARENA, seconds: SECS, gens: GENS, pop: POP, matches: MATCHES,
                date: new Date().toISOString(), champion: champ[race], history: history[race]
            }, null, 1));
        });
        var js = "/* Clockling - trained commander brains (generated by tools/sim/train.js;\n" +
                 " * do not edit by hand). Each brain is a set of decision settings layered\n" +
                 " * over the tuning when picked in Settings (zergBrain / terranBrain). */\n" +
                 "var BRAINS = {\n" +
                 "    zerg: { Trained: " + JSON.stringify(champ.zerg) + " },\n" +
                 "    terran: { Trained: " + JSON.stringify(champ.terran) + " }\n" +
                 "};\n";
        fs.writeFileSync(path.join(ROOT, "app/js/brains.js"), js);
        console.log("champions written to tools/sim/brains/ and app/js/brains.js");
    }
    generation();
}

main();
