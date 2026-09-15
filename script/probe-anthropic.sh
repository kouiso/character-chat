#!/usr/bin/env bash
set -euo pipefail

# 【#952】品質judgeはこのトークンを使わなくなった(OpenRouterへ移行済み)。CLAUDE_SESSION_TOKEN は
# Claudeモデル直送チャットと文脈サジェスト生成だけが読む。judge の障害調査には使えない。
# Probe Anthropic API with the OAuth token in .dev.vars CLAUDE_SESSION_TOKEN.
# Uses the same request shape as functions/api/[[route]].ts:requestAnthropicChat.

DEV_VARS=".dev.vars"
if [[ ! -f "$DEV_VARS" ]]; then
  echo "ERROR: $DEV_VARS not found. Run from repo root." >&2
  exit 1
fi

TOKEN=$(grep "^CLAUDE_SESSION_TOKEN=" "$DEV_VARS" | cut -d= -f2- || true)
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: CLAUDE_SESSION_TOKEN not set in $DEV_VARS" >&2
  echo "       Run: bash script/refresh-claude-session.sh" >&2
  exit 1
fi

echo "Probing Anthropic API (1-token chat)..."
echo "  token prefix: ${TOKEN:0:18}***"

# Capture body to tmpfile and HTTP code separately (BSD-compatible)
BODY_FILE=$(mktemp -t claude-probe.XXXXXX)
trap "rm -f $BODY_FILE" EXIT

HTTP=$(curl -s -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "https://api.anthropic.com/v1/messages" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"Hi"}]}' \
  --max-time 15)

echo "  HTTP status: $HTTP"

case "$HTTP" in
  200)
    echo "✅ OAuth token is VALID"
    exit 0
    ;;
  401)
    echo "❌ OAuth token is EXPIRED or INVALID"
    echo "   Body: $(head -c 200 "$BODY_FILE")"
    echo ""
    echo "   To refresh: claude (Code) を一度開いて login し直してから:"
    echo "     bash script/refresh-claude-session.sh"
    exit 1
    ;;
  *)
    echo "⚠️  Unexpected HTTP $HTTP"
    echo "   Body: $(head -c 500 "$BODY_FILE")"
    exit 1
    ;;
esac
