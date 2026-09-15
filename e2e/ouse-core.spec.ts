/**
 * E2E: Ouse(燈) リデザインUIのコア動線
 *
 * 旧 chat.spec.ts / char-list.spec.ts は旧UIのセレクタ前提で Ouse 化後は全 skip になるため、
 * リデザイン後の実UIに対するコア回帰をここで担保する。
 *
 * カバー範囲:
 *   1. ホームに「つづきから」会話カードが描画される
 *   2. 会話カードを開くと talk 画面のキャラ名がカードのキャラと一致する（#784 回帰）
 *   3. 下タブ（さがす/アルバム/マイ）が遷移する
 *   4. マイ→あたらしい相手をつくる→3カード入口（おまかせ/シナリオ/こだわって）
 *   5. talk の送信ボタンは未入力で disabled、入力で enabled
 *   6. talk ヘッダーの左矢印でホームへ戻る
 *
 * 前提: /api は vite proxy 経由で wrangler(8788) に到達する（ローカル実行時）。
 * API が落ちている環境では会話カードが出ないため該当テストは skip する。
 */

import { expect, test } from "playwright/test";

import type { Page } from "playwright/test";

// ホームの正典パスは `/`。talk は `/chat` と `/chat/<characterId>`（+ ?conv=）を取り得る。
const isHomeUrl = (url: URL): boolean => url.pathname === "/";
const isTalkUrl = (url: URL): boolean =>
  url.pathname === "/chat" || url.pathname.startsWith("/chat/");

// 年齢ゲート・初回オンボーディングを事前通過させる（e2e ハーネスと同じキー）
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("age_verified", JSON.stringify({ verified: true, timestamp: Date.now() }));
    localStorage.setItem("ou_onboarded", "1");
  });
  await page.goto("/");
  await page.waitForTimeout(2500);
  // addInitScript 前に描画された場合の保険
  const gate = page.getByRole("button", { name: "はい、18歳以上です" });
  if (await gate.isVisible().catch(() => false)) {
    await gate.click();
    await page.waitForTimeout(800);
  }
});

const firstConversationCard = (page: Page) =>
  page
    .locator("button:visible")
    .filter({ has: page.locator("span") })
    .filter({ hasText: /新しい会話|分前|時間前|昨夜/ })
    .first();

test.describe("Ouse home — つづきから", () => {
  test("会話カードが描画される", async ({ page }) => {
    const card = firstConversationCard(page);
    const visible = await card.isVisible().catch(() => false);
    test.skip(!visible, "会話データなし（API未接続 or 空DB）— skip");
    await expect(card).toBeVisible();
  });

  test("会話を開くと talk のキャラ名がカードと一致する（#784 回帰）", async ({ page }) => {
    const card = firstConversationCard(page);
    const visible = await card.isVisible().catch(() => false);
    test.skip(!visible, "会話データなし — skip");
    // カード内の serif キャラ名（1つ目の span）
    const cardName = (await card.locator("span").first().innerText()).trim();
    await card.click();
    await page.waitForTimeout(2000);
    // talk 画面の入力欄 placeholder は「<キャラ名>に話しかける…」
    const input = page.locator("textarea");
    await expect(input).toBeVisible();
    const placeholder = (await input.getAttribute("placeholder")) ?? "";
    expect(placeholder).toContain(cardName);
  });

  test("送信ボタンは未入力で disabled・入力で enabled", async ({ page }) => {
    const card = firstConversationCard(page);
    const visible = await card.isVisible().catch(() => false);
    test.skip(!visible, "会話データなし — skip");
    await card.click();
    await page.waitForTimeout(2000);
    const send = page.getByTestId("send-button");
    await expect(send).toBeDisabled();
    await page.locator("textarea").fill("テスト入力");
    await expect(send).toBeEnabled();
  });

  test("talk からブラウザの戻るボタンで遷移元へ戻る（#877 回帰）", async ({ page }) => {
    const card = firstConversationCard(page);
    const visible = await card.isVisible().catch(() => false);
    test.skip(!visible, "会話データなし — skip");

    await expect(page).toHaveURL(isHomeUrl);
    await card.click();
    await expect(page).toHaveURL(isTalkUrl);
    await expect(page.getByRole("button", { name: "ホームへ戻る" })).toBeVisible();

    await page.goBack();

    await expect(page).toHaveURL(isHomeUrl);
    await expect(page.getByRole("button", { name: "ホームへ戻る" })).toBeHidden();
  });

  test("talk ヘッダーの左矢印でホームへ戻る（#818、#877 回帰）", async ({ page }) => {
    // 会話データやAPIの有無でskipしないよう、talkの公開ルートを直接開く。
    await page.goto("/chat");
    await expect(page).toHaveURL(isTalkUrl);

    const backButton = page.getByRole("button", { name: "ホームへ戻る" });
    await expect(backButton).toBeVisible();
    await backButton.click();

    await expect(page).toHaveURL(isHomeUrl);
    await expect(backButton).toBeHidden();
  });
});

