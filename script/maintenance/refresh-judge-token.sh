#!/usr/bin/env bash
set -euo pipefail

# 【#952】judge はこのトークンを使わなくなった。judge は OpenRouter(OPENROUTER_API_KEY)へ移行済み。
# それでも CLAUDE_SESSION_TOKEN は残る2機能が要るので、このスクリプトは廃止せず維持する:
#   - Claude モデル直送チャット (requestRoutedChat)
#   - 文脈サジェスト生成 (requestContextualSuggestions)
# ただし更新の前提自体が壊れている: ホスト側がプロセス内で認証を保持する構成
# (CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH=1)では ~/.claude/.credentials.json が更新されず、
# このスクリプトは古い値を配り続ける。上記2機能が 401 で落ちたら人手でログインし直すこと。
# CLAUDE_SESSION_TOKEN_EXPIRES_AT はコード上の読み手がゼロになったので、配布は惰性である。
#
# 合言葉(CLAUDE_SESSION_TOKEN)の定期自動更新。
# このMacのClaude Codeが常に最新のOAuthトークンをKeychainに保持している事実を使い、
#   1. Keychain "Claude Code-credentials" から accessToken + expiresAt を読む
#   2. .dev.vars のローカル値を更新
#   3. wrangler pages secret put で本番(CLAUDE_SESSION_TOKEN / CLAUDE_SESSION_TOKEN_EXPIRES_AT)を更新
# launchd (com.kouiso.adult-ai-app.refresh-judge-token) が6時間おき+ログイン時に実行する。
# fail-open設計: 失敗してもアプリは壊れず judge が審査スキップに戻るだけ。次回発火でリトライ。
#
# 使い方:
#   bash script/maintenance/refresh-judge-token.sh                 # 1回実行
#   bash script/maintenance/refresh-judge-token.sh --install-launchd  # launchdジョブとして常駐化

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# launchd の最小PATHでは pnpm/node が見えないため、mise とローカル .bin を明示的に通す
export PATH="$REPO_ROOT/node_modules/.bin:$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
PROJECT_NAME="adult-ai-chat"
LOG_DIR="$HOME/Library/Logs/adult-ai-app"
LOG_FILE="$LOG_DIR/refresh-judge-token.log"
PLIST_LABEL="com.kouiso.adult-ai-app.refresh-judge-token"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

mkdir -p "$LOG_DIR"

# launchd が stdout/stderr を LOG_FILE へ流すため、tee すると二重に書かれる。echo のみにする。
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

install_launchd() {
  cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_ROOT/script/maintenance/refresh-judge-token.sh</string>
  </array>
  <key>StartInterval</key><integer>21600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG_FILE</string>
  <key>StandardErrorPath</key><string>$LOG_FILE</string>
  <key>WorkingDirectory</key><string>$REPO_ROOT</string>
</dict>
</plist>
PLIST
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  launchctl load "$PLIST_PATH"
  log "launchd job installed: $PLIST_PATH (every 6h + RunAtLoad)"
  exit 0
}

if [[ "${1:-}" == "--install-launchd" ]]; then
  install_launchd
fi

# 第一ソース: ~/.claude/.credentials.json（Claude Codeが常時最新化している）。
# Keychain は launchd/背景セッションだと承認ダイアログ無しに読めず空を返すため fallback 扱い。
CRED_FILE="$HOME/.claude/.credentials.json"
RAW=""
if [[ -r "$CRED_FILE" ]]; then
  RAW=$(cat "$CRED_FILE")
fi
if [[ -z "$RAW" ]] && command -v security >/dev/null 2>&1; then
  RAW=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
fi
if [[ -z "$RAW" ]]; then
  log "ERROR: neither $CRED_FILE nor Keychain 'Claude Code-credentials' is readable. Is Claude Code logged in?"
  exit 1
fi

