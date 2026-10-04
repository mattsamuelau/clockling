/* Rewards and penalties for each commander, from one battle's stats + control
 * metrics (harness.run output). Resource values follow the units' cost:
 * ling 25, bane 50 (a ling + the morph), marine 50, egg 25.
 *
 * Both sides are paid for kills (value killed - half the value lost, so
 * fighting pays and hiding doesn't), for wiping the other side off the board
 * (+3 / -3 per wipe),
 * for holding the map, and for hitting the enemy where it spawns; the zerg
 * also for banes that pay for themselves, the terrans lose out for stimming
 * marines to death. Value terms are per real minute, so battle length doesn't
 * matter.
 */
var VAL = { ling: 25, bane: 50, marine: 50, egg: 25 };

function rewards(r) {
    var L = r.stats.lost, min = Math.max(1, r.seconds / 60);
    var zergLost = L.ling * VAL.ling + L.bane * VAL.bane + L.egg * VAL.egg;
    var terranLost = L.marine * VAL.marine;
    var control = r.terranControl - r.zergControl;               /* -1 .. 1 */
    var baneEff = L.bane ? r.stats.baneKills / L.bane : 0;      /* marines per bane */
    /* kills count in full, losses at half: fighting has to pay, hiding can't win */
    var V = r.stats.victories || { zerg: 0, terran: 0 };
    var zerg = (terranLost - zergLost * 0.5) / 1000 / min * 4
             - control * 3
             + (V.zerg - V.terran) * 3                         /* wiped them off the board / got wiped */
             + (r.stats.spawnKills || 0) * 0.2 / min
             + Math.min(2, baneEff) * 0.5;
    var terran = (zergLost - terranLost * 0.5) / 1000 / min * 4
               + control * 3
               + (V.terran - V.zerg) * 3
               + L.egg * 0.05 / min
               - (r.stats.stimDeaths || 0) * 0.3 / min;
    return { zerg: +zerg.toFixed(3), terran: +terran.toFixed(3) };
}

module.exports = { rewards: rewards, VAL: VAL };
