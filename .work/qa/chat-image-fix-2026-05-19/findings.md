# Chat Image Context Fix QA

Date: 2026-05-19
Worktree: `/Users/kouiso/ghq/kouiso/adult-ai-app-worktrees/fix-chat-image-context`

## Regression Commit

`4614f06 refactor: eliminate all complexity/max-depth lint errors across 6 files`

Diff summary: `functions/api/[[route]].ts`, `src/component/chat/chat-view.tsx`,
`src/component/chat/message-bubble.tsx`, `src/lib/api.ts`,
`src/lib/quality-guard.ts`, and `src/store/settings-store.ts` were refactored
with 1,227 insertions and 829 deletions. The chat-image regression came from
the `chat-view.tsx` prompt-building path: recent turns were reconstructed in a
way that could lose the actual latest scene context, then the resulting string
was still truncated with `sceneDescription.slice(0, 900)`.

## Root Cause

Mid-chat image generation depended on a client-built scene prompt, but the
refactor made that prompt fragile. It collected recent messages by scanning
backward, so the latest assistant scene could be skipped or paired incorrectly,
then it trimmed from the front of the final string, allowing older context to
push out the current scene. On the Worker side, the prompt translator always
received a random pose hint; when the scene prompt was weak or truncated, that
fallback pose and the character/profile anchors could dominate the actual chat
state. The fix makes the chat prompt builder preserve `[最新]` context under
length pressure and only supplies random pose diversity as a fallback when the
prompt lacks explicit pose/action/setting context.

## Files Kept

- `src/lib/chat-image-prompt.ts`
  - New pure helper that builds recent user/assistant context chronologically
    and trims while preserving the latest scene block.
- `src/lib/chat-image-prompt.test.ts`
  - Covers latest-scene preservation under truncation and assistant-only
    fallback context.
- `src/component/chat/chat-view.tsx`
  - Wires `buildImagePromptFromHistory` into chat-triggered image generation
    and removes the old `sceneDescription.slice(0, 900)` call site.
- `functions/api/lib/image-scene-context.ts`
  - Detects whether the prompt already contains explicit pose/action/setting
    context.
- `functions/api/__tests__/image-scene-context.test.ts`
  - Covers explicit-scene suppression of fallback pose and underspecified
    profile-like prompt fallback behavior.
- `functions/api/[[route]].ts`
  - Uses `resolveFallbackPoseHint` and instructs the tag translator that scene
    context takes priority for pose, action, clothing, background, and emotion.
- `eslint.config.js`
  - Kept because repository-wide `pnpm lint` otherwise fails on
    `scripts/avatar-pipeline/*` project-service parsing errors.
- `functions/api/lib/persona-break-detect.ts`
  - Kept as a mechanical `unicorn/better-regex` lint fix required by
    repository-wide `pnpm lint`.
- `functions/api/lib/quality-report.ts`
  - Kept as mechanical import-order and regex cleanup required by
    repository-wide `pnpm lint`.
- `functions/api/lib/refusal-detect.ts`
  - Kept as mechanical Prettier cleanup required by repository-wide
    `pnpm lint`.
- `src/component/chat/chat-input.tsx`
  - Kept as mechanical Prettier cleanup required by repository-wide
    `pnpm lint`.
- `src/component/chat/message-action-menu.tsx`
  - Kept as mechanical Prettier cleanup required by repository-wide
    `pnpm lint`.
- `src/component/chat/message-bubble.tsx`
  - Kept as mechanical import-order, hook dependency, and Prettier cleanup
    required by repository-wide `pnpm lint`.
- `src/component/gallery/character-gallery.tsx`
  - Kept as mechanical import-order cleanup required by repository-wide
    `pnpm lint`.
- `src/component/web/web-portal.tsx`
  - Kept as mechanical complexity/no-alert cleanup required by repository-wide
    `pnpm lint`.
- `src/lib/api.ts`
  - Kept as mechanical complexity/prefer-const/unused-value cleanup required by
    repository-wide `pnpm lint`.

## Files Dropped

- `.work/qa/chat-image-fix-2026-05-19/scene-match.png`
  - Dropped from the PR because this task only requested `findings.md`; the
    binary screenshot is not needed for the root-cause fix.

## Scope Trim Note

A strict trim to only the chat-image files was attempted. With those unrelated
lint hunks removed, `pnpm tsc -b` completed but `pnpm lint` failed with 34
errors across the files listed above plus the `scripts/avatar-pipeline/*`
project-service errors. The final diff keeps those hunks only because the user
explicitly required `pnpm tsc -b && pnpm lint` to pass and requested zero new
suppressions/skipped tests.

## Verification Evidence

- `pnpm vitest run src/lib/chat-image-prompt.test.ts functions/api/__tests__/image-scene-context.test.ts`
  - Passed: 2 files, 4 tests.
- `pnpm tsc -b`
  - Passed.
- `pnpm lint`
  - Passed with 0 errors and 6 existing security warnings:
    `script/e2e/judges/r2-persistence.ts`, `script/e2e/preflight.ts`,
    `src/lib/emotional-arc-patterns.test.ts`, and `src/lib/quality-guard.ts`.

## Diff Review

- Chat-triggered image generation now calls `buildImagePromptFromHistory(msgs)`.
- The latest user/assistant scene is marked with `[最新]` and preserved by
  `trimPromptPreservingLatest`; the old `sceneDescription.slice(0, 900)` path is
  gone.
- Profile-image-respect is preserved: existing visual anchor extraction remains
  in `translatePromptToImageTags`, and fallback pose diversity is still used for
  underspecified/profile-like prompts.
