/* rounds.js worker: one headless battle, reports the first wipe (s) and its winner */
var fs = require("fs"), vm = require("vm"), path = require("path");
var ROOT = path.join(__dirname, "..", "..");
process.on("message", function (opts) {
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
    for (var k in opts.settings) SET[k] = opts.settings[k];
    S.setTuning(opts.tuning || {});
    S.resize(1280 * 16 / 9, 1280, 1);
    S.setGameSpeed(SET.gameSpeed); S.setUnitScale(SET.unitScale);
    S.init({ canvas: "x" });
    var t = 1000, first = null, winner = null;
    for (var f = 0; f < opts.seconds * 60; f++) {
        t += 1000 / 60;
        var cb = raf; raf = null; cb(t);
        if (first === null && f % 30 === 0) {
            var v = S.stats().victories;
            /* ignore the opening 60 s (the starting armies colliding) */
            if ((v.zerg || v.terran) && f / 60 > 60) { first = f / 60; winner = v.zerg ? "zerg" : "terran"; break; }
            if ((v.zerg || v.terran) && f / 60 <= 60) S.resetStats();
        }
    }
    process.send({ first: first === null ? null : Math.round(first), winner: winner });
    process.exit(0);
});
