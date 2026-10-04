"""Build app/sounds/* from the sources in the sound design brief (app/sounds/README.md).

Downloads every source clip into .sound-src/ (git-ignored cache), then trims and
converts with ffmpeg:
  - SFX   -> app/sounds/<name>.wav   (mono 22.05 kHz 16-bit, peak-normalised)
  - music -> app/sounds/music/<name>.mp3 (stereo 96 kbps, loudness-normalised,
             faded at both ends so the loop seam is soft)

Needs: ffmpeg on PATH, `pip install yt-dlp curl_cffi`
(curl_cffi gets past the Cloudflare check on myinstants).

Re-cut a clip by editing its (start, duration) below and re-running:
  python build_sounds.py            # build everything (downloads are cached)
  python build_sounds.py marine_shoot bane_die   # just these outputs
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, ".sound-src")
OUT = os.path.join(ROOT, "app", "sounds")

YT = "https://www.youtube.com/watch?v="
SB = "https://hoovers.101soundboards.com/sb/board_sounds_rendered/"   # 101soundboards render CDN
MI = "https://www.myinstants.com/en/instant/"

# source key -> how to fetch it
SOURCES = {
    "yt_gunfire":     ("yt", "hPoYpRRsf0c"),
    "yt_bane":        ("yt", "dV748_ZSzws"),
    "yt_ost":         ("yt", "pNt0iVG2VOA"),
    "sb_zzewht03":    ("url", SB + "plxrvnyb.mp3"),   # 62043074 zergling-zzewht03
    "sb_zzedth00":    ("url", SB + "dazobaje.mp3"),   # 62041948 zergling-zzedth00
    "sb_zzewht00":    ("url", SB + "nlayjvvk.mp3"),   # 62042588 zergling-zzewht00
    "mi_good_to_go":  ("mi", "marine-good-to-go-50098"),
    "mi_rock_n_roll": ("mi", "rock-and-roll-marine-20680"),
    "mi_piece_of_me": ("mi", "wanna-piece-of-me-boy-marine-64377"),
}

# output -> (source, start s, duration s or None for whole clip)
SFX = {
    "marine_shoot":  ("yt_gunfire", 7.08, 0.50),   # middle of the short (13.3 s), one burst
    "bane_die":      ("yt_bane", 8.00, 1.20),      # middle of the short (16.5 s)
    "ling_attack":   ("sb_zzewht03", 0, None),
    "ling_die":      ("sb_zzedth00", 0, None),
    "ling_chill":    ("sb_zzewht00", 0, None),
    "marine_voice1": ("mi_good_to_go", 0, None),
    "marine_voice2": ("mi_rock_n_roll", 0, None),
    "marine_spawn":  ("mi_piece_of_me", 0, None),
}

# StarCraft OST (pNt0iVG2VOA) chapter times
MUSIC = {
    "zerg":    (2322, 2603 - 2322),   # Zerg One
    "protoss": (1264, 1549 - 1264),   # Protoss One
    "terran1": (262, 558 - 262),      # Terran One
    "terran2": (604, 840 - 604),      # Terran Two
    "terran3": (891, 1155 - 891),     # Terran Three
}


def run(cmd):
    subprocess.run(cmd, check=True)


def fetch(key):
    """Download a source once; return its cached path."""
    kind, ref = SOURCES[key]
    for f in os.listdir(SRC):
        if os.path.splitext(f)[0] == key:
            return os.path.join(SRC, f)
    print("fetch", key)
    if kind == "yt":
        run([sys.executable, "-m", "yt_dlp", "-q", "--no-warnings", "-x", "--audio-format", "wav",
             "-o", os.path.join(SRC, key + ".%(ext)s"), YT + ref])
        return os.path.join(SRC, key + ".wav")
    from curl_cffi import requests
    url = ref
    if kind == "mi":
        page = requests.get(MI + ref + "/", impersonate="chrome").text
        m = re.search(r"/media/sounds/[^\"' )]+\.mp3", page)
        if not m:
            raise SystemExit("no mp3 on myinstants page " + ref)
        url = "https://www.myinstants.com" + m.group(0)
    r = requests.get(url, impersonate="chrome")
    r.raise_for_status()
    path = os.path.join(SRC, key + ".mp3")
    with open(path, "wb") as f:
        f.write(r.content)
    return path


def peak_gain(path, start, dur):
    """dB of gain that brings the clip's peak to -1 dBFS."""
    cmd = ["ffmpeg", "-hide_banner", "-ss", str(start)] + (["-t", str(dur)] if dur else []) + \
          ["-i", path, "-af", "volumedetect", "-f", "null", "-"]
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    m = re.search(r"max_volume: (-?[\d.]+) dB", err)
    return -1.0 - float(m.group(1)) if m else 0.0


def build_sfx(name):
    key, start, dur = SFX[name]
    src = fetch(key)
    af = ["volume=%.2fdB" % peak_gain(src, start, dur), "afade=t=in:d=0.005"]
    if dur:
        af.append("afade=t=out:st=%.3f:d=%.3f" % (dur - min(0.25, dur * 0.3), min(0.25, dur * 0.3)))
    out = os.path.join(OUT, name + ".wav")
    run(["ffmpeg", "-v", "error", "-y", "-ss", str(start)] + (["-t", str(dur)] if dur else []) +
        ["-i", src, "-af", ",".join(af), "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le", out])
    print("wrote", os.path.relpath(out, ROOT))


def build_music(name):
    start, dur = MUSIC[name]
    src = fetch("yt_ost")
    out = os.path.join(OUT, "music", name + ".mp3")
    af = "loudnorm=I=-18:TP=-2,afade=t=in:d=1.5,afade=t=out:st=%d:d=3" % (dur - 3)
    run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(dur), "-i", src,
         "-af", af, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "96k", out])
    print("wrote", os.path.relpath(out, ROOT))


def main():
    os.makedirs(SRC, exist_ok=True)
    os.makedirs(os.path.join(OUT, "music"), exist_ok=True)
    want = set(sys.argv[1:])
    for n in SFX:
        if not want or n in want:
            build_sfx(n)
    for n in MUSIC:
        if not want or n in want:
            build_music(n)


if __name__ == "__main__":
    main()
