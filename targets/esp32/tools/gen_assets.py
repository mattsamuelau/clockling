"""Generate ESP32 firmware assets from the web app.

Outputs (checked in, regenerate after changing sprites or TUNING defaults):
  include/gen_assets.h   - declarations (tuning table, sprites, fonts)
  src/gen_tuning.cpp     - tuning/settings table from app/js (defaults + UI meta)
  src/gen_sprites.cpp    - sprites pre-scaled to their on-screen width, RGB565 + A8
  src/gen_fonts.cpp      - Roboto A8 glyph masks (clock time has its glow baked in)

Usage:  python targets/esp32/tools/gen_assets.py
Needs:  node (to read app/js), Pillow.
"""
import json
import os
import subprocess
import sys
from collections import Counter

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(TARGET))
IMAGES = os.path.join(ROOT, "app", "images")
FONTS = os.path.join(TARGET, "fonts")

# Keys that make no sense on a fixed 240x320 screen.
DROP_KEYS = {"mapW", "mapH"}

# ESP32-only settings: key -> (default, class, group, meaning)
EXTRA = {
    "brightness": (100, "Visible", "Display", "Backlight brightness (%)"),
    "fpsCap": (30, "Advanced", "Display", "Max frames per second (lower = cooler, less power)"),
}
# ESP32 defaults that differ from the web preview, as {key: scale}. On the 240x320
# panel units look best at 0.75x the watch size. Behaviour radii use the same scale so
# every ratio matches the web build (e.g. lings keep marineScanRadius > marine range,
# allyRadius > flock spacing). Speeds stay in px/s.
UNIT_SCALE = 0.75
RADIUS_SCALE = UNIT_SCALE
SCALED = {k: UNIT_SCALE for k in ["lingW", "baneW", "marineW", "eggW", "lingBump", "baneBump",
                                   "marineBump", "splatBase"]}
SCALED.update({k: RADIUS_SCALE for k in ["baneSplashR", "allyRadius", "marineScanRadius",
                                          "marineGroupRadius", "berserkCatchRadius"]})
# Shared keys with web-specific values retain their established ESP32 defaults.
ESP32_DEFAULTS = {
    "maxLings": 10,
    "maxMarines": 7,
    "eggHatchMult": 1,
    "clockBehind": False,
    "gameSpeed": 1,
    "unitScale": 1,   # web default is 2x; the 240x320 panel stays at 1x population
}



def c_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def fmt_float(v):
    s = repr(float(v))
    return s + "f"


def byte_rows(vals, per=24):
    out = []
    for i in range(0, len(vals), per):
        out.append("  " + ",".join(str(v) for v in vals[i:i + per]) + ",")
    return "\n".join(out)


# --------------------------------------------------------------------------- tuning
def load_data():
    raw = subprocess.check_output(["node", os.path.join(HERE, "extract_meta.js")], cwd=ROOT)
    data = json.loads(raw)
    for k, f in SCALED.items():
        data["tuning"][k] = round(data["tuning"][k] * f)
    for k, v in ESP32_DEFAULTS.items():
        (data["settings"] if k in data["settings"] else data["tuning"])[k] = v
    return data


