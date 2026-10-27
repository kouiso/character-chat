import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import viteReact from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(app, "../..");
const evidence = process.env.RIT105_EVIDENCE_DIR ?? path.join(repo, ".work/rit-105-browser");
const root = await mkdtemp(path.join(tmpdir(), "rit-105-browser-"));
process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_REGISTRY_PATH = path.join(root, "registry");
process.env.WRANGLER_LOG_PATH = path.join(root, "wrangler.log");

let local;
let server;
let browser;
let releaseRestore;
let holdRestore = false;
const failures = [];
const calls = [];

const write = (message) => process.stdout.write(`${message}\n`);

try {
  await mkdir(evidence, { recursive: true });
  await symlink(path.join(app, "node_modules"), path.join(root, "node_modules"), "dir");
  await writeFile(
    path.join(root, "index.html"),
    '<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    path.join(root, "main.tsx"),
    `
import React from "react";
import { createRoot } from "react-dom/client";
import { CharacterWorkspace } from ${JSON.stringify(path.join(app, "src/component/character-workspace.tsx"))};
import ${JSON.stringify(path.join(app, "src/style.css"))};
const call = async (method, value) => {
  const response = await fetch("/__character/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value ?? null),
  });
  if (!response.ok) throw new Error("Synthetic transport failed");
  return response.json();
};
const listed = await call("list");
createRoot(document.getElementById("root")).render(<CharacterWorkspace
  characters={listed.ok ? listed.data.characters : []}
  transport={{ list: () => call("list"), load: (id) => call("load", id), save: (input) => call("save", input), restore: (input) => call("restore", input) }}
/>);
`,
  );
  const [{ createCharacterActions }, { openCharacterTestDb }] = await Promise.all([
    import("../src/server/character-actions.ts"),
    import("../../../packages/db/src/test/character-local-d1.ts"),
  ]);
  local = await openCharacterTestDb();
  const actions = createCharacterActions(
    async () => local.db,
    () => ({ characterActor: { userId: "synthetic-owner" } }),
  );
  server = await createServer({
    configFile: false,
    root,
    envDir: root,
    cacheDir: path.join(root, "vite-cache"),
    plugins: [
      viteReact(),
      {
        name: "rit-105-synthetic-character-actions",
        configureServer(vite) {
          vite.middlewares.use("/__character", async (request, response) => {
            try {
              const method = request.url?.split("?")[0].slice(1);
              const buffers = [];
              for await (const chunk of request) buffers.push(Buffer.from(chunk));
              const input = JSON.parse(Buffer.concat(buffers).toString("utf8") || "null");
              calls.push(method);
              let result;
              if (method === "list") result = await actions.list();
              else if (method === "load") result = await actions.load(input);
              else if (method === "save") result = await actions.save(input);
              else if (method === "restore") {
                if (holdRestore)
                  await new Promise((resolve) => {
                    releaseRestore = resolve;
                  });
                result = await actions.restore(input);
              } else {
                response.statusCode = 404;
                response.end();
                return;
              }
              response.setHeader("content-type", "application/json");
              response.end(JSON.stringify(result));
            } catch (error) {
              failures.push(error instanceof Error ? error.message : String(error));
              response.statusCode = 500;
              response.end("Synthetic action failed");
            }
          });
        },
      },
    ],
    resolve: { dedupe: ["react", "react-dom"] },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [root, repo] } },
  });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    ...(process.env.RIT105_BROWSER_EXECUTABLE || process.platform === "linux"
      ? { executablePath: process.env.RIT105_BROWSER_EXECUTABLE ?? "/usr/bin/chromium" }
      : { channel: process.env.RIT105_BROWSER_CHANNEL ?? "chrome" }),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "キャラクターを作る", exact: true }).click();
  await page.getByRole("heading", { name: "キャラクターを作成", exact: true }).waitFor();
  await page.getByLabel("名前", { exact: true }).fill("合成案内係");
  await page.getByLabel("紹介", { exact: true }).fill("合成試験用の案内係です。");
  await page.getByLabel("タグ（1行に1つ）", { exact: true }).fill("案内\n合成試験");
  await page.getByLabel("最初のひとこと", { exact: true }).fill("こんにちは。街を案内します。");
  await page.getByLabel("指示", { exact: true }).fill("わかりやすい言葉で案内してください。");
  await page
    .getByLabel("例文", { exact: true })
    .fill("利用者: 図書館はどこですか。\n案内係: 広場の隣です。");
  await page.getByLabel("世界", { exact: true }).fill("架空の小さな街");
  await page.getByLabel("見た目", { exact: true }).fill("青い上着と丸い帽子");
  await page.getByLabel("話しかけ設定を有効にする", { exact: true }).check();
  await page.getByLabel("話しかける間隔（分）", { exact: true }).fill("30");
  for (const age of ["17", "", "18歳"]) {
    await page.getByLabel("年齢（18歳以上）", { exact: true }).fill(age);
    await page.getByRole("button", { name: "保存する", exact: true }).click();
    assert.equal(
      await page.getByLabel("年齢（18歳以上）", { exact: true }).getAttribute("aria-invalid"),
      "true",
    );
    assert.equal(calls.filter((call) => call === "save").length, 0);
  }
  await page.getByLabel("年齢（18歳以上）", { exact: true }).fill("18");
  await page.getByLabel("短い案", { exact: true }).fill("合成の街案内");
  await page.getByRole("button", { name: "編集を閉じる", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "キャラクターを作る", exact: true }).click();
  assert.equal(await page.getByLabel("名前", { exact: true }).inputValue(), "合成案内係");
  assert.equal(await page.getByLabel("短い案", { exact: true }).inputValue(), "合成の街案内");
  assert.equal(await page.getByLabel("年齢（18歳以上）", { exact: true }).inputValue(), "18");
  assert.ok(await page.getByLabel("話しかけ設定を有効にする", { exact: true }).isChecked());
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  write("PASS: mobile form validates invalid ages and restores all raw drafts after close/reload");

  const save = async () => {
    await page.getByRole("button", { name: "保存する", exact: true }).click();
    await page.getByText("保存しました。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
  };
  await save();
  await page.screenshot({ path: path.join(evidence, "character-mobile.png"), fullPage: true });
  const listed = await actions.list();
  assert.ok(listed.ok);
  assert.equal(listed.data.characters.length, 1);
  const characterId = listed.data.characters[0].id;
  const first = await actions.load(characterId);
  assert.ok(first.ok);
  assert.equal(first.data.versions.length, 1);
  assert.equal(first.data.sheet.age, 18);
  assert.deepEqual(first.data.sheet.tags, ["案内", "合成試験"]);
  assert.equal(first.data.sheet.appearance, "青い上着と丸い帽子");
  assert.equal(first.data.sheet.world, "架空の小さな街");
  assert.equal(first.data.sheet.proactiveSettings.intervalMinutes, 30);
  assert.equal(
    await page.getByRole("link", { name: "合成案内係と話す", exact: true }).getAttribute("href"),
    `/chat/${characterId}`,
  );
  await page.getByLabel("名前", { exact: true }).fill("合成案内係 第二版");
  await page.getByLabel("指示", { exact: true }).fill("丁寧な言葉で案内してください。");
  await save();
  const second = await actions.load(characterId);
  assert.ok(second.ok);
  assert.equal(second.data.versions.length, 2);
  await page.getByLabel("指示", { exact: true }).fill("短く落ち着いた言葉で案内してください。");
  await page.getByLabel("最初のひとこと", { exact: true }).fill("ようこそ。静かな街を案内します。");
  await save();
  const third = await actions.load(characterId);
  assert.ok(third.ok);
  assert.equal(third.data.versions.length, 3);
  write(
    "PASS: production editor/actions persist three distinct versions and expose chat route link",
  );

  await page.getByLabel("紹介", { exact: true }).fill("復元前の未保存の入力です。");
  await page.getByRole("button", { name: "編集を閉じる", exact: true }).click();
  await page.getByRole("button", { name: "合成案内係 第二版を編集", exact: true }).click();
  assert.equal(
    await page.getByLabel("紹介", { exact: true }).inputValue(),
    "復元前の未保存の入力です。",
  );
  holdRestore = true;
  await page
    .getByRole("button", { name: `版 ${second.data.currentVersionId} に戻す`, exact: true })
    .click();
  await page.getByRole("button", { name: "入力を破棄して戻す", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("input[aria-invalid]")?.disabled ||
      document.querySelector("input[aria-invalid]")?.matches(":disabled"),
  );
  assert.ok(await page.getByLabel("名前", { exact: true }).isDisabled());
  assert.ok(await page.getByRole("button", { name: "保存する", exact: true }).isDisabled());
  assert.equal(typeof releaseRestore, "function");
  holdRestore = false;
  releaseRestore();
  await page
    .getByText("選んだ版に戻しました。次の会話からこの指示を使います。", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("指示", { exact: true }).inputValue(),
    second.data.sheet.systemPrompt,
  );
  assert.equal(
    await page.getByLabel("紹介", { exact: true }).inputValue(),
    second.data.sheet.introduction,
  );
  assert.equal(
    await page.getByLabel("最初のひとこと", { exact: true }).inputValue(),
    second.data.sheet.greeting,
  );
  const restored = await actions.load(characterId);
  assert.ok(restored.ok);
  assert.equal(restored.data.currentVersionId, second.data.currentVersionId);
  assert.equal(restored.data.versions.length, 3);
  assert.deepEqual(restored.data.sheet, second.data.sheet);
  write(
    "PASS: restore blocks concurrent form input, discards confirmed draft, and restores full version without duplicate history",
  );

  await local.reopen();
  await page.reload();
  await page.getByRole("button", { name: "合成案内係 第二版を編集", exact: true }).click();
  assert.equal(
    await page.getByLabel("指示", { exact: true }).inputValue(),
    second.data.sheet.systemPrompt,
  );
  const restarted = await actions.load(characterId);
  assert.ok(restarted.ok);
  assert.deepEqual(restarted.data.sheet, second.data.sheet);
  assert.equal(restarted.data.currentVersionId, second.data.currentVersionId);
  assert.equal(restarted.data.versions.length, 3);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(evidence, "character-desktop.png"), fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  assert.deepEqual(failures, []);
  write(
    "PASS: D1 close/reopen and browser reload retain restored settings/history; desktop and 390px layout have no horizontal overflow",
  );
  write(
    "PASS: no browser pageerror or error console messages; screenshots are local internal evidence only",
  );
} finally {
  releaseRestore?.();
  await browser?.close();
  await server?.close();
  await local?.dispose();
  await rm(root, { recursive: true, force: true });
}
