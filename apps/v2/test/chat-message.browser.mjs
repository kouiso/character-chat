import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const output = resolve(process.env.RIT79_ARTIFACT_DIR ?? join(tmpdir(), "rit-79-message-layout"));
const port = Number(process.env.RIT79_PORT ?? 4179);
const origin = `http://127.0.0.1:${port}`;
const harness = `${output}/harness`;
const require = createRequire(`${repo}/package.json`);
const appRequire = createRequire(`${repo}/apps/v2/package.json`);
const { createServer } = await import(appRequire.resolve("vite"));
const { default: react } = await import(require.resolve("@vitejs/plugin-react"));
const { chromium } = require("playwright");
await mkdir(harness, { recursive: true });

const baselineRef = process.env.RIT79_BASELINE_REF;
const baseline = baselineRef
  ? execFileSync("git", ["show", `${baselineRef}:apps/v2/src/component/chat-view.tsx`], {
      cwd: repo,
      encoding: "utf8",
    }).replace('"../lib/sse-events"', JSON.stringify(`/@fs${repo}/apps/v2/src/lib/sse-events.ts`))
  : `export { ChatView } from "/@fs${repo}/apps/v2/src/component/chat-view.tsx";`;
await writeFile(`${harness}/baseline.tsx`, baseline);
await writeFile(
  `${harness}/index.html`,
  '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
);
await writeFile(
  `${harness}/entry.tsx`,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import "/@fs${repo}/apps/v2/src/style.css";
import { ChatView } from "/@fs${repo}/apps/v2/src/component/chat-view.tsx";
import { ChatView as Baseline } from "./baseline";
const query = new URLSearchParams(location.search);
const View = query.has("baseline") ? Baseline : ChatView;
createRoot(document.getElementById("root")!).render(<View characterId="synthetic-guide" characterName={query.get("name") ?? "サンプル案内役"} />);
`,
);

const server = await createServer({
  configFile: false,
  root: harness,
  cacheDir: `${output}/vite-cache`,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react$/, replacement: require.resolve("react") },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
      { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve("react/jsx-dev-runtime") },
      { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
      { find: /^react-dom$/, replacement: require.resolve("react-dom") },
    ],
  },
  server: { host: "127.0.0.1", port, strictPort: true, fs: { allow: [repo, output] } },
});
await server.listen();
let browser;
const results = [];
const events = (type, payload) => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
const fixtures = {
  normal:
    "<response><action>公園のベンチに地図を広げる。木の葉が静かに揺れている。</action><dialogue>「次は図書館まで歩こう。途中で休んでも大丈夫だよ🙂」</dialogue><inner>初めての道を見つけるのが楽しみ。</inner><action>道の先を指さす。</action></response>",
  long: `<response><action>合成の案内役が散歩の予定を確かめる。</action><dialogue>「${"川沿いの道を歩いて、次の角で図書館へ向かおう。".repeat(40)}\n${"UnbrokenSyntheticText".repeat(24)}」</dialogue><inner>最後までゆっくり読めるといいな。</inner></response>`,
  emoji: `<response><action>合成の絵文字を見比べる。🌸</action><dialogue>「${"👩🏽‍🚀🌸🏳️‍🌈👨‍👩‍👧‍👦🙂".repeat(22)}\n何個並んでも最後まで読めるよ。」</dialogue><inner>👩🏽‍🚀も家族の絵文字もひとまとまり。</inner></response>`,
};
for (const count of [14, 15, 16, 40]) {
  fixtures[`zwj-${count * 2 + 1}`] =
    `<action>合成の結合列。</action><dialogue>${"👩\u200d".repeat(count)}👩</dialogue><inner>本文は変えずに読む。</inner>`;
}
fixtures["modifier-41"] =
  `<action>合成の結合列。</action><dialogue>👩${"🏽".repeat(40)}</dialogue><inner>本文は変えずに読む。</inner>`;
fixtures["whitespace"] =
  " \n<response><action>手を振る。</action>\n\n<dialogue>「こんにちは🙂」</dialogue>\n<inner>また明日。</inner></response> \t";
const sizes = [
  { width: 375, height: 812 },
  { width: 1280, height: 900 },
  { width: 812, height: 375 },
];

const mockChat = async (page, text) => {
  const history = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/chat/synthetic-guide/history") {
      return route.fulfill({ status: 200, json: { history, turn: history.length / 2 + 1 } });
    }
    if (url.pathname === "/api/chat/synthetic-guide") {
      assert.equal(route.request().method(), "POST");
      const input = route.request().postDataJSON();
      assert.equal(typeof input.text, "string");
      history.push({ role: "user", content: input.text }, { role: "assistant", content: text });
      const body =
        events("chunk", { seq: 0, text }) +
        events("done", {
          conversationId: input.conversationId ?? "synthetic-conversation",
          turn: history.length / 2,
          generationId: null,
        });
      return route.fulfill({ status: 200, contentType: "text/event-stream", body });
    }
    return route.continue();
  });
};

const inspect = async (page) =>
  page.evaluate(() => {
    const overflow = [
      ...document.querySelectorAll(
        ".v2-chat, .v2-chat-log, .v2-bubble, .v2-message, .v2-message-text, .v2-message-name",
      ),
    ]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => ({ class: el.className, scroll: el.scrollWidth, client: el.clientWidth }));
    const paragraphs = [...document.querySelectorAll(".v2-message-text, .v2-message-name")];
    const invisible = paragraphs
      .filter((el) => {
        for (let node = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (
            style.display === "none" ||
            style.visibility !== "visible" ||
            Number(style.opacity) === 0
          )
            return true;
        }
        return el.getClientRects().length === 0;
      })
      .map((el) => el.className);
    const rects = paragraphs.flatMap((el, owner) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          owner,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        }));
    });
    const overlaps = [];
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const one = rects[a],
          two = rects[b];
        const width = Math.min(one.right, two.right) - Math.max(one.left, two.left);
        const height = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
        if (width > 1 && height > 1) overlaps.push({ one, two });
      }
    }
    const log = document.querySelector(".v2-chat-log");
    return {
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      overflow,
      invisible,
      overlaps,
      textRects: rects.length,
      viewport: { width: innerWidth, height: innerHeight },
      documentHeight: document.documentElement.scrollHeight,
      scrollY,
      log: { clientHeight: log.clientHeight, scrollHeight: log.scrollHeight },
      layers: [...document.querySelectorAll(".v2-message-layer")].map((el) => ({
        label: el.getAttribute("aria-label"),
        text: el.textContent,
      })),
    };
  });

try {
  browser = await chromium.launch({
    executablePath: process.env.RIT79_CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  for (const size of sizes) {
    for (const [scenario, text] of Object.entries(fixtures)) {
      const context = await browser.newContext({ viewport: size, locale: "ja-JP" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mockChat(page, text);
      const zwj =
        scenario === "modifier-41"
          ? `👩${"🏽".repeat(40)}`
          : scenario.startsWith("zwj-")
            ? `${"👩\u200d".repeat(40)}👩`
            : null;
      await page.goto(zwj ? `${origin}/?${new URLSearchParams({ name: zwj })}` : origin);
      await page
        .getByPlaceholder("メッセージを入力")
        .fill(
          zwj ??
            (scenario === "long"
              ? "合成の長い散歩予定🙂" + "SyntheticUserText".repeat(25)
              : "合成の公園へ行こう🙂"),
        );
      await page.getByRole("button", { name: "送信" }).click();
      await page.getByRole("group", { name: "心の声", exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector(".v2-bubble.pending"));
      assert.equal(
        await page.getByRole("alert").count(),
        0,
        "chat should finish without a recovery error",
      );
      await page.evaluate(() => document.fonts.ready);
      await page.locator(".v2-chat-log").evaluate((el) => {
        el.scrollTop = 0;
      });
      const prefix = `${scenario}-${size.width}x${size.height}`;
      const result = await inspect(page);
      assert.equal(result.documentOverflow, false, `${prefix}: document overflow`);
      assert.deepEqual(result.overflow, [], `${prefix}: element overflow`);
      assert.deepEqual(result.invisible, [], `${prefix}: invisible message text`);
      assert.deepEqual(result.overlaps, [], `${prefix}: overlapping text`);
      assert.deepEqual(errors, [], `${prefix}: browser errors`);
      assert.equal(
        result.layers.map((layer) => layer.text).join(""),
        text.replace(/<\/?(?:response|action|dialogue|inner)>/g, ""),
        `${prefix}: content loss`,
      );
      await writeFile(
        `${output}/${prefix}.snapshot.yml`,
        await page.locator("body").ariaSnapshot(),
      );
      await page.screenshot({ path: `${output}/${prefix}-top.png`, fullPage: true });
      if (result.log.scrollHeight > result.log.clientHeight) {
        await page.locator(".v2-chat-log").evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await page.screenshot({ path: `${output}/${prefix}-bottom.png`, fullPage: true });
      }
      results.push({ scenario, ...result, browserErrors: errors });
      console.log(`${prefix}: overflow=0 overlap=0 textRects=${result.textRects}`);

      if (scenario === "normal" && size.width === 375) {
        const hiddenStyle = await page.addStyleTag({
          content: ".v2-message-layer { opacity: 0; }",
        });
        const hidden = await inspect(page);
        assert.ok(hidden.invisible.length > 0, "visibility guard must reject hidden layers");
        await hiddenStyle.evaluate((el) => el.remove());
        for (const rotatedSize of [{ width: 812, height: 375 }, size]) {
          await page.setViewportSize(rotatedSize);
          const rotated = await inspect(page);
          assert.equal(rotated.documentOverflow, false, "rotation: document overflow");
          assert.deepEqual(rotated.overflow, [], "rotation: element overflow");
          assert.deepEqual(rotated.overlaps, [], "rotation: overlapping text");
          await page.screenshot({
            path: `${output}/rotation-${rotatedSize.width}x${rotatedSize.height}.png`,
            fullPage: true,
          });
          results.push({ scenario: "rotation", ...rotated });
        }
        if (baselineRef) {
          await page.goto(`${origin}/?baseline=1`);
          await page.getByPlaceholder("メッセージを入力").fill("合成の公園へ行こう🙂");
          await page.getByRole("button", { name: "送信" }).click();
          await page.waitForFunction(() =>
            document.querySelector(".v2-bubble.assistant:not(.pending)"),
          );
          await page.screenshot({ path: `${output}/before-375x812.png`, fullPage: true });
        }
      }
      await context.close();
    }
  }
  for (const baseline of baselineRef ? [true, false] : [false]) {
    const context = await browser.newContext({ viewport: sizes[0], locale: "ja-JP" });
    const page = await context.newPage();
    await mockChat(page, fixtures.normal);
    await page.goto(`${origin}/${baseline ? "?baseline=1" : ""}`);
    for (let turn = 1; turn <= 4; turn++) {
      await page.getByPlaceholder("メッセージを入力").fill(`合成の続き${turn}`);
      await page.getByRole("button", { name: "送信" }).click();
      await page.waitForFunction(
        (count) => document.querySelectorAll(".v2-bubble.assistant:not(.pending)").length === count,
        turn,
      );
      if (!baseline) {
        await page.waitForFunction(() => !document.querySelector(".v2-chat-form input").disabled);
        assert.equal(
          await page.getByRole("alert").count(),
          0,
          "followup should finish without a recovery error",
        );
      }
    }
    const latest = await page.evaluate(() => {
      const log = document.querySelector(".v2-chat-log");
      const last = document.querySelector(".v2-bubble.assistant:last-child");
      return {
        scrollTop: log.scrollTop,
        latestBottom: last.getBoundingClientRect().bottom,
        logBottom: log.getBoundingClientRect().bottom,
      };
    });
    await page.screenshot({
      path: `${output}/${baseline ? "before" : "after"}-followup-latest-375x812.png`,
      fullPage: true,
    });
    const latestVisible = latest.latestBottom <= latest.logBottom + 1;
    if (!baseline)
      assert.equal(
        latestVisible,
        true,
        "new reply should remain visible while reading at the bottom",
      );
    console.log(
      `${baseline ? "baseline" : "current"} four-turn followup: latestVisible=${latestVisible} scrollTop=${latest.scrollTop}`,
    );
    results.push({
      scenario: baseline ? "baseline-followup" : "current-followup",
      ...latest,
      latestVisible,
    });
    if (!baseline) {
      const log = page.getByRole("log", { name: "会話のメッセージ" });
      await log.evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.getByPlaceholder("メッセージを入力").fill("合成の続き5");
      await page.getByRole("button", { name: "送信" }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".v2-bubble.assistant:not(.pending)").length === 5,
      );
      const readingScrollTop = await log.evaluate((el) => el.scrollTop);
      assert.equal(readingScrollTop, 0, "new reply should not steal the reading position");
      results.push({ scenario: "history-reading", scrollTop: readingScrollTop });
      await page.screenshot({ path: `${output}/history-reading-375x812.png`, fullPage: true });
      await page.setViewportSize({ width: 375, height: 400 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(
        await log.evaluate((el) => el.scrollTop),
        0,
        "resize should preserve the reading position",
      );
      await page.setViewportSize(sizes[0]);
      await log.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      for (const viewport of [{ width: 375, height: 400 }, { width: 812, height: 375 }, sizes[0]]) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(
          () => {
            const el = document.querySelector(".v2-chat-log");
            return el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
          },
          null,
          { timeout: 5000 },
        );
        const distanceFromBottom = await log.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        );
        const metrics = await inspect(page);
        assert.deepEqual(metrics.overflow, [], "followup resize: element overflow");
        assert.deepEqual(metrics.overlaps, [], "followup resize: overlapping text");
        assert.deepEqual(metrics.invisible, [], "followup resize: invisible text");
        await page.screenshot({
          path: `${output}/followup-resize-${viewport.width}x${viewport.height}.png`,
          fullPage: true,
        });
        results.push({ scenario: "followup-resize", viewport, distanceFromBottom });
      }
      const largerText = await page.addStyleTag({
        content: ".v2-message-text { font-size: 28px; }",
      });
      await page.waitForFunction(
        () => {
          const el = document.querySelector(".v2-chat-log");
          return el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
        },
        null,
        { timeout: 5000 },
      );
      const textResizeGap = await log.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      );
      await page.screenshot({ path: `${output}/followup-text-resize-375x812.png`, fullPage: true });
      results.push({ scenario: "followup-text-resize", distanceFromBottom: textResizeGap });
      await largerText.evaluate((el) => el.remove());
    }
    await context.close();
  }
  await writeFile(`${output}/layout-results.json`, JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
