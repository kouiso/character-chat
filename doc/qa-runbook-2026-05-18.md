# adult-ai-app — QA Runbook 2026-05-18

> **Purpose**: AI-self-testable verification procedure. A future AI (or human)
> can follow these steps verbatim and produce PASS/FAIL evidence without further
> instruction. Covers the top 5 critical paths.
>
> **Companion**: this runbook complements (not replaces) the narrow-scope
> `.work/qa/runbook-migration-gate.md`. When a path overlaps, the
> feature-specific runbook is authoritative for that path.

## 0. Prerequisites

| Prerequisite | Required for | How to verify |
|---|---|---|
| Branch checkout = `main` HEAD | All paths | `git rev-parse HEAD` matches `git ls-remote origin main` |
| `pnpm install --frozen-lockfile` ran successfully | Paths 1, 2, 3, 4 | `node_modules/.modules.yaml` exists |
| `pnpm exec wrangler whoami` shows OAuth login | Paths 1, 5 | Output contains `Account ID` (no `not logged in`) |
| 1Password CLI (`op`) reachable | Path 2 (OpenRouter key from vault) | `op whoami` after `set -a; source /Users/kouiso/ghq/getozinc/.envrc; set +a` |
| Cloudflare API token in env (read-only OK) | Path 4 verification | `echo $CLOUDFLARE_API_TOKEN \| wc -c` >= 40 (else GH secrets test only) |

Skip a path if its prerequisite fails — record SKIP in evidence file with reason.

## 1. Production deploy + auto-skip safety (deploy.yml graceful path)

### Startup
```bash
# Trigger an empty-commit deploy run from main
git checkout main && git pull origin main
git commit --allow-empty -m "qa-runbook: trigger deploy run verification"
git push origin main
# Capture the new run ID
RUN_ID=$(gh run list --repo kouiso/adult-ai-app --workflow Deploy --limit 1 --json databaseId --jq '.[0].databaseId')
echo "deploy run id: $RUN_ID"
```

### Verification items
| # | Check | Expected | FAIL condition |
|---|---|---|---|
| 1.1 | Run completes within 5 min | `gh run watch $RUN_ID --exit-status` exit code = 0 | exit ≠ 0 OR > 5 min |
| 1.2 | `deploy` job conclusion | `success` | any other value |
| 1.3 | If CF secrets absent: `check_secrets` step warning emitted | annotation contains `CLOUDFLARE_API_TOKEN ... 未設定` | no such warning |
| 1.4 | If CF secrets absent: build + pages deploy steps skipped | run log NOT contains `wrangler pages deploy` | log contains pages deploy AND secret was absent (= leak) |
| 1.5 | If CF secrets present: pages deploy completed | log contains `Deployment complete!` URL | absent OR error |
| 1.6 | `migrate_d1` job pause / completion | pause (if env `d1-migration` has reviewers) OR success skip (no secrets) — NEVER `failure` | conclusion=failure |

### Evidence destination
`.work/qa/evidence/run-$RUN_ID-deploy-2026-05-18.md` — paste:
- `gh run view $RUN_ID --json conclusion,jobs` output
- Cloudflare API deployment listing (`mcp__claude_ai_cloudflare__execute` or curl with token) for the latest `adult-ai-chat` Pages deployment, including `commit_hash` matching current main HEAD

### Completion gate
PASS only when items 1.1, 1.2, 1.6 are all PASS AND (1.3-1.4 or 1.5 per secret presence). Otherwise FAIL with item list.

---

## 2. Chat API end-to-end (OpenRouter → streaming response)

### Startup
```bash
# Start local dev (Cloudflare Pages Functions)
pnpm dev:worker > /tmp/qa-dev-worker.log 2>&1 &
sleep 8  # let wrangler boot
# Health probe
curl -s http://localhost:8788/api/health || echo "NOTE: no /api/health endpoint — skip probe"
```

