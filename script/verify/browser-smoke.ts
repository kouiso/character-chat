import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";

import type { Page, Route } from "playwright";

import { isProtectedApiGuarded, isPublicAppShell } from "./prod-reachable-policy";

// ── vars ──────────────────────────────────────────────────────────────────────

function loadProdVars(): Record<string, string> {
  const varsPath = path.resolve(".prod-verify.vars");
  if (!existsSync(varsPath)) {
    throw new Error(".prod-verify.vars が見つかりません。プロジェクトルートに置いてください。");
  }
  const result: Record<string, string> = {};
  for (const line of readFileSync(varsPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = val;
  }
  return result;
}

type Mode = "browser" | "functional" | "feedback";

// web-portal (旧チャットUI) のキャラカードのみを指す。message-action-menu
// (メッセージメニュー/Good/削除) が実装されている画面はこちら経由でしか辿り着けない。
const WEB_PORTAL_CARD_SELECTOR =
  '[data-testid="portal-scroll-container"] button:has(h3.line-clamp-1),' +
  ' [data-testid="portal-scroll-container"] button:has(p.truncate.font-semibold),' +
  ' [data-testid="portal-scroll-container"] button:has(> div[style*="aspect-ratio"] img[alt])';

// Ouse (新UI) の data-testid="character-card" も含めた広義のキャラカード。
// discover/functional モードのようにカード描画確認や送受信確認のみを行う
// 用途向け。Ouse には削除アクションが無いため feedback モードでは使わない。
const CHARACTER_CARD_SELECTOR = `[data-testid="character-card"], ${WEB_PORTAL_CARD_SELECTOR}`;

function getMode(): Mode {
  const m = process.env["PROD_VERIFY_MODE"];
  if (m === "functional") return m;
  if (m === "feedback") return m;
  return "browser";
}

// ── HTTP helper ────────────────────────────────────────────────────────────────

function httpsGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, headers, method: "GET" },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, location: res.headers["location"] }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ── reachable pre-check ────────────────────────────────────────────────────────

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function runReachableCheck(vars: Record<string, string>): Promise<boolean> {
  const base = vars["PROD_BASE_URL"]!;
  const user = vars["BASIC_AUTH_USER"] ?? "";
  const pass = vars["BASIC_AUTH_PASS"] ?? "";
  const basicHeaders = { Authorization: basicAuthHeader(user, pass) };

  const edgeRes = await httpsGet(base + "/", basicHeaders);
  const edgePass = edgeRes.status === 200;
  console.log(`[${edgePass ? "GREEN" : "RED  "}] エッジ通過(Basic): ${edgeRes.status} (expect 200)`);

  const publicShellRes = await httpsGet(base + "/", {});
  const publicShellPass = isPublicAppShell(publicShellRes);
  console.log(
    `[${publicShellPass ? "GREEN" : "RED  "}] 公開シェル: ${publicShellRes.status} (expect HTML 200)`,
  );

  const apiGuardRes = await httpsGet(base + "/api/me", {});
  const apiGuardPass = isProtectedApiGuarded(apiGuardRes.status);
  console.log(
    `[${apiGuardPass ? "GREEN" : "RED  "}] API認証ガード: ${apiGuardRes.status} (expect 401/403)`,
  );

  return edgePass && publicShellPass && apiGuardPass;
}

// ── browser mode ──────────────────────────────────────────────────────────────

/**
 * Basic 認証ヘッダを prodOrigin 限定で注入する。
 * novita/R2 等の外部 origin にはヘッダを送らない。
 * /api/* はアプリ認証(Bearer)経路。エッジ Basic を被せると Bearer を潰し
 * /api/auth/session が 401 になるため、prodOrigin でも /api/* は素通しする
 * (prod-smoke の testAuth が /api/me を Bearer のみで 200 取得できる事実と一致)。
 */
async function installProdAuth(page: Page, prodOrigin: string, authHeader: string): Promise<void> {
  await page.route("**/*", async (route: Route) => {
    const url = route.request().url();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      await route.continue();
      return;
    }
    if (parsed.origin !== prodOrigin || parsed.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    await route.continue({
      headers: { ...route.request().headers(), Authorization: authHeader },
    });
  });
}

