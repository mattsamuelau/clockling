from PIL import Image
import os

OUT = r'd:\git\gearfit\app\images'
flash = []
idle = []
for i in range(21):
    img = Image.open(os.path.join(OUT, f'marine{i}.png')).convert('RGBA')
    px = img.load()
    has = False
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a > 0 and r > 200 and g > 140 and b < 160:
                has = True
                break
        if has:
            break
    (flash if has else idle).append(i)
    print(i, 'flash' if has else 'idle')
print('FLASH', flash)
print('IDLE', idle)
