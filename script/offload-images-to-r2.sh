#!/usr/bin/env bash
# offload-images-to-r2.sh — Phase 2: 画像実体をR2へ退避 + ローカル削除
# offload-images-to-gdrive.sh の R2 版（GDrive規約違反解消のため移行）
#
# 退避先: r2:adult-ai-images/review/avatars/<char>/ および review/evals/<ym>/<run>/
# 使用法: bash script/offload-images-to-r2.sh [--dry-run]
set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCORE_INDEX="$REPO_ROOT/evals/score-index.jsonl"
R2_REMOTE="r2"
R2_BUCKET="adult-ai-images"
R2_BASE="${R2_REMOTE}:${R2_BUCKET}"

TARGET_DIRS=(
  ".work/seeds/images"
  ".work/avatar-qa"
  ".work/avatar-regen"
)
E2E_RUNS_DIR=".work/e2e-results/runs"
EXTS=("png" "jpg" "jpeg" "webp" "gif")

TOTAL=0; UPLOADED=0; VERIFIED=0; DELETED=0; ERRORS=0

log() { echo "[$(date +%H:%M:%S)] $*"; }
err() { echo "[ERROR] $*" >&2; ((ERRORS++)) || true; }

is_image() {
  local f="$1"
  for ext in "${EXTS[@]}"; do [[ "${f,,}" == *."$ext" ]] && return 0; done
  return 1
}

lookup_score() {
  local relpath="$1"
  python3 - "$relpath" "$SCORE_INDEX" <<'PYEOF'
import sys, json, os
relpath, index_path = sys.argv[1], sys.argv[2]
basename = os.path.basename(relpath)
name_no_ext = os.path.splitext(basename)[0]
best = None
try:
    with open(index_path) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            e = json.loads(line)
            if e.get("type") != "image": continue
            src = e.get("source", "")
            if basename in src or relpath in src or name_no_ext in src:
                best = e; break
except Exception:
    pass
if best:
    label = best.get("label") or "NN"
    score = best.get("score", 0)
    judgment = best.get("judgment", "unknown")
    char = best.get("char") or "unknown"
    notes = best.get("notes", "")[:40]
    print(f"{label}|{score}|{judgment}|{char}|{notes}")
else:
    print("NN|0|unknown|unknown|")
PYEOF
}

offload_file() {
  local src_abs="$1" r2_prefix="$2" dst_name="$3"
  local r2_key="${r2_prefix#${R2_BASE}/}/${dst_name}"
  local r2_path="${r2_prefix}/${dst_name}"
  ((TOTAL++)) || true

  if $DRY_RUN; then log "DRY: $(basename "$src_abs") → $r2_key"; return; fi

  if ! rclone copyto "$src_abs" "$r2_path" 2>/tmp/rclone-r2-err.txt; then
    err "copy failed: $src_abs → $(head -1 /tmp/rclone-r2-err.txt)"; return
  fi
  ((UPLOADED++)) || true

  # ハッシュ検証
  local tmpdir; tmpdir=$(mktemp -d)
  cp "$src_abs" "$tmpdir/${dst_name}"
  if rclone check "$tmpdir" "$r2_prefix" --include="${dst_name}" 2>/tmp/rclone-r2-check.txt; then
    ((VERIFIED++)) || true
    rm -rf "$tmpdir"
    rm -f "$src_abs"
    ((DELETED++)) || true
    log "✓ $dst_name"
  else
    err "hash mismatch — NOT deleted: $src_abs"
    rm -rf "$tmpdir"
  fi
}

offload_avatar_dirs() {
  local today; today=$(date +%Y%m%d)
  for dir in "${TARGET_DIRS[@]}"; do
    local abs_dir="$REPO_ROOT/$dir"
    [ -d "$abs_dir" ] || continue
    while IFS= read -r -d '' file; do
      is_image "$file" || continue
      local relpath="${file#$REPO_ROOT/}"
      local basename; basename=$(basename "$file")
      local ext="${basename##*.}"
      local name_no_ext="${basename%.*}"

      local char="unknown"
      [[ "$file" == *downer* ]]    && char="downer"
      [[ "$file" == *yakobus* ]]   && char="yakobus"
      [[ "$file" == *iris* ]]      && char="iris"
      [[ "$file" == *sakura* ]]    && char="sakura"
      [[ "$file" == *adoadstra* ]] && char="adoadstra"
      [[ "$file" == *koharu* ]]    && char="koharu"
      [[ "$file" == *novita* ]]    && char="novita"

      local meta; meta=$(lookup_score "$relpath")
      local label score judgment char_idx notes
      IFS='|' read -r label score judgment char_idx notes <<< "$meta"
      [ "$char_idx" != "unknown" ] && char="$char_idx"

      local score_str="$score"
      [[ "$judgment" == "FAIL" ]] && score_str="${score}F"
      local desc; desc=$(echo "$name_no_ext" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | cut -c1-40)
      local dst_name="${today}__${label}__${score_str}__${char}__${desc}.${ext}"

      offload_file "$file" "${R2_BASE}/review/avatars/${char}" "$dst_name"
    done < <(find "$abs_dir" -type f -print0 2>/dev/null)
  done
}

offload_e2e_images() {
  local runs_abs="$REPO_ROOT/$E2E_RUNS_DIR"
  [ -d "$runs_abs" ] || return
  for run_dir in "$runs_abs"/*/; do
    local run_id; run_id=$(basename "$run_dir")
    local raw_date="${run_id:4:8}"
    local year_month="${raw_date:0:4}-${raw_date:4:2}"
    while IFS= read -r -d '' file; do
      is_image "$file" || continue
      offload_file "$file" "${R2_BASE}/review/evals/${year_month}/${run_id}" "$(basename "$file")"
    done < <(find "$run_dir" -type f -print0 2>/dev/null)
  done
}

log "=== R2 退避開始 (dry_run=$DRY_RUN) ==="
offload_avatar_dirs
offload_e2e_images
log ""
log "=== 完了 ==="
log "  対象: $TOTAL  アップ: $UPLOADED  検証OK: $VERIFIED  削除: $DELETED  エラー: $ERRORS"
$DRY_RUN && log "(--dry-run モード: 実際の変更なし)"
