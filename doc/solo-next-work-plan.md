# Solo Experience Next Work Plan

## Goal

Make the solo chat experience feel less like a collection of tools and more like a guided, replayable personal story workspace.

## Priority 1: Memory Actually Shapes Replies

- Inject selected memory notes into the chat prompt with clear limits and ordering.
- Add a small relevance filter so every saved note is not blindly sent every turn.
- Show which memories were used for a reply in a quiet debug/details surface.
- Failure scenario: irrelevant or stale memories make replies worse. Mitigation: cap memory count, sort by recency and explicit character match, and allow deletion/editing from the same panel.

## Priority 2: Saved Scenes Become Useful

- Add a dedicated saved-scene list with search, character filter, and latest-first sorting.
- Persist scene bookmarks server-side instead of localStorage-only.
- Let users rename saved scenes.
- Failure scenario: localStorage loss or device change makes bookmarks disappear. Mitigation: move canonical storage to D1 and keep localStorage only as a migration/import source.

## Priority 3: Branching Feels Intentional

- Add branch title editing at creation time.
- Display parent/branch relationship in conversation metadata.
- Add a lightweight branch tree or "from this scene" list.
- Failure scenario: users create many branches and cannot tell them apart. Mitigation: default branch titles should include character, scene snippet, and timestamp.

## Priority 4: Suggestions Become Contextual

- Replace fixed phase suggestions with generated suggestions based on the last 3-5 turns, current scene phase, active character, and saved memory.
- Keep a safe fallback to the current fixed suggestions when generation fails.
- Failure scenario: suggestions become generic or repetitive. Mitigation: track recent suggestion text and suppress near-duplicates.

## Priority 5: Verification

- Add API tests for memory notes, gallery, and branch boundary behavior.
- Add component tests for SoloToolsPanel tab behavior and sub-character draft sync.
- Add one browser smoke test that covers memory create, suggestion send, save scene, branch, and real message render with mocked chat.

## Self-Review Bar

- No empty catches or hidden failures.
- No user-only actions exposed on assistant-only workflows.
- No local-only canonical data for important user artifacts.
- No async conversation switching without stale-load guards.
- Mobile 390px and desktop layouts must be screenshot-checked before merge.
