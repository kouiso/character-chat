import { mkdir } from "node:fs/promises";
import path from "node:path";

import { setupFreshConversation } from "../e2e/conversation-setup";

import type { E2eEnv } from "../e2e/env";
import type { Browser, Locator, Page } from "playwright";

interface ChromiumLauncher {
  launch: () => Promise<Browser>;
}

const BASE_URL = process.env["SOLO_VERIFY_BASE_URL"] ?? "http://127.0.0.1:8789";
const USER_EMAIL = "solo-verify-2026-05-14@local.test";
const SCREENSHOT_DIR = path.join(".work", "verify-solo");
const MEMORY_NOTE_CONTENT = "テスト用記憶";
const PLAYWRIGHT_PACKAGE = "playwright";

type FeatureName =
  | "chat loaded"
  | "memory note creation"
  | "records drawer opens"
  | "branch tab renders";

type FeatureStatus = "PASS" | "FAIL";

interface FeatureResult {
  feature: FeatureName;
  status: FeatureStatus;
  screenshot: string;
  reason: string | null;
}

const featureResults: FeatureResult[] = [
  {
    feature: "chat loaded",
    status: "FAIL",
    screenshot: ".work/verify-solo/01-chat-loaded.png",
    reason: "not run",
  },
  {
    feature: "memory note creation",
    status: "FAIL",
    screenshot: ".work/verify-solo/03-memory-created.png",
    reason: "not run",
  },
  {
    feature: "records drawer opens",
    status: "FAIL",
    screenshot: ".work/verify-solo/05-records-drawer.png",
    reason: "not run",
  },
  {
    feature: "branch tab renders",
    status: "FAIL",
    screenshot: ".work/verify-solo/09-branch-tab.png",
    reason: "not run",
  },
];

const env: E2eEnv = {
  runId: "verify-solo",
  userEmail: USER_EMAIL,
  baseUrl: BASE_URL,
  cdpPort: 9222,
  maxTabs: 1,
  scenarioCooldownMs: 0,
  artifactRoot: SCREENSHOT_DIR,
  devOrigin: BASE_URL,
  workerOrigin: BASE_URL,
  resultsRoot: ".work",
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const screenshotPath = (name: string): string => path.join(SCREENSHOT_DIR, name);

const saveScreenshot = async (page: Page, name: string): Promise<string> => {
  const targetPath = screenshotPath(name);
  await page.screenshot({ path: targetPath, fullPage: false });
  return targetPath;
};

const loadChromium = async (): Promise<ChromiumLauncher> => {
  const playwright: { chromium: ChromiumLauncher } = await import(PLAYWRIGHT_PACKAGE);
  return playwright.chromium;
};

const setFeaturePass = (feature: FeatureName): void => {
  const result = featureResults.find((entry) => entry.feature === feature);
  if (!result) throw new Error(`unknown feature: ${feature}`);
  result.status = "PASS";
  result.reason = null;
};

const stripAnsi = (value: string): string => {
  let output = "";
  let inEscape = false;
  for (const char of value) {
    if (!inEscape && char === "\u001B") {
      inEscape = true;
      continue;
    }
    if (inEscape) {
      if (char === "m") inEscape = false;
      continue;
    }
    output += char;
  }
  return output;
};

const cleanReason = (reason: string | null): string =>
  stripAnsi(reason ?? "unknown")
    .split("Call log:")[0]
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) ?? "unknown";

const statusText = (result: FeatureResult): string =>
  result.status === "PASS" ? "PASS" : `FAIL ${cleanReason(result.reason)}`;

const printTable = (): void => {
  console.log("FEATURE              | STATUS | SCREENSHOT");
  for (const result of featureResults) {
    console.log(
      `${result.feature.padEnd(20)} | ${statusText(result).padEnd(6)} | ${result.screenshot}`,
    );
  }
};

const assertVisible = async (locator: Locator, label: string, timeout = 10_000): Promise<void> => {
  try {
    await locator.waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`${label} is not visible: ${formatError(error)}`);
  }
};

