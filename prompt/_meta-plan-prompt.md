# META-PLAN PROMPT — adult-ai-app

> **Purpose**: paste this entire file into a fresh Claude Code session opened at the adult-ai-app repo root. The session will run Discovery, then produce a top-precision plan that mirrors the structure proven on the horsemanager β-distribution plan (Critical 3 + Executor Header + Lane Spawn Template + 4-point anti-fakery + ≥30 pre-mortem + ≥5 self-review pass + 3-round adversarial review).

---

## CRITICAL 3 (re-state at every phase boundary)

1. **Project purpose alignment** — adult-ai-app exists so the user can fap for free without paying monthly subscription erotic apps, using Claude as engine. Plan must move toward that goal at every step. β / portfolio / commercialization are downstream, not the goal.
2. **Zero-fakery verification** — every "done" claim requires evidence_path with ≥1 artifact (screenshot / playwright trace / vitest output / network capture). BLOCKED claims require ≥2 distinct attempts in an `attempts` array.
3. **Context-mode + native tools only** — heavy IO via `mcp__plugin_context-mode_context-mode__ctx_*`. File writes via Write/Edit. Bash allowlist = `git/mkdir/rm/mv/cd/ls/chmod/pnpm/wrangler/tsx/vitest`. No `curl`, no `WebFetch`. No Codex calls.

---

## EXECUTOR HEADER (≤200 tokens, re-read at each phase start)

```
ROLE: planner (neutral engineering assistant per prompt/instructions/persona.md)
GOAL: produce a single plan file at .claude/plans/<slug>.md that, when executed by a Sonnet subagent or future session, ships the user-stated objective end-to-end.
DONE-WHEN: plan file passes all P0 structure gates AND self-review ≥5 pass at 100/100 AND 3-round adversarial review converged AND user approves via ExitPlanMode.
HARD-NO: secret leakage (D1 keys, Supabase keys, OpenRouter keys), schema drop without migration, prod wrangler deploy, @ts-ignore / as any / empty catch.
HARD-DO: Discovery first (≤3 questions, AskUserQuestion tool), pre-mortem ≥30 scenarios with mitigations, self-review loop, adversarial review log inline.
PHASE-ORDER: 0 (Discovery) → 1 (Audit) → 2 (Plan draft) → 3 (Self-review ×5) → 4 (Adversarial ×3) → 5 (ExitPlanMode).
ESCAPE-VALVE: none. MAX_ATTEMPTS=5 distinct fixes per failing review item before halting and asking user.
```

---

## DISCOVERY (run FIRST, before any plan writing)

Use `AskUserQuestion`. Maximum 3 questions, each with 2-4 options. Skip any question already answered in the user's initial prompt.

| # | Question | Options (multiSelect=false unless noted) |
|---|---|---|
| 1 | What is the immediate objective of this plan? | (a) ship a new feature end-to-end / (b) fix a regression / (c) refactor a domain / (d) prepare a release (β / production deploy) |
| 2 | What is the deployment target for this work? | (a) local dev only / (b) Cloudflare Pages preview / (c) Cloudflare Pages production / (d) not deployed yet |
| 3 | What evidence is acceptable as "done"? | (a) vitest pass + lint pass / (b) above + Playwright E2E + screenshot / (c) above + manual UAT in browser / (d) above + production smoke test |

After answers arrive, restate the resolved scope in one sentence and proceed to Phase 1.

---

## PHASE 1 — AUDIT (≤10 minutes wall-clock)

Run the following with `ctx_batch_execute` so raw output stays out of context:

```yaml
commands:
  - label: "git status + branch"
    command: "git status -sb && git log --oneline -5"
  - label: "package.json scripts + deps"
    command: "jq '.scripts, .dependencies, .devDependencies' package.json"
  - label: "src tree top 2 levels"
    command: "find src -maxdepth 2 -type d | sort"
  - label: "functions tree"
    command: "find functions -maxdepth 3 -type f | sort"
  - label: "drizzle migrations"
    command: "ls drizzle/ 2>/dev/null"
  - label: "existing plans"
    command: "ls .claude/plans/ 2>/dev/null && ls prompt/tasks/ 2>/dev/null"
  - label: "lint + type baseline"
    command: "pnpm lint 2>&1 | tail -30 && pnpm exec tsc -b --noEmit 2>&1 | tail -30"
queries:
  - "current state of feature touched by goal"
  - "existing tests covering target area"
  - "secrets / env vars referenced"
```

Synthesize ≤300-token audit summary into the plan's `## Phase 0 — Audit Findings` section. Do NOT paste raw output.

---

## REQUIRED PLAN STRUCTURE (the artifact this prompt produces)

The output plan file at `.claude/plans/<slug>.md` MUST contain these top-level sections in this order. Skipping or reordering = structure-gate FAIL.

