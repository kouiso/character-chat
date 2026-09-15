#!/usr/bin/env bash
# migrate-gdrive-to-r2.sh — 一回限り: GDrive審査画像 → R2 review/ 移行
# GDriveのadult画像をCloudflare R2に退避する（規約違反解消）
#
# 移行先パス:
#   gdrive:avatars/<char>/  → r2:adult-ai-images/review/avatars/<char>/
#   gdrive:evals/<ym>/<run>/  → r2:adult-ai-images/review/evals/<ym>/<run>/
#
# 使用法: bash script/migrate-gdrive-to-r2.sh [--dry-run] [--delete-after]
set -euo pipefail

DRY_RUN=false
DELETE_AFTER=false
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]]     && DRY_RUN=true
  [[ "$arg" == "--delete-after" ]] && DELETE_AFTER=true
done

R2_BUCKET="adult-ai-images"
R2_REMOTE="r2"
GDRIVE_REMOTE="gdrive"

log()  { echo "[$(date +%H:%M:%S)] $*"; }
warn() { echo "[WARN] $*" >&2; }

rclone_copy() {
  local src="$1" dst="$2"
  if $DRY_RUN; then
    log "DRY: rclone copy $src → $dst"
    return
  fi
  rclone copy "$src" "$dst" \
    --transfers 4 \
    --checkers 8 \
    --progress \
    --stats-one-line \
    2>&1
}

rclone_check() {
  local src="$1" dst="$2"
  rclone check "$src" "$dst" --combined - 2>&1
}

log "=== GDrive → R2 移行開始 (dry_run=$DRY_RUN, delete_after=$DELETE_AFTER) ==="
echo ""

# ──────────────────────────────────────────────
# Step 1: avatars/ コピー
# ──────────────────────────────────────────────
log "[1/4] avatars/ のキャラ一覧を確認中..."
CHARS=$(rclone lsd "${GDRIVE_REMOTE}:avatars" --max-depth 1 2>/dev/null | awk '{print $NF}' || true)
if [ -z "$CHARS" ]; then
  warn "gdrive:avatars が空またはアクセス不可 — スキップ"
else
  echo "$CHARS" | while IFS= read -r char; do
    [ -z "$char" ] && continue
    src="${GDRIVE_REMOTE}:avatars/${char}"
    dst="${R2_REMOTE}:${R2_BUCKET}/review/avatars/${char}"
    log "  avatars/${char} → review/avatars/${char}"
    rclone_copy "$src" "$dst"
  done
  log "✓ avatars/ コピー完了"
fi

echo ""

# ──────────────────────────────────────────────
# Step 2: evals/ コピー
# ──────────────────────────────────────────────
log "[2/4] evals/ のディレクトリ一覧を確認中..."
EVAL_DIRS=$(rclone lsd "${GDRIVE_REMOTE}:evals" --max-depth 1 2>/dev/null | awk '{print $NF}' || true)
if [ -z "$EVAL_DIRS" ]; then
  warn "gdrive:evals が空またはアクセス不可 — スキップ"
else
  echo "$EVAL_DIRS" | while IFS= read -r ym; do
    [ -z "$ym" ] && continue
    src="${GDRIVE_REMOTE}:evals/${ym}"
    dst="${R2_REMOTE}:${R2_BUCKET}/review/evals/${ym}"
    log "  evals/${ym} → review/evals/${ym}"
    rclone_copy "$src" "$dst"
  done
  log "✓ evals/ コピー完了"
fi

echo ""

# ──────────────────────────────────────────────
# Step 3: 検証
# ──────────────────────────────────────────────
if ! $DRY_RUN; then
  log "[3/4] R2へのコピー内容を確認中..."
  AVATAR_COUNT=$(rclone ls "${R2_REMOTE}:${R2_BUCKET}/review/avatars" 2>/dev/null | wc -l || echo 0)
  EVAL_COUNT=$(rclone ls "${R2_REMOTE}:${R2_BUCKET}/review/evals" 2>/dev/null | wc -l || echo 0)
  log "  R2 review/avatars/: ${AVATAR_COUNT} ファイル"
  log "  R2 review/evals/:   ${EVAL_COUNT} ファイル"
  echo ""
fi

# ──────────────────────────────────────────────
# Step 4: GDrive削除（--delete-after 指定時のみ）
# ──────────────────────────────────────────────
if $DELETE_AFTER && ! $DRY_RUN; then
  log "[4/4] GDriveから削除中..."
  rclone delete "${GDRIVE_REMOTE}:avatars" --progress 2>&1 || warn "avatars 削除でエラー（続行）"
  rclone delete "${GDRIVE_REMOTE}:evals"   --progress 2>&1 || warn "evals 削除でエラー（続行）"
  log "✓ GDrive削除完了"
elif $DRY_RUN; then
  log "[4/4] DRY RUN のため削除スキップ"
else
  log "[4/4] --delete-after 未指定 → GDriveファイルは残したまま"
  log "      確認後: bash script/migrate-gdrive-to-r2.sh --delete-after"
fi

echo ""
log "=== 完了 ==="
