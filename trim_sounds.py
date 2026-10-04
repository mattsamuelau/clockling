"""Quick trim tool for app/sounds/*.wav and app/sounds/music/*.mp3.

  python trim_sounds.py      ->  opens http://127.0.0.1:8091 in your browser

Pick a clip, drag the Start (and End) slider, hit Play to preview, Save to
write the trimmed .wav. Trims are recorded in app/sounds/trims.json (committed)
and always cut from the untrimmed original, kept in .sound-src/originals/
(git-ignored), so you can re-trim freely; "Restore original" drops the trim.

build_sounds.py re-applies trims.json after rebuilding a clip, so a rebuild
keeps your trims.
"""
import array
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
import wave
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
SOUNDS = os.path.join(ROOT, "app", "sounds")
BACKUP = os.path.join(ROOT, ".sound-src", "originals")
TRIMS = os.path.join(SOUNDS, "trims.json")
PORT = 8091
FADE_S = 0.005  # tiny fade at each cut so it doesn't click


def clip_name(name):
    """'ling_die.wav' or 'music/zerg.mp3' - anything else is refused."""
    d, f = os.path.split(name.replace("\\", "/"))
    if (d, os.path.splitext(f)[1]) not in (("", ".wav"), ("music", ".mp3")) or f.startswith("."):
        raise ValueError("not a clip: " + name)
    return d + "/" + f if d else f


def clip_path(name):
    p = os.path.join(SOUNDS, clip_name(name))
    if not os.path.isfile(p):
        raise ValueError("no such clip")
    return p


def list_clips():
    wavs = sorted(f for f in os.listdir(SOUNDS) if f.endswith(".wav"))
    music = sorted("music/" + f for f in os.listdir(os.path.join(SOUNDS, "music")) if f.endswith(".mp3"))
    return wavs + music


def original_path(name):
    """Untrimmed copy of a clip; made from the current file the first time."""
    p = clip_path(name)
    bak = os.path.join(BACKUP, clip_name(name))
    if not os.path.exists(bak):
        os.makedirs(os.path.dirname(bak), exist_ok=True)
        shutil.copy2(p, bak)
    return bak


