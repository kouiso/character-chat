// 使い方: node record-legacy.mjs <作業ツリー> <ラベル> <出力先>
// 旧アプリの会話（題名・挨拶・連続した返事・画像あり・画像が無いもの）を手元の D1 に置き、
// 本物の移行 CLI（確認 → --apply）で v2 へ移してから、画面で開いて注記つきで残す。
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [worktree, label, outdirArg] = process.argv.slice(2);
const outdir = path.resolve(outdirArg);
const root = path.resolve(worktree);
const app = path.join(root, "apps/v2");
const varsFile = path.join(app, ".dev.vars");
const password = randomBytes(24).toString("hex");
const variables = `BASIC_AUTH_USERNAME=evidence\nBASIC_AUTH_PASSWORD=${password}\nAPP_ENV=test\nV2_FAKE_MODEL=1\nV2_TEST_FAULT=none\n`;
const port = 3128;
const base = `http://127.0.0.1:${port}`;
const authHeader = { authorization: `Basic ${Buffer.from(`evidence:${password}`).toString("base64")}` };
const head = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const run = (args, cwd = root) => execFileSync("pnpm", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

// 1 回ごとに別の ID にして、前の実行の残りと混ざらんようにする。
const stamp = Date.now();
const owner = `legacy-owner-${stamp}`;
const conversationId = `legacy-conv-${stamp}`;
const title = `雨の日の約束 ${new Date(stamp).toISOString().slice(11, 19)}`;
const presentKey = `images/${randomUUID()}.png`;
const missingKey = `images/${randomUUID()}.png`;

// 4x4 の単色 PNG（R2 に置く「ある画像」）。
const png = (() => {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(64 * 3, 0)]);
  for (let x = 0; x < 64; x++) row.set([255, 120, 160], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: 64 }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
})();

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
const seedSql = [
  `INSERT INTO user (id, email, created_at) VALUES (${sqlString(owner)}, 'evidence@example.invalid', ${stamp});`,
  `INSERT INTO conversation (id, user_id, character_id, title, created_at, updated_at) VALUES (${sqlString(conversationId)}, ${sqlString(owner)}, 'runtime-probe', ${sqlString(title)}, ${stamp}, ${stamp + 6});`,
  ...[
    ["m1", "assistant", "いらっしゃい。雨、だいぶ降ってたでしょ？", null],
    ["m2", "user", "ちょっとだけ濡れた", null],
    ["m3", "assistant", "タオル持ってくるね。座って待ってて。", null],
    ["m4", "assistant", "温かいお茶もどうぞ。", presentKey],
    ["m5", "user", "ありがとう", null],
    ["m6", "assistant", "窓の外、虹が出てるよ。", missingKey],
  ].map(
    ([id, role, content, key], index) =>
      `INSERT INTO message (id, user_id, conversation_id, character_id, role, content, image_key, created_at) VALUES (${sqlString(`${conversationId}-${id}`)}, ${sqlString(owner)}, ${sqlString(conversationId)}, 'runtime-probe', '${role}', ${sqlString(content)}, ${key ? sqlString(key) : "NULL"}, ${stamp + index + 1});`,
  ),
].join("\n");

