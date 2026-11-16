#!/usr/bin/env bash
# RIT-240: 計測の会話記録（生成済み本文）を公開 repo の git 管理下へ入れん、
# という判断（RIT-222）を push の前に確かめる検査。
# 「ignore 指定があるのに管理下にある」ファイルが .work/ 配下に1本でもあれば止める。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

bad=$(git ls-files -ci --exclude-standard -- .work/)
if [ -n "$bad" ]; then
  echo "error: .work/ の計測記録が git の管理下に入っとる（公開 repo へは入れん）:" >&2
  echo "$bad" >&2
  exit 1
fi
