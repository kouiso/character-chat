# Bug Log — QA v3 2026-05-15

## Template

```
### BUG-NNN
- **Severity**: P0 / P1 / P2 / P3
- **Surface**: PC 1280px / Tablet 768px / SP 390px / SP 375px / SP narrow 360px / Real iPhone / Real Android / Firefox / Samsung Internet
- **Fidelity**: [Real-device] / [CDP-interactive] / [Playwright-snapshot] / [Static] / [Code-Read]
- **Provider**: anthropic / openrouter / novita / local-only / n/a
- **Origin**: 8788 (wrangler) / 5173 (vite) / both
- **Screen**: [screen name, e.g. Chat / Settings / Web Portal / Moments]
- **Repro**:
  1.
  2.
  3.
- **Expected**:
- **Actual**:
- **Root cause**:
- **Fix**: `file:line`
- **Re-verify**: surface ✅ [fidelity tag] screenshot path
- **Commit**: `<sha>`
- **Status**: Open / Fixed ✅ / Deferred → Issue #NNN
```

---

## Bugs

### BUG-001
- **Severity**: P0
- **Surface**: Local clean D1 / QA setup
- **Fidelity**: [Static] + [Command]
- **Provider**: local-only
- **Origin**: 8788 (wrangler)
- **Screen**: n/a
- **Repro**:
  1. In a clean worktree, run `rm -rf .wrangler/state/v3/d1`
  2. Run `pnpm db:migrate:local`
  3. Observe `0002_lucky_magus.sql` runs before `0002_add_memory_note.sql`
- **Expected**: Clean local D1 applies all migrations successfully.
- **Actual**: Migration failed with `no such table: memory_note`.
- **Root cause**: `0002_lucky_magus.sql` depended on `memory_note`, but wrangler did not reliably apply same-number `0002_*` files in the intended order.
- **Fix**: `drizzle/0002_lucky_magus.sql` no longer rewrites `memory_note`; it only adds `character.visual_prompt`.
- **Re-verify**: `rm -rf .wrangler/state/v3/d1 && pnpm db:migrate:local && pnpm db:seed:reset` ✅, `pnpm exec wrangler d1 migrations list adult-ai-db --local` -> no migrations ✅
- **Commit**: `<pending>`
- **Status**: Fixed ✅

### BUG-002
- **Severity**: P0
- **Surface**: E2E baseline / PC 1280px
- **Fidelity**: [Playwright-snapshot]
- **Provider**: novita / local-only
- **Origin**: 8788 (wrangler)
- **Screen**: Chat image generation
- **Repro**:
  1. Run `E2E_RUN_ID=gate-c-baseline-wt-20260515 E2E_MAX_TABS=1 pnpm exec tsx script/e2e/run.ts --scenarios=S1,S4,S7 --turns=15 --judge=haiku`
  2. Observe S4 aborts on turn 9.
- **Expected**: Image turn either renders a generated image or fails with a bounded, classified app/test error and continues/records cleanly.
- **Actual**: `locator.waitFor: Timeout 120000ms exceeded` while waiting for `img[alt="Generated"]`.
- **Root cause**: E2E waited only for an image element and did not watch for terminal image-generation failure text. Separately, R2 validation watched `img.src`, but `message-bubble` fetches `/api/image/r2/...` and renders a blob URL, so the R2 swap can be missed even when R2 persistence succeeds.
- **Fix**: `script/e2e/judges/r2-persistence.ts` now races initial image visibility against known failure messages, and treats observed `/api/image/r2/...` network responses as R2 persistence evidence.
- **Re-verify**: `E2E_RUN_ID=review-s4-9turn-quality-repeat-20260515 E2E_MAX_TABS=1 pnpm exec tsx script/e2e/run.ts --scenarios=S4 --turns=9 --judge=haiku` ✅. S4 completed, `novitaUrlReceived=true`, `r2KeyPersisted=true`, `reloadDisplayed=true`, `contentType=image/jpeg`.
- **Commit**: `<pending>`
- **Status**: Fixed ✅

### BUG-003
- **Severity**: P1
- **Surface**: E2E baseline / PC 1280px
- **Fidelity**: [Playwright-snapshot]
- **Provider**: openrouter / anthropic
- **Origin**: 8788 (wrangler)
- **Screen**: Chat quality
- **Repro**:
  1. Run Gate C baseline S1/S4/S7 with `--turns=15 --judge=haiku`.
  2. Inspect `run-manifest.json` and worker logs.
