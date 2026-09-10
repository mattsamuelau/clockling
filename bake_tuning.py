import re

vals = {
    "maxLings": 8, "maxBanes": 1, "maxMarines": 3,
    "marineSpawnRateMult": 1.5,
    "marineWaveLo": 30, "marineWaveHi": 32,
    "marineRespawnLo": 10, "marineRespawnHi": 14,
    "marineSpawnGap": 1, "marineSpawnInset": 6,
    "marineWaveSizeLo": 6, "marineWaveSizeHi": 8,
    "marineRespawnSizeLo": 2, "marineRespawnSizeHi": 4,
    "marineHp": 100, "marineShootDamage": 25, "marineShootInterval": 0.4,
    "marineRangeMult": 3, "marineFleeHpPct": 0.9, "marineFleeRangeMult": 1.5,
    "marineGroupWeight": 0.5, "marineAwayWeight": 1, "marineTurnRate": 0.25,
    "marineSplatScale": 1.4,
    "respawnInterval": 2, "respawnBatch": 2,
    "eggTime": 8.5, "eggHatchMult": 1.25,
    "lingHp": 100, "baneHp": 140,
    "lingBiteDamage": 10, "lingBiteInterval": 0.2,
    "baneSplashDamage": 90, "baneSplashR": 75, "baneSplatScale": 2.5,
    "lingAllyRadius": 40, "lingAllyMin": 18,
    "lingFleeRadius": 140, "lingFleeMarineMin": 3,
    "morphAge": 4, "morphCooldown": 2, "morphChancePerSec": 1,
    "retargetInterval": 0.5, "aimInterval": 0.3,
    "splatLife": 1.21, "splatBase": 7, "splatFadeStart": 0.6,
    "corpseLife": 2.2,
    "lingW": 30, "baneW": 39, "marineW": 42, "eggW": 21,
    "lingBump": 10, "baneBump": 12, "marineBump": 12,
}

path = r'd:\git\gearfit\app\js\swarm.js'
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
