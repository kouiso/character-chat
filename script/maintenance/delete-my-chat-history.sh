#!/usr/bin/env bash
# 自分のチャット履歴を本番D1とR2から削除するメンテナンススクリプト
# 用途: user/character行は保全し、conversation/message/関連テーブルのみ削除
#
# 使い方:
#   bash script/maintenance/delete-my-chat-history.sh [--dry-run] [--yes] [--email addr] [--skip-r2-backup]
#
# オプション:
#   --dry-run        件数確認のみ（バックアップも削除もしない）
#   --yes            確認プロンプトをスキップして即実行
#   --email addr     削除対象のuser_id（デフォルト: sukererion@gmail.com）
#   --skip-r2-backup R2オブジェクトのローカルバックアップをスキップ（高速化）

set -euo pipefail

# ── デフォルト値 ──────────────────────────────────────────────────────────────
TARGET_EMAIL="sukererion@gmail.com"
DRY_RUN=false
AUTO_YES=false
SKIP_R2_BACKUP=false
DB_NAME="adult-ai-db"
BUCKET_NAME="adult-ai-images"
BACKUP_DIR=".work/backups/chat-history/$(date +%Y%m%dT%H%M%S)"

# ── 引数パース ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       DRY_RUN=true ;;
    --yes)           AUTO_YES=true ;;
    --skip-r2-backup) SKIP_R2_BACKUP=true ;;
    --email)         shift; TARGET_EMAIL="$1" ;;
    *) echo "❌ 不明なオプション: $1" >&2; exit 1 ;;
  esac
  shift
done

# ── ユーティリティ ────────────────────────────────────────────────────────────
WRANGLER="${WRANGLER:-$(command -v wrangler 2>/dev/null || echo 'npx wrangler')}"

d1_query() {
  $WRANGLER d1 execute "$DB_NAME" --remote --command "$1" --json 2>/dev/null
}

d1_count() {
  local tbl="$1" where="$2"
  d1_query "SELECT count(*) AS n FROM ${tbl} WHERE ${where}" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['results'][0]['n'] if r else 0)" 2>/dev/null || echo "?"
}

# ── ① 対象確認（read-only） ───────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  delete-my-chat-history.sh"
echo "  DB    : ${DB_NAME} (--remote)"
echo "  Bucket: ${BUCKET_NAME}"
echo "  Email : ${TARGET_EMAIL}"
if $DRY_RUN; then echo "  Mode  : DRY-RUN（件数確認のみ）"; fi
echo "═══════════════════════════════════════════════════════"
echo ""

echo "▶ 対象件数を確認中..."

USER_COUNT=$(d1_count "user" "1=1")
CHAR_COUNT=$(d1_count "character" "1=1")
CONV_COUNT=$(d1_count "conversation" "user_id='${TARGET_EMAIL}'")
MSG_COUNT=$(d1_count "message" "user_id='${TARGET_EMAIL}'")
SCENE_BM=$(d1_count "scene_bookmark" "user_id='${TARGET_EMAIL}'" 2>/dev/null || echo "0")
COMIC=$(d1_count "comic" "user_id='${TARGET_EMAIL}'" 2>/dev/null || echo "0")
FEEDBACK=$(d1_count "message_feedback" "user_id='${TARGET_EMAIL}'" 2>/dev/null || echo "0")
MEMORY=$(d1_count "memory_note" "user_id='${TARGET_EMAIL}'" 2>/dev/null || echo "0")

# R2キー件数
R2_KEY_COUNT=$(d1_query "SELECT count(*) AS n FROM message WHERE user_id='${TARGET_EMAIL}' AND (image_key IS NOT NULL OR video_key IS NOT NULL)" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['results'][0]['n'] if r else 0)" 2>/dev/null || echo "?")

echo ""
echo "【保全対象（削除しない）】"
printf "  user             : %s 件\n" "$USER_COUNT"
printf "  character        : %s 件\n" "$CHAR_COUNT"
echo ""
echo "【削除対象】"
printf "  conversation     : %s 件\n" "$CONV_COUNT"
printf "  message          : %s 件\n" "$MSG_COUNT"
printf "  memory_note      : %s 件\n" "$MEMORY"
printf "  message_feedback : %s 件\n" "$FEEDBACK"
printf "  scene_bookmark   : %s 件\n" "$SCENE_BM"
printf "  comic            : %s 件\n" "$COMIC"
printf "  R2 オブジェクト  : %s 件（images/ videos/ prefixのみ）\n" "$R2_KEY_COUNT"
echo ""

# dry-run はここで終了
if $DRY_RUN; then
  echo "✅ DRY-RUN 完了（削除・バックアップは実施していません）"
  exit 0
fi

# ── ② 確認 ───────────────────────────────────────────────────────────────────
if ! $AUTO_YES; then
  echo "⚠️  本番データを削除します。この操作は取り消せません。"
  read -rp "続けますか？ [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "中止しました。"
    exit 0
  fi
fi

# ── ③ バックアップ ────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

echo ""
echo "▶ D1フルバックアップ中..."
$WRANGLER d1 export "$DB_NAME" --remote --output "${BACKUP_DIR}/d1-full.sql"
echo "  → ${BACKUP_DIR}/d1-full.sql"

echo ""
echo "▶ 削除予定R2キーリスト生成中..."
d1_query "SELECT image_key, video_key FROM message WHERE user_id='${TARGET_EMAIL}' AND (image_key IS NOT NULL OR video_key IS NOT NULL)" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
rows = r[0]['results'] if r else []
keys = []
for row in rows:
    for col in ['image_key', 'video_key']:
        v = row.get(col)
        if v and (v.startswith('images/') or v.startswith('videos/')):
            keys.append(v)
