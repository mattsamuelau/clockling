"""Write the values table below into the TUNING block of app/js/swarm.js.
Ignores arguments: running it rewrites swarm.js. Keep the table equal to the defaults."""
import os
import re

vals = {
    "maxLings": 14, "maxBanes": 2, "maxMarines": 6,
    "zergSpeed": 1.2, "terranSpeed": 1.2,
    "marineSpawnRateMult": 1.5,
    "marineWaveLo": 30, "marineWaveHi": 32,
    "marineRespawnLo": 8, "marineRespawnHi": 10,
    "marineSpawnGap": 0.5, "marineSpawnInset": 6,
    "marineWaveSizeLo": 6, "marineWaveSizeHi": 6,
    "marineRespawnSizeLo": 2, "marineRespawnSizeHi": 2,
    "marineHp": 120, "marineShootDamage": 25, "marineShootInterval": 0.36,
    "marineRangeMult": 3, "marineFleeHpPct": 0.9, "marineKiteFrac": 0.6,
    "marineEntrySpeed": 1.5, "marineEntryDepth": 0.09, "marineSightMult": 2,
    "marineGroupWeight": 0.5, "marineAwayWeight": 1, "marineTurnRate": 0.25,
    "marineHealPct": 0.10, "marineHealInterval": 0.5,
    "marineSplatScale": 1.4,
    "respawnInterval": 2, "respawnBatch": 4,
    "eggTimeMin": 8, "eggTimeMax": 10, "eggHatchMult": 1.5,
    "lingHp": 100, "baneHp": 140,
    "lingBiteDamage": 10, "lingBiteInterval": 0.2,
    "baneSplashDamage": 90, "baneSplashR": 61, "baneSplatScale": 2.5,
    "attackGroupSize": 5, "berserkBanes": 2, "attackOdds": 1.5,
    "allyRadius": 45, "marineScanRadius": 140, "marineGroupRadius": 60,
    "berserkCatchRadius": 80, "berserkSpeedMult": 1.5, "lingFleeSpeedMult": 1.4,
    "morphAge": 4, "morphCooldown": 2, "morphChancePerSec": 1,
    "retargetInterval": 0.5, "aimInterval": 0.3,
    "splatLife": 1.21, "splatBase": 7, "splatFadeStart": 0.6,
    "corpseLife": 2.2,
    "lingW": 30, "baneW": 39, "marineW": 42, "eggW": 21,
    "lingBump": 10, "baneBump": 12, "marineBump": 12,
}

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app', 'js', 'swarm.js')
src = open(path, encoding='utf-8').read()

def fmt(v):
    return ('%g' % v) if isinstance(v, float) else str(v)

changed = 0
for k, v in vals.items():
    pattern = re.compile(r'\b' + re.escape(k) + r':\s*[0-9.]+')
    new = k + ': ' + fmt(v)
    src2, n = pattern.subn(new, src)
    if n:
        changed += 1
        src = src2
    else:
        print('NOT FOUND:', k)

open(path, 'w', encoding='utf-8', newline='').write(src)
print('updated', changed, 'keys')