```
# <plan title>

> Critical 3 (project-purpose / zero-fakery / context-mode)

## Executor Header (≤200 tokens, lane-prompt entry point)

## Lane Spawn Prompt Template (subagent header to copy-paste)

## Context — why this plan now

## Scope decisions (in/out, with rationale)

## Phase 0 — Audit Findings (from Phase 1 of meta-prompt)

## Phase 1 — Pre-flight Gates (toolchain, env, secrets, branch)

## Phase 2 — Lane Execution (parallel where possible)
   - L<N> name, branch, file ownership table, done conditions
   - Cross-lane signal mechanism (file-system flag under .claude/runs/<RUN_ID>/)

## Phase 3 — Verification (4-point evidence per change set)

## Phase 4 — Handoff / Reviewer Ready

## Anti-Fakery Protocol (4-point evidence definition)

## Pre-mortem (≥30 scenarios, each with mitigation)

## Self-Review (≥5 pass, 100/100 across all axes)

## Adversarial Review Log (≥3 round, devil's-advocate vs. plan-author)

## Appendix
   - jq fragments for repeated extractions
   - Lane × file ownership matrix
   - Suppression-scan grep patterns
   - Secret name list (names only, NEVER values)
```

---

## P0 STRUCTURE RULES (enforce in the produced plan)

```xml
<rule priority="P0" id="critical-3-first">first 3 non-blank lines of plan = Critical 3.</rule>
<rule priority="P0" id="executor-header-token-budget">Executor Header section ≤200 tokens, plain code-block format, no prose preamble.</rule>
<rule priority="P0" id="lane-template-self-contained">Lane Spawn Prompt Template must be paste-ready with placeholders &lt;L|N|RUN_ID&gt; and zero implicit assumptions.</rule>
<rule priority="P0" id="rules-as-xml">all behavioral rules use XML with priority + id. No markdown bullet rules.</rule>
<rule priority="P0" id="conditionals-as-tables">all conditional logic uses IF-THEN tables. No prose paragraphs.</rule>
<rule priority="P0" id="pre-mortem-min-30">Pre-mortem section has ≥30 numbered scenarios. Each row has: number, scenario, likelihood (H/M/L), impact (H/M/L), mitigation, mitigation-section-link.</rule>
<rule priority="P0" id="self-review-min-5-pass">Self-Review table has ≥5 columns (Pass 1 … Pass N). Final pass aggregate = 100/100. If a check is &lt;100, the plan body MUST already contain the fix.</rule>
<rule priority="P0" id="adversarial-3-round">Adversarial Review log has ≥3 rounds, each with attack / counter / resolution columns. Final row = explicit convergence verdict.</rule>
<rule priority="P0" id="evidence-path-mandatory">Phase 3 Verification section names exact evidence_path templates. Done-claim with null evidence_path = automatic FAIL.</rule>
<rule priority="P0" id="suppression-zero">plan forbids new @ts-ignore / @ts-expect-error / as any / as unknown as / empty catch / eslint-disable. Suppression-scan patterns in Appendix.</rule>
<rule priority="P0" id="secret-name-only">Appendix lists secret NAMES only. Plan body and any subagent prompt must never include secret VALUES, .env contents, or API keys.</rule>
```

---

## ANTI-FAKERY PROTOCOL (define in the plan, enforce inline)

| Axis | Required artifact | Path template | Example |
|---|---|---|---|
| A — UI behavior | Playwright trace.zip OR mp4 | `.claude/runs/<RUN_ID>/<LANE>/ui.zip` | Playwright `test --trace on` output |
| B — console / network | browser console JSON dump + HAR | `.claude/runs/<RUN_ID>/<LANE>/console.json` `network.har` | playwright-mcp captures |
| C — server log | Hono / wrangler log with request_id matching A | `.claude/runs/<RUN_ID>/<LANE>/server.log` | `wrangler pages deployment tail` filtered |
| D — screenshot pair | before-tap PNG + after-tap PNG | `.claude/runs/<RUN_ID>/<LANE>/before.png` `after.png` | screenshot device matches A's frame |

The plan must define a Verification step that asserts all four axes for any change touching user-visible behavior. For pure backend / schema changes, axis A=N/A and axes B+C+migration-output replace it.

---

## PRE-MORTEM CATEGORIES (≥30 scenarios distributed across these)

The plan must cover at least one scenario per category below. Empty categories = FAIL.