- **Expected**: Expected phase and detected phase remain aligned; quality retry should recover from judge failures without returning the last failed attempt as normal.
- **Actual**: S7 completed with `sceneAlignment=6.67`, `escalationNaturalness=0`, last turn expected `conversation` but detected `erotic` with `phaseMonotonicViolation=true`. Worker logs show repeated `AGENCY`, `EXPLICIT`, `wrong-first-person`, `cross-turn-repetition`, and `meta_remark` failures followed by "returning last attempt after 1 retries".
- **Root cause**: Partially identified. Server retry hints did not normalize `claude-judge: ...` dynamic failure reasons, so Claude judge failures received only generic retry guidance instead of the stronger AGENCY/EXPLICIT instruction. Retry exhaustion still returns the last failed attempt with `x-quality-warning: 1`, so more work is required.
- **Fix**: `functions/api/[[route]].ts` now maps `claude-judge:` failures to a dedicated `claude-judge-fail` retry hint.
- **Re-verify**: `pnpm build` ✅. Full quality re-run still needed after BUG-005; `gate-c-s4-quality-hint-20260515` is not valid for comparison because OpenRouter model endpoint 400/502 polluted turns 2-9.
- **Commit**: `<pending>`
- **Status**: Partial Fix ⚠️ (retry-hint normalization only; retry-exhaustion behavior is unchanged and tracked separately as BUG-009)

### BUG-004
- **Severity**: P1
- **Surface**: E2E baseline / PC 1280px
- **Fidelity**: [Playwright-snapshot]
- **Provider**: openrouter / local-only
- **Origin**: 8788 (wrangler)
- **Screen**: Chat streaming
- **Repro**:
  1. Run `E2E_RUN_ID=gate-c-s4-r2-observed-20260515 E2E_MAX_TABS=1 pnpm exec tsx script/e2e/run.ts --scenarios=S4 --turns=9 --judge=haiku`.
  2. Inspect turn 1 UI judge.
- **Expected**: First turn observes `[DONE]` and passes UI streaming judge.
- **Actual**: Turn 1 can record `hasDoneSignal=false`, causing aggregate UI failure.
- **Root cause**: The E2E stream probe was installed by `waitForStreamComplete`, which ran after clicking Send and waiting for message count. On the first turn, this could miss the `/api/chat` fetch entirely.
- **Fix**: `script/e2e/browser-wait.ts` exports `ensureStreamProbe`, and `script/e2e/scenario-runner.ts` installs it before filling/clicking Send.
- **Re-verify**: `E2E_RUN_ID=gate-c-ui-probe-preinstall-20260515 E2E_MAX_TABS=1 pnpm exec tsx script/e2e/run.ts --scenarios=S4 --turns=1 --judge=haiku` ✅. Turn 1 `hasDoneSignal=true`, UI judge passed.
- **Commit**: `<pending>`
- **Status**: Fixed ✅

### BUG-005
- **Severity**: P1
- **Surface**: E2E / PC 1280px / Chat API
- **Fidelity**: [Playwright-snapshot] + [Command]
- **Provider**: openrouter
- **Origin**: 8788 (wrangler)
- **Screen**: Chat streaming
- **Repro**:
  1. Run `E2E_RUN_ID=gate-c-s4-quality-hint-20260515 E2E_MAX_TABS=1 pnpm exec tsx script/e2e/run.ts --scenarios=S4 --turns=9 --judge=haiku`.
  2. Observe repeated `/api/chat` 502s after OpenRouter returns a 400 for the default model.
- **Expected**: If OpenRouter reports the selected model does not support the requested endpoint, the chat router should fall back to the next configured model.
- **Actual**: Response text `model: qwen/qwen-2.5-72b-instruct does not support endpoint: completions` was not classified as fallback-worthy, so `/api/chat` returned 502 and E2E recorded empty assistant turns.
- **Root cause**: `MODEL_FALLBACK_PATTERNS` did not include OpenRouter's "does not support endpoint" error wording.
- **Fix**: `functions/api/[[route]].ts` adds `/does not support endpoint/i` to fallback patterns.
- **Re-verify**: live `/api/chat` probe returned 200 with `x-model-used=deepseek/deepseek-chat` after qwen endpoint 400 fallback ✅; S4 E2E `review-s4-9turn-quality-repeat-20260515` completed with model drift recorded instead of aborting ✅.
- **Commit**: `<pending>`
- **Status**: Fixed ✅

### BUG-006
- **Severity**: P1
- **Surface**: Chat API / Suggestions
- **Fidelity**: [Code-Read] + [Command]
- **Provider**: openrouter
- **Origin**: 8788 (wrangler)
- **Screen**: Suggestions
- **Repro**:
  1. Inspect `functions/api/[[route]].ts`.
  2. Observe suggestions used `anthropic/claude-haiku-4-5` through OpenRouter.
