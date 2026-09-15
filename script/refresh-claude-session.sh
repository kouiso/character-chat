#!/usr/bin/env bash
set -euo pipefail

# 【#952】品質judgeはこのトークンを使わなくなった(OpenRouterへ移行済み)。CLAUDE_SESSION_TOKEN は
# Claudeモデル直送チャットと文脈サジェスト生成だけが読む。judge の障害調査には使えない。
# Refresh adult-ai-app's CLAUDE_SESSION_TOKEN in .dev.vars from macOS Keychain.
# The OAuth token is stored by Claude Code under service name "Claude Code-credentials".

if ! command -v security >/dev/null 2>&1; then
  echo "ERROR: 'security' command not found. This script requires macOS." >&2
  exit 1
fi

# Read the JSON blob from Keychain and extract claudeAiOauth.accessToken
RAW=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
if [[ -z "$RAW" ]]; then
  echo "ERROR: Could not read 'Claude Code-credentials' from Keychain." >&2
  echo "       Open Claude Code and ensure you are logged in." >&2
  exit 1
fi

TOKEN=$(printf '%s' "$RAW" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d["claudeAiOauth"]["accessToken"])
except Exception as e:
    sys.stderr.write(f"Failed to parse Keychain JSON: {e}\n")
    sys.exit(2)
')

if [[ -z "$TOKEN" || "${TOKEN:0:11}" != "sk-ant-oat0" ]]; then
  echo "ERROR: Unexpected token format from Keychain (got: '${TOKEN:0:20}...')" >&2
  exit 1
fi

DEV_VARS=".dev.vars"
if [[ ! -f "$DEV_VARS" ]]; then
  echo "ERROR: $DEV_VARS not found. Run from repo root." >&2
  exit 1
fi

# Backup before mutating
BACKUP=".dev.vars.bak.$(date +%Y%m%d-%H%M%S)"
cp "$DEV_VARS" "$BACKUP"

# Use awk for safe in-place replacement (handles special chars in token)
awk -v tok="$TOKEN" '
  /^CLAUDE_SESSION_TOKEN=/ { print "CLAUDE_SESSION_TOKEN=" tok; replaced=1; next }
  { print }
  END { if (!replaced) print "CLAUDE_SESSION_TOKEN=" tok }
' "$DEV_VARS" > "${DEV_VARS}.tmp" && mv "${DEV_VARS}.tmp" "$DEV_VARS"

echo "Refreshed CLAUDE_SESSION_TOKEN in $DEV_VARS"
echo "  prefix: ${TOKEN:0:18}***"
echo "  length: ${#TOKEN}"
echo "  backup: $BACKUP"
echo ""
echo "Next: bash script/probe-anthropic.sh"
