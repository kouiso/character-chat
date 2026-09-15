# Test Plan — adult-ai-app

Generated: 2026-05-20  
Issue: [#185 test infrastructure](https://github.com/kouiso/adult-ai-app/issues/185)

---

## Coverage Matrix

| Area | Scenario | Tag | Related |
|------|----------|-----|---------|
| Auth (CF Access) | Silent-fail guard: API returns HTML → reload | `[automated: playwright]` | #175 |
| Auth (CF Access) | Reload guard: second html response within 60 s is suppressed | `[automated: unit]` | #175 |
| Char list | Scroll to 800 px → reload → list scrolls back to top | `[automated: playwright]` | #183 |
| Char list | Search input is sticky (visible) while list is scrolled | `[automated: playwright]` | #180, #181 |
| Char list | Search filters characters by name | `[automated: unit]` | #180 |
| Chat open | Top of viewport shows avatar/greeting on open | `[automated: playwright]` | #184 |
| Chat send | Message appears after send + viewport scrolls to bottom | `[automated: playwright]` | core |
| Chat send | Empty send is blocked | `[manual]` | core |
| Image generation | generateImage() returns task_id on 200 | `[automated: unit]` | #177 |
| Image generation | image_meta override is used when characterId is present | `[automated: unit]` | #177 |
| Onboard-char script | Exits 1 when char_id is missing | `[automated: unit]` | #176 |
| API transport | trimMessagesForTransport trims history to stay under 180 k chars | `[automated: unit]` | core |
| API transport | System message is always kept; latest user message is always kept | `[automated: unit]` | core |
| API transport | Empty array passes through unchanged | `[automated: unit]` | core |
| CF Access reload | apiFetch sets reload-guard key, second hit within 60 s skips reload | `[automated: unit]` | #175 |
| Character schema | imageMeta nullable JSON parsed correctly | `[automated: unit]` | #177 |
| Avatar overhaul | imageMeta fields (appearance, artStyle, outfit) pass zod | `[automated: unit]` | #177 |
| /api/image visual anchors | buildVisualAnchorPrompt uses 2.0 weight for hair-color anchors | `[automated: unit]` | #177 |
| /api/image visual anchors | buildVisualAnchorPrompt falls back to uniform weight if no hair | `[automated: unit]` | #177 |
| /onboard-char pipeline | Script accepts valid char_id and creates WORK_DIR | `[planned]` | #176 |
| Sticky search bar | Tag filter row scrolls horizontally, stays in view | `[manual]` | #181 |
| Conversation restore | Opening a conversation starts at the latest message | `[automated: playwright]` | #184 |

---

## Functional Area Details

### A. Auth (CF Access) — #175

**Given** a user whose CF Access session has expired  
**When** any `/api/*` call returns `Content-Type: text/html`  
**Then** `window.location.reload()` is called exactly once within 60 s

**Given** `window.location.reload()` was called within the last 60 s  
**When** another `/api/*` call returns HTML  
**Then** reload is **not** triggered (loop guard)

### B. Character List — #180, #181, #183

**Given** the character sheet is open and the list is scrolled to 800 px  
**When** the page is reloaded  
**Then** the list scroll position starts at the top (no incorrect restore)

**Given** the character sheet is open  
**When** the user scrolls the character list to 800 px  
**Then** the search input remains visible / accessible (sticky behaviour)

### C. Chat Open — #184

**Given** the user selects a character  
**When** the chat view opens  
**Then** the greeting message from the avatar is visible in the initial viewport without scrolling

### D. Chat Send — core

**Given** the chat view is open and the user types a message  
**When** the send button is clicked  
**Then** a new `[data-testid="message-bubble"]` appears and the scroll position is at the bottom

### E. Image Generation — #177

**Given** a `characterId` is passed to `generateImage`  
**When** the server reads `image_meta` from D1  
**Then** the `appearance + artStyle` fields are used as visual anchors instead of `characterDescription`

**Given** `image_meta` is null / missing  
**When** `generateImage` is called  
**Then** `extractVisualAnchors(characterDescription)` is used as the fallback

### F. /onboard-char — #176

**Given** the script is invoked without arguments  
**When** it is executed  
**Then** it exits with code 1 and prints usage to stderr

---

## Test Automation Stack

| Layer | Tool | Config |
|-------|------|--------|
| Unit tests | Vitest 4 + jsdom | `vitest.config.ts` |
| Component tests | Vitest + @testing-library/react | same |
| E2E tests | Playwright 1.59 | `playwright.config.ts` (new) |
| Coverage | @vitest/coverage-v8 | v8 provider |
| CI | GitHub Actions | `.github/workflows/test.yml` |

Default Playwright viewport: **375 × 667** (iPhone SE, mobile-first).  
Dev server port for e2e: **5185** (avoids collision with other sessions on 5173).

---

## Coverage Targets

| Module | Target |
|--------|--------|
| `src/lib/api.ts` | 80 %+ |
| `functions/api/lib/image-prompt-anchors.ts` | 100 % |
| `src/schema/character.ts` | 80 %+ |