### Verification items
| # | Check | Expected | FAIL condition |
|---|---|---|---|
| 2.1 | POST `/api/chat` with minimal payload returns stream | first byte within 10s | timeout >10s OR HTTP 5xx |
| 2.2 | Response includes assistant text (non-empty after parse) | XML/text chunk length >50 chars | empty OR all-whitespace |
| 2.3 | No `containsApologyLeak` triggered for safe prompt | response NOT contains `申し訳ござい` (when prompt is benign) | apology in safe path |
| 2.4 | refusal-detect retry path: NOT fired for single hedge in erotic phase (post #156) | only 1 LLM call per turn for single-hedge input | 2+ calls observed |
| 2.5 | OpenRouter usage delta visible | usage log row in D1 `usage_log` table for the turn | no row inserted |
| 2.6 | No secret leak in response body | response body NOT contain `OPENROUTER_API_KEY`, `Bearer sk-` | match found |

### Test prompts
```bash
PAYLOAD='{"messages":[{"role":"user","content":"こんにちは"}],"characterId":"char-yuzuki","responseLength":"short","safeMode":false}'
curl -sN -X POST http://localhost:8788/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d "$PAYLOAD" | head -c 4000 > /tmp/qa-chat-response.txt
```

### Evidence destination
`.work/qa/evidence/chat-2026-05-18.md` — paste first 4000 chars of response, D1 `SELECT * FROM usage_log ORDER BY created_at DESC LIMIT 3` output, wrangler log tail (last 50 lines).

### Completion gate
PASS only when 2.1, 2.2, 2.6 all PASS. Items 2.3-2.5 informational; failure logs reason but doesn't block.

---

## 3. Image generation (Novita → R2 → display)

### Startup
```bash
# Assumes Path 2 dev server already running. Otherwise restart.
ps aux | grep -E 'wrangler.*dev|pnpm.*dev:worker' | grep -v grep | head -1
# If absent: pnpm dev:worker &  (see Path 2)
```

### Verification items (async two-phase: init → poll → R2 fetch)
| # | Check | Expected | FAIL condition |
|---|---|---|---|
| 3.1 | POST `/api/image` returns `task_id` | response JSON has `task_id` string + echoed `prompt` | no `task_id` OR error status |
| 3.2 | Poll `/api/image/task-result?task_id=<id>` until ready (max 60s) | response shape eventually contains image data / r2 url field per `novitaTaskResultSchema` | timeout >60s OR status=failed |
| 3.3 | Save result to R2 + retrieve via `/api/image/r2/<key>` | HTTP GET returns 2xx, Content-Type starts with `image/` | 4xx, 5xx, non-image type |
| 3.4 | R2 bucket has new `images/<uuid>.<ext>` entry | listing diff vs pre-step shows +1 (CF API list with prefix `images/`) | no new entry |
| 3.5 | Phase-aware params honored | request `phase` field round-trips into response prompt (`novitaPrompt` shows phase-tier tags) | params not phase-tier appropriate |
| 3.6 | No NSFW leak in alt text / metadata | response JSON fields don't contain raw uncensored explicit tokens beyond what `phaseGuardrails` allows | leak detected |

### Test prompt (matches current `imageSchema` at functions/api/[[route]].ts:143)
```bash
IMG_PAYLOAD='{"prompt":"1girl, solo, living room daytime, smiling","characterDescription":"yuzuki, brown hair","width":768,"height":1024,"phase":"conversation"}'
INIT=$(curl -s -X POST http://localhost:8788/api/image \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d "$IMG_PAYLOAD")
echo "$INIT" > /tmp/qa-image-init.json
TASK_ID=$(echo "$INIT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("task_id",""))')
echo "TASK_ID=$TASK_ID"
# Poll
for i in $(seq 1 30); do
  RESULT=$(curl -s "http://localhost:8788/api/image/task-result?task_id=$TASK_ID" -H "Authorization: Bearer test")
  echo "[$i] $RESULT" | head -c 400
  if echo "$RESULT" | grep -q '"image_url"\|"images"\|"output"'; then break; fi
  sleep 2
done > /tmp/qa-image-result.json 2>&1
```

### Evidence destination
`.work/qa/evidence/image-2026-05-18.md` — JSON response, R2 listing before/after (use `mcp__claude_ai_cloudflare__execute` with bucket `adult-ai-images` prefix `images/`), one PNG header hex dump (`xxd /tmp/img.png | head -3`).

### Completion gate
PASS when 3.1, 3.2, 3.3 all PASS. 3.4-3.5 informational.

---

## 4. Cloudflare Access auth (302 unauthenticated, 200 authenticated)

### Startup
```bash
# No dev server needed — hit production directly
PROD=https://adult-ai-chat.pages.dev
```

### Verification items
| # | Check | Expected | FAIL condition |
|---|---|---|---|
| 4.1 | Unauthenticated GET `/` returns 302 redirect to CF Access challenge | HTTP 302, `Location` header contains `cloudflareaccess.com` | 200 (auth bypass!) or 404/5xx |
| 4.2 | Unauthenticated POST `/api/chat` returns 302 | same as 4.1 | 200 (API auth bypass!) or 500 |
| 4.3 | With valid `CF_Authorization` cookie/JWT: 200 | needs interactive token capture (browser session export) — record SKIP if not available | leaked path bypasses auth |
| 4.4 | JWT/bearer verification grep finds canonical helpers in current code | `grep -nE 'CF-Access-JWT-Assertion\|verifyBearer' functions/api/'[[route]].ts'` returns ≥2 hits (one for CF Access header read, one for bearer compare) | grep finds 0 hits = auth surface gone |

### Evidence destination
`.work/qa/evidence/auth-2026-05-18.md` — `mcp__claude_ai_cloudflare__execute` results for steps 4.1 and 4.2 (or curl via Bash if MCP unavailable). For 4.4: paste the grep command output from current `main` HEAD.

### Completion gate
PASS when 4.1, 4.2, 4.4 PASS. 4.3 informational (token capture is non-trivial).

---

## 5. D1 schema + avatar serving integrity

### Startup
```bash
# Read-only D1 queries; no mutation
pnpm exec wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" --json > /tmp/qa-d1-tables.json
```

### Verification items
| # | Check | Expected | FAIL condition |
|---|---|---|---|
| 5.1 | All migrations 0001..0020 applied | `pnpm exec wrangler d1 migrations list DB --remote` shows no `[ ]` (unapplied) | any `[ ]` present |
| 5.2 | `character` row count = 189 (or matches deployed) | `SELECT COUNT(*) FROM character;` JSON has `total: 189` (±5 acceptable drift) | order-of-magnitude different |
| 5.3 | All wired avatars (`SELECT avatar ... WHERE avatar LIKE '/avatars/%'`) file-exist | join via python: every path → `public/avatars/<filename>` is a file | any missing path |
| 5.4 | R2 bucket `adult-ai-images` reachable + has `images/` prefix populated | CF API list returns ≥1 entry | empty or 401 |
| 5.5 | No `http_url` avatar drift | `SUM(CASE WHEN avatar LIKE 'http%' THEN 1)` = 0 | nonzero (= avatar moved to CDN unexpectedly) |
| 5.6 | NULL-avatar count breakdown matches expected pattern | `SELECT COUNT(*) FROM character WHERE avatar IS NULL OR avatar=''` returns 121 (±10) — and is fully accounted by `charap_likely + saylo_likely` | unaccounted NULL chars |

### Evidence destination
`.work/qa/evidence/d1-2026-05-18.md` — copy JSON outputs of:
- `wrangler d1 migrations list DB --remote`
- 5.2 (`COUNT(*)`)
- 5.3 (join script result, similar to existing `.work/audit/evidence/d1-wired-vs-filesystem-join.json`)
- 5.4 (CF API R2 listing)
- 5.5, 5.6 (single query each)

### Completion gate
PASS when 5.1, 5.3, 5.4 all PASS. 5.2, 5.5, 5.6 informational.

---

## 6. Completion gate (whole runbook)

Overall PASS requires:
- Path 1 (deploy) PASS
- Path 4 (auth) PASS
- Path 5 (D1+avatar) PASS

Paths 2 (chat) and 3 (image) are FUNCTIONAL gates — FAIL on these means product
broken, but infra integrity (1/4/5) is the structural gate.

Save aggregated evidence:
```bash
mkdir -p .work/qa/evidence
# After all paths run, write a summary:
cat > .work/qa/evidence/SUMMARY-2026-05-18.md <<EOF
# QA Runbook Run — 2026-05-18 — <UTC timestamp>
- Operator: <AI name or human>
- HEAD: $(git rev-parse HEAD)

| Path | Status | Evidence file |
|------|--------|---------------|
| 1 deploy | PASS / FAIL / SKIP | run-<RUN_ID>-deploy-2026-05-18.md |
| 2 chat | ... | chat-2026-05-18.md |
| 3 image | ... | image-2026-05-18.md |
| 4 auth | ... | auth-2026-05-18.md |
| 5 d1 | ... | d1-2026-05-18.md |
EOF
```

Commit evidence to a branch `qa/run-YYYY-MM-DD-<short-hash>` and open a PR titled
`qa: runbook run YYYY-MM-DD PASS|FAIL` so traceability is preserved.

## 7. Failure handling

When any check fails:
1. Do NOT mark "DONE" — record FAIL with exact symptom + expected vs actual
2. Open a GH issue describing the gap (per universal pipeline)
3. If trivial fix (≤ 1 file, ≤ 10 LOC, low risk), open PR same session; otherwise queue for next session

NEVER suppress a failing check to make the runbook green.
NEVER skip an entire path without an evidence file recording the SKIP reason.

## 8. Maintenance

This runbook is dated. Update when:
- New critical path emerges (e.g. payment flow added → add Path 6)
- An existing path's verification command changes (e.g. endpoint renamed)
- A FAIL pattern recurs across runs (add it as a named check item)

Mark stale runbook with `> SUPERSEDED-BY: doc/qa-runbook-YYYY-MM-DD.md` at top.
