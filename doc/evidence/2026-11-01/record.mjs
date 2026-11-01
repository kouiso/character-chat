// Usage: node record.mjs <worktree> <label> <outdir>
// Boots the v2 app the same way verify:ci does (APP_ENV=test, fake model, local D1), then records
// annotated videos of the chat behaviours with Playwright.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [worktree, label, outdir, extra = ""] = process.argv.slice(2);
const root = path.resolve(worktree);
const app = path.join(root, "apps/v2");
const varsFile = path.join(app, ".dev.vars");
const password = randomBytes(24).toString("hex");
const variables = `BASIC_AUTH_USERNAME=evidence\nBASIC_AUTH_PASSWORD=${password}\nAPP_ENV=test\nV2_FAKE_MODEL=1\nV2_TEST_FAULT=none\n`;
const port = 3127;
const base = `http://127.0.0.1:${port}`;
const auth = { username: "evidence", password };
const authHeader = { authorization: `Basic ${Buffer.from(`evidence:${password}`).toString("base64")}` };
const head = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const character = "runtime-probe";

const run = (args) => execFileSync("pnpm", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

let server;
let log = "";
await mkdir(outdir, { recursive: true });
await writeFile(varsFile, variables, { flag: "wx", mode: 0o600 });
try {
  run(["--filter", "@v2/app", "exec", "wrangler", "d1", "migrations", "apply", "adult-ai-db", "--local", "--persist-to", "../../.wrangler/state", "--config", "../../packages/cf/wrangler.local.jsonc"]);
  run(["--filter", "@v2/app", "seed:local"]);
  server = spawn("pnpm", ["--filter", "@v2/app", "exec", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (c) => (log = (log + c).slice(-20000)));
  server.stderr.on("data", (c) => (log = (log + c).slice(-20000)));
  for (let i = 0; ; i++) {
    if (i > 300) throw new Error("server not ready");
    try {
      const r = await fetch(`${base}/api/health`, { headers: authHeader, signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  const browser = await chromium.launch();
  const results = [];

  const scenario = async (name, title, body) => {
    const dir = path.join(outdir, `tmp-${name}`);
    const context = await browser.newContext({
      httpCredentials: auth,
      viewport: { width: 420, height: 760 },
      recordVideo: { dir, size: { width: 420, height: 760 } },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") errors.push(`console.${m.type()}: ${m.text().slice(0, 6000)}`);
    });
    let step = 0;
    const caption = async (text) => {
      step += 1;
      await page.evaluate(
        ([t, h]) => {
          let el = document.getElementById("__evidence");
          if (!el) {
            el = document.createElement("div");
            el.id = "__evidence";
            el.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99999;background:rgba(200,0,0,.88);color:#fff;font:600 14px/1.45 sans-serif;padding:8px 10px;white-space:pre-wrap;pointer-events:none";
            document.body.appendChild(el);
          }
          el.textContent = `${h}\n${t}`;
          // 注記で画面の中身を隠さんよう、注記の高さだけ下げる。
          document.body.style.paddingTop = `${el.offsetHeight}px`;
        },
        [text, `${label} @ ${head} ｜ ${title}`],
      );
      await page.waitForTimeout(1300);
      await page.screenshot({ path: path.join(outdir, `${name}-${String(step).padStart(2, "0")}.png`) });
    };
    let outcome = "ok";
    try {
      await page.goto(`${base}/chat/${character}`);
      await page.getByRole("textbox", { name: "メッセージ" }).waitFor();
      // hydrate 前に触ると、操作が state に入らず、サーバーの HTML との食い違いも出る。
      await page.waitForFunction(() =>
        Object.keys(document.querySelector('input[aria-label="メッセージ"]') ?? {}).some((k) => k.startsWith("__react")),
      );
      await body(page, caption);
    } catch (error) {
      outcome = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
      await caption(`検証が失敗: ${outcome}`).catch(() => undefined);
    }
    const video = page.video();
    await context.close();
    const file = path.join(outdir, `${name}.webm`);
    if (video) await rename(await video.path(), file);
    await rm(dir, { recursive: true, force: true });
    results.push({ name, title, outcome, pageErrors: errors });
  };

  const input = (page) => page.getByRole("textbox", { name: "メッセージ" });
  const send = (page) => page.getByRole("button", { name: "送信" });
  // 画面の起動（React の hydrate）より前に入れた文字は state に入らず、送信ボタンが有効にならん。
  // ボタンが有効になるまで入れ直してから進む。
  const typeIn = async (page, text) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      await input(page).fill(text.slice(0, -1));
      await input(page).pressSequentially(text.slice(-1));
      if (await send(page).isEnabled()) return;
      await page.waitForTimeout(500);
    }
    const detail = await page.evaluate(() => ({
      inputDisabled: document.querySelector('input[aria-label="メッセージ"]')?.disabled,
      value: document.querySelector('input[aria-label="メッセージ"]')?.value?.length,
      hydrated: Object.keys(document.querySelector('input[aria-label="メッセージ"]') ?? {}).some((k) => k.startsWith("__react")),
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
      storage: localStorage.getItem("v2-chat-session:runtime-probe"),
    }));
    throw new Error(`send button never enabled ${JSON.stringify(detail)}`);
  };

  await scenario("s1-send", "送信すると返信が届き、端末の保留が消える", async (page, caption) => {
    await caption("1. 会話画面を開いた（モデルは試験用の固定応答）");
    await typeIn(page, "こんにちは");
    await caption("2. 「こんにちは」と入力して送信する");
    await send(page).click();
    await page.getByText("ねえ、こっち向いて。").waitFor({ timeout: 20000 });
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("v2-chat-session:runtime-probe") ?? "null")?.pending ?? null);
    if (pending !== null) throw new Error("pending remained after done");
    await caption("3. 返信が届いた。端末に残る保留は null（確認済み）");
  });

  await scenario("s2-reconnect", "送信が切れても、再読み込みで同じ送信を 1 組だけ復元する", async (page, caption) => {
    let cut = true;
    await page.route(`**/api/chat/${character}`, async (route) => {
      if (route.request().method() === "POST" && cut) {
        cut = false;
        // サーバーには届けるが、応答を画面へ返さずに切る（通信が途中で切れた状態）
        await route.fetch().catch(() => undefined);
        return route.abort("connectionreset");
      }
      return route.continue();
    });
    await caption("1. 最初の送信だけ、応答の途中で通信を切るよう細工した");
    await typeIn(page, "切断しても大丈夫？");
    await send(page).click();
    await page.getByRole("button", { name: "再接続・再試行" }).waitFor({ timeout: 20000 });
    await caption("2. 通信が切れて「再接続・再試行」が出た。入力欄は送信中のまま");
    await page.unroute(`**/api/chat/${character}`);
    await page.reload();
    await page.getByText("ねえ、こっち向いて。").last().waitFor({ timeout: 20000 });
    const users = await page.getByText("切断しても大丈夫？").count();
    if (users !== 1) throw new Error(`user bubbles = ${users}`);
    await caption(`3. 再読み込みで同じ受付番号を再開し、送信と返信が 1 組だけ出た（送信の吹き出し ${users} 件）`);
  });

  await scenario("s3-too-long", "4000 字を超える入力は送らず、保留にもせず入力を残す", async (page, caption) => {
    await typeIn(page, "あ".repeat(4001));
    await caption("1. 4001 字を入力して送信する");
    await send(page).click();
    await page.getByText("4000字以内で送信してください。入力は保持されています。").waitFor();
    const value = await input(page).inputValue();
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("v2-chat-session:runtime-probe") ?? "null")?.pending ?? null);
    if (value.length !== 4001 || pending !== null) throw new Error("input or pending wrong");
    await caption(`2. 送らずに注意を出した。入力は ${value.length} 字のまま、端末の保留は null`);
  });

  await scenario("s4-rejected", "送り直しても通らない拒否は「入力に戻す」で入力欄へ戻せる", async (page, caption) => {
    await page.route(`**/api/chat/${character}`, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "送信内容を確認してください。" }) })
        : route.continue(),
    );
    await caption("1. 送信 API が 400（内容の不備）を返すよう細工した");
    await typeIn(page, "通らない送信");
    await send(page).click();
    await page.getByRole("button", { name: "入力に戻す" }).waitFor({ timeout: 20000 });
    await caption("2. 再接続ではなく「入力に戻す」が出た");
    await page.getByRole("button", { name: "入力に戻す" }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="メッセージ"]')?.value === "通らない送信");
    await caption("3. 押すと送信文が入力欄へ戻った（サーバーは受け付けていないので保存なし）");
  });

  if (extra.includes("saved")) {
    await scenario("s5-saved", "保存した会話を一覧から開くと、その会話の履歴で再開する", async (page, caption) => {
      await page.goto(base);
      await page.getByRole("heading", { name: "保存した会話" }).waitFor({ timeout: 20000 });
      await page.waitForFunction(() =>
        Object.keys(document.querySelector("h2") ?? {}).some((k) => k.startsWith("__react")),
      );
      await caption("1. 新しい端末（端末の保存なし）で一覧を開くと「保存した会話」が D1 から出る。一番上が一番新しい会話");
      await page.getByRole("heading", { name: "保存した会話" }).locator("..").getByRole("link").first().click();
      await page.waitForURL(/conversationId=/);
      // 一番新しい会話は、2 本目（切断と再読み込み）で送った会話。
      await page.getByText("切断しても大丈夫？").waitFor({ timeout: 20000 });
      await page.getByText("ねえ、こっち向いて。").first().waitFor({ timeout: 20000 });
      const alert = await page.getByRole("alert").count();
      if (alert !== 0) throw new Error("error shown after resume");
      await caption("2. 会話 ID 付きで開き、2 本目で送った「切断しても大丈夫？」とその返信が D1 から出た。エラー表示なし");
    });
  }

  await browser.close();
  await writeFile(path.join(outdir, "result.json"), JSON.stringify({ label, head, results }, null, 2));
  console.log(JSON.stringify({ label, head, results }));
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  if ((await readFile(varsFile, "utf8").catch(() => null)) === variables) await rm(varsFile);
}
