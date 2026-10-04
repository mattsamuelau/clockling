/* Backtest every battle preset exactly as the page applies it (defaults, then the
 * preset's sliders + tuning from clockling.html PRESETS), several seeds each, and
 * report whether the fight is alive: zerg attacks launched, kills per minute both
 * ways, and when each side wiped the other.
 *
 *   node tools/sim/backtest.js            # all presets, 3 seeds x 8 real minutes
 *   SEEDS=2 MINS=5 node tools/sim/backtest.js Balanced Mental
 *
 * Run this before handing over any behaviour / tuning change.
 */
var fork = require("child_process").fork, fs = require("fs"), path = require("path"), vm = require("vm"), os = require("os");
var ROOT = path.join(__dirname, "..", "..");
var SEEDS = +process.env.SEEDS || 3, MINS = +process.env.MINS || 8;

function loadPresets() {
    var html = fs.readFileSync(path.join(ROOT, "clockling.html"), "utf8");
    var a = html.indexOf("var PRESETS = ["), b = html.indexOf("];", a);
    var sb = {};
    vm.createContext(sb);
    vm.runInContext(html.slice(a, b + 2) + " this.P = PRESETS;", sb);
    return sb.P;
}

if (process.send || process.argv[2] === "--child") {
    process.on("message", function (job) {
        var noop = function () {};
        var ctx = new Proxy({}, { get: function (t, k) {
            if (k === "createRadialGradient" || k === "createLinearGradient") return function () { return { addColorStop: noop }; };
            return k in t ? t[k] : noop;
        }, set: function (t, k, v) { t[k] = v; return true; } });
        var raf = null;
        var sb = { window: { location: { search: "" }, requestAnimationFrame: function (cb) { raf = cb; }, cancelAnimationFrame: noop },
                   document: { getElementById: function () { return { getContext: function () { return ctx; } }; } },
                   Image: function () {}, console: console };
        Object.defineProperty(sb.Image.prototype, "src", { set: function () { this.onload && this.onload(); } });
        vm.createContext(sb);
        ["settings.js", "tuning-meta.js", "brains.js", "swarm.js"].forEach(function (f) {
            if (fs.existsSync(path.join(ROOT, "app/js", f))) vm.runInContext(fs.readFileSync(path.join(ROOT, "app/js", f), "utf8"), sb);
        });
        vm.runInContext("this.__S = Swarm; this.__SET = SETTINGS;", sb);
        var S = sb.__S, SET = sb.__SET;
        for (var k in job.s) SET[k] = job.s[k];
        S.setTuning(job.t || {});
        S.resize(1280 * 16 / 9, 1280, 1);
        S.setGameSpeed(SET.gameSpeed); S.setUnitScale(SET.unitScale);
        var attacks = 0, was = false, t = 1000, wipes = [], lastV = { zerg: 0, terran: 0 };
        S.setSoundHandler(function (n) { if (n === "lingAttack") attacks++; });
        S.init({ canvas: "x" });
        for (var f = 0; f < job.mins * 3600; f++) {
            t += 1000 / 60;
            var cb = raf; raf = null; cb(t);
            if (f % 60 === 0) {
                var v = S.stats().victories;
                if (v.zerg > lastV.zerg) wipes.push("Z" + (f / 3600).toFixed(1));
                if (v.terran > lastV.terran) wipes.push("T" + (f / 3600).toFixed(1));
                lastV = { zerg: v.zerg, terran: v.terran };
            }
        }
        var L = S.stats().lost;
        process.send({ attacks: attacks, marinesKilled: L.marine, zergKilled: L.ling + L.bane, wipes: wipes });
        process.exit(0);
    });
    return;
}

var presets = loadPresets(), want = process.argv.slice(2);
if (want.length) presets = presets.filter(function (p) { return want.indexOf(p.name) >= 0; });
var jobs = [];
presets.forEach(function (p) { for (var i = 0; i < SEEDS; i++) jobs.push({ name: p.name, s: p.s, t: p.t, mins: MINS }); });
var results = new Array(jobs.length), next = 0, done = 0, W = Math.max(1, os.cpus().length - 2);
function launch() {
    if (next >= jobs.length) return;
    var i = next++, c = fork(__filename, ["--child"]);
    c.on("message", function (r) { results[i] = r; });
    c.on("exit", function () { if (++done === jobs.length) report(); else launch(); });
    c.send(jobs[i]);
}
for (var w = 0; w < Math.min(W, jobs.length); w++) launch();
function report() {
    presets.forEach(function (p) {
        console.log("== " + p.name + " (" + SEEDS + " x " + MINS + " min)");
        jobs.forEach(function (j, i) {
            if (j.name !== p.name) return;
            var r = results[i] || {};
            console.log("   zerg attacks " + r.attacks + " | marines killed/min " + (r.marinesKilled / MINS).toFixed(1) +
                        " | zerg killed/min " + (r.zergKilled / MINS).toFixed(1) + " | wipes " + ((r.wipes || []).join(" ") || "none"));
        });
    });
}
