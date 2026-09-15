#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT_DIR = path.join(process.cwd(), ".work", "app-shot");
const VIEWPORT = { width: 375, height: 667 };

const screens = ["home", "my", "discover", "photo", "talk"];
const screenArg = process.argv.find((arg) => arg.startsWith("--screen="));
const filter = screenArg?.slice("--screen=".length);
const targets = filter ? screens.filter((screen) => screen === filter) : screens;

if (filter && targets.length === 0) {
  console.error(`Unknown --screen value: ${filter}. Expected one of: ${screens.join(", ")}`);
  process.exit(2);
}

const waitForApp = async (page) => {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page
    .getByRole("button", { name: /はい、?18歳以上です/ })
    .click({ timeout: 2_000 })
    .catch(() => undefined);
  await page.waitForTimeout(250);
};

const assertRendered = async (page, screen) => {
  const rootState = await page.evaluate(() => {
    const root = document.querySelector("#root");
    return {
      exists: Boolean(root),
      textLength: root?.textContent?.trim().length ?? 0,
      childCount: root?.childElementCount ?? 0,
      bodyTextLength: document.body.textContent?.trim().length ?? 0,
    };
  });
  if (!rootState.exists || rootState.childCount === 0 || rootState.bodyTextLength === 0) {
    throw new Error(`${screen}: root is empty (${JSON.stringify(rootState)})`);
  }
};

const clickTab = async (page, label) => {
  await page.getByRole("button", { name: label }).click({ timeout: 10_000 });
  await page.waitForTimeout(350);
};

const openScreen = async (page, screen) => {
  await waitForApp(page);
  if (screen === "home") {
    await clickTab(page, "ホーム");
    return;
  }
  if (screen === "my") {
    await clickTab(page, "マイ");
    return;
  }
  if (screen === "discover") {
    await clickTab(page, "さがす");
    return;
  }
  if (screen === "photo") {
    await clickTab(page, "アルバム");
    return;
  }
  if (screen === "talk") {
    await clickTab(page, "ホーム");
    const homeCard = page
      .locator("main button")
      .filter({ hasNotText: /ホーム|さがす|アルバム|マイ/ })
      .first();
    await homeCard.click({ timeout: 10_000 });
    await page.waitForTimeout(500);
    return;
  }
  throw new Error(`Unhandled screen: ${screen}`);
};

const browser = await chromium.launch();
const failures = [];
try {
  await mkdir(OUT_DIR, { recursive: true });
  for (const screen of targets) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    try {
      await page.addInitScript(() => {
        localStorage.setItem("ou_onboarded", "1");
        localStorage.setItem(
          "age_verified",
          JSON.stringify({ verified: true, timestamp: Date.now() }),
        );
      });
      await openScreen(page, screen);
      await assertRendered(page, screen);
      if (consoleErrors.length > 0) {
        throw new Error(`${screen}: console errors:\n${consoleErrors.join("\n")}`);
      }
      const outPath = path.join(OUT_DIR, `${screen}.png`);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`${screen}: ${outPath}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