def load_trims():
    try:
        with open(TRIMS, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_trims(trims):
    with open(TRIMS, "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(sorted(trims.items())), f, indent=2)
        f.write("\n")


def cut(src, dst, start, end):
    """Write src[start:end] (seconds) to dst with a fade at each edge."""
    if dst.endswith(".mp3"):
        return cut_music(src, dst, start, end)
    with wave.open(src, "rb") as w:
        params = w.getparams()
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        frames = w.readframes(w.getnframes())
    n = len(frames) // (ch * width)
    a = max(0, min(n - 1, int(round(start * rate))))
    b = max(a + 1, min(n, int(round(end * rate))))
    data = frames[a * ch * width:b * ch * width]
    if width == 2:
        s = array.array("h", data)
        if sys.byteorder == "big":
            s.byteswap()
        f = min(int(FADE_S * rate), (b - a) // 2)
        for i in range(f):
            g = i / f
            for c in range(ch):
                s[i * ch + c] = int(s[i * ch + c] * g)
                s[-(i + 1) * ch + c] = int(s[-(i + 1) * ch + c] * g)
        if sys.byteorder == "big":
            s.byteswap()
        data = s.tobytes()
    with wave.open(dst, "wb") as w:
        w.setparams(params)
        w.writeframes(data)
    return (b - a) / rate


def cut_music(src, dst, start, end):
    """Re-encode like build_sounds.build_music: fade in 1.5 s / out 3 s so the loop seam stays soft."""
    dur = end - start
    af = "afade=t=in:d=%.3f,afade=t=out:st=%.3f:d=%.3f" % (min(1.5, dur / 4), dur - min(3, dur / 4), min(3, dur / 4))
    tmp = dst + ".tmp.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % start, "-t", "%.3f" % dur, "-i", src,
                    "-af", af, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "96k", tmp], check=True)
    os.replace(tmp, dst)
    return dur


def trim(name, start, end):
    name = clip_name(name)
    dur = cut(original_path(name), clip_path(name), start, end)
    trims = load_trims()
    trims[name] = [round(start, 3), round(end, 3)]
    save_trims(trims)
    return dur


def restore(name):
    name = clip_name(name)
    shutil.copy2(original_path(name), clip_path(name))
    trims = load_trims()
    trims.pop(name, None)
    save_trims(trims)


def reapply(name):
    """Called by build_sounds.py right after it rebuilds a clip: the fresh build
    becomes the new original, then any recorded trim is cut from it."""
    name = clip_name(name)
    t = load_trims().get(name)
    if not t:
        return None
    bak = os.path.join(BACKUP, name)
    os.makedirs(os.path.dirname(bak), exist_ok=True)
    shutil.copy2(clip_path(name), bak)
    return cut(bak, clip_path(name), t[0], t[1])


PAGE = r"""<!doctype html><html><head><meta charset="utf-8"><title>Sound Trimmer</title>
<style>
:root{--bg:#16181d;--panel:#20232a;--fg:#e6e6e6;--dim:#8a8f98;--acc:#6cf;--cut:#e5534b}
body{margin:0;background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif;display:flex;height:100vh}
#list{width:200px;background:var(--panel);overflow:auto;padding:8px 0}
#list div{padding:8px 14px;cursor:pointer}#list div:hover{background:#2a2e37}
#list div.on{background:var(--acc);color:#000}
#main{flex:1;padding:20px;display:flex;flex-direction:column;gap:14px;min-width:0}
canvas{width:100%;height:180px;background:#0e1013;border-radius:6px}
.row{display:flex;align-items:center;gap:12px}.row label{width:50px;color:var(--dim)}
input[type=range]{flex:1}.val{width:70px;text-align:right;font-variant-numeric:tabular-nums}
button{background:#2f3540;color:var(--fg);border:0;border-radius:5px;padding:9px 16px;font-size:14px;cursor:pointer}
button:hover{background:#3b4250}button.pri{background:var(--acc);color:#000}
#msg{color:var(--dim);white-space:pre-wrap;font-family:monospace}
</style></head><body>
<div id="list"></div>
<div id="main">
  <h3 id="title" style="margin:0">pick a clip</h3>
  <canvas id="cv"></canvas>
  <div class="row"><label>Start</label><input id="s" type="range" min="0" step="0.01" value="0"><span class="val" id="sv"></span></div>
  <div class="row"><label>End</label><input id="e" type="range" min="0" step="0.01" value="0"><span class="val" id="ev"></span></div>
  <div class="row">
    <button id="play">&#9654; Play trimmed (space)</button><button id="playall">Play whole</button>
    <button class="pri" id="save">Save</button><button id="restore">Restore original</button>
  </div>
  <div id="msg"></div>
</div>
<script>
const ac = new AudioContext(), cv = document.getElementById("cv"), ctx = cv.getContext("2d");
const S = document.getElementById("s"), E = document.getElementById("e"), msg = document.getElementById("msg");
let peaks = null, trims = {}, cur = null, buf = null, src = null, playStart = 0, playOff = 0, playEnd = 0;

async function loadList() {
  const r = await (await fetch("/list")).json(), L = document.getElementById("list");
  trims = r.trims; L.innerHTML = "";
  r.names.forEach(n => { const d = document.createElement("div"); d.dataset.n = n; d.textContent = n + (trims[n] ? " ✂" : ""); d.onclick = () => load(n); L.appendChild(d); });
  if (cur) [...L.children].forEach(d => d.classList.toggle("on", d.dataset.n === cur));
}
async function load(n) {
  stop(); cur = n;
  [...document.querySelectorAll("#list div")].forEach(d => d.classList.toggle("on", d.dataset.n === n));
  document.getElementById("title").textContent = n;
  const ab = await (await fetch("/sounds/" + n + "?t=" + Date.now())).arrayBuffer();
  buf = await ac.decodeAudioData(ab); peaks = null;
  const t = trims[n] || [0, buf.duration];
  S.max = E.max = buf.duration.toFixed(2); S.value = t[0].toFixed(2); E.value = Math.min(t[1], buf.duration).toFixed(2);
  msg.textContent = "original " + buf.duration.toFixed(2) + " s" + (trims[n] ? ", trimmed to " + t[0].toFixed(2) + " - " + t[1].toFixed(2) + " s" : ""); draw();
}
function draw() {
  const w = cv.width = cv.clientWidth * devicePixelRatio, h = cv.height = cv.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  document.getElementById("sv").textContent = (+S.value).toFixed(2) + " s";
  document.getElementById("ev").textContent = (+E.value).toFixed(2) + " s";
  if (!buf) return;
  const x = t => t / buf.duration * w;
  if (!peaks || peaks.length !== w * 2) {   // min/max per pixel, worked out once per clip / resize
    const d = buf.getChannelData(0), step = d.length / w;
    peaks = new Float32Array(w * 2);
    for (let i = 0; i < w; i++) {
      let lo = 1, hi = -1;
      for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) { const v = d[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
      peaks[i * 2] = lo; peaks[i * 2 + 1] = hi;
    }
  }
  ctx.fillStyle = "#6cf";
  for (let i = 0; i < w; i++) ctx.fillRect(i, (1 - peaks[i * 2 + 1]) * h / 2, 1, Math.max(1, (peaks[i * 2 + 1] - peaks[i * 2]) * h / 2));
  ctx.fillStyle = "rgba(0,0,0,.65)";
  ctx.fillRect(0, 0, x(+S.value), h); ctx.fillRect(x(+E.value), 0, w - x(+E.value), h);
  ctx.fillStyle = "#e5534b"; ctx.fillRect(x(+S.value) - 1, 0, 2, h); ctx.fillRect(x(+E.value) - 1, 0, 2, h);
  if (src) { ctx.fillStyle = "#fff"; ctx.fillRect(x(playOff + ac.currentTime - playStart), 0, 2, h); }
}
function stop() { if (src) { src.onended = null; src.stop(); src = null; } draw(); }
function play(a, b) {
  stop(); if (!buf) return; ac.resume();
  src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination);
  playStart = ac.currentTime; playOff = a; src.start(0, a, b - a);
  src.onended = () => { src = null; draw(); };
  (function tick() { if (src) { draw(); requestAnimationFrame(tick); } })();
}
S.oninput = () => { if (+S.value >= +E.value) S.value = (+E.value - 0.01).toFixed(2); draw(); };
E.oninput = () => { if (+E.value <= +S.value) E.value = (+S.value + 0.01).toFixed(2); draw(); };
S.onchange = E.onchange = () => play(+S.value, +E.value);   // auto-preview on release
document.getElementById("play").onclick = () => play(+S.value, +E.value);
document.getElementById("playall").onclick = () => buf && play(0, buf.duration);
document.addEventListener("keydown", ev => { if (ev.code === "Space") { ev.preventDefault(); src ? stop() : play(+S.value, +E.value); } });
async function post(path, body) {
  const r = await fetch(path, { method: "POST", body: JSON.stringify(body) });
  const t = await r.text(); if (!r.ok) throw new Error(t); return t;
}
document.getElementById("save").onclick = async () => {
  if (!cur) return;
  try { const t = await post("/trim", { name: cur, start: +S.value, end: +E.value }); await loadList(); msg.textContent = t; }
  catch (e) { msg.textContent = "error: " + e.message; }
};
document.getElementById("restore").onclick = async () => {
  if (!cur) return;
  try { await post("/restore", { name: cur }); await loadList(); await load(cur); msg.textContent = "restored original (" + buf.duration.toFixed(2) + " s)"; }
  catch (e) { msg.textContent = "error: " + e.message; }
};
addEventListener("resize", draw);
loadList();
</script></body></html>"""


class H(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            return self.send(200, PAGE, "text/html; charset=utf-8")
        if path == "/list":
            return self.send(200, json.dumps({"names": list_clips(), "trims": load_trims()}), "application/json")
        if path.startswith("/sounds/"):
            try:
                name = urllib.parse.unquote(path[8:])
                with open(original_path(name), "rb") as f:   # page always edits the original
                    return self.send(200, f.read(), "audio/mpeg" if name.endswith(".mp3") else "audio/wav")
            except ValueError as e:
                return self.send(404, str(e))
        self.send(404, "404")

    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/trim":
                dur = trim(req["name"], float(req["start"]), float(req["end"]))
                return self.send(200, "saved %s: %.2f s (cut %.2f s off the front) - recorded in trims.json"
                                 % (req["name"], dur, req["start"]))
            if self.path == "/restore":
                restore(req["name"])
                return self.send(200, "ok")
            self.send(404, "404")
        except Exception as e:
            self.send(400, str(e))

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    url = "http://127.0.0.1:%d" % PORT
    print("Sound trimmer at", url, "(Ctrl+C to quit)")
    webbrowser.open(url)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
