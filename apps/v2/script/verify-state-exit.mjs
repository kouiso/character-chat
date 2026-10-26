import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import viteReact from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(appRoot, "../../.work/rit85/browser");
await mkdir(output, { recursive: true });

const main = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider, Link } from '@tanstack/react-router';
import { Route as ChatRoute } from '/src/routes/chat/$id.tsx';
import { Route as ListRoute } from '/src/routes/index.tsx';
import { AppErrorState, AppLoadingState, AppNotFoundState } from '/src/component/app-route-state.tsx';
import '/src/style.css';
let rootCalls = 0;
const rootMode = new URLSearchParams(location.search).get('root');
const root = createRootRoute({ component: Outlet, pendingComponent: rootMode ? AppLoadingState : undefined, errorComponent: AppErrorState, notFoundComponent: AppNotFoundState, loader: rootMode ? async () => {
  const mode = new URLSearchParams(location.search).get('root');
  if (mode === 'wait' && rootCalls++ === 0) return new Promise(() => {});
  if (mode === 'error' && rootCalls++ === 0) throw new Error('RIT85_SYNTHETIC_FAILURE');
  return null;
} : undefined });
const home = createRoute({ ...ListRoute.options, getParentRoute: () => root, path: '/' });
const chat = createRoute({ ...ChatRoute.options, getParentRoute: () => root, path: '/chat/$id' });
const router = createRouter({ routeTree: root.addChildren([home, chat]), defaultPendingMs: 0, defaultPendingMinMs: 0 });
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
`;

const syntheticCharacters = `
let retries = 0;
let listCalls = 0;
export const listCharacters = async () => {
  const mode = window.syntheticListMode ?? new URLSearchParams(location.search).get('list');
  if (mode === 'wait' && listCalls++ === 0) return new Promise(() => {});
  if ((mode === 'error' && listCalls++ === 0) || mode === 'always-error') throw new Error('RIT85_SYNTHETIC_FAILURE');
  if (mode === 'empty' && listCalls++ === 0) return [];
  return ['wait', 'retry', 'error', 'missing', 'ready'].map(id => ({ id, name: id, avatar: null }));
};
export const getCharacter = async ({ data: id }) => {
  if (id === 'wait') return new Promise(resolve => { window.resolveSyntheticWait = () => resolve({ id, name: '合成テストキャラクター' }); });
  if (id === 'error' || (id === 'retry' && retries++ === 0)) throw new Error('RIT85_SYNTHETIC_FAILURE');
  return id === 'missing' ? null : { id, name: '合成テストキャラクター' };
};
`;

let apiMode = "none";
let syntheticResponse;

const server = await createServer({
  configFile: false,
  root: appRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 3185, strictPort: true },
  plugins: [
    viteReact(),
    {
      name: "rit85-synthetic-loader",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "/__rit85-main.jsx" || source === path.join(appRoot, "__rit85-main.jsx"))
          return path.join(appRoot, "__rit85-main.jsx");
        if (
          (source === "../../server/characters" || source === "../server/characters") &&
          (importer?.endsWith("/routes/chat/$id.tsx") || importer?.endsWith("/routes/index.tsx"))
        )
          return "\0rit85-characters";
      },
      load(id) {
        if (id === path.join(appRoot, "__rit85-main.jsx")) return main;
        if (id === "\0rit85-characters") return syntheticCharacters;
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.method === "POST" && req.url === "/api/chat/ready") {
            if (apiMode === "wait") {
              syntheticResponse = res;
            } else if (apiMode === "http-error") {
              res.writeHead(503, { "content-type": "application/json" });
              res.end(JSON.stringify({ message: "合成の生成失敗" }));
            } else if (apiMode === "empty") {
              res.writeHead(204);
              res.end();
            } else {
              res.writeHead(200, { "content-type": "text/event-stream" });
              if (apiMode === "sse-error") {
                res.end('event: error\ndata: {"message":"合成の生成失敗"}\n\n');
              } else {
                res.write('event: token\ndata: {"text":"合成の途中応答"}\n\n');
                if (apiMode === "eof") res.end();
                else syntheticResponse = res;
              }
            }
            return;
          }
          if (!req.headers.accept?.includes("text/html")) return next();
          const html = await vite.transformIndexHtml(
            req.url ?? "/",
            '<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__rit85-main.jsx"></script></body></html>',
          );
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(html);
        });
      },
    },
  ],
});

let browser;
const results = [];
const errors = [];
const externalRequests = [];
const posts = [];
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", (route) => {
    const request = route.request();
    if (request.method() === "POST") posts.push(request.url());
    if (new URL(request.url()).origin !== "http://127.0.0.1:3185") {
      externalRequests.push(request.url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("RIT85_SYNTHETIC_FAILURE") &&
      !(apiMode === "http-error" && message.text().includes("503"))
    )
      errors.push(message.text());
  });
  const snapshot = async (name) => {
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    await writeFile(path.join(output, `${name}.yaml`), await page.locator("body").ariaSnapshot());
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      name,
    );
  };
  const home = async () => {
    await page.getByRole("link", { name: "一覧に戻る" }).click();
    await page.getByRole("heading", { name: "キャラクター", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
  };
  const visit = async (id) => {
    await page.goto("http://127.0.0.1:3185/");
    await page.getByRole("link", { name: id, exact: true }).click();
  };

  await visit("wait");
  await page.getByRole("heading", { name: "会話を読み込んでいます" }).waitFor();
  await snapshot("01-loading");
  await home();
  await page.evaluate(() => window.resolveSyntheticWait());
  assert.equal(await page.getByRole("heading", { name: "キャラクター", exact: true }).count(), 1);
  await snapshot("01-loading-back");
  results.push("loading: click back; late loader resolution stays on home");

  await visit("retry");
  await page.getByRole("heading", { name: "会話を読み込めませんでした" }).waitFor();
  await snapshot("02-error");
  await page.getByRole("button", { name: "読み込みをやり直す" }).click();
  await page.getByText("合成テストキャラクター", { exact: true }).waitFor();
  await snapshot("02-error-retry");
  results.push("error: click retry loads synthetic chat");

  await visit("error");
  await page.getByRole("heading", { name: "会話を読み込めませんでした" }).waitFor();
  await page.getByRole("button", { name: "読み込みをやり直す" }).click();
  await page.getByRole("heading", { name: "会話を読み込めませんでした" }).waitFor();
  await home();
  results.push("error: repeated retry failure retains working back link");

  await visit("missing");
  await page.getByRole("heading", { name: "このキャラクターは利用できません" }).waitFor();
  await snapshot("03-unavailable");
  await page.getByRole("link", { name: "一覧に戻る" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "キャラクター", exact: true }).waitFor();
  await snapshot("03-unavailable-back");
  results.push("unavailable: keyboard back link returns home");

  await visit("wait");
  await page.getByRole("heading", { name: "会話を読み込んでいます" }).waitFor();
  await context.setOffline(true);
  await page.getByRole("heading", { name: "オフラインです" }).waitFor();
  await snapshot("04-offline-loading");
  await home();
  await snapshot("04-offline-loading-back");
  await context.setOffline(false);
  results.push("offline loading: back works while browser network is offline");

  await visit("error");
  await page.getByRole("heading", { name: "会話を読み込めませんでした" }).waitFor();
  await context.setOffline(true);
  await page.getByRole("heading", { name: "オフラインです" }).waitFor();
  await snapshot("05-offline-error");
  await page.getByRole("button", { name: "読み込みをやり直す" }).click();
  await page.getByRole("heading", { name: "オフラインです" }).waitFor();
  await home();
  await context.setOffline(false);
  results.push("offline error: retry failure retains offline state and back works");

  await visit("ready");
  const input = page.getByPlaceholder("メッセージを入力");
  await input.fill("合成の未送信文");
  await context.setOffline(true);
  await page.getByRole("heading", { name: "オフラインです" }).waitFor();
  await snapshot("06-offline-chat");
  assert.equal(await input.inputValue(), "合成の未送信文");
  await context.setOffline(false);
  await page.getByRole("heading", { name: "オフラインです" }).waitFor({ state: "detached" });
  assert.equal(await input.inputValue(), "合成の未送信文");
  await snapshot("06-offline-chat-recovered");
  await context.setOffline(true);
  await home();
  await snapshot("06-offline-chat-back");
  results.push("offline chat: draft survives reconnect, no auto POST, back works offline");

  assert.deepEqual(posts, []);
  await context.setOffline(false);
  const sendSynthetic = async (mode) => {
    apiMode = mode;
    await visit("ready");
    await page.getByPlaceholder("メッセージを入力").fill("合成の質問");
    await page.getByRole("button", { name: "送信", exact: true }).click();
  };

  await sendSynthetic("wait");
  assert.equal(await page.getByPlaceholder("メッセージを入力").isDisabled(), true);
  await snapshot("07-generation-wait");
  await home();
  syntheticResponse?.end();
  await snapshot("07-generation-wait-back");
  results.push("generation wait: back works while POST response is pending");

  await sendSynthetic("stream");
  await page.getByText("合成の途中応答", { exact: true }).waitFor();
  assert.equal(await page.getByPlaceholder("メッセージを入力").isDisabled(), true);
  await snapshot("08-generation-stream");
  await home();
  syntheticResponse?.end();
  results.push("generation streaming: back works while stream is open");

  for (const mode of ["http-error", "sse-error", "empty"]) {
    await sendSynthetic(mode);
    if (mode === "empty") {
      await page.waitForFunction(() => !document.querySelector("input").disabled);
    } else {
      await page.getByText("合成の生成失敗", { exact: true }).waitFor();
    }
    await snapshot(`09-generation-${mode}`);
    await home();
    results.push(`generation ${mode}: back works after synthetic failure`);
  }

  await sendSynthetic("eof");
  await page.getByText("合成の途中応答", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector("input").disabled);
  await snapshot("10-generation-interrupted");
  await home();
  await snapshot("10-generation-interrupted-back");
  results.push("generation incomplete EOF: back works with partial pending bubble");

  assert.equal(posts.length, 6);
  const retryRead = () => page.getByRole("button", { name: "読み込みをやり直す" }).click();
  const listReady = () => page.getByRole("link", { name: "ready", exact: true }).waitFor();
  for (const [mode, title] of [
    ["wait", "一覧を読み込んでいます"],
    ["error", "一覧を読み込めませんでした"],
    ["empty", "キャラクターがありません"],
  ]) {
    await page.goto(`http://127.0.0.1:3185/?list=${mode}`);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await snapshot(`11-list-${mode}`);
    await retryRead();
    await listReady();
    await snapshot(`11-list-${mode}-retry`);
    results.push(`list ${mode}: retry loads actual list component with synthetic records`);
  }

  await page.goto("http://127.0.0.1:3185/?list=wait");
  await page.getByRole("heading", { name: "一覧を読み込んでいます" }).waitFor();
  await context.setOffline(true);
  await page.getByRole("heading", { name: "オフラインです" }).waitFor();
  await snapshot("14-list-offline-loading");
  await retryRead();
  await context.setOffline(false);
  await listReady();
  results.push("list offline pending: retry remains available and reconnect completes GET only");

  await page.goto("http://127.0.0.1:3185/?list=always-error");
  await page.getByRole("heading", { name: "一覧を読み込めませんでした" }).waitFor();
  await context.setOffline(true);
  await page.getByRole("heading", { name: "オフラインです" }).waitFor();
  await snapshot("15-list-offline-error");
  await retryRead();
  await context.setOffline(false);
  await page.getByRole("heading", { name: "一覧を読み込めませんでした" }).waitFor();
  await page.evaluate(() => {
    window.syntheticListMode = "ready";
  });
  await retryRead();
  await listReady();
  results.push("list offline failure: repeated failure retains retry then recovers");

  await page.goto("http://127.0.0.1:3185/");
  await listReady();
  await context.setOffline(true);
  await page.getByRole("heading", { name: "オフラインです" }).waitFor();
  await snapshot("16-list-offline-cached");
  await retryRead();
  await context.setOffline(false);
  await listReady();
  results.push("list offline cached: keeps items and can retry after reconnect");

  await page.goto("http://127.0.0.1:3185/?list=empty");
  await page.getByRole("heading", { name: "キャラクターがありません" }).waitFor();
  await context.setOffline(true);
  await page.getByRole("heading", { name: "オフラインです" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "読み込みをやり直す" }).count(), 1);
  await snapshot("22-list-offline-empty");
  await retryRead();
  await context.setOffline(false);
  await listReady();
  results.push("list offline empty: one retry action, recovers after reconnect");

  for (const [mode, title] of [
    ["wait", "画面を読み込んでいます"],
    ["error", "画面を読み込めませんでした"],
  ]) {
    await page.goto(`http://127.0.0.1:3185/?root=${mode}`);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await snapshot(`17-root-${mode}`);
    await retryRead();
    await listReady();
    results.push(`root contract ${mode}: retry recovers actual list`);
    await page.goto(`http://127.0.0.1:3185/?root=${mode}`);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await context.setOffline(true);
    await page.getByRole("heading", { name: "オフラインです" }).waitFor();
    await snapshot(`20-root-offline-${mode}`);
    await retryRead();
    await context.setOffline(false);
    await listReady();
    results.push(`root contract offline ${mode}: retry remains actionable`);
  }

  await page.goto("http://127.0.0.1:3185/unknown");
  await page.getByRole("heading", { name: "ページが見つかりません" }).waitFor();
  await snapshot("19-root-not-found");
  await home();
  await snapshot("19-root-not-found-back");
  results.push("root contract unknown URL: back loads actual list");
  assert.equal(posts.length, 6);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        results,
        routeStateKinds: 4,
        presentations: 22,
        deadEnds: 0,
        errors,
        syntheticPosts: posts.length,
        automaticPosts: 0,
        externalRequests,
        output,
      },
      null,
      2,
    ),
  );
} finally {
  syntheticResponse?.end();
  if (errors.length) console.error(JSON.stringify({ errors }));
  await browser?.close();
  await server.close();
}
