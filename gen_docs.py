"""Regenerate the default-value tables in TUNING.md from app/js.

The tables sit between <!-- BEGIN:TABLES --> and <!-- END:TABLES --> in
TUNING.md; everything else in that file is hand-written and left alone.
Values come from the same extract the ESP32 build uses (node
targets/esp32/tools/extract_meta.js), so the docs can never drift from
the code. Run after changing tuning-meta.js or settings.js defaults
(bake_tuning.py runs this automatically).
"""
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
EXTRACT = os.path.join(ROOT, "targets", "esp32", "tools", "extract_meta.js")
DOC = os.path.join(ROOT, "TUNING.md")

BEGIN = "<!-- BEGIN:TABLES -->"
END = "<!-- END:TABLES -->"


def load():
    raw = subprocess.check_output(["node", EXTRACT], cwd=ROOT)
    return json.loads(raw)


def fmt(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return v
    return "%g" % v


def applies_to(only):
    return {"web": "web", "esp32": "ESP32"}.get(only, "both")


def sentence(s):
    s = (s or "").strip()
    return s if not s else s.rstrip(".") + "."


def gen(data):
    tuning, settings, meta = data["tuning"], data["settings"], data["meta"]
    out = []
    seen = set()
    for group, keys in meta["groups"].items():
        keys = [k for k in keys if k in tuning]
        if not keys:
            continue
        seen.update(keys)
        out.append("## %s" % group)
        out.append("")
        out.append("| Key | Default | Meaning | Class |")
        out.append("|---|---|---|---|")
        for k in keys:
            m = meta["tuning"].get(k, {})
            out.append("| `%s` | %s | %s | %s |" % (
                k, fmt(tuning[k]), sentence(m.get("meaning")),
                m.get("class", "Advanced")))
        out.append("")
    leftover = [k for k in tuning if k not in seen]
    if leftover:
        out.append("## Other")
        out.append("")
        out.append("| Key | Default | Meaning | Class |")
        out.append("|---|---|---|---|")
        for k in leftover:
            m = meta["tuning"].get(k, {})
            out.append("| `%s` | %s | %s | %s |" % (
                k, fmt(tuning[k]), sentence(m.get("meaning")),
                m.get("class", "Advanced")))
        out.append("")
    out.append("## SETTINGS (not `TUNING`) - in `app/js/settings.js`")
    out.append("")
    out.append("| Key | Default | Meaning | Applies to |")
    out.append("|---|---|---|---|")
    for k, v in settings.items():
        m = meta["settings"].get(k, {})
        out.append("| `%s` | %s | %s | %s |" % (
            k, fmt(v), sentence(m.get("meaning")), applies_to(m.get("only"))))
    out.append("")
    out.append("ESP32-only device settings (`brightness`, `fpsCap`) are defined in `targets/esp32/tools/gen_assets.py`.")
    return "\n".join(out) + "\n"


def main():
    body = gen(load())
    src = open(DOC, encoding="utf-8").read()
    i, j = src.index(BEGIN), src.index(END)
    new = src[:i] + BEGIN + "\n\n" + body + "\n" + END + src[j + len(END):]
    open(DOC, "w", encoding="utf-8", newline="").write(new)
    print("TUNING.md tables regenerated")


if __name__ == "__main__":
    main()
