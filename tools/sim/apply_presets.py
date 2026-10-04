"""Write the balance search winners (tools/sim/results/<preset>.json, best first)
into the app:

  balanced -> the defaults: battle sliders in app/js/settings.js, tuning in
              app/js/tuning-meta.js (Balanced = "no overrides")
  terran / zerg / mental -> the PRESETS overrides in clockling.html, each with
              every battle slider spelled out

  python tools/sim/apply_presets.py            # all four
  python tools/sim/apply_presets.py --dry-run  # just print what would change

Then run gen_docs.py so TUNING.md matches.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RES = os.path.join(ROOT, "tools", "sim", "results")
SLIDERS = ["gameSpeed", "unitScale", "unitSpeed", "marineSkill", "zergSkill", "zergBrain", "terranBrain"]
DRY = "--dry-run" in sys.argv


def best(name):
    with open(os.path.join(RES, name + ".json"), encoding="utf-8") as f:
        return json.load(f)["candidates"][0]


def js(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return ("%.2f" % v).rstrip("0").rstrip(".")
    return str(v)


def read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return f.read()


def write(p, s):
    if DRY:
        return
    with open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


def set_default_setting(s, key, val):
    s2, n = re.subn(r"(\n    %s: )[^,]+(,)" % key, lambda m: m.group(1) + js(val) + m.group(2), s, count=1)
    assert n == 1, key
    return s2


def set_default_tuning(s, key, val):
    s2, n = re.subn(r"(\n        %s: \{[^\n]*?default: )[^,]+(,)" % key, lambda m: m.group(1) + js(val) + m.group(2), s, count=1)
    assert n == 1, key
    return s2


def main():
    b = best("balanced")
    print("balanced score", b["score"], b["metrics"])
    st = read("app/js/settings.js")
    for k in SLIDERS:
        if k in b["settings"]:
            st = set_default_setting(st, k, b["settings"][k])
    write("app/js/settings.js", st)
    tm = read("app/js/tuning-meta.js")
    for k, v in b["tuning"].items():
        tm = set_default_tuning(tm, k, v)
    write("app/js/tuning-meta.js", tm)

    html = read("clockling.html")
    names = {"terran": "Terran", "zerg": "Zerg", "mental": "Mental"}
    for key, label in names.items():
        c = best(key)
        print(key, "score", c["score"], c["metrics"])
        s = dict((k, c["settings"][k]) for k in SLIDERS if k in c["settings"])
        t = dict((k, v) for k, v in c["tuning"].items() if b["tuning"].get(k) != v)
        s_txt = "{ " + ", ".join("%s: %s" % (k, js(v)) for k, v in s.items()) + " }"
        t_items = ["%s: %s" % (k, js(v)) for k, v in t.items()]
        lines, cur = [], ""
        for it in t_items:
            if len(cur) + len(it) > 88:
                lines.append(cur.rstrip())
                cur = ""
            cur += it + ", "
        lines.append(cur.rstrip(", "))
        t_txt = "{ " + "\n               ".join(lines) + " }"
        pat = re.compile(r'(\{ name: "%s", hint: "[^"]*",\n          )s: \{[^}]*\},\n          t: \{[^}]*\} \}' % label)
        assert pat.search(html), label
        html = pat.sub(lambda m: m.group(1) + "s: " + s_txt + ",\n          t: " + t_txt + " }", html, count=1)
    # Balanced spells out its sliders too, so picking it resets them
    bs = "{ " + ", ".join("%s: %s" % (k, js(b["settings"][k])) for k in SLIDERS if k in b["settings"]) + " }"
    html, n = re.subn(r'(\{ name: "Balanced", hint: "[^"]*", )s: \{[^}]*\}', lambda m: m.group(1) + "s: " + bs, html, count=1)
    assert n == 1
    write("clockling.html", html)
    print("dry run" if DRY else "written")


if __name__ == "__main__":
    main()