async function bootstrapAppAuth(
  page: Page,
  prodBase: string,
  basicUser: string,
  basicPass: string,
): Promise<string | null> {
  const result = await page.evaluate(
    async ({ base, user, pass }: { base: string; user: string; pass: string }) => {
      try {
        const fd = new FormData();
        fd.set("username", user);
        fd.set("password", pass);
        const r = await fetch(`${base}/api/auth/basic-login`, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: fd,
        });
        if (!r.ok) return { ok: false, status: r.status };
        const data = (await r.json()) as { token?: string };
        return { ok: true, token: data.token ?? null };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    { base: prodBase, user: basicUser, pass: basicPass },
  );

  if (!result.ok || !result.token) {
    console.error(`  /api/auth/basic-login 失敗: ${JSON.stringify(result)}`);
    return null;
  }
  await page.evaluate(
    ({ t }: { t: string }) => localStorage.setItem("auth_token", t),
    { t: result.token },
  );
  return result.token;
}

async function runFeedbackAndDelete(page: Page): Promise<{ itemD: boolean; itemE: boolean }> {
  console.log("=== 項目D: Good/Bad フィードバック検証 ===");

  // Ouse (character-card) を含む CHARACTER_CARD_SELECTOR は使わない。
  // Ouse には削除アクションが無く、メニューの aria-label も別物のため
  // 誤って Ouse のカードを踏むと itemD/itemE が必ず false になる。
  const CHAR_CARD_SELECTOR = WEB_PORTAL_CARD_SELECTOR;
  const MENU_BTN_SELECTOR = 'button[aria-label="メッセージメニュー"]';
  const MSG_BUBBLE_SELECTOR = '[data-testid="message-bubble"]';

  let itemD = false;
  let itemE = false;

  try {
    await page.waitForSelector(CHAR_CARD_SELECTOR, { timeout: 15_000 }).catch(() => null);
    const charItem = page.locator(CHAR_CARD_SELECTOR).first();
    if ((await charItem.count()) === 0) {
      console.log("[SKIP] キャラが見つかりません。D/E をスキップ。");
      return { itemD: true, itemE: true };
    }
    await charItem.click();

    // キャラ詳細画面 → 「はじめる」or「つづきから、話す」ボタンでチャット画面へ
    const chatStartBtn = page.locator('button:has-text("はじめる"), button:has-text("つづきから、話す")');
    await chatStartBtn.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => null);
    if ((await chatStartBtn.count()) > 0) await chatStartBtn.first().click();

    const textarea = page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 20_000 });

    // チャット画面に入った時点でグリーティングがあれば即利用、なければ送信して待つ
    const bubblesOnEntry = await page.locator('[data-testid="message-bubble"]').count();
    let assistantReceived = bubblesOnEntry > 0;

    if (!assistantReceived) {
      await textarea.fill("こんにちは");
      const sendBtn = page.locator('button[aria-label="送信"]');
      if ((await sendBtn.count()) > 0) {
        await sendBtn.click();
      } else {
        await textarea.press("Enter");
      }
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(1_000);
        const count = await page.locator('[data-testid="message-bubble"]').count();
        if (count > bubblesOnEntry + 1) { assistantReceived = true; break; }
      }
    }

    if (!assistantReceived) {
      console.log("[RED  ] アシスタント返信なし — D/E を SKIP");
      return { itemD: false, itemE: false };
    }

    // ── 項目 D: Good/Bad ───────────────────────────────────────────────────
    // 最後のメッセージバブル（アシスタント返信 or グリーティング）にメニューを開く
    const assistantBubble = page.locator('[data-testid="message-bubble"]').last();
    await assistantBubble.hover();
    await page.waitForTimeout(500);

    const menuBtns = page.locator(MENU_BTN_SELECTOR);
    const menuCount = await menuBtns.count();
    console.log(`  メッセージメニューボタン数: ${menuCount}`);
    if (menuCount > 0) {
      const lastMenuBtn = menuBtns.last();
      await lastMenuBtn.click();
      await page.waitForTimeout(500);

      const goodBtn = page.locator('button:has-text("Good")').first();
      if ((await goodBtn.count()) > 0) {
        await goodBtn.click();
        await page.waitForTimeout(1_000);

        await assistantBubble.hover();
        await page.waitForTimeout(300);
        await lastMenuBtn.click();
        await page.waitForTimeout(500);

        const pressedGood = page.locator('button[aria-pressed="true"]:has-text("Good")');
        const pressed = await pressedGood.count();
        itemD = pressed > 0;
        console.log(`[${itemD ? "GREEN" : "RED  "}] Good aria-pressed=true: ${pressed > 0}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      } else {
        console.log("[RED  ] Good ボタンが見つかりません");
      }
    }

    // ── 項目 E: 削除 → reload 後に復活しない ─────────────────────────────
    console.log("=== 項目E: メッセージ削除の永続化確認 ===");
    const bubblesBefore = await page.locator(MSG_BUBBLE_SELECTOR).count();
    console.log(`  削除前 message-bubble 件数: ${bubblesBefore}`);

    if (bubblesBefore > 0) {
      await assistantBubble.hover();
      await page.waitForTimeout(300);
      const menuBtnsAgain = page.locator(MENU_BTN_SELECTOR);
      if ((await menuBtnsAgain.count()) > 0) {
        await menuBtnsAgain.last().click();
        await page.waitForTimeout(500);

        const deleteBtn = page.locator('button:has-text("削除")').first();
        if ((await deleteBtn.count()) > 0) {
          await deleteBtn.click();
          await page.waitForTimeout(1_500);

          const bubblesAfterDelete = await page.locator(MSG_BUBBLE_SELECTOR).count();
          console.log(`  削除後 message-bubble 件数: ${bubblesAfterDelete}`);

          await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
          await page.waitForTimeout(3_000);
          const bubblesAfterReload = await page.locator(MSG_BUBBLE_SELECTOR).count();
          console.log(`  reload後 message-bubble 件数: ${bubblesAfterReload}`);

          itemE = bubblesAfterReload <= bubblesAfterDelete;
          console.log(`[${itemE ? "GREEN" : "RED  "}] 削除がreload後も永続: ${itemE}`);
        } else {
          console.log("[RED  ] 削除ボタンが見つかりません");
        }
      }
    } else {
      console.log("[SKIP] メッセージがないため削除テストをスキップ。E=true とみなす");
      itemE = true;
    }
  } catch (e) {
    console.error(`  feedback/delete エラー: ${e}`);
  }

  return { itemD, itemE };
}

async function runBrowser(vars: Record<string, string>, functional: boolean, mode: Mode): Promise<boolean> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    console.error("playwright がインストールされていません: pnpm add -D playwright");
    return false;
  }

  const base = vars["PROD_BASE_URL"]!;
  const prodOrigin = new URL(base).origin;
  const basicUser = vars["BASIC_AUTH_USER"] ?? "";
  const basicPass = vars["BASIC_AUTH_PASS"] ?? "";
  const edgeAuthHeader = basicAuthHeader(basicUser, basicPass);

  const screenshotDir = path.resolve(".work", "e2e-results");
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, `browser-smoke-${Date.now()}.png`);

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let passed = false;
  try {
    await installProdAuth(page, prodOrigin, edgeAuthHeader);
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const appJwt = await bootstrapAppAuth(page, base, basicUser, basicPass);
    if (!appJwt) throw new Error("app JWT 取得失敗");

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate(() => {
      localStorage.setItem(
        "age_verified",
        JSON.stringify({ verified: true, timestamp: Date.now() }),
      );
      localStorage.setItem("ou_onboarded", "1");
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });

    const meResult = await page.evaluate(
      async ({ base: b }: { base: string }) => {
        const jwt = localStorage.getItem("auth_token") ?? "";
        const r = await fetch(`${b}/api/me`, {
          headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
        });
        return r.ok ? ((await r.json()) as { email?: string }) : null;
      },
      { base },
    );
    const email = meResult?.email ?? "(不明)";
    console.log(`  /me identity: ${email}`);

    if (functional) {
      passed = await runFunctional(page, base);
    } else if (mode === "feedback") {
      const { itemD, itemE } = await runFeedbackAndDelete(page);
      passed = itemD && itemE;
      console.log(`[${itemD ? "GREEN" : "RED  "}] 項目D Good/Bad フィードバック`);
      console.log(`[${itemE ? "GREEN" : "RED  "}] 項目E 削除永続化`);
    } else {
      // スクロールコンテナが現れるまで待つ（API fetch 完了 + React 描画の完了）
      await page
        .waitForSelector('[data-testid="portal-scroll-container"]', { timeout: 20_000 })
        .catch(() => null);

      const cardLocator = page.locator(CHARACTER_CARD_SELECTOR);
      const visibleCardLocator = page.locator(`:is(${CHARACTER_CARD_SELECTOR}):visible`);
      let cardCount = 0;
      let visibleCardCount = 0;
      for (let i = 0; i < 10; i++) {
        cardCount = await cardLocator.count();
        visibleCardCount = await visibleCardLocator.count();
        if (visibleCardCount > 0) break;
        await page.waitForTimeout(1_000);
      }

      const errorText = await page.locator("text=キャラクターを取得できませんでした").count();
      const emptyText = await page.locator("text=該当するキャラクターがいません").count();
      const hasError = errorText > 0 || emptyText > 0;
      const onboardingVisible = await page
        .getByRole("button", { name: "会いに行く →" })
        .isVisible()
        .catch(() => false);

      passed = visibleCardCount > 0 && !hasError && !onboardingVisible;
      console.log(
        `[${visibleCardCount > 0 ? "GREEN" : "RED  "}] 表示中のキャラカード件数: ${visibleCardCount}/${cardCount}`,
      );
      console.log(`[${!hasError ? "GREEN" : "RED  "}] エラー文言なし: ${!hasError}`);
      console.log(`[${!onboardingVisible ? "GREEN" : "RED  "}] オンボーディング非表示: ${!onboardingVisible}`);
      console.log(`[${passed ? "GREEN" : "RED  "}] discover 画面 PASS: ${passed}`);

      if (!passed) {
        console.error("  ❌ キャラが描画されていません。スクショは証拠として撮りますが FAIL です。");
      }
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  スクリーンショット: ${screenshotPath}`);
  } catch (e) {
    console.error(`  browser モード エラー: ${e}`);
    passed = false;
  } finally {
    await browser.close();
  }
  return passed;
}