for k in keys:
    print(k)
" > "${BACKUP_DIR}/r2-keys.txt"

R2_KEY_LINES=$(wc -l < "${BACKUP_DIR}/r2-keys.txt" | tr -d ' ')
echo "  → ${BACKUP_DIR}/r2-keys.txt（${R2_KEY_LINES}キー）"

if ! $SKIP_R2_BACKUP && [[ "$R2_KEY_LINES" -gt 0 ]]; then
  echo ""
  echo "▶ R2オブジェクトのローカルバックアップ中..."
  mkdir -p "${BACKUP_DIR}/r2"
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    local_path="${BACKUP_DIR}/r2/${key//\//__}"
    $WRANGLER r2 object get "$BUCKET_NAME/$key" --file "$local_path" --remote 2>/dev/null \
      && echo "  ✓ $key" \
      || echo "  ⚠ スキップ（取得失敗）: $key"
  done < "${BACKUP_DIR}/r2-keys.txt"
  echo "  → ${BACKUP_DIR}/r2/"
fi

# ── ④ D1削除 SQL 生成・実行 ──────────────────────────────────────────────────
SQL_FILE="/tmp/delete-my-chat-history-$$.sql"
cat > "$SQL_FILE" <<ENDSQL
-- 自分のチャット履歴削除（user_id = '${TARGET_EMAIL}'）
-- 子テーブルから順に削除（FK孤児化防止）

DELETE FROM memory_note WHERE user_id = '${TARGET_EMAIL}';
DELETE FROM message_feedback WHERE user_id = '${TARGET_EMAIL}';
DELETE FROM scene_bookmark WHERE user_id = '${TARGET_EMAIL}';
DELETE FROM comic WHERE user_id = '${TARGET_EMAIL}';
DELETE FROM quality_report_dedup WHERE conversation_id IN (
  SELECT id FROM conversation WHERE user_id = '${TARGET_EMAIL}'
);
DELETE FROM conversation_scene_state WHERE conversation_id IN (
  SELECT id FROM conversation WHERE user_id = '${TARGET_EMAIL}'
);
DELETE FROM conversation_scene_body_fluid WHERE conversation_id IN (
  SELECT id FROM conversation WHERE user_id = '${TARGET_EMAIL}'
);
DELETE FROM message WHERE user_id = '${TARGET_EMAIL}';
DELETE FROM conversation WHERE user_id = '${TARGET_EMAIL}';
ENDSQL

echo ""
echo "▶ D1削除実行中..."
$WRANGLER d1 execute "$DB_NAME" --remote --file "$SQL_FILE"
rm -f "$SQL_FILE"
echo "  → 完了"

# ── ⑤ R2削除 ─────────────────────────────────────────────────────────────────
if [[ "$R2_KEY_LINES" -gt 0 ]]; then
  echo ""
  echo "▶ R2オブジェクト削除中（images/ videos/ prefixのみ）..."
  DELETED=0
  SKIPPED=0
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    # 安全装置: images/ または videos/ 以外は絶対に触らない
    if [[ "$key" =~ ^(images/|videos/) ]]; then
      $WRANGLER r2 object delete "$BUCKET_NAME/$key" --remote 2>/dev/null \
        && { echo "  ✓ $key"; DELETED=$((DELETED+1)); } \
        || { echo "  ⚠ 削除失敗: $key"; SKIPPED=$((SKIPPED+1)); }
    else
      echo "  🛑 スキップ（保全対象prefix）: $key"
      SKIPPED=$((SKIPPED+1))
    fi
  done < "${BACKUP_DIR}/r2-keys.txt"
  echo "  → 削除: ${DELETED}件 / スキップ: ${SKIPPED}件"
fi

# ── ⑥ 検証 ───────────────────────────────────────────────────────────────────
echo ""
echo "▶ 削除後の件数確認..."

POST_CONV=$(d1_count "conversation" "user_id='${TARGET_EMAIL}'")
POST_MSG=$(d1_count "message" "user_id='${TARGET_EMAIL}'")
POST_USER=$(d1_count "user" "1=1")
POST_CHAR=$(d1_count "character" "1=1")

echo ""
echo "【削除後】"
printf "  conversation (自分): %s 件（期待値: 0）\n" "$POST_CONV"
printf "  message (自分)     : %s 件（期待値: 0）\n" "$POST_MSG"
printf "  user               : %s 件（削除前: %s）\n" "$POST_USER" "$USER_COUNT"
printf "  character          : %s 件（削除前: %s）\n" "$POST_CHAR" "$CHAR_COUNT"

ERRORS=0
if [[ "$POST_CONV" != "0" ]]; then echo "  ❌ conversation が残っています"; ERRORS=$((ERRORS+1)); fi
if [[ "$POST_MSG" != "0" ]]; then echo "  ❌ message が残っています"; ERRORS=$((ERRORS+1)); fi
if [[ "$POST_USER" != "$USER_COUNT" ]]; then echo "  ❌ user 件数が変わっています！"; ERRORS=$((ERRORS+1)); fi
if [[ "$POST_CHAR" != "$CHAR_COUNT" ]]; then echo "  ❌ character 件数が変わっています！"; ERRORS=$((ERRORS+1)); fi

echo ""
if [[ $ERRORS -eq 0 ]]; then
  echo "✅ 削除完了。バックアップ: ${BACKUP_DIR}"
else
  echo "⚠️  ${ERRORS}件の検証エラーがあります。バックアップ: ${BACKUP_DIR}"
  exit 1
fi