def gen_tuning():
    data = load_data()
    tuning, settings, meta = data["tuning"], data["settings"], data["meta"]

    # group lookup from the web UI's grouping
    group_of = {}
    for g, keys in meta["groups"].items():
        for k in keys:
            group_of.setdefault(k, g)

    entries = []  # (key, default, isBool, advanced, group, meaning)
    for k, v in tuning.items():
        if k in DROP_KEYS:
            continue
        m = meta["tuning"].get(k)
        if m is None:
            print("warning: TUNING key %s has no tuning-meta entry" % k, file=sys.stderr)
            m = {"class": "Advanced", "meaning": k}
        elif m.get("only") == "web":
            continue   # web-only tuning keys (e.g. the egg shield): not on the firmware
        elif m.get("default") != v and k not in SCALED and k not in ESP32_DEFAULTS:
            print("note: %s default differs (swarm.js=%s, tuning-meta=%s); using swarm.js"
                  % (k, v, m.get("default")), file=sys.stderr)
        entries.append((k, v, isinstance(v, bool), m["class"] == "Advanced",
                        group_of.get(k, "Other"), m["meaning"], ""))
    for k, v in settings.items():
        m = meta["settings"].get(k, {"class": "Advanced", "meaning": k})
        if m.get("only") == "web" or isinstance(v, str):
            continue   # web-only (e.g. timeZone, fieldSize); the ESP32 has its own POSIX TZ
        opts = "|".join(m["options"]) if isinstance(m.get("options"), list) else ""
        entries.append((k, v, isinstance(v, bool), m["class"] == "Advanced",
                        group_of.get(k, "Other"), m["meaning"], opts))
    for k, (v, cls, g, meaning) in EXTRA.items():
        entries.append((k, v, isinstance(v, bool), cls == "Advanced", g, meaning, ""))

    # group display order: web groups, then anything new
    order = ["Clock", "Battle", "Display"] + [g for g in meta["groups"] if g not in ("Clock", "Battle", "Display", "Map")]
    for e in entries:
        if e[4] not in order:
            order.append(e[4])

    enum = ",\n".join("  T_%s" % e[0] for e in entries)
    rows = ",\n".join(
        "  {%s, %s, %d, %d, %d, %s, %s}" % (
            c_str(k), fmt_float(float(v)), int(b), int(adv), order.index(g), c_str(meaning),
            c_str(opts) if opts else "nullptr")
        for (k, v, b, adv, g, meaning, opts) in entries)
    groups = ", ".join(c_str(g) for g in order)
    header = """// ---- tuning (generated from app/js/swarm.js + settings.js + tuning-meta.js)
enum TKey : uint8_t {
%s,
  T_COUNT
};
struct TMeta {
  const char* key;
  float def;
  uint8_t isBool;
  uint8_t advanced;
  uint8_t group;      // index into TGROUPS
  const char* meaning;
  const char* opts;   // dropdown labels "A|B|C" (value = index), or nullptr
};
extern const TMeta TMETA[T_COUNT];
extern const char* const TGROUPS[];
extern const uint8_t TGROUP_COUNT;
""" % enum
    body = """const TMeta TMETA[T_COUNT] = {
%s
};
const char* const TGROUPS[] = {%s};
const uint8_t TGROUP_COUNT = %d;
""" % (rows, groups, len(order))
    return header, body


# --------------------------------------------------------------------------- sprites
SPRITE_SETS = [
    # (C name, files, target width TUNING key)
    ("SPR_LING", ["ling%d.png" % i for i in range(4)], "lingW"),
    ("SPR_BANE", ["bane%d.png" % i for i in range(4)], "baneW"),
    ("SPR_EGG", ["eggA.png", "eggB.png", "eggC.png"], "eggW"),
    ("SPR_MWALK", ["marine_walk0.%d.png" % (i + 1) for i in range(6)], "marineW"),
    ("SPR_MATK", ["marine_new%d.png" % i for i in range(8)], "marineW"),
]


