/* Balance search for the battle presets: a small evolutionary search (random
 * population, keep the best, mutate, repeat) over spawn / respawn / swarm
 * settings, scoring headless battles (harness.js) with metrics.fun().
 *
 *   node tools/sim/balance.js                 # every preset
 *   node tools/sim/balance.js balanced mental # just these
 *   GENS=4 POP=20 SEEDS=2 node tools/sim/balance.js
 *
 * Writes tools/sim/results/<preset>.json (every candidate scored, best first)
 * and prints the best settings + tuning to paste into clockling.html PRESETS
 * (Balanced = the defaults in settings.js / tuning-meta.js).
 */
var fork = require("child_process").fork, path = require("path"), fs = require("fs"), os = require("os");
var metrics = require("./metrics");

var GENS = +process.env.GENS || 4, POP = +process.env.POP || 20, SEEDS = +process.env.SEEDS || 2;
var KEEP = Math.max(2, Math.round(POP / 4));
var WORKERS = +process.env.WORKERS || Math.max(1, os.cpus().length - 2);
var OUT = path.join(__dirname, "results");

/* ranges: [lo, hi] float, [lo, hi, "int"], or [true, false] choice */
var COMMON = {
    maxLings: [10, 30, "int"], maxBanes: [1, 5, "int"], maxMarines: [4, 10, "int"],
    /* reinforcement while alive is slow and a wipe costs a long countdown, so a
     * side that wins a fight can grind the other down and hold the map */
    respawnInterval: [1, 12], respawnBatch: [1, 6, "int"],
    attackGroupSize: [8, 40, "int"], attackOdds: [0.9, 3.75],
    zergWaveLo: [15, 120], zergWaveSpread: [1.1, 1.6],
    marineWaveLo: [15, 120], marineWaveSpread: [1.05, 1.4],
    marineRespawnLo: [5, 60], marineRespawnSpread: [1.1, 1.6],
    marineWaveSizeLo: [3, 10, "int"], marineRespawnSizeLo: [1, 4, "int"],
    zergPatience: [10, 90], marineHealPct: [0.01, 0.1]
};
function extend(base, over) { var o = {}, k; for (k in base) o[k] = base[k]; for (k in over) o[k] = over[k]; return o; }

var PRESETS = {
    balanced: {
        settings: { gameSpeed: 2.5, unitScale: 2, unitSpeed: 1, zergBrain: 0, terranBrain: 0 }, seconds: +process.env.SECS || 480,
        space: extend(COMMON, { marineSkill: [0.5, 0.85], zergSkill: [0.4, 0.85] }), fixed: { zergSmarts: true },
        target: { terran: 0.35, zerg: 0.35, swings: 4, maxSpell: 180 }
    },
    terran: {
        settings: { gameSpeed: 2.5, unitScale: 2, unitSpeed: 1, zergBrain: 0, terranBrain: 1 }, seconds: +process.env.SECS || 480,
        space: extend(COMMON, { marineSkill: [0.75, 1], zergSkill: [0.2, 0.6], zergSmarts: [true, false] }), fixed: {},
        target: { terran: 0.55, zerg: 0.2, swings: 3, maxSpell: 240 }
    },
    zerg: {
        settings: { gameSpeed: 2.5, unitScale: 2, unitSpeed: 1, zergBrain: 1, terranBrain: 0 }, seconds: +process.env.SECS || 480,
        space: extend(COMMON, { marineSkill: [0.25, 0.6], zergSkill: [0.75, 1], zergSmarts: [true, false] }), fixed: {},
        target: { terran: 0.2, zerg: 0.55, swings: 3, maxSpell: 240 }
    },
    mental: {
        settings: { gameSpeed: 5, unitScale: 5, unitSpeed: 1, marineSkill: 1, zergSkill: 1, zergBrain: 1, terranBrain: 1 }, seconds: +process.env.SECS || 300,
        space: extend(COMMON, {
            maxLings: [30, 80, "int"], maxBanes: [3, 10, "int"], maxMarines: [8, 14, "int"],
            respawnBatch: [4, 16, "int"], attackGroupSize: [20, 250, "int"], zergSmarts: [true, false]
        }), fixed: {},
        target: { terran: 0.3, zerg: 0.3, swings: 6, maxSpell: 120, minUnits: 250 }
    }
};

