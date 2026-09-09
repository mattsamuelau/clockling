import os
from collections import deque
import numpy as np
from PIL import Image, ImageFilter

OUT = r'd:\git\gearfit\app\images'

for i in range(21):
    path = os.path.join(OUT, f'marine{i}.png')
    img = Image.open(path).convert('RGBA')
    a = np.array(img)
    rgb = a[:, :, :3].astype(np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    H, W = a.shape[:2]

    blue = (r < 100) & (b > 200) & (b > r + 120) & (b > g + 80)
    yellow = (r > 200) & (g > 140) & (b < 160)
    black = (r < 75) & (g < 75) & (b < 75)
    white = (r > 200) & (g > 200) & (b > 200)
    lightblue = (r < 200) & (b > r + 80) & (b > g + 40)

    # find the LARGEST connected blue component = the body (ignore small bits like the nozzle)
    blue_mask = blue
    seen = np.zeros((H, W), dtype=bool)
    best = None
    for sy, sx in zip(*np.nonzero(blue_mask)):
        if seen[sy, sx]:
            continue
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        comp = [(sy, sx)]
        while q:
            y, x = q.popleft()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < H and 0 <= nx < W and blue_mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
                        comp.append((ny, nx))
        if best is None or len(comp) > len(best):
            best = comp
    body_blue = np.zeros((H, W), dtype=bool)
    for y, x in best:
        body_blue[y, x] = True

    # dilate the body so the white helmet / highlights stay attached
    body = Image.fromarray((body_blue * 255).astype(np.uint8), 'L').filter(ImageFilter.MaxFilter(99))
    body_d = np.array(body) > 0

    keep = blue | yellow | black | (white & body_d) | (lightblue & body_d)

    # flood fill from the body component (8-connectivity) only through keep;
    # drops disconnected window/sky/frame junk dragged in by the flash
    seen = np.zeros((H, W), dtype=bool)
    q = deque()
    for y, x in best:
        seen[y, x] = True
        q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and keep[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))

    a[:, :, 3] = np.where(seen, a[:, :, 3], 0)
    out = Image.fromarray(a)
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    out.save(path)
    print(i, 'cleaned', out.size)

print('done')

