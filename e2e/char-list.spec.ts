/**
 * E2E: Character list — scroll restore and sticky search (#180, #181, #183)
 *
 * Regression sentinels:
 *   - After scrolling the char list to 800 px and reloading, position resets to top.
 *   - Search input remains visible (sticky in SheetContent) while list is scrolled.
 *
 * These tests use `data-testid` attributes added in #185:
 *   - char-search-input  (search <input> in CharacterSheetList)
 *   - char-list-scroll   (overflow-y-auto char list container)
 */

import { type Page, expect, test } from "playwright/test";

const openCharacterList = async (page: Page): Promise<void> => {
  const inlineList = page.getByTestId("char-list-scroll");
  if (await inlineList.isVisible().catch(() => false)) return;

  const sheetTrigger = page.getByRole("button", { name: "キャラクター管理" });
  if (!(await sheetTrigger.isVisible().catch(() => false))) {
    test.skip(true, "Character list UI is not available without backend data");
    return;
  }

  await sheetTrigger.click();
  await page.getByText("キャラクター管理").waitFor({ state: "visible" });
};

test.describe("Char list — scroll restore (#183)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("scroll position resets to top after page reload", async ({ page }) => {
    await openCharacterList(page);

    const listScroll = page.getByTestId("char-list-scroll");
    await listScroll.waitFor({ state: "visible" });

    // Scroll the char list to 800 px
    await listScroll.evaluate((el) => {
      el.scrollTop = 800;
    });

    // Confirm we actually scrolled
    const scrolledTop = await listScroll.evaluate((el) => el.scrollTop);
    // Skip scrollToTop test if list is not tall enough
    if (scrolledTop < 100) {
      test.skip(true, "Char list not tall enough to scroll — skip scroll regression test");
      return;
    }

    // Reload the page
    await page.reload();

    // Open the sheet again
    await openCharacterList(page);

    const listScrollAfter = page.getByTestId("char-list-scroll");
    await listScrollAfter.waitFor({ state: "visible" });

    // Scroll position should start at 0 (no erroneous restore)
    const topAfterReload = await listScrollAfter.evaluate((el) => el.scrollTop);
    expect(topAfterReload).toBe(0);
  });
});

test.describe("Char list — sticky search bar (#180, #181)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("search input is visible after scrolling the list", async ({ page }) => {
    await openCharacterList(page);

    const listScroll = page.getByTestId("char-list-scroll");
    await listScroll.waitFor({ state: "visible" });

    // Scroll the list
    await listScroll.evaluate((el) => {
      el.scrollTop = 400;
    });

    // Search input must remain visible (it's outside the scrollable container)
    const searchInput = page.getByTestId("char-search-input");
    await expect(searchInput).toBeVisible();
  });

  test("typing in search input filters the character list", async ({ page }) => {
    await openCharacterList(page);

    const searchInput = page.getByTestId("char-search-input");
    await searchInput.waitFor({ state: "visible" });

    // Type a query that unlikely matches any character
    await searchInput.fill("xyzzy-no-match-expected");

    // Expect the "no results" message
    await expect(page.getByText("条件に一致するキャラクターがありません")).toBeVisible();

    // Clear and verify list is restored
    await searchInput.clear();
    await expect(page.getByText("条件に一致するキャラクターがありません")).not.toBeVisible();
  });
});