| Category | Example scenarios to seed |
|---|---|
| Cloudflare deploy | wrangler.toml drift, D1 migration order skew, KV namespace mismatch |
| OpenRouter / AI SDK | rate limit, model deprecation, streaming chunk truncation, prompt-cache miss |
| Dexie / IndexedDB | schema version bump corrupts existing user data, browser private mode failure |
| Auth (Supabase / jose) | JWT expiry edge case, refresh-token race, RLS bypass |
| Vitest / Playwright | flaky timer, jsdom vs. real browser drift, snapshot rot |
| TypeScript build | tsc -b cache stale, project-reference cycle, vite ESM/CJS interop |
| Tailwind v4 / shadcn | utility class purge over-aggressive, theme token drift, dark-mode FOUC |
| Zustand state | hydration mismatch SSR-less but persist-driven, store split during refactor |
| Drizzle ORM | migration rename loses data, Zod schema vs. Drizzle schema drift |
| TTS / Speech Synthesis | Safari speechSynthesis cancels on focus loss, voice not loaded yet |
| Privacy / project-purpose | adult content moderation by OpenRouter, model refusal cascading, content backup leakage |
| Session / planning | meta-prompt itself drifts, subagent token overflow, ScheduleWakeup absent |

---

## SELF-REVIEW TABLE FORMAT

| # | Check | Pass 1 | Pass 2 | Pass 3 | Pass 4 | Pass 5 |
|---|---|---|---|---|---|---|
| 1 | Critical 3 first 3 lines | … | … | … | … | … |
| 2 | Executor Header ≤200 tokens | … | … | … | … | … |
| … | … | … | … | … | … | … |
| N | Adversarial review converged | — | — | — | — | … |

Pass aggregate row at the bottom: e.g. `**Pass 5 aggregate**: 100/100 (N items)`.

If any cell <100 in Pass 5, you have NOT finished — go to Pass 6 with adversarial agent input.

---

## ADVERSARIAL REVIEW LOG FORMAT

```
### Round 1: Devil's Advocate
| Attack | Counter | Resolution |
|---|---|---|
| (attack) | (rebuttal) | (incorporated / dismissed-with-reason) |

### Round 2: Pragmatist
… same shape …

### Round 3: Convergence
- bullet list of agreed points
- explicit "unresolved = 0" or "unresolved = N (escalate to user)"
```

If the planner-self alone cannot generate genuine adversarial pressure, spawn parallel `Agent` subagents with these distinct briefs:

1. **deepresearch** — read the project's prior memory / prompts, find past failure patterns relevant to the current goal, list them as fakery risks.
2. **red-team** — produce 10-15 critical gaps, 5-10 hidden assumptions, 3-5 anti-fakery loopholes in the current draft plan.
3. **stack-specialist** — for the deepest tech surface in scope (e.g., Cloudflare D1, Vercel AI SDK streaming), inventory infra, list pre-flight gates the plan is missing.

Absorb each agent's findings into a new pre-mortem batch and a new self-review pass. Only then call ExitPlanMode.

---

## FINAL GATE (before ExitPlanMode)

Verify, in order:

1. All P0 structure rules pass.
2. Pre-mortem ≥30 scenarios, all with mitigation links.
3. Self-Review last pass = 100/100 across ≥5 passes.
4. Adversarial Review = ≥3 rounds with explicit convergence.
5. Plan file is at `.claude/plans/<slug>.md`. Slug uses kebab-case nouns derived from the goal.
6. No secret values anywhere in the plan or any subagent prompt.

Then — and only then — call `ExitPlanMode`.

---

## RECURSIVE EMBEDDING REQUIREMENTS

The produced plan MUST itself contain:

- a Critical 3 block at top
- a pre-mortem section
- a self-review section
- an adversarial review section
- a Lane Spawn Prompt Template that includes the same Critical 3 + 4-point evidence rule

This is non-negotiable. Plans without recursive embedding fail user review on first inspection because executor subagents lose the constraints mid-run.

---

## OPERATING NOTES (planner self-discipline)

- Communicate with the user in Japanese (project's persona = neutral engineering assistant per `prompt/instructions/persona.md`). The plan file body itself is English (better for downstream LLM parsing). Section headers may be bilingual when natural.
- Never `WebFetch`. Use `mcp__plugin_context-mode_context-mode__ctx_fetch_and_index` then `ctx_search`.
- Never paste raw command output >20 lines into context. Use `ctx_batch_execute` and summarize.
- When the plan exceeds ~6000 tokens, move detail-heavy tables (jq fragments, full pre-mortem, suppression patterns) into the Appendix and keep the main flow lean.
- If the user interrupts with "plan長すぎ" or similar, compress the Executor Header and move sections to Appendix; do NOT delete pre-mortem items.
- Preserve project tone: adult content is the explicit purpose. Do not water down the goal in the plan body.

---

## START

Begin Discovery now. After Discovery answers arrive, run Phase 1 audit, then write the plan to `.claude/plans/<slug>.md`, then loop self-review and adversarial review until the Final Gate passes, then call `ExitPlanMode`.
