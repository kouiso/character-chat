#!/usr/bin/env bash
set -euo pipefail

# 【#952】品質judgeはこのトークンを使わなくなった(OpenRouterへ移行済み)。CLAUDE_SESSION_TOKEN は
# Claudeモデル直送チャットと文脈サジェスト生成だけが読む。judge の障害調査には使えない。
# Upload Claude Code's OAuth token from macOS Keychain to Cloudflare Pages.
# This keeps production on the same Claude subscription path as local dev.

PROJECT_NAME="${1:-adult-ai-chat}"
SECRET_NAME="CLAUDE_SESSION_TOKEN"

if ! command -v security >/dev/null 2>&1; then
  echo "ERROR: 'security' command not found. This script requires macOS." >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "ERROR: 'npx' command not found. Install Node.js/pnpm dependencies first." >&2
  exit 1
fi

TOKEN=$(
  security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null |
    python3 -c '
import json, sys
try:
    token = json.load(sys.stdin)["claudeAiOauth"]["accessToken"]
except Exception as e:
    sys.stderr.write(f"failed to read Claude token from Keychain: {e}\n")
    sys.exit(2)
if not token.startswith("sk-ant-oat0"):
    sys.stderr.write("unexpected Claude token format\n")
    sys.exit(3)
print(token, end="")
'
)

printf '%s' "$TOKEN" | npx wrangler pages secret put "$SECRET_NAME" --project-name "$PROJECT_NAME"

echo "Uploaded $SECRET_NAME to Cloudflare Pages project '$PROJECT_NAME'."
echo "Token prefix: ${TOKEN:0:18}***"
