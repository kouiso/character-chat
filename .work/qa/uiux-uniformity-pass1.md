# adult-ai-app UI/UX Uniformity Audit (Pass 1)

Date: 2026-05-16
Viewport: 390x844 (iPhone 12 baseline) + desktop spot checks
Branch: feat/uiux-uniformity-pass1 (worktree)

Screens captured (before/):
- 01-discover, 02-chat-empty, 03-create, 04-groups, 05-moments,
  06-pricing, 07-support, 08-tos, 09-privacy, 11-settings(char-detail panel)

## Findings (sorted by severity)

### HIGH

H1. Legal pages have NO bottom-nav and a tiny dark gradient header — feels like a different app.
   - Evidence: 08-tos.png / 09-privacy.png — top bar is ~40px tall (`py-2.5`) with text-lg, then content is a 4xl-max card; on mobile (390px) it looks like a popover.
   - File: `src/app.tsx:177` (header) and `src/component/legal/{terms,privacy,tokushoho}.tsx`.
   - Fix: standardize back link as a real anchor with min-h-11 touch target and `text-base`. Re-use a `LegalShell` for all three legal pages.

H2. "チャットに戻る" link in legal header has small hit target (text-xs, no padding) — violates 44px tap rule.
   - File: `src/app.tsx:182-188`.
   - Fix: wrap as full-width row, min-h-11, ArrowLeft icon for clarity.

H3. Bottom-nav center FAB has uneven label vertical alignment — text "作成" missing on mobile (CenterAction has no label).
   - File: `src/component/web/web-portal.tsx:286-297`.
   - Fix: add `<span>作成</span>` below the button (consistent with siblings).

H4. Discover age-gate modal opens AFTER content paints — content visible behind modal on first load. Layout shift.
   - Evidence: 01-discover.png pre-fix had age-gate over discover content.
   - File: `src/component/legal/age-gate-modal.tsx` + render order in `app.tsx`.
   - Fix: render age-gate first (return overlay before main) when unverified — out of scope (state coupling). Document, do not change in pass1.

H5. CreatePage shows "1対1チャット" card pre-selected (primary border) but it's not a togglable choice — it's a static heading. Looks like a radio that's stuck.
   - File: `src/component/web/web-portal.tsx:909-920`.
   - Fix: remove `border-primary` styling; render as a non-interactive heading or remove the button wrapper.

### MID

M1. Heading sizes inconsistent across pages: discover hero uses `text-3xl md:text-5xl`, others (pricing/groups/create/support) use `text-2xl`. No mobile downscale on the others.
   - Files: web-portal.tsx lines 449, 955, 1025, 1148, 1195.
   - Fix: unify page-titles to `text-2xl font-semibold` (already mostly aligned). Discover hero stays.

M2. Empty-state cards differ: groups uses dashed border, moments uses dashed border, but legal/pricing/support have no empty states.
   - Fix: pricing "準備中" should look like a real "coming soon" stamp, not a `text-3xl` price.

M3. PricingPage "準備中" is rendered as `text-3xl font-semibold` price (same slot as a real price), which is misleading — looks like a free price.
   - File: web-portal.tsx:1167.
   - Fix: replace with a small `<Badge>準備中</Badge>` style or `text-sm text-muted-foreground` so it doesn't compete with the title.

M4. Bottom-nav active-state color is `text-primary` only — no background pill, hard to spot active tab.
   - File: web-portal.tsx:275-279.
   - Fix: add `bg-primary/10` for active state on the label/icon column.

M5. NavButton (desktop) hover state is `hover:bg-muted` only, no active state for current page.
   - File: web-portal.tsx:299-316.
   - Fix: accept an `isActive` prop and apply `bg-muted text-foreground` when active.

M6. Tag chips on Discover have inconsistent height: search input is `h-11`, chip is `py-1.5` → ~28px → looks small next to the input.
   - File: web-portal.tsx:432-447.
   - Fix: standardize chips to `min-h-9` and `px-3.5`.

M7. CharacterCard tag chips on grid view show only **1** tag (`slice(0, 1)`) which truncates rich metadata. List view shows 3. Asymmetric.
   - File: web-portal.tsx:348.
   - Fix: grid → 2 tags, list → 3 tags.

M8. CreatePage "確認" submit button label is ambiguous — should be "作成する" or "保存".
   - File: web-portal.tsx:985.
   - Fix: relabel to `作成する` (matches success toast `キャラクターを作成しました`).

M9. SupportPage legal links at the bottom use bare `<a>` without icons or visible underline by default — link affordance unclear.
   - File: web-portal.tsx:1204-1214.
   - Fix: add `underline` (always visible, not only on hover) and consistent gap.

M10. Discover hero copy “キャラを見つけて、すぐ会話に入る” has dev-y subtext “Web版の入口として統合しました” — exposes implementation detail to users.
   - File: web-portal.tsx:452-454.
   - Fix: replace subtext with user-facing copy.

M11. CreatePage uses `Field`/`Area` components with always-`*`-prefixed label in Area (`*${label}`) — even for optional fields like "キャラクター紹介".
   - File: web-portal.tsx:1132-1133 (Area always prepends `*`).
   - Fix: add a `required?: boolean` prop on Area mirroring Field's behavior.

### LOW

L1. PricingPage page padding `py-8` but no header bar — feels naked on mobile compared to discover.
L2. Color-only contrast on muted text near 4.5:1 limit; not measured precisely. Out of scope for pass1.
L3. SupportPage FAQ has no expand/collapse — fine for 4 items but inconsistent if scaled.
L4. Discover viewMode toggle is hidden behind tiny 32×32 buttons. Below 44px tap target.
L5. CharacterCard hover lifts -translate-y-0.5 but no focus ring — keyboard nav invisible.

## Top-10 fix table

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| 1 | HIGH H1+H2 | src/app.tsx:177-189 + new legal shell | Standardize legal header with proper ArrowLeft back button, min-h-11 touch target |
| 2 | HIGH H3 | src/component/web/web-portal.tsx:286-297 | Add `作成` label under center FAB on mobile nav |
| 3 | HIGH H5 | src/component/web/web-portal.tsx:909-920 | Remove fake-selected styling on Create page first card |
| 4 | MID M3 | src/component/web/web-portal.tsx:1164-1177 | Convert "準備中" price to badge instead of `text-3xl` |
| 5 | MID M4 | src/component/web/web-portal.tsx:271-283 | Mobile nav active state — bg pill + bolder text |
| 6 | MID M5 | src/component/web/web-portal.tsx:203-210, 299-316 | Desktop NavButton active state via prop |
| 7 | MID M6 | src/component/web/web-portal.tsx:432-447 | Tag chips min-h-9 for touch consistency |
| 8 | MID M7 | src/component/web/web-portal.tsx:348 | CharacterCard grid → 2 tags shown |
| 9 | MID M8 | src/component/web/web-portal.tsx:985 | Submit label "確認" → "作成する" |
| 10 | MID M10 | src/component/web/web-portal.tsx:452-454 | Discover hero subtext rewrite (user-facing) |
| bonus | MID M11 | src/component/web/web-portal.tsx:1121-1145 | Area `required` prop instead of always `*` |
| bonus | MID M9 | src/component/web/web-portal.tsx:1204-1214 | Support page footer links always-underlined |
