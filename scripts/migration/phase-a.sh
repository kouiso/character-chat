#!/usr/bin/env bash
# Phase A: scripted charap profile capture for migration v4.
# - Per char: search → disambiguate via D1 system_prompt prefix → screenshot → crop overlay-removed → save.
# - ADB は macmini 経由で実行（WSL から ssh）。
# - Resume 対応: profile.png 既存なら skip。Ambiguity は `.escalate` で後回し。

set -u
set -o pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
D1_CHARS="${D1_CHARS:-/tmp/d1-chars.json}"
ORIGINALS="${ORIGINALS:-/tmp/originals}"
PROGRESS="${PROGRESS:-/tmp/migration-manager.progress.json}"
LOG="${LOG:-/tmp/migration-manager.log}"
SSH_HOST="${SSH_HOST:-macmini-lan}"
DEVICE_SERIAL="${DEVICE_SERIAL:-2A091FDH300C0J}"
APP_PKG="${APP_PKG:-jp.wrtn.character}"

# Probe-confirmed coords (1080x2340 portrait).
SEARCH_ICON_X=830;  SEARCH_ICON_Y=195
SEARCH_FIELD_X=545; SEARCH_FIELD_Y=192
CLEAR_X_X=895;      CLEAR_X_Y=193

LIMIT="${LIMIT:-0}"   # 0 = no limit. e.g., LIMIT=1 for smoke test.
ONLY_ID="${ONLY_ID:-}"

mkdir -p "$ORIGINALS"
[ -f "$PROGRESS" ] || echo '{"done":[],"escalated":[],"failed":[]}' > "$PROGRESS"

