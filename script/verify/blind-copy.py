"""腕名とモデル名を落とした盲検コピーを作る。対応表は scratchpad にだけ置く（読了後に開く）。"""
import re, sys, json, pathlib, hashlib
src_dirs = sys.argv[1:]
base = pathlib.Path(__file__).parent
out = base / "blind"
scratchpad = base / "scratchpad"
out.mkdir(exist_ok=True)
scratchpad.mkdir(exist_ok=True)
mapping = {}
# 腕を当てられる行は全部削る。dropped/error は台本側の事情、preExtend* と extended は
# extend 発火の有無＝腕そのもの、visibleChars/latencyMs は長さ・速度で腕が割れる。
# intent/servedPhase は両腕で同一台本なので残す（読みの文脈になる）。
STRIP = re.compile(
    r"^# (servedModel|mechanicsPhase|quality|regenerate|extended|dropped|visibleChars|"
    r"preExtendVisibleChars|preExtendBodyChars|error):.*\n",
    re.M,
)
for d in src_dirs:
    d = pathlib.Path(d)
    code = "B" + hashlib.sha1(d.name.encode()).hexdigest()[:4].upper()
    mapping[code] = d.name
    dst = out / code
    dst.mkdir(exist_ok=True)
    for f in sorted(d.glob("*.txt")):
        m = re.match(r"([A-Za-z]+)-(\d+)-", f.name)
        if not m:
            continue
        text = STRIP.sub("", f.read_text(encoding="utf-8"))
        (dst / f"{m.group(1)}-{m.group(2)}.txt").write_text(text, encoding="utf-8")
(scratchpad / "mapping.json").write_text(
    json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8"
)
print(json.dumps({k: len(list((out / k).glob('*.txt'))) for k in mapping}, ensure_ascii=False))