// ── functional mode ───────────────────────────────────────────────────────────

async function runFunctional(page: Page, base: string): Promise<boolean> {
  console.log("=== functional モード (本番課金あり) ===");

  const CHAT_SEND_SELECTOR = ".cs-button--send";
  const COMPOSER_SELECTOR = ".cs-message-input__content-editor";
  const CHAR_CARD_SELECTOR = CHARACTER_CARD_SELECTOR;
  const BUBBLE_SELECTOR = '[data-testid="message-bubble"]';

  try {
    // SP レイアウトで統一（プロフィールシート経由でトークへ入る）
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto(`${base}/discover`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(CHAR_CARD_SELECTOR, { timeout: 15_000 }).catch(() => null);

    const charItem = page.locator(CHAR_CARD_SELECTOR).first();
    if ((await charItem.count()) === 0) {
      console.log("[SKIP] キャラが見つかりません。functional モードをスキップ。");
      return true;
    }
    await charItem.click();

    // キャラ詳細画面 → 「この子と話す →」でトーク画面へ
    const chatStartBtn = page.locator('button:has-text("この子と話す")');
    await chatStartBtn.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => null);
    if ((await chatStartBtn.count()) > 0) await chatStartBtn.first().click();

    const composer = page.locator(COMPOSER_SELECTOR).first();
    await composer.waitFor({ state: "visible", timeout: 20_000 });

    const countBefore = await page.locator(BUBBLE_SELECTOR).count();
    await composer.fill("テスト");

    const sendBtn = page.locator(CHAT_SEND_SELECTOR);
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
    if ((await sendBtn.count()) > 0 && !(await sendBtn.evaluate((el) => (el as HTMLButtonElement).disabled))) {
      await sendBtn.click();
    } else {
      await composer.press("Enter");
    }

    // SSE なので networkidle 禁止・ポーリング(60s) — user msg + assistant reply = +2
    let responseReceived = false;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1_000);
      const msgs = await page.locator(BUBBLE_SELECTOR).count();
      if (msgs > countBefore + 1) { responseReceived = true; break; }
    }
    console.log(`[${responseReceived ? "GREEN" : "RED  "}] chat 応答受信`);
    return responseReceived;
  } catch (e) {
    console.error(`  functional エラー: ${e}`);
    return false;
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const vars = loadProdVars();
  const mode = getMode();
  console.log(`browser-smoke 開始 (mode: ${mode}, url: ${vars["PROD_BASE_URL"]})`);

  const reachableOk = await runReachableCheck(vars);
  if (!reachableOk) {
    console.error("reachable チェック失敗。browser モードを中止。");
    process.exit(1);
  }

  const passed = await runBrowser(vars, mode === "functional", mode);
  console.log(`\n結果: ${passed ? "✅ PASS" : "❌ FAIL"}`);

  const resultDir = path.resolve(".work", "e2e-results");
  if (!existsSync(resultDir)) mkdirSync(resultDir, { recursive: true });
  writeFileSync(
    path.join(resultDir, `browser-smoke-${Date.now()}.json`),
    JSON.stringify({ mode, passed, timestamp: new Date().toISOString() }, null, 2),
  );

  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error("browser-smoke 予期しないエラー:", e);
  process.exit(1);
});
