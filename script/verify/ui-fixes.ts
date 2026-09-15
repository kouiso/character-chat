import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const BASE_URL = process.env["BASE_URL"] ?? "http://127.0.0.1:8789";
const OUT_DIR = ".work/ui-fixes-2026-07-31";

async function skipOnboarding(page: import("playwright").Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem("age_verified", JSON.stringify({ verified: true, timestamp: Date.now() }));
    localStorage.setItem("ou_onboarded", "1");
  });
}

async function captureMyPage(page: import("playwright").Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/my`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const filePath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`[ui-fixes] ${filePath}`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await skipOnboarding(page);

    await captureMyPage(page, "desktop-my-page");
  } finally {
    await browser.close();
  }

  console.log(`[ui-fixes] screenshots saved to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
