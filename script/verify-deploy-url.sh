#!/usr/bin/env bash
set -euo pipefail

CANONICAL_URL="${1:-https://adult-ai-chat.pages.dev}"
DEAD_URL="https://adult-ai-app.pages.dev"

probe_http_code() {
  local url="$1"
  curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 10 --max-time 20 "$url" || true
}

dead_code="$(probe_http_code "$DEAD_URL")"
if [ "$dead_code" != "000" ]; then
  echo "unexpected reachable legacy URL: $DEAD_URL returned HTTP $dead_code" >&2
  exit 1
fi

canonical_code="$(probe_http_code "$CANONICAL_URL")"
case "$canonical_code" in
  200|302|401|403)
    echo "canonical deploy URL reachable: $CANONICAL_URL returned HTTP $canonical_code"
    ;;
  *)
    echo "canonical deploy URL failed: $CANONICAL_URL returned HTTP $canonical_code" >&2
    exit 1
    ;;
esac
