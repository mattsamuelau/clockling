/* "Is this battle fun?" metrics from one sample per real second of
 * [marines, lings, banes].
 *
 * Share: each side's units as a fraction of its cap (maxMarines; maxLings +
 * maxBanes, both x unitScale); share = terran / (terran + zerg), smoothed 10 s. A side "controls the
 * map" while its share is >= 0.6 (zerg: <= 0.4). A good fight swings: terran
 * takes decisive control for a while, then the zerg do, then terran again -
 * not a 50/50 stalemate and not a wipe.
 */
var CONTROL = 0.6, SMOOTH = 10;

function summarize(samples, caps) {
    var n = samples.length, share = [], i;
    for (i = 0; i < n; i++) {
        /* each side as a fraction of its own cap, so a side near wiped out reads as
         * having lost the map whatever the raw supply numbers are */
        var s = samples[i], T = s[0] / caps.marines, Z = (s[1] + s[2]) / caps.zerg;
        share.push(T + Z > 0 ? T / (T + Z) : 0.5);
    }
    var sm = [];
    for (i = 0; i < n; i++) {
        var a = Math.max(0, i - SMOOTH + 1), sum = 0;
        for (var j = a; j <= i; j++) sum += share[j];
        sm.push(sum / (i - a + 1));
    }
    /* control spells: runs of one side in control; contested seconds between two
     * spells of the same side don't break it */
    var tT = 0, tZ = 0, spells = [], cur = null, curLen = 0, swings = 0, lastSide = null;
    var mean = 0, units = 0;
    var warm = Math.min(60, Math.floor(n / 5));   /* skip the opening minute */
    for (i = warm; i < n; i++) {
        var v = sm[i], side = v >= CONTROL ? "T" : v <= 1 - CONTROL ? "Z" : null;
        mean += v;
        units += samples[i][0] + samples[i][1] + samples[i][2];
        if (side === "T") tT++;
        if (side === "Z") tZ++;
        if (side && side !== cur) {
            if (cur) spells.push({ side: cur, len: curLen });
            if (lastSide && side !== lastSide) swings++;
            cur = side; curLen = 0; lastSide = side;
        }
        if (side && side === cur) curLen++;
    }
    if (cur) spells.push({ side: cur, len: curLen });
    var m = n - warm || 1;
    var longest = { T: 0, Z: 0 };
    spells.forEach(function (sp) { longest[sp.side] = Math.max(longest[sp.side], sp.len); });
    return {
        seconds: n,
        meanShare: +(mean / m).toFixed(3),
        terranControl: +(tT / m).toFixed(3),
        zergControl: +(tZ / m).toFixed(3),
        swingsPer10Min: +(swings / m * 600).toFixed(2),
        longestTerranSpell: longest.T,
        longestZergSpell: longest.Z,
        avgUnits: +(units / m).toFixed(1)
    };
}

/* score a (seed-averaged) summary against a preset's target: control time for
 * each side, a healthy swing rate, no side holding the map forever */
function fun(r, target) {
    var score = 0;
    score -= Math.abs(r.terranControl - target.terran) * 10;
    score -= Math.abs(r.zergControl - target.zerg) * 10;
    var sw = Math.max(0.2, r.swingsPer10Min);
    score -= Math.abs(Math.log(sw / target.swings)) * 3;
    var cap = target.maxSpell || 240;
    score -= Math.max(0, r.longestTerranSpell - cap) / 60;
    score -= Math.max(0, r.longestZergSpell - cap) / 60;
    if (target.minUnits && r.avgUnits < target.minUnits) score -= (target.minUnits - r.avgUnits) / target.minUnits * 5;
    return +score.toFixed(3);
}

function average(list) {
    var out = {}, keys = Object.keys(list[0]).filter(function (k) { return typeof list[0][k] === "number"; });
    keys.forEach(function (k) {
        out[k] = +(list.reduce(function (a, r) { return a + r[k]; }, 0) / list.length).toFixed(3);
    });
    return out;
}

module.exports = { summarize: summarize, fun: fun, average: average };
