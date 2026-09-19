#!/usr/bin/env bash
# 実測コーパス（.work/）を private リポから復元する。
# 公開リポジトリには adult 会話本文を含むためコーパスは git に載せない。
# 正は kouiso/character-chat-corpus（private）の .work/ ツリー。
#
# 認証の優先順位:
#   1. CORPUS_TOKEN（CI の secrets.CORPUS_PAT 等、repo:read が効く PAT）
#   2. gh CLI のログインセッション（ローカル想定）
#   3. 素の git（credential helper / SSH 設定がある環境向け）
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [ -d .work/e2e-results/vlong-dogfood ]; then
  echo "corpus already present: .work/e2e-results/vlong-dogfood"
  exit 0
fi

REPO="kouiso/character-chat-corpus"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "${CORPUS_TOKEN:-}" ]; then
  git clone --depth 1 "https://x-access-token:${CORPUS_TOKEN}@github.com/${REPO}.git" "$TMP/corpus"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh repo clone "$REPO" "$TMP/corpus" -- --depth 1
else
  git clone --depth 1 "git@github.com:${REPO}.git" "$TMP/corpus"
fi

mkdir -p .work
cp -a "$TMP/corpus/.work/." .work/
echo "corpus restored into .work/ from ${REPO}"
