#!/usr/bin/env python3
"""transcript の .txt から、男の発言とキャラ返答を並べた会話 HTML を作る。

手打ちで本文を写すと文字化けするので、必ず transcript を読んで生成する。

RIT-7: 先頭に core-check（fantasy-core-check）の集計表を載せる。採点ロジックの
正本は packages/bench/src/fantasy-core-check.ts（@v2/judge）なので、subprocess で
JSONL を受け取ってここでは表示だけを組み立てる。pnpm/tsx が無い環境では
集計セクションを省略して会話本体だけ出す。
"""
import glob
import html
import json
import os
import re
import subprocess
import sys

RUN_DIR = sys.argv[1] if len(sys.argv) > 1 else (
    ".work/e2e-results/vlong-dogfood/2026-09-17-core2-2-60157521"
)
OUT = sys.argv[2] if len(sys.argv) > 2 else ".work/report/sakura-core-v2.html"
TITLE = sys.argv[3] if len(sys.argv) > 3 else "さくら core v2 会話（新芯・全ターン）"

CSS = """body{font-family:system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;line-height:1.8;color:#222}
h1{font-size:1.35rem}
h2{font-size:1.05rem;border-bottom:2px solid #ddd;padding-bottom:.2rem;margin-top:2.5rem}
.user{background:#fff3e0;border:1px solid #ffcc80;border-radius:8px;padding:.7rem .9rem;margin:1.2rem 0 .8rem}
.user b{color:#e65100}
.action{color:#333;margin:.5rem 0}
.dialogue{color:#1a4d8f;font-weight:600;margin:.5rem 0;padding-left:1rem}
.inner{color:#888;font-style:italic;font-size:.9rem;margin:.4rem 0;padding-left:1rem}
.meta{color:#999;font-size:.8rem}
table.core{border-collapse:collapse;margin:1rem 0;font-size:.85rem}
table.core th,table.core td{border:1px solid #ccc;padding:.25rem .5rem;text-align:left}
table.core th{background:#f5f5f5}
td.on{background:#fde7e7;font-weight:600}
.ev{color:#555;font-size:.78rem}
"""


def parse(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    turn = re.search(r"^# turn: (\d+)", text, re.M)
    phase = re.search(r"^# servedPhase: (\S+)", text, re.M)
    user = re.search(r"^# > (.*)$", text, re.M)
    body = text.split("# --- ここから本文 ---", 1)
    blocks = []
    if len(body) == 2:
        for tag, content in re.findall(
            r"<(action|dialogue|inner)>(.*?)</\1>", body[1], re.S
        ):
            blocks.append((tag, content.strip()))
    return {
        "turn": int(turn.group(1)) if turn else 0,
        "phase": phase.group(1) if phase else "-",
        "user": user.group(1).strip() if user else "",
        "blocks": blocks,
    }


def run_core_check(run_dir):
    """fantasy-core-check の JSONL を実行して (per-turn 行, totals) を返す。

    採点の正本は packages/bench/src/fantasy-core-check.ts（@v2/judge）。
    pnpm/tsx が無い、または実行に失敗した時は None を返し、レポート側は
    集計なしで続行する（会話本体の生成を止めんため）。
    """
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    cmd = [
        "pnpm",
        "--filter",
        "@v2/bench",
        "exec",
        "tsx",
        "src/fantasy-core-check.ts",
        "--dirs",
        os.path.abspath(run_dir),
    ]
    try:
        proc = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    rows, totals = [], None
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "totals" in rec:
            totals = rec["totals"]
        elif "items" in rec:
            rows.append(rec)
    return rows, totals


def core_summary_html(core):
    rows, totals = core
    if not rows:
        return ""
    items = [k for k in rows[0]["items"].keys()]
    parts = [
        "<h2>core-check 集計</h2>",
        '<table class="core"><tr><th>turn</th>'
        + "".join(f"<th>{html.escape(k)}</th>" for k in items)
        + "</tr>",
    ]
    for row in rows:
        cells = [f"<td>{row['turn']}</td>"]
        for k in items:
            if row["items"].get(k):
                ev = html.escape(row.get("evidence", {}).get(k, ""))
                cells.append(f'<td class="on">●<br><span class="ev">{ev}</span></td>')
            else:
                cells.append("<td></td>")
        parts.append("<tr>" + "".join(cells) + "</tr>")
    if totals:
        parts.append(
            "<tr><td><b>合計</b></td>"
            + "".join(f"<td><b>{totals.get(k, 0)}</b></td>" for k in items)
            + "</tr>"
        )
    parts.append("</table>")
    parts.append(
        '<p class="meta">scream は「出ないのが正解」のネガティブ項目。'
        "各セルの断片はヒットした本文の証拠。誤検知らしきヒットは断片を見て自分で判断する。</p>"
    )
    return "\n".join(parts)


files = sorted(glob.glob(os.path.join(RUN_DIR, "Sakura-*.txt")))
turns = [parse(p) for p in files]
turns = [t for t in turns if t["blocks"]]
core = run_core_check(RUN_DIR)
if core:
    # 同じ run dir に別キャラの transcript が居ても、レポートは Sakura の表だけにする。
    shown = {os.path.basename(p) for p in files}
    rows, totals = core
    kept = [r for r in rows if r.get("file") in shown]
    if totals:
        totals = {k: sum(1 for r in kept if r["items"].get(k)) for k in totals}
    core = (kept, totals) if kept else None

parts = [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="utf-8">',
    f"<title>{html.escape(TITLE)}</title>",
    f"<style>{CSS}</style></head><body>",
    f"<h1>{html.escape(TITLE)}</h1>",
    f'<p class="meta">run: {html.escape(os.path.basename(RUN_DIR))} / '
    f"{len(turns)} ターン。オレンジがあなたの発言、青がさくらの台詞、"
    "グレーがさくらの内心。</p>",
]

if core:
    parts.append(core_summary_html(core))
else:
    parts.append(
        '<p class="meta">core-check 集計なし（pnpm/tsx 未導入か実行失敗。'
        "手動: pnpm --filter @v2/bench exec tsx src/fantasy-core-check.ts --dirs <run dir>）</p>"
    )

for t in turns:
    parts.append(
        f'<h2>ターン{t["turn"]}<span class="meta"> — {html.escape(t["phase"])}</span></h2>'
    )
    if t["user"]:
        parts.append(f'<div class="user"><b>あなた：</b>{html.escape(t["user"])}</div>')
    for tag, content in t["blocks"]:
        parts.append(f'<p class="{tag}">{html.escape(content)}</p>')

parts.append("</body></html>")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(parts))
print(f"wrote {OUT} ({len(turns)} turns)")
