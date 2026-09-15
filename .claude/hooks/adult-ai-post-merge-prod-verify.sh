#!/usr/bin/env bash
# PostToolUse Hook: PR merge 成功検知 → .work/.pending-prod-verify-PR<NN> marker 設置
#
# gh pr merge の「実際の成功」を検知し、PR番号スコープの marker を立てて
# prod-verify の実施を要求する。Stop hook (adult-ai-prod-verify-gate.sh) が
# marker を見て turn 終了をブロックする。
#
# v2 堅牢化（偽marker防止）:
#   - "gh pr merge" の単純文字列一致をやめ、merge サブコマンドの実呼び出しに限定
#   - --help / -h は除外
#   - tool_response の stdout/stderr に gh の成功語
#     (Merged / Squashed and merged / Rebased and merged) ... pull request
#     が含まれる場合のみ marker を立てる（ポジティブ検出）
#   - marker を PR番号スコープ化（連続マージで自己デッドロックしない）
#
# 脱出手段（marker を立てないケース）:
#   - repo が adult-ai-app 以外 → 無視
#   - コマンドが gh pr merge の実呼び出しでない → 無視
#   - tool_response に成功語が無い（失敗 / dry-run / --help / echo 等）→ 無視

set +e

INPUT="$(cat 2>/dev/null || true)"

# 1. repo チェック（cwd スコープ guard・fail-open）
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo '')"
repo_name="$(basename "$repo_root" 2>/dev/null || echo '')"
[ "$repo_name" != "adult-ai-app" ] && exit 0

# 2. merge サブコマンドの実呼び出しか（単純文字列一致を排除）
cmd="$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo '')"
echo "$cmd" | grep -qE 'gh +pr +merge( |$)' || exit 0
# --help / -h は merge ではない
echo "$cmd" | grep -qE '(^| )(--help|-h)( |$)' && exit 0

# 3. 失敗シグナル: exit_code が非ゼロなら無視
exit_code="$(echo "$INPUT" | jq -r '.tool_response.exit_code // empty' 2>/dev/null || echo '')"
if [ -n "$exit_code" ] && [ "$exit_code" != "0" ] && [ "$exit_code" != "null" ]; then
  exit 0
fi

# 4. ポジティブ検出: stdout/stderr を結合（gh は成功メッセージを stderr に出す）
out="$(echo "$INPUT" | jq -r '[.tool_response.stdout // "", .tool_response.stderr // ""] | join("\n")' 2>/dev/null || echo '')"
echo "$out" | grep -qE '(Merged|Squashed and merged|Rebased and merged) pull request' || exit 0

# 5. PR 番号抽出（成功行 "... pull request owner/repo#NN ..." 優先・無ければコマンド）
pr_num="$(echo "$out" | grep -oE 'pull request [^ ]*#[0-9]+' | grep -oE '#[0-9]+' | head -1 | tr -d '#')"
[ -z "$pr_num" ] && pr_num="$(echo "$cmd" | grep -oE 'gh +pr +merge +[0-9]+' | grep -oE '[0-9]+' | head -1)"

# 6. marker を設置（PR番号スコープ）
mkdir -p "$repo_root/.work"
if [ -n "$pr_num" ]; then
  marker="$repo_root/.work/.pending-prod-verify-PR${pr_num}"
  pr_label="#${pr_num}"
else
  marker="$repo_root/.work/.pending-prod-verify"
  pr_label="(PR番号不明)"
fi
touch "$marker"

# 7. AI へのリマインド（stderr → Claude の additionalContext として表示される）
cat >&2 <<EOF

╔══════════════════════════════════════════════════════════════════════╗
║  PROD_VERIFY_REQUIRED — PR merge 成功検知 ${pr_label}
╠══════════════════════════════════════════════════════════════════════╣
║  PR がマージされました。ユーザーの指示を待たずに今すぐ本番確認を実行せよ。  ║
║                                                                      ║
║  必須手順（この順で実行）:                                               ║
║    1. pnpm verify:prod         → API 疎通確認（課金なし）               ║
║    2. pnpm verify:prod:browser → ブラウザ UI + スクショ（課金なし）       ║
║                                                                      ║
║  証拠（browser-smoke-*.png）が .work/e2e-results/ に生成されるまで      ║
║  Stop hook が turn 終了をブロックする。                                  ║
║                                                                      ║
║  手動脱出: touch ~/.claude/disable-stop-hook                          ║
╚══════════════════════════════════════════════════════════════════════╝
EOF

exit 0