let server;
let log = "";
await mkdir(outdir, { recursive: true });
await writeFile(varsFile, variables, { flag: "wx", mode: 0o600 });
const results = [];
try {
  run(["--filter", "@v2/app", "exec", "wrangler", "d1", "migrations", "apply", "adult-ai-db", "--local", "--persist-to", "../../.wrangler/state", "--config", "../../packages/cf/wrangler.local.jsonc"]);
  run(["--filter", "@v2/app", "seed:local"]);
  const seedFile = path.join(outdir, "legacy-seed.sql");
  await writeFile(seedFile, seedSql);
  run(["--filter", "@v2/app", "exec", "wrangler", "d1", "execute", "adult-ai-db", "--local", "--persist-to", "../../.wrangler/state", "--config", "../../packages/cf/wrangler.local.jsonc", "--file", seedFile]);
  const pngFile = path.join(outdir, "present.png");
  await writeFile(pngFile, png);
  run(["--filter", "@v2/app", "exec", "wrangler", "r2", "object", "put", `adult-ai-images/${presentKey}`, "--file", pngFile, "--content-type", "image/png", "--local", "--persist-to", "../../.wrangler/state"]);

  // 本物の移行 CLI。確認（書かない）→ 適用。出力は証跡として残す。
  const migrate = (apply) =>
    run(["--filter", "@v2/cf", "migrate:legacy", "--source-user", owner, "--target-user", "local", ...(apply ? ["--apply"] : [])]);
  const inspectOut = migrate(false);
  const applyOut = migrate(true);
  await writeFile(path.join(outdir, "migration-output.txt"), `## 確認（--apply なし）\n${inspectOut}\n## 適用（--apply）\n${applyOut}\n`);

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
  const dir = path.join(outdir, "tmp-video");
  const context = await browser.newContext({
    httpCredentials: { username: "evidence", password },
    viewport: { width: 420, height: 900 },
    recordVideo: { dir, size: { width: 420, height: 900 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`console.${m.type()}: ${m.text().slice(0, 300)}`);
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
        document.body.style.paddingTop = `${el.offsetHeight}px`;
      },
      [text, `${label} @ ${head} ｜ 旧アプリの会話を移して、v2 の画面で再開する`],
    );
    await page.waitForTimeout(1300);
    await page.screenshot({ path: path.join(outdir, `s6-legacy-${String(step).padStart(2, "0")}.png`) });
  };
  const hydrated = (selector) =>
    page.waitForFunction((s) => Object.keys(document.querySelector(s) ?? {}).some((k) => k.startsWith("__react")), selector);

  let outcome = "ok";
  try {
    await page.goto(base);
    await page.getByRole("heading", { name: "保存した会話" }).waitFor({ timeout: 20000 });
    await hydrated("h2");
    const link = page.getByRole("link", { name: title });
    await link.waitFor();
    await caption(`1. 移行 CLI（確認 → --apply）で移した旧会話が、一覧に旧アプリの題名「${title}」で出る`);
    await link.click();
    await page.waitForURL(new RegExp(`conversationId=${conversationId}`));
    await page.getByText("いらっしゃい。雨、だいぶ降ってたでしょ？").waitFor({ timeout: 20000 });
    await hydrated('input[aria-label="メッセージ"]');
    const bubbles = await page.locator(".v2-bubble").evaluateAll((els) => els.map((el) => [el.className.includes("assistant") ? "assistant" : "user", el.textContent?.trim().slice(0, 12)]));
    const roles = bubbles.map(([role]) => role).join(",");
    if (roles !== "assistant,user,assistant,assistant,user,assistant") throw new Error(`order ${roles}`);
    await caption(`2. 挨拶（最初の返事）と、続けて 2 つ並ぶ返事がそのままの順で出る（並び: ${roles}）`);
    const shown = page.locator('img[alt="会話に保存された画像"]');
    await shown.first().waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector('img[alt="会話に保存された画像"]');
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 20000 });
    await page.getByRole("status").filter({ hasText: "画像を読み込めませんでした。" }).waitFor({ timeout: 20000 });
    await caption("3. R2 にある画像（m4）は表示され、R2 に無い画像（m6）は「画像を読み込めませんでした。」と再読み込みのボタンになる。会話は使えるまま");
    await page.getByRole("button", { name: "再読み込み" }).click();
    await page.getByRole("status").filter({ hasText: "画像を読み込めませんでした。" }).waitFor({ timeout: 20000 });
    const alerts = await page.getByRole("alert").count();
    if (alerts !== 0) throw new Error("error alert shown");
    await caption("4. 再読み込みを押すと読み直し、まだ無いので同じ案内に戻る。エラー表示（alert）は出ない");
  } catch (error) {
    outcome = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
    await caption(`検証が失敗: ${outcome}`).catch(() => undefined);
  }
  const video = page.video();
  await context.close();
  if (video) await rename(await video.path(), path.join(outdir, "s6-legacy.webm"));
  await rm(dir, { recursive: true, force: true });
  await browser.close();
  results.push({ name: "s6-legacy", outcome, pageErrors: errors });
  await writeFile(path.join(outdir, "result-legacy.json"), JSON.stringify({ label, head, conversationId, title, results }, null, 2));
  console.log(JSON.stringify({ label, head, results }));
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  if ((await readFile(varsFile, "utf8").catch(() => null)) === variables) await rm(varsFile);
}