def rgb565(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def gen_sprites(tuning):
    header = """// ---- sprites (straight RGB565 + separate A8 alpha)
struct SpriteFrame { uint16_t w, h; const uint16_t* rgb; const uint8_t* a; };
struct SpriteSet { uint8_t n; uint16_t srcW, srcH; const SpriteFrame* frames; };
/* Copy sprite pixels from flash to heap (flash reads miss the 32 KB cache). */
void spritesToRam();
"""
    body = ["#include <stdlib.h>\n#include <string.h>\n",
            "static void* ramCopy(const void* src, size_t n) {\n"
            "  void* p = malloc(n);\n  if (p) memcpy(p, src, n);\n  return p ? p : (void*)src;\n}"]
    to_ram = []
    total = 0
    for name, files, wkey in SPRITE_SETS:
        tw = int(round(tuning[wkey]))
        header += "extern const SpriteSet %s;\n" % name
        frames = []
        src_w = src_h = 0
        for fi, fn in enumerate(files):
            im = Image.open(os.path.join(IMAGES, fn)).convert("RGBA")
            src_w, src_h = im.size
            th = max(1, int(round(tw * src_h / src_w)))
            # premultiplied resize avoids dark fringes around transparent edges
            small = im.convert("RGBa").resize((tw, th), Image.LANCZOS).convert("RGBA")
            px = list(small.get_flattened_data())
            rgb = [rgb565(r, g, b) if a else 0 for (r, g, b, a) in px]
            al = [a for (_, _, _, a) in px]
            cid = "%s_%d" % (name.lower(), fi)
            body.append("static const uint16_t %s_rgb[%d] = {\n%s\n};" % (cid, len(rgb), byte_rows(rgb, 16)))
            body.append("static const uint8_t %s_a[%d] = {\n%s\n};" % (cid, len(al), byte_rows(al)))
            frames.append("{%d, %d, %s_rgb, %s_a}" % (tw, th, cid, cid))
            total += len(rgb) * 3
        body.append("static SpriteFrame %s_frames[] = {%s};" % (name.lower(), ", ".join(frames)))
        body.append("const SpriteSet %s = {%d, %d, %d, %s_frames};" % (
            name, len(frames), src_w, src_h, name.lower()))
        to_ram.append("  for (SpriteFrame& f : %s_frames) {\n"
                      "    f.rgb = (const uint16_t*)ramCopy(f.rgb, f.w * f.h * 2);\n"
                      "    f.a = (const uint8_t*)ramCopy(f.a, f.w * f.h);\n  }" % name.lower())
    body.append("void spritesToRam() {\n%s\n}" % "\n".join(to_ram))
    print("sprites: %.1f KB" % (total / 1024.0))
    return header, "\n".join(body) + "\n"


# --------------------------------------------------------------------------- fonts
FONT_HEADER = """// ---- fonts (A8 coverage masks; colour applied at draw time)
struct Glyph { uint32_t off; uint8_t w, h; int8_t xo, yo; uint8_t adv; };
struct Font { uint8_t first, last; int8_t ascent, descent; const Glyph* glyphs; const uint8_t* alpha; };
"""


def glyph_masks(font_path, size, chars, style=None):
    """Return (glyph list, alpha bytes, ascent, descent). yo is relative to the baseline."""
    font = ImageFont.truetype(font_path, size)
    ascent, descent = font.getmetrics()
    k = size / 70.0  # glow radii scale with the text (CSS values are for 70px)
    pad = int(16 * k) + 2 if style == "glow" else 2
    glyphs, data = [], []
    for ch in chars:
        adv = int(round(font.getlength(ch)))
        box = font.getbbox(ch, anchor="ls")
        if box[2] <= box[0] or box[3] <= box[1]:
            glyphs.append((len(data), 0, 0, 0, 0, adv))
            continue
        w = box[2] - box[0] + pad * 2
        h = box[3] - box[1] + pad * 2
        pen = (pad - box[0], pad - box[1])
        m = Image.new("L", (w, h), 0)
        ImageDraw.Draw(m).text(pen, ch, font=font, fill=255, anchor="ls")
        if style == "glow":
            # CSS: colour rgba(.,.,.,0.35), 1px text-stroke, text-shadow 8px@0.7 + 22px@0.45
            # (ESP32: glow radii halved - blur 4/11 -> 2/5 at 70px).
            # Everything is the same green, so the result is a single alpha mask.
            s = Image.new("L", (w, h), 0)
            ImageDraw.Draw(s).text(pen, ch, font=font, fill=255, anchor="ls",
                                   stroke_width=1, stroke_fill=255)
            ring = ImageChops.subtract(s, m)
            g1 = s.filter(ImageFilter.GaussianBlur(2 * k)).point(lambda v: v * 0.7)
            g2 = s.filter(ImageFilter.GaussianBlur(5 * k)).point(lambda v: v * 0.45)
            fill = m.point(lambda v: v * 0.35)
            layers = [g2, g1, fill, ring]
            out = []
            ld = [list(l.get_flattened_data()) for l in layers]
            for i in range(w * h):
                keep = 1.0
                for l in ld:
                    keep *= 1.0 - l[i] / 255.0
                out.append(int(round((1.0 - keep) * 255)))
            m = Image.new("L", (w, h))
            m.putdata(out)
        bb = m.point(lambda v: 255 if v > 3 else 0).getbbox()
        if not bb:
            glyphs.append((len(data), 0, 0, 0, 0, adv))
            continue
        m = m.crop(bb)
        xo = bb[0] - pen[0]
        yo = bb[1] - pen[1]
        glyphs.append((len(data), m.size[0], m.size[1], xo, yo, adv))
        data.extend(m.get_flattened_data())
    return glyphs, data, ascent, descent


def gen_fonts():
    bold = os.path.join(FONTS, "Roboto-Bold.ttf")
    reg = os.path.join(FONTS, "Roboto-Regular.ttf")
    specs = [
        # name, font, px, first, last, style
        # the ESP32 clock is 1/2 the size of the web one (#time 70px, #sec 20px, #date 16px)
        ("FONT_TIME", bold, 36, "-", ":", "glow"),   # time, glow baked in
        ("FONT_SEC", bold, 15, "-", ":", None),      # seconds
        ("FONT_DATE", reg, 16, " ", "~", None),      # date
        ("FONT_TEXT", reg, 16, " ", "~", None),      # status overlays
    ]
    header = FONT_HEADER
    body = []
    total = 0
    for name, path, px, first, last, style in specs:
        chars = [chr(c) for c in range(ord(first), ord(last) + 1)]
        glyphs, data, asc, desc = glyph_masks(path, px, chars, style)
        total += len(data)
        lo = name.lower()
        header += "extern const Font %s;\n" % name
        body.append("static const uint8_t %s_a[%d] = {\n%s\n};" % (lo, max(1, len(data)), byte_rows(data or [0])))
        body.append("static const Glyph %s_g[] = {\n%s\n};" % (
            lo, ",\n".join("  {%d, %d, %d, %d, %d, %d}" % g for g in glyphs)))
        body.append("const Font %s = {%d, %d, %d, %d, %s_g, %s_a};" % (
            name, ord(first), ord(last), asc, desc, lo, lo))
    print("fonts: %.1f KB" % (total / 1024.0))
    return header, "\n".join(body) + "\n"


# --------------------------------------------------------------------------- background
def gen_background(W, H, suffix):
    """CSS radial-gradient(ellipse at 50% 30%, #1c1142 0%, #0b0618 72%) with the default
    farthest-corner sizing, ordered-dithered to RGB565. Baked so the ESP32 can memcpy it."""
    cx, cy = W * 0.5, H * 0.3
    ratio = min(cx, W - cx) / min(cy, H - cy)
    fx, fy = max(cx, W - cx), max(cy, H - cy)
    ry = ((fx / ratio) ** 2 + fy ** 2) ** 0.5
    rx = ry * ratio
    c0, c1 = (0x1c, 0x11, 0x42), (0x0b, 0x06, 0x18)
    bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    px = []
    for y in range(H):
        for x in range(W):
            t = min(1.0, (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2) ** 0.5 / 0.72)
            d = bayer[y & 3][x & 3] / 16.0
            r, g, b = [a + (b_ - a) * t for a, b_ in zip(c0, c1)]
            r = min(255, int(r + d * 8)); g = min(255, int(g + d * 4)); b = min(255, int(b + d * 8))
            v = rgb565(r, g, b)
            px.append(((v >> 11) << 3, ((v >> 5) & 0x3F) << 2, (v & 0x1F) << 3))
    # 4-bit palette: keep the 16 most used colours, fold any rare extras into their nearest.
    # 38 KB fits in RAM; a 150 KB RGB565 copy read from flash thrashes the 32 KB cache.
    top = [c for c, _ in Counter(px).most_common(16)]
    near = {c: min(top, key=lambda t: sum((a - b_) ** 2 for a, b_ in zip(c, t))) for c in set(px)}
    idx = [top.index(near[c]) for c in px]
    pal = [rgb565(*c) for c in top] + [0] * (16 - len(top))
    nib = [idx[i] | (idx[i + 1] << 4) for i in range(0, len(idx), 2)]
    header = ("// ---- background %dx%d (4-bit indices into a 16-colour RGB565 palette)\n"
              "extern const uint16_t BG_PAL_%s[16];\nextern const uint8_t BG_NIB_%s[%d];\n"
              % (W, H, suffix, suffix, len(nib)))
    body = "const uint16_t BG_PAL_%s[16] = {%s};\nconst uint8_t BG_NIB_%s[%d] = {\n%s\n};\n" % (
        suffix, ",".join(map(str, pal)), suffix, len(nib), byte_rows(nib))
    return header, body


def write(path, text):
    with open(path, "w", newline="\n") as f:
        f.write(text)
    print("wrote", os.path.relpath(path, ROOT))


def main():
    t_head, t_body = gen_tuning()
    tuning = load_data()["tuning"]
    s_head, s_body = gen_sprites(tuning)
    f_head, f_body = gen_fonts()
    bp_head, bp_body = gen_background(240, 320, "P")   # portrait
    bl_head, bl_body = gen_background(320, 240, "L")   # landscape
    b_head, b_body = bp_head + bl_head, bp_body + bl_body

    banner = "// GENERATED by targets/esp32/tools/gen_assets.py - do not edit.\n"
    write(os.path.join(TARGET, "include", "gen_assets.h"),
          banner + "#pragma once\n#include <stdint.h>\n\n" + t_head + "\n" + s_head + "\n" + f_head + "\n" + b_head)
    write(os.path.join(TARGET, "src", "gen_tuning.cpp"),
          banner + '#include "gen_assets.h"\n\n' + t_body)
    write(os.path.join(TARGET, "src", "gen_sprites.cpp"),
          banner + '#include <esp_attr.h>\n#include "gen_assets.h"\n\n' + s_body)
    write(os.path.join(TARGET, "src", "gen_background.cpp"),
          banner + '#include "gen_assets.h"\n\n' + b_body)
    write(os.path.join(TARGET, "src", "gen_fonts.cpp"),
          banner + '#include "gen_assets.h"\n\n' + f_body)


if __name__ == "__main__":
    main()
