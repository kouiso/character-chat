#!/usr/bin/env bash
set -euo pipefail

# GitHub-hosted runner (ubuntu-*/macos-*/windows-*) の直書きを禁止する。
#
# WHY: 2026年8月、org共有のGitHub Actions minutes無料枠(Free plan 2,000分/月)を使い切り、
# `ubuntu-latest` を指したジョブに runner が割り当たらず数秒で failure する状態になった
# (runner_id:0 / runner_name:"" が目印)。このリポでも fix-issue-headings が30連続で
# 落ちとった。org標準は変数経由で、無料枠を使い切った月だけ自動で Blacksmith へ
# 切り替わる仕組み(horsemanager の runner_budget_switch.yml)がある。
# 直書きはこの仕組みから外れ、切替の恩恵を受けられない。
#
# 許可される書き方:
#   runs-on: ${{ vars.RUNNER_LINUX || 'ubuntu-latest' }}
#   runs-on: ${{ vars.RUNNER_LINUX_4VCPU || 'blacksmith-4vcpu-ubuntu-2404' }}
#
# fallback に blacksmith を置いとるのは意図的。fallback が効くのは switch がまだ変数を
# 作ってへん時 = 枠の残量が分からん時で、そこで GitHub-hosted を指すと枠が尽きとる
# 状況で runner が割り当たらんため。
#
# 禁止される書き方 (エラー):
#   runs-on: ubuntu-latest / ubuntu-22.04 / macos-latest / windows-latest 等
#   上記が matrix.os 経由で使われる場合 (matrix定義内の `- os: ubuntu-latest` 等) も同様
#
# 例外 (ALLOWLIST): どうしても GitHub-hosted が必要な場合は下の ALLOWLIST_FILES に
# ファイル名を追記し、ワークフローファイル側にも理由をコメントで残すこと。

readonly WORKFLOW_DIR=".github/workflows"

# 例: ALLOWLIST_FILES=("release.yml")
readonly -a ALLOWLIST_FILES=()

is_allowlisted() {
  local basename="$1"
  local allowed
  for allowed in "${ALLOWLIST_FILES[@]:-}"; do
    [[ "${basename}" == "${allowed}" ]] && return 0
  done
  return 1
}

# 検査対象の行: `runs-on:` と、matrix定義内の `- os:` / `os:`。
#
# WHY: 以前は「行末までが裸のランナー名」という行全体アンカーで判定しとったが、
# `runs-on: ubuntu-latest  # 一時的` や `runs-on: "ubuntu-latest"`、
# `os: [ubuntu-latest, macos-latest]` を素通ししとった。どれも有効な YAML で、
# 実際に GitHub-hosted ランナーへ解決される。
# そこで「行から ${{ ... }} を取り除いた残りに裸のランナー名が残っとるか」で見る。
# 変数経由なら式ごと消えて何も残らんので、素通しでけへん。
readonly TARGET_LINE_PATTERN='^[[:space:]]*(-[[:space:]]+)?(runs-on|os):'
readonly GITHUB_HOSTED_PATTERN='(ubuntu|macos|windows)-[a-zA-Z0-9._]+'
readonly BLACKSMITH_NAME_PATTERN='blacksmith-[a-zA-Z0-9._-]+'

# GitHub Actions の式 ${{ ... }} を取り除いた残りを返す
strip_expressions() {
  printf '%s' "$1" | sed 's/\${{[^}]*}}//g'
}

errors=0
warnings=0

while IFS= read -r workflow; do
  basename_workflow="$(basename "${workflow}")"

  if is_allowlisted "${basename_workflow}"; then
    continue
  fi

  while IFS=: read -r lineno line; do
    bare="$(strip_expressions "${line}")"

    # blacksmith-2vcpu-ubuntu-2404 は名前に "ubuntu-2404" を含むため、
    # 先に blacksmith 名を取り除いてから GitHub-hosted を探す(誤検出防止)。
    if printf '%s' "${bare}" | grep -qE "${BLACKSMITH_NAME_PATTERN}"; then
      echo "::warning file=${workflow},line=${lineno}::blacksmith-* の直書きは動作する(課金対象外)が、\${{ vars.RUNNER_LINUX* }} 経由に揃えると無料枠に応じた自動切替の対象になる: ${line}"
      warnings=$((warnings + 1))
      bare="$(printf '%s' "${bare}" | sed -E "s/${BLACKSMITH_NAME_PATTERN}//g")"
    fi

    if printf '%s' "${bare}" | grep -qE "${GITHUB_HOSTED_PATTERN}"; then
      echo "::error file=${workflow},line=${lineno}::runs-on の直書きは禁止(無料枠を使い切った月に runner が割り当たらず落ちる、2026年8月の実例あり)。\${{ vars.RUNNER_LINUX || 'ubuntu-latest' }} 形式を使うこと: ${line}"
      errors=$((errors + 1))
    fi
  done < <(grep -nE "${TARGET_LINE_PATTERN}" "${workflow}" || true)

done < <(find "${WORKFLOW_DIR}" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)

echo "runner-hardcode-guard: errors=${errors} warnings=${warnings}"

if [ "${errors}" -gt 0 ]; then
  exit 1
fi
exit 0
