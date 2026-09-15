import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const BASE_URL = process.env["BASE_URL"] ?? "http://127.0.0.1:8788";
const OUT_DIR = ".work/ux-screenshots";

interface Shot {
  name: string;
  route: string;
  viewport: { width: number; height: number };
  deviceLabel: string;
}

const shots: Shot[] = [
  { name: "home", route: "/", viewport: { width: 375, height: 812 }, deviceLabel: "mobile" },
  { name: "discover", route: "/discover", viewport: { width: 375, height: 812 }, deviceLabel: "mobile" },
  { name: "chat", route: "/chat/char-tsukasa", viewport: { width: 375, height: 812 }, deviceLabel: "mobile" },
  { name: "create", route: "/create", viewport: { width: 375, height: 812 }, deviceLabel: "mobile" },
  { name: "home-desktop", route: "/", viewport: { width: 1280, height: 832 }, deviceLabel: "desktop" },
  { name: "chat-desktop", route: "/chat/char-mitsuki", viewport: { width: 1280, height: 832 }, deviceLabel: "desktop" },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const paths: string[] = [];

  try {
    for (const shot of shots) {
      const context = await browser.newContext({ viewport: shot.viewport });
      const page = await context.newPage();

      // 年齢確認・オンボーディングをスキップして UI 本体を撮影
      await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        localStorage.setItem("age_verified", JSON.stringify({ verified: true, timestamp: Date.now() }));
        localStorage.setItem("ou_onboarded", "1");
      });

      await page.goto(`${BASE_URL}${shot.route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      const filePath = path.join(OUT_DIR, `${shot.deviceLabel}-${shot.name}.png`);
      await page.screenshot({ path: filePath, fullPage: false });
      paths.push(filePath);
      console.log(`[ux-screenshots] ${filePath}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`[ux-screenshots] captured ${paths.length} screenshots in ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
