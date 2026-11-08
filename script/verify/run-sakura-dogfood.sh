#!/usr/bin/env bash
# さくら台本ドッグフード一発実行: bench(script-run) → fantasy-core-check → HTMLレポート
# 使い方: script/verify/run-sakura-dogfood.sh [--run N]
set -euo pipefail
cd "$(dirname "$0")/../.."

RUN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN="${2:?--run に番号が要る}"; shift 2 ;;
    *) echo "不明な引数: $1" >&2; exit 2 ;;
  esac
done

# 実 API を叩くので、鍵が無い時点で早めに止める
if [[ -z "${OPENROUTER_API_KEY:-}" && -f apps/v2/.dev.vars ]]; then
  key="$(grep -E '^OPENROUTER_API_KEY=' apps/v2/.dev.vars | tail -1 | cut -d= -f2-)"
  export OPENROUTER_API_KEY="$key"
fi
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "OPENROUTER_API_KEY が未設定。課金 API を叩かないよう中断" >&2
  exit 1
fi

# --run 省略時は既存 run の次の連番
if [[ -z "$RUN" ]]; then
  last="$(ls -d .work/e2e-results/vlong-dogfood/*-script2-* 2>/dev/null \
    | sed -E 's/.*-script2-([0-9]+)-.*/\1/' | sort -n | tail -1)"
  RUN=$(( ${last:-0} + 1 ))
fi

pnpm --filter @v2/bench script-run -- --arm script2 --run "$RUN" --only Sakura

RUN_DIR="$(ls -dt .work/e2e-results/vlong-dogfood/*-script2-"$RUN"-* | head -1)"

JSON_OUT="$RUN_DIR/fantasy-core-check.jsonl"
( cd packages/bench && pnpm exec tsx src/fantasy-core-check.ts --dirs "../../$RUN_DIR" ) | tee "$JSON_OUT"

REPORT=".work/report/sakura-script2-${RUN}.html"
python3 script/verify/build-conversation-html.py "$RUN_DIR" "$REPORT" "さくら script2 run${RUN}"
echo "report: $REPORT"
