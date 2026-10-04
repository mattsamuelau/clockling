"""Bake an exported Clockling share link (or its cfg JSON) into the repo defaults.

Workflow
  Settings drawer -> Share / embed -> copy the Link, hand it to the agent.
  The agent runs this script, then commits and pushes: the exported {s, t}
  values become the new defaults everywhere (web + ESP32 + docs).

  python bake_tuning.py <share-link>    URL containing #s=<base64url cfg>
  python bake_tuning.py <cfg.json>      raw {"s": {...}, "t": {...}}
  python bake_tuning.py --check         regenerate + show what would change

Where defaults live (single source of truth):
  TUNING   -> app/js/tuning-meta.js   (TUNING_META.tuning[key].default;
               app/js/swarm.js derives its runtime TUNING object from it)
  SETTINGS -> app/js/settings.js
  Everything else (TUNING.md tables, targets/esp32/src/gen_tuning.cpp,
  targets/esp32/include/gen_assets.h) is generated from those two files and
  must never be edited by hand.
"""
import base64
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
META = os.path.join(ROOT, "app", "js", "tuning-meta.js")
SETTINGS = os.path.join(ROOT, "app", "js", "settings.js")
EXTRACT = os.path.join(ROOT, "targets", "esp32", "tools", "extract_meta.js")


def b64url_decode(s):
    s = s.replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)
    return base64.b64decode(s).decode("utf-8")


def parse_export(arg):
    text = arg
    if os.path.isfile(arg):
        with open(arg, encoding="utf-8") as fh:
            text = fh.read().strip()
    m = re.search(r"[#&]s=([A-Za-z0-9_-]+)", text)
    if m:
        text = b64url_decode(m.group(1))
    try:
        cfg = json.loads(text)
    except ValueError:
        sys.exit("not a Clockling export: expected {s: {...}, t: {...}}")
    if not isinstance(cfg, dict) or not ("s" in cfg or "t" in cfg):
        sys.exit("not a Clockling export: expected {s: {...}, t: {...}}")
    return cfg


def jsval(v):
    return json.dumps(v)


def bake_tuning(vals):
    """Write TUNING values into tuning-meta.js `default:` fields."""
    src = open(META, encoding="utf-8").read()
    changed = 0
    for k, v in vals.items():
        pat = re.compile(r"^(\s*" + re.escape(k) + r"\s*:\s*\{[^}]*?default:\s*)[^,}]+", re.M)
        src, n = pat.subn(lambda m: m.group(1) + jsval(v), src)
        if n == 0:
            print("WARN: tuning key not found in tuning-meta.js: %s" % k)
        changed += n
    open(META, "w", encoding="utf-8", newline="").write(src)
    return changed


def bake_settings(vals):
    """Write SETTINGS values into settings.js."""
    src = open(SETTINGS, encoding="utf-8").read()
    changed = 0
    for k, v in vals.items():
        pat = re.compile(r"^(\s*" + re.escape(k) + r"\s*:\s*)[^,]+?(?=\s*,)", re.M)
        src, n = pat.subn(lambda m: m.group(1) + jsval(v), src)
        if n == 0:
            print("WARN: settings key not found in settings.js: %s" % k)
        changed += n
    open(SETTINGS, "w", encoding="utf-8", newline="").write(src)
    return changed


def regenerate():
    subprocess.run([sys.executable, os.path.join(ROOT, "gen_docs.py")], cwd=ROOT, check=True)
    subprocess.run([sys.executable, os.path.join(ROOT, "targets", "esp32", "tools", "gen_assets.py")],
                   cwd=ROOT, check=True)


def check():
    """Regenerate the derived files and report what would change."""
    regenerate()
    out = subprocess.run(
        ["git", "diff", "--stat", "--", "TUNING.md",
         "targets/esp32/src/gen_tuning.cpp", "targets/esp32/include/gen_assets.h"],
        cwd=ROOT, capture_output=True, text=True).stdout.strip()
    print(out if out else "TUNING.md and the ESP32 generated files are up to date")


def main():
    if len(sys.argv) < 2 or sys.argv[1] == "--check":
        check()
        return
    cfg = parse_export(sys.argv[1])
    n = bake_tuning(cfg.get("t") or {})
    m = bake_settings(cfg.get("s") or {})
    print("baked %d tuning + %d settings keys into the defaults" % (n, m))
    regenerate()
    print("TUNING.md tables and ESP32 assets regenerated")


if __name__ == "__main__":
    main()
