import os
from PIL import Image
from rembg import remove

SRC = r'd:\git\gearfit\marine1.gif'
OUT = r'd:\git\gearfit\app\images'

im = Image.open(SRC)
n = im.n_frames
print("frames:", n)

for i in range(n):
    im.seek(i)
    frame = im.convert('RGBA').copy()
    cut = remove(frame)          # ML background removal -> RGBA
    bbox = cut.getbbox()          # crop to content
    if bbox is None:
        print(i, "empty")
        continue
    cropped = cut.crop(bbox)
    path = os.path.join(OUT, f'marine{i}.png')
    cropped.save(path)
    print(i, "saved", cropped.size)

print("done")
