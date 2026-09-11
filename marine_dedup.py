"""Deduplicate marine1_transparent.gif frames into visually-distinct images.

Saves one representative per distinct group as app/images/marine_new#.png,
with a labeled grid (marine_new_grid.png) for quick visual picking.
The current animation is a firing cycle: clean -> smoke -> flash -> clean ...
so distinct groups = clean, smoke variants, flash variants.
"""
import math
from PIL import Image, ImageSequence

SRC = r"d:\git\gearfit\marine1_transparent.gif"
OUTDIR = r"d:\git\gearfit\app\images"
GRID = r"d:\git\gearfit\marine_new_grid.png"
BOX = (35, 7, 401, 237)      # fixed tight bbox, identical for all frames
THRESHOLD = 26               # RMS color difference under this => same image

im = Image.open(SRC)
frames = [f.convert("RGBA").crop(BOX) for f in ImageSequence.Iterator(im)]
assert len(frames) == 21

# flatten pixels once
def flatten(f):
    px = f.load(); w, h = f.size
    return [(px[x, y]) for y in range(h) for x in range(w)]

data = [flatten(f) for f in frames]

def rms(a, b):
    s = 0; n = 0
    for (r1, g1, b1, a1), (r2, g2, b2, a2) in zip(a, b):
        if a1 < 40 and a2 < 40:
            continue
        n += 1
        s += (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
    return math.sqrt(s / (3 * n))

# greedy clustering in first-occurrence order (keeps animation order)
groups = []
for i, pix in enumerate(data):
    placed = False
    for grp in groups:
        if rms(data[grp[0]], pix) < THRESHOLD:
            grp.append(i)
            placed = True
            break
    if not placed:
        groups.append([i])

# save first frame of each group (lowest original index)
saved = []
for gi, grp in enumerate(groups):
    rep = frames[grp[0]]
    path = "%s/marine_new%d.png" % (OUTDIR, gi)
    rep.save(path)
    saved.append((gi, grp, rep))
    print("marine_new%d.png <- frames %s" % (gi, grp))

# labeled grid for easy picking
W, H = saved[0][2].size
cols = 4
rows = math.ceil(len(saved) / cols)
pad = 8
grid = Image.new("RGBA", (cols * (W + pad) + pad, rows * (H + pad) + pad), (30, 30, 50, 255))
for gi, grp, rep in saved:
    cell = (pad + (gi % cols) * (W + pad), pad + (gi // cols) * (H + pad))
    grid.alpha_composite(rep, cell)
grid.convert("RGB").save(GRID)
print("grid -> %s" % GRID)
print("distinct images = %d" % len(saved))
