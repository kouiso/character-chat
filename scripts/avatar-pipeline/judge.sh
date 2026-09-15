#!/usr/bin/env bash
set -u

A_PATH=""
B_PATH=""
OUT_PATH=""
PROMPT_PATH=""

cleanup() {
  if [[ -n "${PROMPT_PATH:-}" && -f "$PROMPT_PATH" ]]; then
    rm -f "$PROMPT_PATH"
  fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --a)
      [ "$#" -lt 2 ] && { echo "missing value for --a"; exit 1; }
      A_PATH="$2"
      shift 2
      ;;
    --b)
      [ "$#" -lt 2 ] && { echo "missing value for --b"; exit 1; }
      B_PATH="$2"
      shift 2
      ;;
    --out)
      [ "$#" -lt 2 ] && { echo "missing value for --out"; exit 1; }
      OUT_PATH="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$A_PATH" || -z "$B_PATH" || -z "$OUT_PATH" ]]; then
  mkdir -p "$(dirname "$OUT_PATH")" 2>/dev/null || true
  echo '{"result":"FAIL","refinement_hint":"judge.sh usage error: --a --b --out are required"}' > "$OUT_PATH"
  exit 0
fi

PROMPT_PATH="/tmp/prompt-$$.txt"
{
  cat <<'EOF_PROMPT'
You are a strict anime avatar QA judge. Default-reject bias.
Evaluate the candidate image against the character text spec using this weighted 8-axis rubric:
- 髪 (hair): weight 3
- 衣装 (outfit): weight 3
- NSFW lean: weight 2
- 顔・年齢 (face/age consistency): weight 2
- 目 (eyes): weight 1
- 体型 (body type): weight 1
- 雰囲気 (mood/aura): weight 1
- art_quality: weight 2

Scoring: each axis 0..10 integer. weighted_avg = sum(score*weight)/15.
PASS only if weighted_avg >= 7.0 AND hair >= 6 AND outfit >= 6 AND art_quality >= 6.
Otherwise FAIL.

Few-shot anti-rubber-stamp guidance:
- Example 1: Good style but wrong hair color -> FAIL, hint focuses on exact hair color/length.
- Example 2: Correct hair/outfit but muddy rendering -> FAIL, hint focuses on line quality/eye clarity.
- Example 3: Strong all around with precise costume -> PASS, hint is minimal.

Return JSON only:
{"result":"PASS|FAIL","refinement_hint":"single concise actionable sentence"}

CharacterSpecJSON:
EOF_PROMPT
  cat "$A_PATH" 2>/dev/null || printf '{}\n'
  cat <<'EOF_PROMPT'

CandidateImageBase64PNG:
EOF_PROMPT
  base64 < "$B_PATH" | tr -d '\n' 2>/dev/null || true
  printf '\n'
} > "$PROMPT_PATH"

RAW="$(cd /tmp && claude --print --model claude-haiku-4-5-20251001 --output-format json < "$PROMPT_PATH" 2>/dev/null || true)"
RESULT="FAIL"
HINT="Judge invocation failed; refine hair/outfit fidelity and improve art quality."

if [[ -n "$RAW" ]]; then
  PARSED="$(printf '%s' "$RAW" | node -e '
let input="";
process.stdin.on("data",d=>input+=d);
process.stdin.on("end",()=>{
  try {
    const top = JSON.parse(input);
    const candidate = typeof top?.result === "string" ? JSON.parse(top.result) : top;
    const result = candidate?.result === "PASS" ? "PASS" : "FAIL";
    const hint = typeof candidate?.refinement_hint === "string" && candidate.refinement_hint.trim().length > 0
      ? candidate.refinement_hint.trim()
      : "Refine to match hair/outfit and improve clarity.";
    process.stdout.write(JSON.stringify({result, refinement_hint: hint}));
  } catch {
    process.stdout.write(JSON.stringify({result:"FAIL", refinement_hint:"Judge output parse error; tighten prompt-image consistency."}));
  }
});')"
  RESULT="$(printf '%s' "$PARSED" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.result);});')"
  HINT="$(printf '%s' "$PARSED" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.refinement_hint);});')"
fi

mkdir -p "$(dirname "$OUT_PATH")"
printf '{"result":"%s","refinement_hint":%s}\n' "$RESULT" "$(printf '%s' "$HINT" | node -p 'JSON.stringify(require("fs").readFileSync(0,"utf8"))')" > "$OUT_PATH"
exit 0