const verifyServer = async (): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/`);
  } catch (error) {
    console.error(`wrangler server is not reachable at ${BASE_URL}/: ${formatError(error)}`);
    process.exit(2);
  }

  if (response.status !== 200) {
    console.error(`wrangler server at ${BASE_URL}/ returned ${response.status}; expected 200`);
    process.exit(2);
  }
};

const clickBottomTab = async (page: Page, label: string): Promise<void> => {
  const nav = page.locator('nav[aria-label="メインタブ"]');
  const tab = nav.getByRole("button", { name: label, exact: true }).first();
  await assertVisible(tab, `${label} tab`);
  await tab.click({ force: true });
};

// 抽斗はせり上がる最中で、force click が空振りすることがある。
// 選択済みになるまで押し直す。
const openDrawerTab = async (page: Page, label: string): Promise<void> => {
  const tab = page.getByRole("tab", { name: label, exact: true }).first();
  await assertVisible(tab, `${label} tab`);
  const selected = page
    .locator('[role="tab"][aria-selected="true"]')
    .filter({ hasText: label })
    .first();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tab.scrollIntoViewIfNeeded();
    await tab.click({ force: true });
    try {
      await selected.waitFor({ state: "visible", timeout: 3_000 });
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`${label} tab did not become selected`);
};

const run = async (): Promise<void> => {
  await verifyServer();
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });

  try {
    const setup = await setupFreshConversation(page, env, "S1", "char-tsukasa", USER_EMAIL);
    await saveScreenshot(page, "01-chat-loaded.png");
    setFeaturePass("chat loaded");

    // マイ画面 → 記憶
    await page.getByRole("button", { name: "ホームへ戻る" }).click();
    await sleep(500);
    await clickBottomTab(page, "マイ");
    await assertVisible(page.getByText("マイ", { exact: true }).first(), "マイ heading");
    await saveScreenshot(page, "02-my-screen.png");

    const memoryRow = page.locator("button").filter({ hasText: "記憶" }).first();
    await assertVisible(memoryRow, "記憶 row");
    await memoryRow.scrollIntoViewIfNeeded();
    await memoryRow.click({ force: true });
    await assertVisible(page.getByText("記憶", { exact: true }).first(), "記憶 heading");
    await saveScreenshot(page, "03-memory-before-create.png");

    const addButton = page.locator("button").filter({ hasText: "覚えさせたいことを足す" }).first();
    await assertVisible(addButton, "add memory button");
    await addButton.click({ force: true });

    const textarea = page.getByRole("textbox", { name: "覚えさせたいこと" });
    await assertVisible(textarea, "memory textarea");
    await textarea.fill(MEMORY_NOTE_CONTENT);
    const saveButton = page.getByRole("button", { name: "これを事実にする", exact: true }).first();
    await assertVisible(saveButton, "save memory button");
    await saveButton.click({ force: true });

    await assertVisible(
      page.locator("div").filter({ hasText: MEMORY_NOTE_CONTENT }).first(),
      "created memory note",
      15_000,
    );
    await saveScreenshot(page, "03-memory-created.png");
    setFeaturePass("memory note creation");

    // チャットに戻る
    await page.getByRole("button", { name: "もどる" }).click();
    await sleep(300);
    await page.goto(`${BASE_URL}/chat?conv=${encodeURIComponent(setup.conversationId)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('[data-testid="message-bubble"]', { state: "visible", timeout: 15_000 });
    await sleep(500);
    await saveScreenshot(page, "04-chat-returned.png");

    // 設定シート → ふたりの記録
    const menuButton = page.getByRole("button", { name: "メニューを開く" }).first();
    await assertVisible(menuButton, "menu button");
    await menuButton.click({ force: true });
    const recordsButton = page.locator("button").filter({ hasText: "ふたりの記録" }).first();
    await assertVisible(recordsButton, "records button");
    await recordsButton.scrollIntoViewIfNeeded();
    await recordsButton.click({ force: true });
    await assertVisible(page.getByText("ふたりの抽斗").first(), "records drawer title");
    await saveScreenshot(page, "05-records-drawer.png");
    setFeaturePass("records drawer opens");

    // 場面タブ
    await openDrawerTab(page, "場面");
    await assertVisible(page.getByText("現在の場面").first(), "scene tab content");
    await saveScreenshot(page, "06-scene-tab.png");

    // 分岐タブ
    await openDrawerTab(page, "分岐");
    await assertVisible(page.getByText("まだ分岐はありません").first(), "branch empty state");
    await saveScreenshot(page, "09-branch-tab.png");
    setFeaturePass("branch tab renders");
  } catch (error) {
    const message = formatError(error);
    for (const result of featureResults) {
      if (result.status === "FAIL" && result.reason === "not run") {
        result.reason = message;
        break;
      }
    }
    throw error;
  } finally {
    await browser.close();
    printTable();
  }
};

run().catch((error: unknown) => {
  console.error(formatError(error));
  process.exit(1);
});