log() { printf '[phase-a %s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }

# Remote helper that runs on macmini: search → dump → tap row → screenshot → pull.
# Args: search_name(no spaces, ≤8 chars) prefix_for_match(<=80 chars escaped) out_dir(remote)
# NOTE: SEARCH_NAME and PREFIX are passed base64-encoded via env to survive zsh on macmini
#       (default macOS shell is zsh and bare env vars with spaces or 【】 break the remote command line).
# Emits status on stdout:
#   STATUS=OK ROW_BOUNDS=... ROW_DESC="..."
#   STATUS=AMBIGUOUS
#   STATUS=NO_HIT
#   STATUS=FAIL reason=...
run_remote_capture() {
  local search_name="$1"
  local prefix="$2"
  local out_dir="$3"

  local sn_b64 pf_b64
  sn_b64=$(printf '%s' "$search_name" | base64 -w0)
  pf_b64=$(printf '%s' "$prefix" | base64 -w0)

  ssh "$SSH_HOST" \
    SEARCH_NAME_B64="$sn_b64" \
    PREFIX_B64="$pf_b64" \
    OUT_DIR="$out_dir" \
    APP_PKG="$APP_PKG" \
    DEVICE_SERIAL="$DEVICE_SERIAL" \
    SEARCH_ICON_X=$SEARCH_ICON_X SEARCH_ICON_Y=$SEARCH_ICON_Y \
    SEARCH_FIELD_X=$SEARCH_FIELD_X SEARCH_FIELD_Y=$SEARCH_FIELD_Y \
    CLEAR_X_X=$CLEAR_X_X CLEAR_X_Y=$CLEAR_X_Y \
    'bash -s' <<'REMOTE'
set -u
# NOTE: `adb shell` over an ssh-heredoc inherits the (now-consumed) heredoc stdin and exits early
#       when called inside `$(...)` capture. `exec 0</dev/null` is NOT enough; each `adb` call
#       must explicitly redirect stdin from /dev/null. Wrap with a helper.
ADB_RAW="adb -s $DEVICE_SERIAL"
adb_run() { $ADB_RAW "$@" </dev/null; }
mkdir -p "$OUT_DIR"
SEARCH_NAME=$(printf '%s' "$SEARCH_NAME_B64" | base64 -D 2>/dev/null || printf '%s' "$SEARCH_NAME_B64" | base64 -d)
PREFIX=$(printf '%s' "$PREFIX_B64" | base64 -D 2>/dev/null || printf '%s' "$PREFIX_B64" | base64 -d)

# Ensure charap is in foreground (over-eager back keyevents from a previous run can exit the app).
CURRENT_FOCUS=$(adb_run shell dumpsys window | grep mCurrentFocus | head -1)
if ! echo "$CURRENT_FOCUS" | grep -q "$APP_PKG"; then
  adb_run shell am start -n "$APP_PKG/.MainActivity" >/dev/null
  sleep 2.5
fi

# 0) Ensure app is at home tab; tap search icon.
adb_run shell input tap $SEARCH_ICON_X $SEARCH_ICON_Y
sleep 1
# Tap field then clear ×; if × not present that's fine.
adb_run shell input tap $SEARCH_FIELD_X $SEARCH_FIELD_Y
sleep 0.4
adb_run shell input tap $CLEAR_X_X $CLEAR_X_Y
sleep 0.4
adb_run shell input tap $SEARCH_FIELD_X $SEARCH_FIELD_Y
sleep 0.4

# 1) Type via ADBKeyboard broadcast.
adb_run shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb_run shell am broadcast -a ADB_INPUT_TEXT --es msg "$SEARCH_NAME" >/dev/null
sleep 0.5
adb_run shell input keyevent 66   # ENTER
sleep 2.2

# 2) Dump UI.
adb_run shell uiautomator dump /sdcard/dump.xml >/dev/null
adb_run pull /sdcard/dump.xml "$OUT_DIR/search-dump.xml" >/dev/null

# 3) Take search screenshot as evidence.
adb_run shell screencap -p /sdcard/search.png
adb_run pull /sdcard/search.png "$OUT_DIR/search.png" >/dev/null

# 4) Disambiguate via python: name-anchor match + body similarity.
python3 - "$OUT_DIR/search-dump.xml" "$PREFIX" <<'PY'
import sys, re, xml.etree.ElementTree as ET
from difflib import SequenceMatcher

xml_path, prefix = sys.argv[1], sys.argv[2]
# prefix layout: "{name} {body...}". Recover name (greedy until first space or 30 chars).
prefix_parts = prefix.split(' ', 1)
target_name = prefix_parts[0][:40]
target_body = prefix_parts[1] if len(prefix_parts) > 1 else ''

tree = ET.parse(xml_path)
candidates = []  # (text, bounds)
for node in tree.iter():
    a = node.attrib
    txt = (a.get("text") or "").strip()
    desc = (a.get("content-desc") or "").strip()
    bounds = a.get("bounds") or ""
    s = txt if len(txt) > len(desc) else desc
    if not s or not bounds or len(s) < 6:
        continue
    candidates.append((s, bounds))

def w(b):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
    if not m: return 0
    x1,y1,x2,y2 = map(int, m.groups())
    return x2-x1

def y_top(b):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
    if not m: return 0
    return int(m.group(2))

# Character card rows: width > 700. They typically read "{name}, {subtitle}, {tags...}".
rows = [c for c in candidates if w(c[1]) > 700]
if not rows:
    rows = candidates

# Dedupe by bounds-top (multiple text nodes per row may share the same top y).
seen_tops = set()
uniq = []
for s, b in rows:
    t = y_top(b)
    # Quantize by 50px to merge adjacent fragments of the same row.
    bucket = t // 50
    if bucket in seen_tops:
        # Keep the longer text in same bucket.
        for i, (us, ub) in enumerate(uniq):
            if y_top(ub) // 50 == bucket:
                if len(s) > len(us):
                    uniq[i] = (s, b)
                break
    else:
        seen_tops.add(bucket)
        uniq.append((s, b))

# Score each row: (name_match_score, body_similarity).
def score_row(row_text):
    name_score = 0.0
    # Exact name as prefix of row → very strong.
    if row_text.startswith(target_name):
        name_score = 1.0
    elif target_name in row_text[:60]:
        name_score = 0.7
    body_score = SequenceMatcher(None, row_text[:300], target_body[:300]).ratio() if target_body else 0.0
    return name_score, body_score, name_score * 0.7 + body_score * 0.3

scored = []
for s, b in uniq:
    ns, bs, total = score_row(s)
    scored.append((total, ns, bs, s, b))
scored.sort(reverse=True)

if not scored:
    print("STATUS=NO_HIT")
    sys.exit(0)

best = scored[0]
second = scored[1] if len(scored) > 1 else (0, 0, 0, '', '')

# Acceptance rules:
# 1) Strong name match (>=0.7) AND gap >= 0.15 from second → OK.
# 2) Best total >= 0.55 AND gap >= 0.10 → OK.
# 3) Otherwise AMBIGUOUS or NO_HIT.
best_total, best_name, best_body, best_s, best_b = best
gap = best_total - second[0]

decision = None
if best_name >= 0.7 and gap >= 0.15:
    decision = "OK"
elif best_total >= 0.55 and gap >= 0.10:
    decision = "OK"
elif best_total < 0.30:
    decision = "NO_HIT"
else:
    decision = "AMBIGUOUS"

if decision == "OK":
    print("STATUS=OK TOTAL=%.2f NAME=%.2f BODY=%.2f BOUNDS=%s" % (best_total, best_name, best_body, best_b))
    print("ROW_DESC=%s" % best_s[:100].replace("\n"," "))
elif decision == "NO_HIT":
    print("STATUS=NO_HIT BEST=%.2f" % best_total)
else:
    print("STATUS=AMBIGUOUS BEST=%.2f SECOND=%.2f" % (best_total, second[0]))
    print("BEST_DESC=%s" % best_s[:100].replace("\n"," "))
PY
PY_EXIT=$?
if [ "$PY_EXIT" -ne 0 ]; then
  echo "STATUS=FAIL reason=python_disambiguator_exit_$PY_EXIT"
  exit 0
fi
REMOTE
}

# Tap row + capture detail. Bounds string like [0,200][1080,400]
run_remote_tap_and_crop() {
  local bounds="$1"
  local out_dir="$2"
  # Parse center.
  local cx cy
  read -r cx cy <<<"$(python3 -c "
import re,sys
m=re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', '$bounds')
x1,y1,x2,y2=map(int,m.groups())
print((x1+x2)//2, (y1+y2)//2)
")"

  ssh "$SSH_HOST" \
    CX="$cx" CY="$cy" OUT_DIR="$out_dir" DEVICE_SERIAL="$DEVICE_SERIAL" \
    'bash -s' <<'REMOTE'
set -u
ADB_RAW="adb -s $DEVICE_SERIAL"
adb_run() { $ADB_RAW "$@" </dev/null; }
adb_run shell input tap $CX $CY
sleep 2.5
adb_run shell uiautomator dump /sdcard/detail.xml >/dev/null
adb_run pull /sdcard/detail.xml "$OUT_DIR/detail-dump.xml" >/dev/null
adb_run shell screencap -p /sdcard/detail.png
adb_run pull /sdcard/detail.png "$OUT_DIR/detail-full.png" >/dev/null
# Crop overlay-removed: 1080x880+0+384 (overlay sits in bottom 200px of the 1080x1080 avatar region — verified by Opus 2026-05-17).
convert "$OUT_DIR/detail-full.png" -crop 1080x880+0+384 +repage "$OUT_DIR/profile.png"
# Back once to return to search list.
adb_run shell input keyevent 4
sleep 0.5
REMOTE
}

# Sanitize name for search: drop punctuation, keep first 8 chars.
sanitize_search_name() {
  python3 - <<PY "$1"
import sys, re
s = sys.argv[1]
# Strip common Japanese punctuation and quotation.
s = re.sub(r'[…\.\!?！？、。「」『』〜～・,，:;]', '', s)
s = s.strip()
print(s[:8])
PY
}

update_progress() {
  local id="$1" key="$2"
  python3 - "$PROGRESS" "$id" "$key" <<'PY'
import json, sys
path, cid, key = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f: data = json.load(f)
if cid not in data[key]:
    data[key].append(cid)
with open(path, 'w') as f: json.dump(data, f, ensure_ascii=False)
PY
}

main() {
  log "Phase A start. D1_CHARS=$D1_CHARS LIMIT=$LIMIT ONLY_ID=${ONLY_ID:-(all)}"

  local count=0
  while IFS=$'\t' read -r id name sys_prompt; do
    [ -n "$ONLY_ID" ] && [ "$id" != "$ONLY_ID" ] && continue

    local out_dir="$ORIGINALS/$id"
    mkdir -p "$out_dir"

    if [ -f "$out_dir/profile.png" ]; then
      log "SKIP $id (profile.png exists)"
      update_progress "$id" "done"
      count=$((count+1))
      [ "$LIMIT" -gt 0 ] && [ "$count" -ge "$LIMIT" ] && break
      continue
    fi

    local search_name
    search_name=$(sanitize_search_name "$name")
    if [ -z "$search_name" ]; then
      log "FAIL $id reason=empty_search_name name='$name'"
      update_progress "$id" "failed"
      continue
    fi

    # Prefix for similarity match: name + first ~120 chars of system_prompt body (post-header).
    # We pass name first because the search-result row begins with the char name, giving a strong anchor.
    local prefix
    prefix=$(python3 - <<PY "$name" "$sys_prompt"
import sys, re
name = sys.argv[1]
sp = sys.argv[2].replace('\n', ' ')
# Strip the 【キャラクター】 header block so similarity focuses on body content.
body = re.sub(r'^.*?【設定】\s*', '', sp)
print(name + ' ' + body[:120])
PY
)

    log "PROCESS $id name='$name' search='$search_name'"

    local capture_out
    capture_out=$(run_remote_capture "$search_name" "$prefix" "$out_dir" 2>&1)
    # DEBUG: dump raw output to per-char file for first-failure investigation.
    echo "$capture_out" > "$out_dir/_raw-capture.log"
    local status
    status=$(echo "$capture_out" | grep -E '^STATUS=' | head -1 || true)

    case "$status" in
      STATUS=OK*)
        local bounds
        bounds=$(echo "$capture_out" | grep -oE 'BOUNDS=\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | sed 's/^BOUNDS=//')
        if [ -z "$bounds" ]; then
          log "FAIL $id reason=no_bounds_in_ok_response"
          echo "no_bounds" > "$out_dir/.escalate"
          update_progress "$id" "escalated"
          continue
        fi
        log "  -> match bounds=$bounds, tapping…"
        run_remote_tap_and_crop "$bounds" "$out_dir" >>"$LOG" 2>&1
        # Files were written on the macmini (where adb runs) — pull them back to WSL.
        scp -q "$SSH_HOST:$out_dir/profile.png" "$out_dir/profile.png" 2>>"$LOG" || true
        scp -q "$SSH_HOST:$out_dir/detail-full.png" "$out_dir/detail-full.png" 2>>"$LOG" || true
        scp -q "$SSH_HOST:$out_dir/detail-dump.xml" "$out_dir/detail-dump.xml" 2>>"$LOG" || true
        if [ -f "$out_dir/profile.png" ]; then
          log "  -> OK $id profile saved ($(identify -format '%wx%h' "$out_dir/profile.png" 2>/dev/null || echo unknown))"
          update_progress "$id" "done"
        else
          log "FAIL $id reason=crop_did_not_produce_profile (scp from macmini failed)"
          echo "crop_failed" > "$out_dir/.escalate"
          update_progress "$id" "escalated"
        fi
        ;;
      STATUS=AMBIGUOUS*)
        # Pull the search dump + screenshot so a later Opus pass can resolve.
        scp -q "$SSH_HOST:$out_dir/search.png" "$out_dir/search.png" 2>>"$LOG" || true
        scp -q "$SSH_HOST:$out_dir/search-dump.xml" "$out_dir/search-dump.xml" 2>>"$LOG" || true
        log "  -> AMBIGUOUS $id ($status). Marking .escalate"
        echo "$status" > "$out_dir/.escalate"
        update_progress "$id" "escalated"
        ;;
      STATUS=NO_HIT*)
        log "  -> NO_HIT $id ($status). Marking .escalate"
        echo "$status" > "$out_dir/.escalate"
        update_progress "$id" "escalated"
        ;;
      *)
        log "  -> UNKNOWN status for $id: $status. Marking .escalate"
        echo "${status:-no_status}" > "$out_dir/.escalate"
        update_progress "$id" "escalated"
        ;;
    esac

    count=$((count+1))
    [ "$LIMIT" -gt 0 ] && [ "$count" -ge "$LIMIT" ] && break
  done < <(python3 -c "
import json, sys
data = json.load(open('$D1_CHARS'))
try:
    for r in data:
        print('{}\t{}\t{}'.format(r['id'], r['name'], (r.get('system_prompt') or '').replace('\n',' ').replace('\t',' ')))
except BrokenPipeError:
    sys.stderr.close()
")

  log "Phase A done. Counted $count chars."
  python3 -c "
import json
d = json.load(open('$PROGRESS'))
print('progress: done=%d escalated=%d failed=%d' % (len(d['done']), len(d['escalated']), len(d['failed'])))
" | tee -a "$LOG"
}

main "$@"