test.describe("Ouse bottom nav", () => {
  for (const [label, tabRe, expectText] of [
    ["さがす", /^さがす$/, /名前・タグ・雰囲気で探す|見つかりました/],
    ["アルバム", /^アルバム$/, /アルバム/],
    ["マイ", /^マイ$/, /あたらしい相手をつくる/],
  ] as const) {
    test(`タブ「${label}」で画面が切り替わる`, async ({ page }) => {
      await page.locator("button:visible").filter({ hasText: tabRe }).first().click();
      await page.waitForTimeout(1200);
      await expect(page.locator("body")).toContainText(expectText);
    });
  }
});

test.describe("Ouse discover", () => {
  test("PC左ペインをスクロールしても検索欄と2列表示を維持する（#819 回帰）", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/discover");

    const leftPane = page.locator(".ou-pc-left-body");
    const scroller = leftPane.locator(".ou-discover-scroll");
    const searchDock = leftPane.getByTestId("discover-search-dock");
    const cards = leftPane.getByTestId("character-card");

    await expect(searchDock).toBeVisible();
    test.skip((await cards.count()) < 4, "キャラクターデータなし — skip");

    const firstCard = await cards.nth(0).boundingBox();
    const secondCard = await cards.nth(1).boundingBox();
    expect(firstCard).not.toBeNull();
    expect(secondCard).not.toBeNull();
    expect(Math.abs(firstCard!.y - secondCard!.y)).toBeLessThanOrEqual(1);
    expect(secondCard!.x - firstCard!.x).toBeGreaterThan(0);

    const initialDock = await searchDock.boundingBox();
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const scrolledDock = await searchDock.boundingBox();
    expect(initialDock).not.toBeNull();
    expect(scrolledDock).not.toBeNull();
    expect(Math.abs(initialDock!.y - scrolledDock!.y)).toBeLessThanOrEqual(1);

    const firstImage = cards.locator("img").first();
    await expect(firstImage).toBeVisible();
    await expect
      .poll(() => firstImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("pc-discover-scrolled.png") });
  });
});

test.describe("つくる入口（3カード）", () => {
  test("おまかせ/シナリオ/こだわって の3ルートが説明文つきで表示される", async ({ page }) => {
    await page
      .locator("button:visible")
      .filter({ hasText: /^マイ$/ })
      .first()
      .click();
    await page.waitForTimeout(1000);
    await page
      .locator("button:visible, a:visible")
      .filter({ hasText: "あたらしい相手をつくる" })
      .first()
      .click();
    await page.waitForTimeout(1500);
    const body = page.locator("body");
    await expect(body).toContainText("おまかせでつくる");
    await expect(body).toContainText("シナリオからつくる");
    await expect(body).toContainText("こだわってつくる");
    // card3 の説明文が描画される（監査で検出した clip の回帰）
    await expect(body).toContainText("細部まで自分で決めたい人に");
  });
});
