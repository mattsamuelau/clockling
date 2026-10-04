/* Headless Clockling battle: runs the real app/js/swarm.js in a Node vm with a
 * stub canvas and a fake 60 fps clock, sampling the fight once per real second.
 *
 *   node tools/sim/harness.js '{"settings":{"gameSpeed":2,"marineSkill":0.8},"tuning":{"maxLings":20},"seconds":600}'
 *
 * As a module: require("./harness").run(opts) -> metrics (see metrics.js).
 * Used by balance.js, which forks this file once per battle.
 */
var fs = require("fs"), vm = require("vm"), path = require("path");
var metrics = require("./metrics");
var ROOT = path.join(__dirname, "..", "..");

function run(opts) {
    var noop = function () {};
    var ctx = new Proxy({}, { get: function (t, k) {
        if (k === "createRadialGradient" || k === "createLinearGradient") return function () { return { addColorStop: noop }; };
        if (k === "measureText") return function () { return { width: 10 }; };
        return k in t ? t[k] : noop;
    }, set: function (t, k, v) { t[k] = v; return true; } });
    var rafCb = null;
    var sandbox = {
        window: { location: { search: "" }, requestAnimationFrame: function (cb) { rafCb = cb; return 1; }, cancelAnimationFrame: noop },
        document: { getElementById: function () { return { getContext: function () { return ctx; } }; } },
        Image: function () { this.width = 366; this.height = 230; },
        console: console
    };
    /* images "load" as soon as src is set */
    Object.defineProperty(sandbox.Image.prototype, "src", { set: function () { var s = this; s.onload && s.onload(); } });
    vm.createContext(sandbox);
    ["settings.js", "tuning-meta.js", "brains.js", "swarm.js"].forEach(function (f) {
        if (!fs.existsSync(path.join(ROOT, "app/js", f))) return;
        vm.runInContext(fs.readFileSync(path.join(ROOT, "app/js", f), "utf8"), sandbox, { filename: f });
    });
    vm.runInContext("this.__S = Swarm; this.__SET = SETTINGS;", sandbox);
    var Swarm = sandbox.__S, SET = sandbox.__SET;
    var s = opts.settings || {};
    for (var k in s) SET[k] = s[k];
    SET.soundOn = false;
    Swarm.setTuning(opts.tuning || {});
    Swarm.resize(opts.w || 1280 * 16 / 9, opts.h || 1280, 1);
    Swarm.setGameSpeed(SET.gameSpeed);
    Swarm.setUnitScale(SET.unitScale);
    Swarm.init({ canvas: "x" });   /* restart() + start() run synchronously: images load instantly */

    var secs = opts.seconds || 600, t = 1000, samples = [];
    for (var f = 0; f < secs * 60; f++) {
        t += 1000 / 60;
        var cb = rafCb; rafCb = null;
        if (!cb) break;
        cb(t);
        if (f % 60 === 59) {
            var units = Swarm.debugUnits(), m = 0, l = 0, b = 0;
            for (var i = 0; i < units.length; i++) {
                var u = units[i];
                if (u.dead) continue;
                if (u.kind === "marine") m++; else if (u.kind === "ling") l++; else if (u.kind === "bane") b++;
            }
            samples.push([m, l, b]);
        }
    }
    var T = Swarm.TUNING, us = +SET.unitScale || 1;
    var out = metrics.summarize(samples, { marines: Math.max(1, Math.round(T.maxMarines * us)),
                                           zerg: Math.max(1, Math.round(T.maxLings * us) + Math.round(T.maxBanes * us)) });
    out.stats = Swarm.stats();
    if (opts.keepSamples) out.samples = samples;
    return out;
}

module.exports = { run: run };

if (require.main === module) {
    if (process.send) {
        process.on("message", function (opts) { process.send(run(opts)); process.exit(0); });
    } else {
        var res = run(JSON.parse(process.argv[2] || "{}"));
        console.log(JSON.stringify(res, null, 1));
    }
}