- **Expected**: Claude usage must go through Claude Code OAuth session token only; no OpenRouter Claude fallback.
- **Actual**: Suggestions could spend OpenRouter Claude credits.
- **Root cause**: `SUGGESTION_MODEL` still pointed at an OpenRouter Claude model after chat routing had been changed.
- **Fix**: `functions/api/[[route]].ts` now uses `deepseek/deepseek-chat` for suggestions.
- **Re-verify**: live `/api/suggestions` probe returned 200 with suggestions JSON ✅.
- **Commit**: `<pending>`
- **Status**: Fixed ✅

### BUG-007
- **Severity**: P1
- **Surface**: E2E / PC 1280px
- **Fidelity**: [Playwright-snapshot] + [Unit]
- **Provider**: local-only
- **Origin**: 8788 (wrangler)
- **Screen**: E2E rubric / scene phase
- **Repro**:
  1. Run S4 9-turn E2E.
  2. Inspect phase timeline for heartbeat `ドクドク`, `止まらない`, lip-gaze, thigh/skirt, and climax cue edge cases.
- **Expected**: Phase detector should classify actual scene progression, not isolated words.
- **Actual**: Heartbeat/pulse and broad climax words caused false climax; lip gaze caused false intimate; thigh/skirt cues were missed; final climax cues could be missed.
- **Root cause**: Scene phase judge relied on broad substring keywords and allowed regex matches across punctuation.
- **Fix**: `script/e2e/judges/scene-phase.ts` now guards pulse/climax cues, keeps afterglow from overriding climax, narrows kiss/lip action matching, adds thigh/skirt/distance cues, and treats explicit injection/climax wording as climax.
- **Re-verify**: `pnpm exec vitest run src/lib/e2e-scene-phase-judge.test.ts src/lib/scene-phase.test.ts src/lib/quality-guard.test.ts` ✅; replay of `review-s4-9turn-quality-repeat-20260515` with current judge gives 9/9 phase matches and 0 monotonic violations ✅.
- **Commit**: `<pending>`
- **Status**: Fixed ✅

### BUG-008
- **Severity**: P1
- **Surface**: Chat quality guard
- **Fidelity**: [Unit] + [Playwright-snapshot]
- **Provider**: openrouter / local-only
- **Origin**: 8788 (wrangler)
- **Screen**: Chat quality
- **Repro**:
  1. In S4, observe a model can repeat the previous assistant text while stored history may be plain text.
  2. Run quality guard against XML current response and plain previous response.
- **Expected**: Identical or near-identical cross-turn output should fail `cross-turn-repetition`.
- **Actual**: If previous history had no XML tags, section extraction returned empty strings and the duplicate could pass.
- **Root cause**: Cross-turn repetition compared only extracted XML sections and had no plain-text fallback.
- **Fix**: `src/lib/quality-guard.ts` falls back to `stripXmlTags(response)` when a section is absent.
- **Re-verify**: `pnpm exec vitest run src/lib/quality-guard.test.ts` covered plain-history duplicate detection ✅.
- **Commit**: `<pending>`
- **Status**: Fixed ✅

### BUG-009
- **Severity**: P1
- **Surface**: E2E baseline / PC 1280px
- **Fidelity**: [Code-Read] + [Playwright-snapshot]
- **Provider**: openrouter / anthropic
- **Origin**: 8788 (wrangler)
- **Screen**: Chat quality
- **Repro**:
  1. Send a chat turn that triggers `AGENCY` / `EXPLICIT` / `claude-judge:*` quality failures.
  2. Let server retry exhaust `MAX_QUALITY_RETRIES` (default 1).
- **Expected**: When all retries fail, the server should surface a clear quality failure to the client and not emit the failed assistant message as if it were a normal reply.
- **Actual**: Server returns the last failed attempt with `x-quality-warning: 1`. The client displays the failed text the same way as a normal assistant message; only the `x-quality-warning` header distinguishes it.
- **Root cause**: Quality retry path was designed for "best-effort fallback" rather than "fail closed". Returning the last failed attempt unblocks UX continuity but ships low-quality text. This was not addressed by the BUG-003 partial fix, which only normalized `claude-judge:` retry hints upstream.
- **Fix**: Deferred. Requires deciding between (a) returning an explicit `quality_exhausted` error and letting the client surface a retry CTA, or (b) keeping the fallback but visually flagging the warning in the UI.
- **Re-verify**: Pending.
- **Commit**: n/a
- **Status**: Open
