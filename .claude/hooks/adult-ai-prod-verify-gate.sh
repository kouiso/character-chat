#!/usr/bin/env bash
# Stop Hook: PR merge 後の本番動作確認ゲート
#
# .work/.pending-prod-verify marker が存在するのに browser-smoke スクリーンショット証拠が
# 無い場合に exit 2 で turn 終了をブロックし、/prod-verify の実行を強制する。
#
# 脱出手段:
#   - stop_hook_active == true → 無限ループ防止のため許可
#   - ~/.claude/disable-stop-hook が存在 → 手動脱出
#   - repo が adult-ai-app 以外 → 無視
#   - .work/.pending-prod-verify が存在しない → merge なし、無視
#   - marker より新しい browser-smoke-*.png が存在 → 確認済み、marker 削除して許可

set +e

INPUT="$(cat 2>/dev/null || true)"

# 1. 無限ループ防止
STOP_HOOK_ACTIVE="$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo 'false')"
[ "$STOP_HOOK_ACTIVE" = "true" ] && exit 0

# 2. 手動脱出ハッチ
[ -f "$HOME/.claude/disable-stop-hook" ] && exit 0

# 3. adult-ai-app プロジェクト外なら無視
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo '')"
repo_name="$(basename "$repo_root" 2>/dev/null || echo '')"
[ "$repo_name" != "adult-ai-app" ] && exit 0

# 4. marker がなければ merge していない → 無干渉
# v2: PR番号スコープ marker (.pending-prod-verify / .pending-prod-verify-PR<NN>) を全て対象にする
shopt -s nullglob
markers=( "$repo_root"/.work/.pending-prod-verify* )
shopt -u nullglob
[ ${#markers[@]} -eq 0 ] && exit 0

# 5. 各 marker について、それより新しい browser-smoke スクショがあれば証拠あり→該当 marker 削除
#    一度の prod-verify(新しい png)で全 marker を解除できる（1デプロイ=1確認でカバー）
E2E_DIR="$repo_root/.work/e2e-results"
blocked=0
for m in "${markers[@]}"; do
  cleared=0
  if [ -d "$E2E_DIR" ]; then
    recent_ss="$(find "$E2E_DIR" -maxdepth 1 -name "browser-smoke-*.png" -newer "$m" 2>/dev/null | head -1)"
    if [ -n "$recent_ss" ]; then
      rm -f "$m"
      cleared=1
    fi
  fi
  [ "$cleared" -eq 0 ] && blocked=1
done
[ "$blocked" -eq 0 ] && exit 0

# 6. 証拠なし → turn 終了をブロック
cat >&2 <<'EOF'

╔══════════════════════════════════════════════════════════════════════╗
║  PROD_VERIFY_REQUIRED — 停止ブロック                                   ║
╠══════════════════════════════════════════════════════════════════════╣
║  PR をマージしたが本番動作確認が未完了です。                               ║
║                                                                      ║
║  今すぐ以下を実行してください（ユーザー指示不要）:                            ║
║    1. pnpm verify:prod         → API 疎通確認                         ║
║    2. pnpm verify:prod:browser → ブラウザ UI + スクリーンショット          ║
║                                                                      ║
║  .work/e2e-results/browser-smoke-*.png が生成されると自動で解除されます。  ║
║                                                                      ║
║  手動脱出: touch ~/.claude/disable-stop-hook                          ║
╚══════════════════════════════════════════════════════════════════════╝
EOF

exit 2
