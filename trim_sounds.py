"""Quick trim tool for app/sounds/*.wav.

  python trim_sounds.py      ->  opens http://127.0.0.1:8091 in your browser

Pick a clip, drag the Start (and End) slider, hit Play to preview, Save to
overwrite the .wav. The first save of each clip backs up the original to
.sound-src/originals/ (git-ignored); "Restore original" puts it back.

Note: build_sounds.py rebuilds these files from source and would undo a trim -
the Save message prints the matching start/duration to copy into its SFX table.
"""
import array
import json
import os
import shutil
import sys
import wave
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
SOUNDS = os.path.join(ROOT, "app", "sounds")
BACKUP = os.path.join(ROOT, ".sound-src", "originals")
PORT = 8091
FADE_S = 0.005  # tiny fade at each cut so it doesn't click


def clip_path(name):
    name = os.path.basename(name)
    if not name.endswith(".wav"):
        raise ValueError("not a wav")
    p = os.path.join(SOUNDS, name)
    if not os.path.isfile(p):
        raise ValueError("no such clip")
    return p


def trim(name, start, end):
    p = clip_path(name)
    with wave.open(p, "rb") as w:
        params = w.getparams()
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        frames = w.readframes(w.getnframes())
    n = len(frames) // (ch * width)
    a = max(0, min(n, int(round(start * rate))))
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
    os.makedirs(BACKUP, exist_ok=True)
    bak = os.path.join(BACKUP, os.path.basename(p))
    if not os.path.exists(bak):
        shutil.copy2(p, bak)
    with wave.open(p, "wb") as w:
        w.setparams(params)
        w.writeframes(data)
    return (b - a) / rate


def restore(name):
    p = clip_path(name)
    bak = os.path.join(BACKUP, os.path.basename(p))
    if not os.path.exists(bak):
        raise ValueError("no backup - clip was never trimmed here")
    shutil.copy2(bak, p)


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
let cur = null, buf = null, src = null, playStart = 0, playOff = 0, playEnd = 0;

async function loadList() {
  const names = await (await fetch("/list")).json(), L = document.getElementById("list");
  L.innerHTML = "";
  names.forEach(n => { const d = document.createElement("div"); d.textContent = n; d.onclick = () => load(n); L.appendChild(d); });
}
async function load(n) {
  stop(); cur = n;
  [...document.querySelectorAll("#list div")].forEach(d => d.classList.toggle("on", d.textContent === n));
  document.getElementById("title").textContent = n;
  const ab = await (await fetch("/sounds/" + n + "?t=" + Date.now())).arrayBuffer();
  buf = await ac.decodeAudioData(ab);
  S.max = E.max = buf.duration.toFixed(2); S.value = 0; E.value = buf.duration.toFixed(2);
  msg.textContent = buf.duration.toFixed(2) + " s"; draw();
}
function draw() {
  const w = cv.width = cv.clientWidth * devicePixelRatio, h = cv.height = cv.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  document.getElementById("sv").textContent = (+S.value).toFixed(2) + " s";
  document.getElementById("ev").textContent = (+E.value).toFixed(2) + " s";
  if (!buf) return;
  const d = buf.getChannelData(0), step = d.length / w, x = t => t / buf.duration * w;
  ctx.fillStyle = "#6cf";
  for (let i = 0; i < w; i++) {
    let lo = 1, hi = -1;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) { const v = d[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    ctx.fillRect(i, (1 - hi) * h / 2, 1, Math.max(1, (hi - lo) * h / 2));
  }
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
  try { const t = await post("/trim", { name: cur, start: +S.value, end: +E.value }); await load(cur); msg.textContent = t; }
  catch (e) { msg.textContent = "error: " + e.message; }
};
document.getElementById("restore").onclick = async () => {
  if (!cur) return;
  try { await post("/restore", { name: cur }); await load(cur); msg.textContent = "restored original (" + buf.duration.toFixed(2) + " s)"; }
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
            names = sorted(f for f in os.listdir(SOUNDS) if f.endswith(".wav"))
            return self.send(200, json.dumps(names), "application/json")
        if path.startswith("/sounds/"):
            try:
                with open(clip_path(path[8:]), "rb") as f:
                    return self.send(200, f.read(), "audio/wav")
            except ValueError as e:
                return self.send(404, str(e))
        self.send(404, "404")

    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/trim":
                dur = trim(req["name"], float(req["start"]), float(req["end"]))
                stem = req["name"][:-4]
                return self.send(200, "saved %s: %.2f s (cut %.2f s off the front)\n"
                                 "build_sounds.py: add %.2f to %s's start, duration %.2f"
                                 % (req["name"], dur, req["start"], req["start"], stem, dur))
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
