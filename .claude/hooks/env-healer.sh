#!/bin/bash
# adult-ai-app env healer — Vite + Cloudflare Workers
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
REPO_DIR="/Users/kouiso/ghq/kouiso/adult-ai-app"
FIXED=0; ISSUES=0
echo '=== adult-ai-app Env Healer ==='

# Check env
[ -f "$REPO_DIR/.env" ] && echo '✓  .env exists' || [ -f "$REPO_DIR/.env.local" ] && echo '✓  .env.local exists' || { echo '⚠  no .env file (copy from .env.example)'; ISSUES=$((ISSUES+1)); }

# Check wrangler CLI for CF Workers
command -v wrangler > /dev/null 2>&1 && echo '✓  wrangler available' || { echo '⚠  wrangler not found (npm i -g wrangler)'; ISSUES=$((ISSUES+1)); }

# Check node_modules
[ -d "$REPO_DIR/node_modules" ] && echo '✓  node_modules exists' || { echo '⚠  node_modules missing — run: yarn install'; ISSUES=$((ISSUES+1)); }

# ── Mark session as healed ──────────────────────────────────────
STATE_DIR="$HOME/.claude/hooks/state"
mkdir -p "$STATE_DIR"
# Search all gate-written token files and create matching state files.
# This handles cases where CLAUDE_PROJECT_DIR differs between gate and healer env.
TOUCHED=0
for TOKEN_FILE in /tmp/env-healer-token-*; do
  [ -f "$TOKEN_FILE" ] || continue
  RAW=$(cat "$TOKEN_FILE")
  SID="${RAW%%:::*}"
  PHASH="${RAW##*:::}"
  touch "$STATE_DIR/env-healed-${SID}-${PHASH}"
  TOUCHED=$((TOUCHED+1))
done
# Fallback: compute hash locally
if [ "$TOUCHED" -eq 0 ]; then
  if command -v md5 &>/dev/null; then
    PROJECT_HASH=$(echo "$CLAUDE_PROJECT_DIR" | md5 2>/dev/null || echo "default")
  else
    PROJECT_HASH=$(echo "$CLAUDE_PROJECT_DIR" | md5sum | cut -d' ' -f1)
  fi
  touch "$STATE_DIR/env-healed-default-${PROJECT_HASH}"
fi
echo ""
echo "=== Done: ${FIXED} fixed, ${ISSUES} warning(s) ==="
[ "$ISSUES" -gt 0 ] && echo "⚠  Some warnings above."
