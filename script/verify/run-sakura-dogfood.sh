#!/usr/bin/env bash
# RIT-8: さくら台本ドッグフードの一発実行（bench → core-check → HTML レポート）。
# 課金 API（OpenRouter）を叩くので、OPENROUTER_API_KEY 未設定では一切走らせん。
#
# 使い方:
#   script/verify/run-sakura-dogfood.sh [run番号]
#   - run番号省略時は今日の script2 連番の次を自動採番
#   - OPENROUTER_API_KEY は環境変数優先、無ければ apps/v2/.dev.vars から拾う
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ -z "${OPENROUTER_API_KEY:-}" && -f apps/v2/.dev.vars ]]; then
  key="$(grep -E '^OPENROUTER_API_KEY=' apps/v2/.dev.vars | head -1 | cut -d= -f2- | tr -d '"'\'' ')"
  export OPENROUTER_API_KEY="$key"
fi
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "OPENROUTER_API_KEY が未設定。環境変数か apps/v2/.dev.vars で渡す（課金 API を叩くので未設定のまま走らせん）" >&2
  exit 1
fi

RESULT_ROOT=".work/e2e-results/vlong-dogfood"
REPORT_ROOT=".work/report"
mkdir -p "$REPORT_ROOT"

RUN_N="${1:-}"
if [[ -z "$RUN_N" ]]; then
  today="$(date +%F)"
  last="$(ls -d "$RESULT_ROOT/$today"-script2-* 2>/dev/null | sed -E 's/.*-script2-([0-9]+)-.*/\1/' | sort -n | tail -1)"
  RUN_N=$(( ${last:-0} + 1 ))
fi
echo "==> arm=script2 run=$RUN_N"

pnpm --filter @v2/bench script-run -- --arm script2 --run "$RUN_N" --only Sakura

RUN_DIR="$(ls -dt "$RESULT_ROOT"/*-script2-"$RUN_N"-* 2>/dev/null | head -1)"
if [[ -z "$RUN_DIR" ]]; then
  echo "run ディレクトリが見つからん: $RESULT_ROOT/*-script2-$RUN_N-*" >&2
  exit 1
fi
echo "==> transcripts: $RUN_DIR"

CORE_JSONL="$REPORT_ROOT/core-check-script2-$RUN_N.jsonl"
pnpm --filter @v2/bench exec tsx src/fantasy-core-check.ts --dirs "$(pwd)/$RUN_DIR" | tee "$CORE_JSONL"
echo "==> core-check: $CORE_JSONL"

REPORT_HTML="$REPORT_ROOT/sakura-script2-$RUN_N.html"
python3 script/verify/build-conversation-html.py "$RUN_DIR" "$REPORT_HTML" "さくら script2-$RUN_N 会話"
echo "==> report: $REPORT_HTML"
