#!/usr/bin/env python3
"""Remove baked-in like counter UI from profile avatars.

Usage:
  python scripts/avatar-clean/run.py --input /tmp/originals --output /tmp/originals-clean
  python scripts/avatar-clean/run.py --dry-run
"""

from __future__ import annotations

import argparse
import shutil
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class ProcessResult:
    detected: bool
    used_fallback: bool
    copied_original: bool
    output_shape: tuple[int, int, int] | None


def find_ui_rect(img: np.ndarray) -> tuple[int, int, int, int] | None:
    h, w = img.shape[:2]
    x0, y0 = int(w * 0.67), int(h * 0.67)
    roi = img[y0:h, x0:w]

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    _, white_mask = cv2.threshold(gray, 215, 255, cv2.THRESH_BINARY)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    white_mask = cv2.morphologyEx(white_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(white_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best = None
    best_score = -1.0
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        area = cw * ch
        if area < 2500:
            continue
        aspect = cw / max(ch, 1)
        if aspect < 1.3 or aspect > 6.0:
            continue

        rect = roi[y : y + ch, x : x + cw]
        if rect.size == 0:
            continue
        text_pixels = np.mean(rect < 100)
        if text_pixels < 0.03:
            continue

        score = area * min(text_pixels * 10.0, 2.0)
        if score > best_score:
            best_score = score
            best = (x0 + x, y0 + y, cw, ch)

    return best


def inpaint_or_fill(img: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    x, y, w, h = rect
    pad = 6
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(img.shape[1], x + w + pad)
    y2 = min(img.shape[0], y + h + pad)

    mask = np.zeros(img.shape[:2], dtype=np.uint8)
    mask[y1:y2, x1:x2] = 255

    out = cv2.inpaint(img, mask, 5, cv2.INPAINT_TELEA)

    if np.mean(mask) == 0:
        out = img.copy()
        patch = img[max(0, y1 - h) : y1, x1:x2]
        fill_color = tuple(int(v) for v in np.mean(patch, axis=(0, 1))) if patch.size else (0, 0, 0)
        out[y1:y2, x1:x2] = fill_color

    return out


def fallback_mask(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    bw, bh = min(200, w), min(80, h)
    x1, y1 = w - bw, h - bh
    out = img.copy()

    sample = img[max(0, y1 - bh) : y1, max(0, x1 - bw) : x1]
    fill = tuple(int(v) for v in np.mean(sample, axis=(0, 1))) if sample.size else (0, 0, 0)
    out[y1:h, x1:w] = fill
    return out


def recrop(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    target_h = min(800, h)
    top = max(0, (h - target_h) // 2)
    bottom = top + target_h
    return img[top:bottom, 0:w]


def process_image(src: Path, dst: Path, dry_run: bool) -> ProcessResult:
    img = cv2.imread(str(src))
    if img is None:
        return ProcessResult(False, False, True, None)

    rect = find_ui_rect(img)
    detected = rect is not None

    if detected:
        cleaned = inpaint_or_fill(img, rect)
        used_fallback = False
    else:
        cleaned = fallback_mask(img)
        used_fallback = True

    cropped = recrop(cleaned)

    if dry_run:
        return ProcessResult(detected, used_fallback, False, cropped.shape)

    dst.parent.mkdir(parents=True, exist_ok=True)
    ok = cv2.imwrite(str(dst), cropped)
    if not ok:
        shutil.copy2(src, dst)
        return ProcessResult(detected, used_fallback, True, None)

    return ProcessResult(detected, used_fallback, False, cropped.shape)


def iter_profiles(input_dir: Path) -> list[tuple[str, Path]]:
    rows: list[tuple[str, Path]] = []
    for d in sorted(input_dir.iterdir()):
        if not d.is_dir():
            continue
        p = d / "profile.png"
        if p.exists():
            rows.append((d.name, p))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="/tmp/originals")
    ap.add_argument("--output", default="/tmp/originals-clean")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)

    if not input_dir.exists():
        print(f"ERROR: input dir not found: {input_dir}")
        return 2

    profiles = iter_profiles(input_dir)
    total = len(profiles)
    if total == 0:
        print(f"WARN: no profile.png found under {input_dir}")
        return 1

    warns = 0
    for i, (char_id, src) in enumerate(profiles, start=1):
        dst = output_dir / char_id / "profile.png"
        print(f"[{i}/{total}] processing {char_id}...", end="")
        result = process_image(src, dst, args.dry_run)

        if result.copied_original:
            warns += 1
            print(f" WARN(copy fallback) -> {dst}")
            if not args.dry_run:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
            continue

        if not result.detected:
            warns += 1
            print(f" WARN(ui not detected; fallback mask) -> {dst}")
        else:
            print(f" -> output {dst}")

        if args.dry_run and result.output_shape is not None:
            h, w = result.output_shape[:2]
            print(f"      dry-run diff: {src.name} {cv2.imread(str(src)).shape[:2]} -> {(h, w)}")

    print(f"done. processed={total}, warnings={warns}, dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
