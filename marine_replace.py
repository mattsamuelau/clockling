"""Replace app/images/marine0-20.png with frames from marine1_transparent.gif.

The new GIF is the transparent version of marine1.gif: 21 frames, all 426x240,
with an identical content bbox (35,7,401,237) on every frame. Cropping to that
fixed bbox gives every sprite the SAME dimensions (366x230) -> no more wobble.
"""
import os
from PIL import Image, ImageSequence

SRC = r"d:\git\gearfit\marine1_transparent.gif"
OUTDIR = r"d:\git\gearfit\app\images"
BOX = (35, 7, 401, 237)  # fixed tight bbox, identical for all 21 frames

im = Image.open(SRC)
frames = list(ImageSequence.Iterator(im))
assert len(frames) == 21, "expected 21 frames, got %d" % len(frames)

for i, f in enumerate(frames):
    rgba = f.convert("RGBA")
    out = rgba.crop(BOX)
    path = os.path.join(OUTDIR, "marine%d.png" % i)
    out.save(path)
    print("marine%d.png %s" % (i, out.size))

print("replaced %d marine sprites" % len(frames))