# accessToken と expiresAt(ms epoch) をまとめて取り出す
CREDS=$(printf '%s' "$RAW" | python3 -c '
import json, sys
from datetime import datetime, timezone
try:
    d = json.load(sys.stdin)["claudeAiOauth"]
    token = d["accessToken"]
    expires_ms = d.get("expiresAt")
except Exception as e:
    sys.stderr.write(f"Failed to parse Keychain JSON: {e}\n")
    sys.exit(2)
iso = ""
if isinstance(expires_ms, (int, float)):
    iso = datetime.fromtimestamp(expires_ms / 1000, tz=timezone.utc).isoformat()
print(token)
print(iso)
')
TOKEN=$(printf '%s' "$CREDS" | sed -n '1p')
EXPIRES_AT=$(printf '%s' "$CREDS" | sed -n '2p')

if [[ -z "$TOKEN" || "${TOKEN:0:11}" != "sk-ant-oat0" ]]; then
  log "ERROR: unexpected token format from Keychain (prefix: '${TOKEN:0:12}...')"
  exit 1
fi

# --- .dev.vars のローカル値更新 -------------------------------------------
DEV_VARS="$REPO_ROOT/.dev.vars"
if [[ -f "$DEV_VARS" ]]; then
  update_var() {
    local name="$1" value="$2"
    awk -v name="$name" -v val="$value" '
      $0 ~ "^" name "=" { print name "=" val; replaced=1; next }
      { print }
      END { if (!replaced) print name "=" val }
    ' "$DEV_VARS" > "${DEV_VARS}.tmp" && mv "${DEV_VARS}.tmp" "$DEV_VARS"
  }
  update_var "CLAUDE_SESSION_TOKEN" "$TOKEN"
  [[ -n "$EXPIRES_AT" ]] && update_var "CLAUDE_SESSION_TOKEN_EXPIRES_AT" "$EXPIRES_AT"
  log ".dev.vars updated (token prefix ${TOKEN:0:14}***, expires $EXPIRES_AT)"
else
  log "WARN: $DEV_VARS not found, skipping local update"
fi

# --- 本番 Cloudflare Pages secret 更新 -------------------------------------
cd "$REPO_ROOT"
# .dev.vars から CF API トークンを読み取る（wrangler OAuth 不要）
CF_API_TOKEN=""
CF_ACCOUNT_ID=""
if [[ -f "$REPO_ROOT/.dev.vars" ]]; then
  CF_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' "$REPO_ROOT/.dev.vars" | head -1 | cut -d= -f2-)
  CF_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' "$REPO_ROOT/.dev.vars" | head -1 | cut -d= -f2-)
fi

CF_UPDATED=false
WRANGLER="$REPO_ROOT/node_modules/.bin/wrangler"

if [[ -n "${CF_API_TOKEN:-}" ]]; then
  export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
  [[ -n "${CF_ACCOUNT_ID:-}" ]] && export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
  if printf '%s' "$TOKEN" | "$WRANGLER" pages secret put CLAUDE_SESSION_TOKEN --project-name "$PROJECT_NAME" >>"$LOG_FILE" 2>&1; then
    log "prod secret CLAUDE_SESSION_TOKEN updated (via API token)"
    CF_UPDATED=true
  else
    log "WARN: wrangler pages secret put failed even with API token — falling back to CF API via python3"
  fi
fi

if [[ "$CF_UPDATED" == "false" ]]; then
  if [[ -n "${CF_API_TOKEN:-}" && -n "${CF_ACCOUNT_ID:-}" ]]; then
    if python3 - "$CF_ACCOUNT_ID" "$PROJECT_NAME" "$CF_API_TOKEN" "$TOKEN" "${EXPIRES_AT:-}" <<'PYEOF'
import sys, json, urllib.request, urllib.error
account_id, project_name, api_token, token, expires_at = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
env_vars = {
    "CLAUDE_SESSION_TOKEN": {"type": "secret_text", "value": token},
}
if expires_at:
    env_vars["CLAUDE_SESSION_TOKEN_EXPIRES_AT"] = {"type": "secret_text", "value": expires_at}
body = json.dumps({"deployment_configs": {"production": {"env_vars": env_vars}}}).encode()
req = urllib.request.Request(
    f"https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects/{project_name}",
    data=body, method="PATCH",
    headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.load(resp)
    if result.get("success"):
        print("CF API PATCH success")
    else:
        print(f"CF API error: {result.get('errors')}", file=sys.stderr)
        sys.exit(1)
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
    sys.exit(1)
PYEOF
    then
      log "prod secrets updated (CF API python3 fallback)"
      CF_UPDATED=true
    else
      log "WARN: CF Pages prod secret 更新失敗（API tokenにpages:editスコープ不足）"
      log "WARN: 一時対処 → Claude Code セッションで CF MCP 経由手動更新（mcp__claude_ai_cloudflare__execute）"
      log "WARN: 恒久対処 → CF dashboardでpages:editスコープのAPIトークン作成 → .dev.vars の CLOUDFLARE_API_TOKEN を差し替え"
    fi
  else
    log "WARN: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID が .dev.vars に無い（CF Pages更新スキップ）"
  fi
fi

if [[ -n "$EXPIRES_AT" && "$CF_UPDATED" == "true" ]]; then
  if [[ -n "${CF_API_TOKEN:-}" ]]; then
    printf '%s' "$EXPIRES_AT" | "$WRANGLER" pages secret put CLAUDE_SESSION_TOKEN_EXPIRES_AT --project-name "$PROJECT_NAME" >>"$LOG_FILE" 2>&1 || true
  fi
  log "prod secret CLAUDE_SESSION_TOKEN_EXPIRES_AT updated ($EXPIRES_AT)"
fi

log "refresh complete"
