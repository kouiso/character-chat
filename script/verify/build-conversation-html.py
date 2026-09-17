#!/usr/bin/env python3
"""transcript の .txt から、男の発言とキャラ返答を並べた会話 HTML を作る。

手打ちで本文を写すと文字化けするので、必ず transcript を読んで生成する。
"""
import glob
import html
import os
import re
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


files = sorted(glob.glob(os.path.join(RUN_DIR, "Sakura-*.txt")))
turns = [parse(p) for p in files]
turns = [t for t in turns if t["blocks"]]

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
