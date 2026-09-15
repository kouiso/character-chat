"""腕名とモデル名を落とした盲検コピーを作る。対応表は scratchpad にだけ置く（読了後に開く）。"""
import re, sys, json, pathlib, hashlib
src_dirs = sys.argv[1:]
out = pathlib.Path(__file__).parent / "blind"
out.mkdir(exist_ok=True)
mapping = {}
for d in src_dirs:
    d = pathlib.Path(d)
    code = "B" + hashlib.sha1(d.name.encode()).hexdigest()[:4].upper()
    mapping[code] = d.name
    dst = out / code
    dst.mkdir(exist_ok=True)
    for f in sorted(d.glob("*.txt")):
        m = re.match(r"(Sakura|Downer)-(\d+)-", f.name)
        if not m:
            continue
        text = f.read_text(encoding="utf-8")
        text = re.sub(r"^# servedModel:.*\n", "", text, flags=re.M)
        text = re.sub(r"^# quality:.*\n", "", text, flags=re.M)
        text = re.sub(r"^# regenerate:.*\n", "", text, flags=re.M)
        text = re.sub(r"^# visibleChars:.*\n", "", text, flags=re.M)
        (dst / f"{m.group(1)}-{m.group(2)}.txt").write_text(text, encoding="utf-8")
(out / "mapping.json").write_text(json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({k: len(list((out / k).glob('*.txt'))) for k in mapping}, ensure_ascii=False))
