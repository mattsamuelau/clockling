/* Round-length search: tunes the knobs that decide how fast a side can snowball
 * so that, in Balanced, one side wins decisively (wipes the other) after about
 * 3-5 minutes of fighting - and either side can be the one that wins.
 *
 *   node tools/sim/rounds.js            # GENS=4 POP=12 SEEDS=3 SECS=600
 *
 * Score per candidate: how far each seed's first wipe lands from 4 minutes
 * (no wipe = heavy penalty) plus how lopsided the winners are across seeds.
 * Writes tools/sim/results/rounds.json, best first.
 */
var fork = require("child_process").fork, path = require("path"), fs = require("fs"), os = require("os");
var GENS = +process.env.GENS || 4, POP = +process.env.POP || 12, SEEDS = +process.env.SEEDS || 3, SECS = +process.env.SECS || 600;
var WORKERS = +process.env.WORKERS || Math.max(1, os.cpus().length - 2);
var SETTINGS = { gameSpeed: 2.5, unitScale: 2, marineSkill: 0.8, zergSkill: 0.8, blueShell: true };
var SPACE = {
    respawnInterval: [3, 12], respawnBatch: [1, 5, "int"],
    blueShellPulse: [8, 40], marineRespawnSizeLo: [1, 4, "int"],
    attackOdds: [1, 3], zergNoHope: [0.1, 0.5], zergPatience: [3, 20]
};
function sample(r) { var v = r[0] + Math.random() * (r[1] - r[0]); return r[2] === "int" ? Math.round(v) : +v.toFixed(2); }
function mutate(g) {
    var o = {};
    for (var k in SPACE) {
        var r = SPACE[k], v = g[k];
        if (Math.random() < 0.4) v = Math.max(r[0], Math.min(r[1], v + (Math.random() * 2 - 1) * (r[1] - r[0]) * 0.25));
        o[k] = r[2] === "int" ? Math.round(v) : +v.toFixed(2);
    }
    return o;
}
function tuning(g) { var t = {}; for (var k in g) t[k] = g[k]; t.marineRespawnSizeHi = g.marineRespawnSizeLo + 1; return t; }

/* one battle in a forked worker: first wipe time (s) and who won it */
var WORKER = path.join(__dirname, "rounds_worker.js");
function runAll(jobs) {
    return new Promise(function (resolve) {
        var out = new Array(jobs.length), next = 0, done = 0;
        function launch() {
            if (next >= jobs.length) return;
            var i = next++, c = fork(WORKER);
            c.on("message", function (r) { out[i] = r; });
            c.on("exit", function () { if (++done === jobs.length) resolve(out); else launch(); });
            c.send(jobs[i]);
        }
        for (var w = 0; w < Math.min(WORKERS, jobs.length); w++) launch();
    });
}
function score(runs) {
    var s = 0, z = 0, t = 0;
    runs.forEach(function (r) {
        if (!r || r.first === null) { s -= 6; return; }
        s -= Math.abs(r.first / 60 - 4);
        if (r.winner === "zerg") z++; else t++;
    });
    s -= Math.abs(z - t) / runs.length * 3;
    return +s.toFixed(3);
}
function main() {
    var pop = [], all = [];
    for (var i = 0; i < POP; i++) { var g = {}; for (var k in SPACE) g[k] = sample(SPACE[k]); pop.push(g); }
    var gen = 0;
    (function step() {
        var jobs = [];
        pop.forEach(function (g) { for (var s = 0; s < SEEDS; s++) jobs.push({ settings: SETTINGS, tuning: tuning(g), seconds: SECS }); });
        runAll(jobs).then(function (res) {
            pop.forEach(function (g, i) {
                var runs = res.slice(i * SEEDS, (i + 1) * SEEDS);
                all.push({ genes: g, score: score(runs), runs: runs });
            });
            all.sort(function (a, b) { return b.score - a.score; });
            console.log("gen " + gen + " best " + all[0].score + " " + JSON.stringify(all[0].runs) + " " + JSON.stringify(all[0].genes));
            if (++gen >= GENS) {
                var dir = path.join(__dirname, "results");
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, "rounds.json"), JSON.stringify({ settings: SETTINGS, secs: SECS, seeds: SEEDS, date: new Date().toISOString(), candidates: all.map(function (c) { return { score: c.score, tuning: tuning(c.genes), runs: c.runs }; }) }, null, 1));
                return;
            }
            var keep = all.slice(0, 4).map(function (c) { return c.genes; });
            pop = [];
            for (var j = 0; j < POP; j++) pop.push(mutate(keep[j % keep.length]));
            step();
        });
    })();
}
main();