function sample(r) {
    if (typeof r[0] === "boolean") return r[Math.floor(Math.random() * r.length)];
    var v = r[0] + Math.random() * (r[1] - r[0]);
    return r[2] === "int" ? Math.round(v) : +v.toFixed(2);
}
function mutate(genes, space) {
    var g = extend(genes, {});
    for (var k in space) {
        if (Math.random() > 0.35) continue;
        var r = space[k];
        if (typeof r[0] === "boolean") { g[k] = sample(r); continue; }
        var v = g[k] + (Math.random() * 2 - 1) * (r[1] - r[0]) * 0.25;
        v = Math.max(r[0], Math.min(r[1], v));
        g[k] = r[2] === "int" ? Math.round(v) : +v.toFixed(2);
    }
    return g;
}
/* genes -> real setting / tuning values (spreads become the Hi values) */
function expand(genes, preset) {
    var s = extend(preset.settings, {}), t = extend(preset.fixed, {});
    for (var k in genes) {
        if (k === "marineSkill" || k === "zergSkill") s[k] = genes[k];
        else if (!/Spread$/.test(k)) t[k] = genes[k];
    }
    t.zergWaveHi = +(t.zergWaveLo * genes.zergWaveSpread).toFixed(1);
    t.marineWaveHi = +(t.marineWaveLo * genes.marineWaveSpread).toFixed(1);
    t.marineRespawnHi = +(t.marineRespawnLo * genes.marineRespawnSpread).toFixed(1);
    t.marineWaveSizeHi = t.marineWaveSizeLo + 2;
    t.marineRespawnSizeHi = t.marineRespawnSizeLo + 1;
    return { settings: s, tuning: t };
}

/* run jobs [{settings, tuning, seconds}] on a pool of forked harnesses */
function runAll(jobs) {
    return new Promise(function (resolve) {
        var results = new Array(jobs.length), next = 0, done = 0;
        function launch() {
            if (next >= jobs.length) return;
            var idx = next++, child = fork(path.join(__dirname, "harness.js"));
            child.on("message", function (r) { results[idx] = r; });
            child.on("exit", function () {
                done++;
                if (!results[idx]) results[idx] = { error: true };
                if (done === jobs.length) resolve(results); else launch();
            });
            child.send(jobs[idx]);
        }
        for (var w = 0; w < Math.min(WORKERS, jobs.length); w++) launch();
    });
}

function evaluate(cands, preset) {
    var jobs = [];
    cands.forEach(function (c) {
        var e = expand(c.genes, preset);
        for (var s = 0; s < SEEDS; s++) jobs.push({ settings: e.settings, tuning: e.tuning, seconds: preset.seconds });
    });
    return runAll(jobs).then(function (res) {
        cands.forEach(function (c, i) {
            var runs = res.slice(i * SEEDS, (i + 1) * SEEDS).filter(function (r) { return !r.error; });
            c.metrics = runs.length ? metrics.average(runs) : null;
            c.runs = runs.map(function (r) { delete r.stats; return r; });
            c.score = c.metrics ? metrics.fun(c.metrics, preset.target) : -1e9;
        });
        return cands;
    });
}

function search(name) {
    var preset = PRESETS[name], all = [];
    var pop = [];
    for (var i = 0; i < POP; i++) {
        var g = {};
        for (var k in preset.space) g[k] = sample(preset.space[k]);
        pop.push({ genes: g, gen: 0 });
    }
    var gen = 0;
    function step() {
        var t0 = Date.now();
        return evaluate(pop, preset).then(function (scored) {
            all = all.concat(scored);
            all.sort(function (a, b) { return b.score - a.score; });
            var best = all[0];
            console.log("[" + name + "] gen " + gen + " (" + ((Date.now() - t0) / 1000).toFixed(0) + " s) best " +
                        best.score + " " + JSON.stringify(best.metrics));
            gen++;
            if (gen >= GENS) return finish();
            var parents = all.slice(0, KEEP);
            pop = [];
            for (var j = 0; j < POP; j++) pop.push({ genes: mutate(parents[j % KEEP].genes, preset.space), gen: gen });
            return step();
        });
    }
    function finish() {
        if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
        var rows = all.map(function (c) { var e = expand(c.genes, preset); return { score: c.score, gen: c.gen, settings: e.settings, tuning: e.tuning, metrics: c.metrics, runs: c.runs }; });
        fs.writeFileSync(path.join(OUT, name + ".json"), JSON.stringify({
            preset: name, target: preset.target, seconds: preset.seconds, seeds: SEEDS, gens: GENS, pop: POP,
            date: new Date().toISOString(), candidates: rows
        }, null, 1));
        console.log("[" + name + "] BEST " + JSON.stringify({ settings: rows[0].settings, tuning: rows[0].tuning }));
    }
    return step();
}

var want = process.argv.slice(2);
if (!want.length) want = Object.keys(PRESETS);
want.reduce(function (p, name) { return p.then(function () { return search(name); }); }, Promise.resolve());
