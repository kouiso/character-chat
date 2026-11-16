// ストーリー作成欄が狭い画面ではみ出さないことを、実ブラウザの実測で確かめる（#178）。
// 事前に v2 をローカルで起動し、最長名のキャラを含むデータを入れておく（test/README.md）。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const { chromium } = createRequire(`${repo}/package.json`)("playwright");

const base = process.env.V2_URL ?? "http://127.0.0.1:3111";
const httpCredentials = {
  username: process.env.V2_USER ?? "e2e",
  password: process.env.V2_PASS ?? "e2e-local-pass",
};
const longestId = process.env.V2_LONGEST_CHARACTER_ID ?? "long-name";
const shot = process.env.SHOT_PATH;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  for (const width of [375, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 812 },
      deviceScaleFactor: 2,
      httpCredentials,
    });
    const page = await context.newPage();
    await page.goto(`${base}/stories`);
    await page.locator("form.v2-story-create select").selectOption(longestId);
    if (shot && width === 375) await page.screenshot({ path: shot });
    const m = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      rects: [...document.querySelectorAll("form.v2-story-create > *")].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      }),
    }));
    assert.equal(m.rects.length, 3, "選択欄・題・作成ボタンの 3 部品");
    assert.ok(m.scroll <= width, `${width}px: ページ幅 ${m.scroll} が画面幅を超えた`);
    for (const r of m.rects) {
      assert.ok(r.left >= 0 && r.right <= width, `${width}px: 部品が画面外 ${r.left}-${r.right}`);
    }
    await context.close();
  }

  const wide = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    httpCredentials,
  });
  const page = await wide.newPage();
  await page.goto(`${base}/stories`);
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll("form.v2-story-create > *")].map((el) =>
      Math.round(el.getBoundingClientRect().top),
    ),
  );
  assert.equal(new Set(tops).size, 1, "広い画面では横一列のまま");
  console.log("story-create layout OK");
} finally {
  await browser.close();
}
