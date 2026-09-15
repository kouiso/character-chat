#!/usr/bin/env bash
# Onboard a new character: avatar + greeting + system_prompt + image_meta + deploy + Slack.
# Usage:
#   scripts/onboard-char.sh <char_id>
#   scripts/onboard-char.sh import-charap-新キャラ名
#
# Assumes the row already exists in D1 (created via the UI or seed import).
# Reads description from D1 → codex generates everything → SQL applied → deploy → Slack.

set -euo pipefail

CHAR_ID="${1:-}"
if [[ -z "$CHAR_ID" ]]; then
  echo "usage: $0 <char_id>" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="/tmp/onboard-char-${CHAR_ID//[^a-zA-Z0-9_-]/_}"
mkdir -p "$WORK_DIR"

SPEC="$WORK_DIR/spec.md"
SQL="$WORK_DIR/update.sql"
REPORT="$WORK_DIR/report.md"

cat > "$SPEC" <<EOF
# Onboard char: $CHAR_ID

## Working directory
$REPO_ROOT

## Scope
Single-character onboarding pipeline. The row \`$CHAR_ID\` already exists in D1
(possibly with placeholder/generic greeting + system_prompt + null image_meta).

## Pipeline (all in one go)
1. Read the char's current row from D1 (use \`wrangler d1 execute adult-ai-db --remote\`
   with \`SELECT id, name, avatar, system_prompt, greeting FROM character WHERE id='$CHAR_ID';\` and parse JSON).
2. If \`avatar\` is null OR the file at \`public/avatars/\${id}.png\` does not exist
   OR the file looks defective (manual visual verify required):
   a. Try crop-from-scrape first: scan \`.work/scrape/account_runs/\` for a card image
      containing the char name; if found → crop to 512x512.
   b. Otherwise generate via Novita (\`NOVITA_API_KEY\` from \`.dev.vars\`,
      model \`darkSushiMixMix_225D_64380.safetensors\` to match existing profiles).
   c. Visual-verify the resulting PNG: face visible, no UI residue, matches description.
3. Write avatar PNG to \`public/avatars/\${id}.png\` (overwrite ok).
4. Vision-extract image_meta JSON from the avatar:
   \`{"appearance": "...", "artStyle": "...", "outfit": "...", "negativePrompt": "..."}\`
   English, hair color / eye color / build / distinctive features explicit, <1000 chars.
5. Rewrite greeting (80–200 chars Japanese, in-character, no "あなたは、どうしたい？" template,
   appropriate address inferred from setup).
6. Rewrite system_prompt (500–1200 chars) using THIS template:
   \`\`\`
   【キャラクター】
   名前: <name>
   年齢: 18歳

   【設定】
   <description, expanded with sensible details: 関係性, 背景, 性格,
   見た目の特徴 (use image_meta appearance), 距離感>

   【口調・振る舞い】
   - 一人称「...」、呼び方「...」
   - 語尾の癖
   - 距離感、ボディタッチ頻度
   - からかいの有無、真面目モードの落差
   - NSFW の入り方（キャラ個性に基づく具体的な傾向を書く。説教やメタ確認を入れない）
   \`\`\`
7. Output to \`$SQL\`:
   \`\`\`sql
   UPDATE character SET
     avatar = '/avatars/$CHAR_ID.png',
     greeting = '<new>',
     system_prompt = '<new>',
     image_meta = '<json>'
   WHERE id = '$CHAR_ID';
   \`\`\`
8. Output to \`$REPORT\`: one line \`[Vision-Check] $CHAR_ID - PASS|FAIL\` with reason.

## Gold standard reference
\`import-charap-ユメミ\` row in D1 — same tone/quality basis.

## Constraints
- DO NOT execute SQL against D1 yourself (this script applies it after codex finishes).
- DO NOT push to git, don't touch other chars.
- Properly SQL-escape single quotes.
- Idempotent: if everything already looks good, output a no-op report and skip SQL.

# 必須プロトコル
- Self-review 100/100 before SQL write
- Verification source tag: [Vision-Check] (or [Novita-Attempt-N] if generated)
EOF

echo "[onboard] spec written: $SPEC"
echo "[onboard] firing codex (bg)..."
cat "$SPEC" | codex exec -c model="gpt-5.5" -c model_reasoning_effort="high" \
  --dangerously-bypass-approvals-and-sandbox > "$WORK_DIR/codex.log" 2>&1
CODEX_EXIT=$?

if [[ $CODEX_EXIT -ne 0 ]]; then
  echo "[onboard] codex failed (exit $CODEX_EXIT). log: $WORK_DIR/codex.log" >&2
  tail -30 "$WORK_DIR/codex.log" >&2
  exit 2
fi

if [[ ! -s "$SQL" ]]; then
  echo "[onboard] no SQL produced (codex marked no-op). report:" >&2
  cat "$REPORT" 2>/dev/null || true
  exit 0
fi

echo "[onboard] codex done. SQL:"
cat "$SQL"
echo ""
echo "[onboard] applying SQL to D1..."
cd "$REPO_ROOT"
pnpm exec wrangler d1 execute adult-ai-db --remote --file="$SQL" --yes

echo "[onboard] building..."
pnpm build > "$WORK_DIR/build.log" 2>&1 || { echo "[onboard] build failed:" >&2; tail -20 "$WORK_DIR/build.log" >&2; exit 3; }

echo "[onboard] deploying..."
DEPLOY_OUT=$(pnpm exec wrangler pages deploy dist --project-name=adult-ai-chat --branch=main --commit-dirty=true 2>&1)
DEPLOY_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9-]+\.adult-ai-chat\.pages\.dev' | tail -1)
echo "[onboard] deployed: $DEPLOY_URL"

# Slack notify if SLACK_WEBHOOK or mcp script available
SLACK_MSG="[onboard] char \`$CHAR_ID\` 完了 → $DEPLOY_URL\n$(cat "$REPORT" 2>/dev/null)"
echo "[onboard] $SLACK_MSG"
echo "[onboard] (Slack 通知は claude code 経由で別途送信を推奨)"
