# Preflight Gates — 2026-05-15

| Gate | Status | Evidence |
|------|--------|----------|
| 0.1 dev server | PASS | `http://localhost:8788/api/me` -> 200, `http://localhost:5173/` started |
| 0.2 D1 migrations | PASS | Clean worktree D1 migration bug fixed in `drizzle/0002_lucky_magus.sql`; `wrangler d1 migrations list adult-ai-db --local` -> no migrations |
| 0.2 seed reset | PASS | `pnpm db:seed:reset` -> Characters: 65, Conversations: 43 |
| 0.2 R2 | PASS | `adult-ai-images` bucket listed |
| 0.3 Playwright | PASS | Chromium/WebKit/Firefox present per dry-run |
| Gate A OpenRouter quota | PASS | credits endpoint: total_credits=85, total_usage=50.63835115, remaining ~=34.36 |
| Gate B vendor latency | PASS | OpenRouter models 191ms, Novita model 321ms, Anthropic models 250ms |
| Gate C baseline rubric | PARTIAL | `gate-c-baseline-wt-20260515`: S1 completed raw 85, S4 aborted on image wait timeout, S7 completed raw 66.67 with phase regression. S4 was reworked through BUG-002/004/005/007/008. Latest live S4 `review-s4-9turn-quality-repeat-20260515` completed 9 turns with UI/D1 pass on every turn, image stages ok, creampie ok, and no failure taxonomy entries. Current scene judge replay on that manifest gives 9/9 phase matches and 0 monotonic violations. Still provisional because image reviewer sign-off is not recorded and S1/S7 full rerun remains outstanding. |
| Gate D Chrome/CDP | PASS | Chrome listening on `127.0.0.1:9222`; e2e can fall back to local launch |
| Gate E Claude session probe | PASS | `bash script/probe-anthropic.sh` -> HTTP 200 |
| Gate F all-fail degraded path | PENDING | Not run yet |
| Gate G mission scope sign-off | PENDING | Requires user choices |

Notes:
- The original plan text said `~/.claude-work/secrets/claude-session-keys.env` was the token source. Later session investigation corrected this: the valid OAuth access token comes from macOS Keychain service `Claude Code-credentials`.
- `script/e2e/run.ts` now supports `--turns=N`; the plan already depended on this flag, but it was missing.
- BUG-001 fixed a clean-D1 migration order failure where `0002_lucky_magus.sql` depended on `memory_note` before `0002_add_memory_note.sql` had run.
- BUG-002 fixed the E2E image probe: image-generation failure text now aborts the wait immediately, and R2 validation observes `/api/image/r2/...` network responses because UI images may render through blob URLs.
- BUG-004 fixed first-turn UI stream observation by installing the E2E stream probe before clicking Send.
- BUG-005 fixed OpenRouter fallback classification for "does not support endpoint" model errors.
- BUG-006 removed OpenRouter Claude usage from suggestions and live-verified `/api/suggestions`.
- BUG-007 tightened E2E scene phase detection and replay-verified latest S4 at 9/9 phase matches.
- BUG-008 fixed cross-turn repetition detection when previous assistant history is plain text rather than XML.
