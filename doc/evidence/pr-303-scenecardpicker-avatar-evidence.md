# PR #303 — SceneCardPicker Avatar Rendering Evidence

Date (UTC): 2026-05-25

## Scope
Validate that `SceneCardPicker`:
1. Resolves stored avatar keys (example: `char-yarisa-classmate.jpg`) via `/api/avatar/...`.
2. Uses fallback content when avatar values are invalid/non-image.

## Automated evidence
Command:

```bash
pnpm -s vitest run src/component/chat/scene-card-picker.test.tsx src/lib/avatar-url.test.ts
```

Result:
- Test Files: 2 passed
- Tests: 9 passed

Key expectations covered by tests:
- `SceneCardPicker` renders profile image source as `/api/avatar/char-yarisa-classmate.jpg` for stored key input.
- `SceneCardPicker` renders fallback (no `<img>` avatar image) when avatar input is invalid (e.g. emoji value).
- `resolveAvatarSrc` maps stored keys to `/api/avatar/<encoded-key>` and rejects unsafe/invalid values.

## Preview/screenshot artifact status
No screenshot artifact was produced in this run.

Blocker:
- In this cloud CLI task, no existing Storybook/preview capture command dedicated to `SceneCardPicker` was available/configured as a deterministic one-command artifact path for this PR evidence step.
- Automated unit tests above provide direct evidence for the two requested behaviors.

## Expected vs Actual
- Expected: stored key resolves to `/api/avatar/char-yarisa-classmate.jpg`.
  - Actual: test assertion passes.
- Expected: invalid avatar value uses fallback rendering.
  - Actual: test assertion passes.
