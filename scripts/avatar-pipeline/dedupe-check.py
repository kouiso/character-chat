#!/usr/bin/env python3
"""アバター候補画像の重複を perceptual hash で機械判定する。

局長に提示する前に必ず実行し、既出画像（採点済み）との Hamming 距離で
再提示を機械的にブロックする。ファイル名が違っても画像の中身で重複を捕まえる。

判定:
  距離 <= BLOCK_THRESHOLD (既定5)  -> BLOCK   : ほぼ同一。再提示禁止。
  距離 <= WARN_THRESHOLD  (既定10) -> WARN    : 類似（=チェンジ対象）。別パターン要求。
  距離 >  WARN_THRESHOLD           -> OK      : 新規。提示可。

台帳: .work/review-log/shown-hashes.tsv
  形式: phash<TAB>label<TAB>filepath<TAB>date

使い方:
  # 候補をチェック（提示前）
  python3 dedupe-check.py check <image>...
  # 既出を台帳へ登録（提示・採点後）
  python3 dedupe-check.py register --label A4 --date 2026-06-17 <image>...
  # 台帳の中身を表示
  python3 dedupe-check.py list
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
    import imagehash
except ImportError as e:  # 依存欠如はユーザーに修復手段を明示して落とす
    sys.stderr.write(
        f"依存が無い: {e}\n"
        "インストール: pip install Pillow imagehash\n"
    )
    sys.exit(3)

REPO_ROOT = Path(__file__).resolve().parents[2]
LEDGER = REPO_ROOT / ".work" / "review-log" / "shown-hashes.tsv"

BLOCK_THRESHOLD = 5
WARN_THRESHOLD = 10


def phash(path: Path) -> imagehash.ImageHash:
    with Image.open(path) as img:
        return imagehash.phash(img)  # 64bit pHash


def load_ledger() -> list[tuple[imagehash.ImageHash, str, str, str]]:
    if not LEDGER.exists():
        return []
    rows: list[tuple[imagehash.ImageHash, str, str, str]] = []
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        h_hex, label, filepath, date = parts[0], parts[1], parts[2], parts[3]
        try:
            rows.append((imagehash.hex_to_hash(h_hex), label, filepath, date))
        except ValueError:
            continue
    return rows


def cmd_check(paths: list[str]) -> int:
    ledger = load_ledger()
    worst = 0  # exit code: 0=all OK, 1=WARN present, 2=BLOCK present
    for p in paths:
        path = Path(p)
        if not path.exists():
            print(f"MISSING\t{p}")
            continue
        h = phash(path)
        if not ledger:
            print(f"OK\t{p}\tdist=inf\t台帳が空（新規）")
            continue
        best = min(ledger, key=lambda r: h - r[0])
        bd = h - best[0]
        if bd <= BLOCK_THRESHOLD:
            print(f"BLOCK\t{p}\tdist={bd}\t既出と同一: label={best[1]} {best[2]}")
            worst = max(worst, 2)
        elif bd <= WARN_THRESHOLD:
            print(f"WARN\t{p}\tdist={bd}\t類似(チェンジ対象): label={best[1]} {best[2]}")
            worst = max(worst, 1)
        else:
            print(f"OK\t{p}\tdist={bd}\t新規")
    return worst


def cmd_register(label: str, date: str, paths: list[str]) -> int:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    existing = {h for h, _, _, _ in load_ledger()}
    appended = 0
    with LEDGER.open("a", encoding="utf-8") as f:
        for p in paths:
            path = Path(p)
            if not path.exists():
                print(f"MISSING\t{p}", file=sys.stderr)
                continue
            h = phash(path)
            if any((h - e) <= BLOCK_THRESHOLD for e in existing):
                print(f"SKIP(既に台帳に同一)\t{p}", file=sys.stderr)
                continue
            f.write(f"{h}\t{label}\t{path}\t{date}\n")
            existing.add(h)
            appended += 1
            print(f"REGISTERED\t{label}\t{p}\t{h}")
    print(f"# {appended} 件登録 -> {LEDGER}", file=sys.stderr)
    return 0


def cmd_list() -> int:
    rows = load_ledger()
    if not rows:
        print("# 台帳は空")
        return 0
    for h, label, filepath, date in rows:
        print(f"{h}\t{label}\t{filepath}\t{date}")
    print(f"# 合計 {len(rows)} 件", file=sys.stderr)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="アバター候補の pHash 重複チェック")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_check = sub.add_parser("check", help="提示前に既出と照合")
    p_check.add_argument("images", nargs="+")

    p_reg = sub.add_parser("register", help="提示・採点後に台帳へ登録")
    p_reg.add_argument("--label", required=True)
    p_reg.add_argument("--date", required=True)
    p_reg.add_argument("images", nargs="+")

    sub.add_parser("list", help="台帳の中身を表示")

    args = ap.parse_args()
    if args.cmd == "check":
        return cmd_check(args.images)
    if args.cmd == "register":
        return cmd_register(args.label, args.date, args.images)
    if args.cmd == "list":
        return cmd_list()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
