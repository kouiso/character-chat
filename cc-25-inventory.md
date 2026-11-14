# CC-25 inventory: deleting the v1 copy from main (read-only survey, main @ working tree)

Full copy is in the lane container at /home/user/notes/cc-25-inventory.md (137 lines). Summary for backup:

Reading used: delete = root src/ EXCEPT src/schema/, functions/ EXCEPT functions/api/lib/refusal-detect*, index.html, root vite/playwright config, e2e/, v1-only public/ and scripts. Keep = src/schema/*, drizzle/, drizzle.config.ts, apps/v2, packages/*, refusal-detect.

## BLOCKERS
B1 src/lib/scene-phase.ts (1240 lines) imported by src/schema/rag-chunk.ts:4 and packages/bench/src/user-actor.ts:13 -> must stay or move.
B2 apps/v2/src/server/media.test.ts:35 reads functions/api/lib/route-context.ts (readFileSync).
B3 functions/api/__tests__/in-scene-line-is-not-a-refusal.test.ts:3 and refusal-retry-keeps-erotic-model.test.ts:3-4 import [[route]] / src/lib/model; refusal-detect.test.ts:119 reads script/e2e/fixture/replay-20260708/*.json.
B4 script/seed.ts:11 imports src/lib/prompt-variant-defaults; pnpm db:seed used by .github/workflows/v2-arm.yml:92.
B5 functions/api/__tests__/no-injected-consent-framing.test.ts is the only guard over packages/prompt/src + packages/engine/src consent ban (L258-270); does not scan apps/v2/src.
B6 CHAT-5 guard functions/api/__tests__/very-long-no-quota-directive.test.ts is v1-only; no v2 equivalent.
B7 functions/api/routes/characters.ts:6-7 imports packages/db (goes away with functions/).

## Counts (git ls-files)
src/ minus schema 343 files / 61,931 lines; functions/ minus refusal-detect pair 189 / 45,358; e2e/ 3 / 437; index.html 1 / 20; root configs 6 / 213; core subtotal 542 / ~107,959. Candidates needing a keep list: public/ 212 (202 avatars read by script/seed.ts), script/ 178, scripts/ 23 (30 files import src/ or functions/).

## Inbound references to fix in the same PR
package.json scripts (dev, dev:worker, build, deploy, preview, smoke, test*, test:e2e, verify/e2e/bench); vitest.config.ts (src/test/setup.ts, coverage thresholds); tsconfig.json / tsconfig.node.json; .oxlintrc.json dead globs; Taskfile.yml (dev, build, test, typecheck, deploy, ci, ci:fast); .lefthook.yml; scripts/hooks/commit-msg quality-gate path list; .github/ci/run.mjs + check.test.mjs; ci.yml (keep v2, runner-hardcode-guard, migrations; rewrite ci matrix; delete e2e, boot-smoke); AGENTS.md (commands, structure, CHAT-5 L241), REVIEW.md L107/L261, 16 prompt/ files; regenerate .gemini/.github copies via scripts/sync-ai-rules.sh.

## Guard tests
very-long-no-quota-directive: v1 only. no-injected-consent-framing: mostly v1; v2 part (L258-270) should be moved into packages/ before delete; update prompt/instructions/no-injected-ai-filter.md:49 and AGENTS.md:241.

## Suggested order
1 resolve B1-B6; 2 rewrite CI/package.json/Taskfile/vitest/tsconfig/oxlint/commit-msg; 3 delete set + sync-ai-rules.sh; 4 prune root deps + lockfile; verify pnpm v2:ci, pnpm lint, pnpm db:migrate:local, node --test .github/ci/check.test.mjs.
