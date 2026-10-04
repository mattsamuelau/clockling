"""Make a Clockling share link the new defaults.

  python tools/apply_link.py "https://.../clockling.html#s=<base64url cfg>"
  python tools/apply_link.py <base64url cfg>

Every setting in the link's "s" part becomes its default in app/js/settings.js,
every tuning key in "t" its default in app/js/tuning-meta.js, and the Balanced
preset in clockling.html takes the link's battle sliders (Balanced is "the
defaults", so it stays highlighted on a fresh start). TUNING.md is regenerated.
Keys the repo doesn't know are listed and skipped.

GitHub: Actions -> "Apply share link" -> Run workflow, paste the link; it runs
this script and commits the result to main.
"""
import base64
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATTLE_KEYS = ["gameSpeed", "unitScale", "unitSpeed", "blueShell", "growthMode", "marineSkill", "zergSkill", "zergBrain", "terranBrain"]


def decode(arg):
    m = re.search(r"[#&?]s=([A-Za-z0-9_\-+/=]+)", arg)
    raw = m.group(1) if m else arg.strip()
    raw = raw.replace("+", "-").replace("/", "_")
    return json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))


def js(v):
    return json.dumps(v)


def path(p):
    return os.path.join(ROOT, p)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cfg = decode(sys.argv[1])
    s_part, t_part = cfg.get("s", {}), cfg.get("t", {})
    unknown, changed = [], []

    st = open(path("app/js/settings.js"), encoding="utf-8").read()
    for k, v in s_part.items():
        st2, n = re.subn(r"(\n    %s: )[^,\n]+(,)" % re.escape(k), lambda m: m.group(1) + js(v) + m.group(2), st, count=1)
        if n:
            st = st2; changed.append("settings %s = %s" % (k, js(v)))
        else:
            unknown.append("s." + k)
    open(path("app/js/settings.js"), "w", encoding="utf-8", newline="\n").write(st)

    tm = open(path("app/js/tuning-meta.js"), encoding="utf-8").read()
    for k, v in t_part.items():
        tm2, n = re.subn(r"(\n        %s: \{[^\n]*?default: )[^,]+(,)" % re.escape(k), lambda m: m.group(1) + js(v) + m.group(2), tm, count=1)
        if n:
            tm = tm2; changed.append("tuning %s = %s" % (k, js(v)))
        else:
            unknown.append("t." + k)
    open(path("app/js/tuning-meta.js"), "w", encoding="utf-8", newline="\n").write(tm)

    html = open(path("clockling.html"), encoding="utf-8").read()
    m = re.search(r'(\{ name: "Balanced", hint: "[^"]*",\s*s: \{)([^}]*)(\})', html)
    if m:
        body = m.group(2)
        for k in BATTLE_KEYS:
            if k not in s_part:
                continue
            body2, n = re.subn(r"(\b%s: )[^,}]+" % k, lambda mm: mm.group(1) + js(s_part[k]), body, count=1)
            body = body2 if n else body.rstrip() + ", %s: %s " % (k, js(s_part[k]))
        html = html[:m.start(2)] + body + html[m.end(2):]
        open(path("clockling.html"), "w", encoding="utf-8", newline="\n").write(html)
        changed.append("Balanced preset sliders updated")

    subprocess.run([sys.executable, path("gen_docs.py")], check=True)
    print("\n".join(changed))
    if unknown:
        print("skipped (not in this version): " + ", ".join(unknown))


if __name__ == "__main__":
    main()
