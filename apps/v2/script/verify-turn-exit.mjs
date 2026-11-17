// RIT-65 出口・壊し試験の確かめ。実物の手元の workerd（vite dev = miniflare の DO・D1）と
// 固定モデルを相手に、Playwright で画面を動かす。
// - E-1: 「出口の表」の状態 12 個を 1 つずつ出し、表の出口を全部押して別の状態へ
//   移った事を確かめる。通った状態・押した出口・行き止まりは実行の中で数える。
// - S-13b: slow-admit で送信直後の「止める」→ stop は 404 missing → 入力へ文が戻り、
//   遅れて届いた送信は生成されず failed/withdrawn に畳まれる。
// - S-14: 塊の小出しの途中の「止める」→ shownSeq まで切り詰め（truncated）。
//   止めるの POST が届かん時は残りの塊を全部出して idle へ戻る。
// - B-1..B-4: タブを閉じる・圏外・途中で新版（再起動）・モデルの時間切れ。
// 数字は直に書かない。結果は stdout の JSON。
//
// 使い方: node script/verify-turn-exit.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const varsFile = new URL("../.dev.vars", import.meta.url);
const outputDir = path.resolve(root, ".work/rit65/browser");
const PORT = Number(process.env.V2_EXIT_PORT ?? 3121);
const base = `http://127.0.0.1:${PORT}`;
const username = "runtime-exit-test";
const password = randomBytes(32).toString("hex");
const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const characterId = process.env.V2_VERIFY_CHARACTER_ID ?? "runtime-probe";
const chatPath = `/chat/${characterId}`;

// 止める・再試行の待ちの上限。部屋の試行は 1 件ごと 1.5 秒待つ故障でもこの中に収める。
const UI_WAIT_MS = 30_000;
const RESTART_READY_MS = 60_000;

// 画面の印（板の文言と一字一句同じ）。状態の確かめはこれらの有無で決める。
const WAITING_MAIN = "返事を書いています";
const WAITING_SUB = "少し時間がかかっています";
const ARRIVING_MAIN = "返事が届いています";
const SEND_FAILED_PRIMARY = "メッセージを送れませんでした。";
const SEND_FAILED_MARKER = "まだ送れていません";
const RESENDING_MARKER = "送り直しています";
const NO_REPLY_PRIMARY = "返事が届きませんでした。";
const REJECTED_SECONDARY = "このままでは送れません。";
const OFFLINE_PRIMARY = "オフラインです。";
const CUT_OFF_PRIMARY = "返事が途中で止まりました。";
const STOPPED_MARKER = "ここで止めました";
const INPUT_SELECTOR = 'input[aria-label="メッセージ"]';

// 複数塊の返事。タグブロックごとに 1 塊になる（split-chunks）。各塊は 80 文字前後で、
// 小出しの間は 1.6 秒以上空く（20ms/字）。nearDuplicate の判定で落ちんよう文は全部別物。
const LONG_REPLY = [
  "<response>",
  "<action>本棚の端を指でなぞり、背表紙の題字をひとつ読み上げた。</action>",
  "<dialogue>この棚は詩集ばかりなの。あんたにはこれが合いそうやと思うわ。</dialogue>",
  "<inner>目つきが柔らかい。ちゃんと本を読む人だと分かった。</inner>",
  "<action>窓際の椅子を引いて、向かいの席をそっと示した。</action>",
  "<dialogue>日当たりのええ席が空いとるで。読むならそこが一番や。</dialogue>",
  "<inner>少し話しすぎたかな。でも案内は私の仕事やし、ええか。</inner>",
  "<action>受付の札をめくって、静粛の面をこちらへ向け直した。</action>",
  "<dialogue>あんまり長話したら他の人に悪いわ。続きは閉館のあとね。</dialogue>",
  "<inner>くすりと笑いが漏れた。今日はええ日になりそうや。</inner>",
  "<action>貸出台帳を開いて、新しい貸出票を一枚破り取った。</action>",
  "<dialogue>名前を書いてちょうだい。返却は二週間後で間に合うから。</dialogue>",
  "<inner>また明日も来てくれるとええな。そっと願うてしまった。</inner>",
  "</response>",
].join("");

// slow の副の文は 15 秒（部屋の ping 間隔）を超えて待つ時だけ出る。slow-events は
// 出来事ごとに 1.5 秒空けるので、14.6 秒で終わる LONG_REPLY では間に合わん。
// 塊が 2 倍あれば done は 20 秒を超え、待ちの表示が確かに出る。文は全部別物にする。
const SLOWER_REPLY = [
  "<response>",
  "<action>書架の並びを指で辿り、装丁の違いをひとつひとつ確かめた。</action>",
  "<dialogue>ここの階は専門書が集まっとるで。あんたには合いそうやと思うわ。</dialogue>",
  "<inner>静かに聞き入っとる。本気で探しに来た人や。</inner>",
  "<action>窓際の長机を手の平で示して、明るい方角を促した。</action>",
  "<dialogue>午後は陽が差して読みやすいで。奥の席がおすすめや。</dialogue>",
  "<inner>少し早口になったかな。落ち着いて案内せんと。</inner>",
  "<action>カウンターの札を裏返して、貸出手続きの窓口を指した。</action>",
  "<dialogue>借りる時はこっちへ並んでな。今日は空いとるからすぐ済むわ。</dialogue>",
  "<inner>笑顔がこぼれた。丁寧に相槌を打ってくれる人は好きや。</inner>",
  "<action>帳簿の束を取り出して、貸出票をそっと一枚差し出した。</action>",
  "<dialogue>お名前だけ書いてちょうだい。期限は来月の同じ日までや。</dialogue>",
  "<inner>明日も来てくれたら嬉しいな。そんなことを考えてしまった。</inner>",
  "<action>児童書の棚へ歩いて、背の低い段を指で示した。</action>",
  "<dialogue>小さい子向けの絵本はこっちやで。字が大きくて読みやすいわ。</dialogue>",
  "<inner>案内の間中ずっと相槌を打ってくれとる。真面目な人や。</inner>",
  "<action>返却箱の蓋を持ち上げて、中の本をそっと並べ直した。</action>",
  "<dialogue>返す時はこの箱へ入れてな。カウンターは混むから助かるわ。</dialogue>",
  "<inner>手際が良いところを見せたい。少しだけ見栄を張ってしまった。</inner>",
  "<action>閲覧机のランプをひとつ捻って、灯りの下へ本を置いた。</action>",
  "<dialogue>ここなら明るいし静かや。気に入ったらそのまま座ってええで。</dialogue>",
  "<inner>この席は私のお気に入りでもある。教えるのは内緒にしよう。</inner>",
  "<action>検索機の画面を拭いて、探したい題名の入れ方を示した。</action>",
  "<dialogue>分からん本があったらここで調べられるで。漢字は読みでも出るわ。</dialogue>",
  "<inner>新しい司書さんにも同じ説明をしたばかり。もう慣れたものや。</inner>",
  "<action>雑誌架の前で足を止め、最新号の背表紙を抜いて見せた。</action>",
  "<dialogue>新聞と週刊誌はこの棚やで。バックナンバーは倉庫にあるわ。</dialogue>",
  "<inner>質問される前に全部説明してもうた。少し張り切りすぎたか。</inner>",
  "<action>閉架書庫の扉を軽く叩き、許可証の要る場所を教えた。</action>",
  "<dialogue>ここの奥は貴重書やから申請がいるで。用があれば紙を出してな。</dialogue>",
  "<inner>鍵の音が冷たく響いた。滅多に開けん場所やから仕方ない。</inner>",
  "<action>カード目録の抽斗を引いて、著者名の五十音順を指で示した。</action>",
  "<dialogue>古い本はまだ紙の目録にしか載っとらんの。慣れたら早いで。</dialogue>",
  "<inner>抽斗の滑りが悪い。そろそろ油を差さんとあかんな。</inner>",
  "<action>階段の踊り場で振り返り、二階の分野表を指さした。</action>",
  "<dialogue>上は文学と歴史や。好きな時代があればすぐ分かるで。</dialogue>",
  "<inner>息が少し上がった。毎日何往復もするけど階段は堪える。</inner>",
  "</response>",
].join("");

// 確かめの記録。実行の中でだけ数える。
const results = [];
const states = new Set();
const exitsPressed = [];
const deadEnds = [];
const failures = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const api = (pathname, init = {}) =>
  fetch(`${base}${pathname}`, {
    ...init,
    headers: { authorization: auth, ...(init.headers ?? {}) },
  });
const turnOf = (conversationId, requestId) =>
  api(
    `/api/chat/${characterId}/turn?conversationId=${encodeURIComponent(conversationId)}` +
      (requestId ? `&requestId=${encodeURIComponent(requestId)}` : ""),
  ).then((response) => (response.ok ? response.json() : null));
const historyOf = (conversationId) =>
  api(`/api/chat/${characterId}/history?conversationId=${encodeURIComponent(conversationId)}`).then(
    (response) => (response.ok ? response.json() : null),
  );

// .dev.vars は起動ごとに書き替える。元の中身は退避して、終わったら必ず戻す。
const originalVars = await readFile(varsFile).catch(() => null);
const varsFor = (fault, fakeResponse, faultMs) =>
  `BASIC_AUTH_USERNAME=${username}\nBASIC_AUTH_PASSWORD=${password}\nAPP_ENV=test\n` +
  `V2_FAKE_MODEL=1\nV2_TEST_FAULT=${fault}\n` +
  (fakeResponse === undefined ? "" : `V2_FAKE_RESPONSE=${JSON.stringify(fakeResponse)}\n`) +
  (faultMs === undefined ? "" : `V2_TEST_FAULT_MS=${faultMs}\n`);

let server = null;
let serverOutput = "";
const killServer = async () => {
  if (!server?.pid) return;
  try {
    process.kill(process.platform === "win32" ? server.pid : -server.pid, "SIGTERM");
  } catch {}
  for (let wait = 0; wait < 100; wait += 1) {
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  server = null;
};

const waitReady = async (timeoutMs = 90_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`runtime server exited before readiness:\n${serverOutput.slice(-4000)}`);
    }
    try {
      const response = await api("/api/health", { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).mockModel === true) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`runtime server readiness timed out:\n${serverOutput.slice(-4000)}`);
};

// 試験故障ごとに vite dev（workerd）を起動する。故障は環境変数なので切り替えは再起動。
const boot = async (fault, fakeResponse, faultMs) => {
  await killServer();
  await writeFile(varsFile, varsFor(fault, fakeResponse, faultMs), { mode: 0o600 });
  serverOutput = "";
  server = spawn(
    "pnpm",
    [
      "--filter",
      "@v2/app",
      "exec",
      "vite",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { cwd: root, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (chunk) => {
    serverOutput = (serverOutput + chunk).slice(-20_000);
  });
  server.stderr.on("data", (chunk) => {
    serverOutput = (serverOutput + chunk).slice(-20_000);
  });
  await waitReady();
};

// 画面の補助。会話は localStorage を空にして毎回新しく作る（保留の残りを持ち越さんため）。
// localStorage はオリジンへ載ってからしか触れんので、開いて → 消して → 開き直す。
const freshChat = async (page) => {
  await page.goto(`${base}${chatPath}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}${chatPath}`);
  await page.getByRole("textbox", { name: "メッセージ" }).waitFor({ timeout: UI_WAIT_MS });
};

const inputOf = (page) => page.getByRole("textbox", { name: "メッセージ" });
const alertOf = (page) => page.getByRole("alert");
// dev の SSR 木と初回描画が合わん時、React が木を作り直して入力が捨てられる。
// 値が残り送信が効く状態になるまで入れ直す（2 回目以降は新しい木なので残る）。
// オフラインの再現はこの確かめが通ってから回線を切る。先に切ると dev の module 取得が
// 途切れて画面自体が仕上がらず、送信も止めの表示も出せん。
const fillText = async (page, text) => {
  const input = inputOf(page);
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await input.fill(text);
    try {
      await page.waitForFunction(
        ([selector, expected]) => {
          const el = document.querySelector(selector);
          const button = [...document.querySelectorAll("button")].find(
            (candidate) => candidate.textContent === "送信",
          );
          return el !== null && el.value === expected && button !== undefined && !button.disabled;
        },
        [INPUT_SELECTOR, text],
        { timeout: 3000 },
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("fillText: input never became ready");
};

const clickSend = async (page) =>
  page.getByRole("button", { name: "送信", exact: true }).click({ timeout: 3000 });

const sendText = async (page, text) => {
  await fillText(page, text);
  // クリックの間に送信の受理が立ってボタンが畳まれる事がある。畳まれた分は送れとるので成功扱い。
  try {
    await clickSend(page);
  } catch (error) {
    const accepted = await page
      .locator(".v2-message-turn.user")
      .count()
      .then((count) => count > 0);
    if (!accepted) throw error;
  }
};
// POST の本文から受付番号を拾う口。API の確かめ（turn/history）に使う。
const captureSubmit = (page) =>
  page
    .waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === `/api/chat/${characterId}`,
      { timeout: UI_WAIT_MS },
    )
    .then((request) => request.postDataJSON());

// 入力欄へ送信文が戻った事の確かめ。止める・入力に戻す・発言の操作は全部同じ終点。
const restoredInput = (page, sentText) =>
  page.waitForFunction(
    ([selector, expected]) => document.querySelector(selector)?.value === expected,
    [INPUT_SELECTOR, sentText],
    { timeout: UI_WAIT_MS },
  );

const pressExit = async (page, exit, sentText) => {
  if (exit === "stop") {
    await page.getByRole("button", { name: "返事を止める" }).click();
    // 保存前の畳み（stopped/missing）は送信文を入力へ戻す。
    await restoredInput(page, sentText);
    return;
  }
  if (exit === "retry") {
    await page.getByRole("button", { name: "もう一度", exact: true }).click();
    // 送り直しに入った印（送り直しています／待ちの文）が出る。
    await page
      .getByText(RESENDING_MARKER, { exact: true })
      .or(page.getByText(WAITING_MAIN, { exact: true }))
      .first()
      .waitFor({ timeout: UI_WAIT_MS });
    return;
  }
  if (exit === "withdraw") {
    await page.getByRole("button", { name: "入力に戻す" }).click();
    await restoredInput(page, sentText);
    return;
  }
  if (exit === "message-action") {
    await page.getByRole("button", { name: "この発言の操作" }).click();
    await restoredInput(page, sentText);
    return;
  }
  if (exit === "back") {
    await page.getByRole("link", { name: "一覧に戻る" }).click();
    await page.waitForURL(`${base}/`, { timeout: UI_WAIT_MS });
    return;
  }
  if (exit === "send") {
    const text = `出口の確かめ ${randomBytes(3).toString("hex")}`;
    await sendText(page, text);
    // 送信したら入力は空になり、自分の吹き出しが並ぶ（速い返事だと止める印は
    // 見えんまま通り過ぎるので、新しい吹き出しが出た事で確かめる）。
    await page.waitForFunction(
      ([selector]) => document.querySelector(selector)?.value === "",
      [INPUT_SELECTOR],
      { timeout: UI_WAIT_MS },
    );
    // pending の印は作りかけの返事の側だけに付く。送信文の吹き出し自体は通常の user。
    await page.locator(".v2-message-turn.user").first().waitFor({ timeout: UI_WAIT_MS });
    return;
  }
  throw new Error(`unknown exit ${exit}`);
};

// 状態へ連れて行く手順と、押した出口の記録。1 出口失敗しても他の出口の確かめは続け、
// 全部駄目だった状態だけ deadEnds へ入れる。
const visit = async (label, page, reach, exits, sentText) => {
  let pressed = 0;
  for (const exit of exits) {
    try {
      const text = await reach(page);
      states.add(label);
      await pressExit(page, exit, text ?? sentText);
      exitsPressed.push(`${label}:${exit}`);
      pressed += 1;
      results.push(`${label}: exit ${exit} moved state`);
    } catch (error) {
      failures.push(`${label}:${exit}: ${String(error).slice(0, 400)}`);
    }
  }
  if (pressed === 0) deadEnds.push(label);
};

let browser;
let context;
try {
  // 手元の D1（miniflare）を最新へ。種は実行のたびに入れ直しても同じ内容（INSERT OR IGNORE）。
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@v2/app",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "adult-ai-db",
      "--local",
      "--persist-to",
      "../../.wrangler/state",
      "--config",
      "../../packages/cf/wrangler.local.jsonc",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  execFileSync("pnpm", ["--filter", "@v2/app", "seed:local"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    httpCredentials: { username, password },
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(UI_WAIT_MS);

  // ---- 故障 slow-admit: S-13b と sending の出口 ----
  await boot("slow-admit");
  // S-13b: 送信が部屋へ届く前に止める → stop は 404 missing、入力へ文が戻る。
  // 10 秒後に D1 の行が無く、GET turn の active が null、受付は failed/withdrawn。
  {
    await freshChat(page);
    const sent = `s13b-${randomBytes(3).toString("hex")}`;
    const captured = captureSubmit(page);
    await sendText(page, sent);
    await sleep(300);
    await page.getByRole("button", { name: "返事を止める" }).click();
    await restoredInput(page, sent);
    const { conversationId, requestId } = await captured;
    await sleep(10_000);
    const turn = await turnOf(conversationId, requestId);
    assert.equal(turn?.active, null, "S-13b: GET turn active");
    assert.equal(turn?.request?.status, "failed", "S-13b: request status");
    assert.equal(turn?.request?.failureCode, "withdrawn", "S-13b: failure code");
    const history = await historyOf(conversationId);
    assert.equal(history?.history?.length ?? -1, 0, "S-13b: そのターンの D1 の行は無い");
    results.push("S-13b: early stop leaves withdrawn mark, no D1 rows");
  }
  // sending: 止める・戻る
  await visit(
    "sending",
    page,
    async () => {
      await freshChat(page);
      const sent = `sending-${randomBytes(3).toString("hex")}`;
      await sendText(page, sent);
      await page.getByRole("button", { name: "返事を止める" }).waitFor();
      return sent;
    },
    ["stop", "back"],
  );

  // ---- 故障 slow-events: writing / arriving / slow の出口と B-2・B-3 ----
  // 出来事間隔を 3.5 秒へ広げる。既定の 1.5 秒では返事が 17 秒足らずで終わり、
  // 15 秒超の待ちでだけ出る「少し時間がかかっています」の表示が確かめられん。
  await boot("slow-events", SLOWER_REPLY, 3500);
  const slowSend = async (page) => {
    await freshChat(page);
    const sent = `waiting-${randomBytes(3).toString("hex")}`;
    await sendText(page, sent);
    return sent;
  };
  await visit(
    "writing",
    page,
    async () => {
      const sent = await slowSend(page);
      await page.getByText(WAITING_MAIN, { exact: true }).waitFor();
      // writing の間は「少し時間がかかっています」の副の文はまだ出ん。
      assert.equal(await page.getByText(WAITING_SUB, { exact: true }).count(), 0);
      return sent;
    },
    ["stop", "back"],
  );
  await visit(
    "arriving",
    page,
    async () => {
      const sent = await slowSend(page);
      await page.getByText(ARRIVING_MAIN, { exact: true }).waitFor();
      return sent;
    },
    ["stop", "back"],
  );
  await visit(
    "slow",
    page,
    async () => {
      const sent = await slowSend(page);
      await page.getByText(WAITING_SUB, { exact: true }).waitFor({ timeout: 40_000 });
      return sent;
    },
    ["stop", "back"],
  );

  // B-2 圏外: slow-events で送信 → 2 秒後に setOffline → 10 秒 → 戻す → 何も押さず返事が出る。
  {
    await freshChat(page);
    const captured = captureSubmit(page);
    await sendText(page, `b2-${randomBytes(3).toString("hex")}`);
    const { conversationId } = await captured;
    await sleep(2_000);
    await context.setOffline(true);
    await sleep(10_000);
    await context.setOffline(false);
    // あいさつ文は最初から出ているので、pending でない 2 つ目の assistant が返事の印。
    await page
      .locator(".v2-message-turn.assistant:not(.pending)")
      .nth(1)
      .waitFor({ timeout: RESTART_READY_MS });
    const history = await historyOf(conversationId);
    const roles = (history?.history ?? []).map((row) => row.role);
    assert.deepEqual(roles, ["user", "assistant"], "B-2: 履歴は発言 1・返事 1");
    results.push("B-2: offline during generation recovers to exactly one reply");
  }

  // B-3 途中で新しい版: slow-events で送信 → 2 秒後にサーバ再起動 → 60 秒以内に返事か
  // 失敗の枠→「もう一度」で返事が出る。履歴は発言 1・返事 1。GET turn の active は null。
  {
    await freshChat(page);
    const captured = captureSubmit(page);
    await sendText(page, `b3-${randomBytes(3).toString("hex")}`);
    const { conversationId, requestId } = await captured;
    await sleep(2_000);
    await killServer();
    await boot("slow-events", SLOWER_REPLY);
    const reply = page.locator(".v2-message-turn.assistant:not(.pending)").nth(1);
    const failure = page.getByRole("button", { name: "もう一度", exact: true });
    try {
      await reply.or(failure).first().waitFor({ timeout: RESTART_READY_MS });
    } catch {
      failures.push("B-3: 60 秒以内に返事も失敗の枠も出なかった");
    }
    if ((await reply.count()) === 0 && (await failure.count()) > 0) {
      await failure.click();
      await reply.waitFor({ timeout: RESTART_READY_MS });
    }
    const history = await historyOf(conversationId);
    const roles = (history?.history ?? []).map((row) => row.role);
    assert.deepEqual(roles, ["user", "assistant"], "B-3: 履歴は発言 1・返事 1");
    // slow-events の done 書き込みと finishSuccess の間に照会が走ると running が見える。
    // 終わるはずの仕事が止まったままなら待っても null にならず失敗する。
    let turn = null;
    for (let i = 0; i < 20 && turn?.active !== null; i += 1) {
      turn = await turnOf(conversationId, requestId);
      if (turn?.active !== null) await sleep(1_000);
    }
    assert.equal(turn?.active, null, "B-3: GET turn active");
    results.push("B-3: mid-generation restart recovers to exactly one reply");
  }

  // ---- 故障 fail-generation-once: no_reply の出口と B-4 前半 ----
  await boot("fail-generation-once");
  await visit(
    "no_reply",
    page,
    async () => {
      await freshChat(page);
      const sent = `noreply-${randomBytes(3).toString("hex")}`;
      await sendText(page, sent);
      await alertOf(page).getByText(NO_REPLY_PRIMARY, { exact: true }).waitFor();
      return sent;
    },
    // 1 回目は「もう一度」→ 作り直しが届く。2 回目は「戻る」。
    ["retry", "back"],
  );
  // B-4 前半: もう一度で返事が届く（no_reply:retry の押した後を最後まで見る）。
  {
    await freshChat(page);
    await sendText(page, `b4a-${randomBytes(3).toString("hex")}`);
    await alertOf(page).getByText(NO_REPLY_PRIMARY, { exact: true }).waitFor();
    await page.getByRole("button", { name: "もう一度", exact: true }).click();
    await page
      .locator(".v2-message-turn.assistant:not(.pending)")
      .nth(1)
      .waitFor({ timeout: UI_WAIT_MS });
    results.push("B-4a: retry after generation timeout delivers reply");
  }

  // ---- 故障 fail-after-chunk-once: cut_off の出口 ----
  // 最初の試行で 1 塊届いた直後に生成が止まる。もう一度で 2 試行目は成功する。
  await boot("fail-after-chunk-once", LONG_REPLY);
  await visit(
    "cut_off",
    page,
    async () => {
      await freshChat(page);
      const sent = `cutoff-${randomBytes(3).toString("hex")}`;
      await sendText(page, sent);
      await alertOf(page).getByText(CUT_OFF_PRIMARY, { exact: true }).waitFor();
      return sent;
    },
    ["retry", "back"],
  );

  // ---- 故障 fail-generation: rejected の出口と B-4 後半 ----
  await boot("fail-generation");
  const reachRejected = async (page) => {
    await freshChat(page);
    const sent = `rejected-${randomBytes(3).toString("hex")}`;
    const captured = captureSubmit(page);
    await sendText(page, sent);
    // 3 試行目の失敗で「もう一度送れない時」へ。もう一度を 2 回踏む。
    await alertOf(page).getByText(NO_REPLY_PRIMARY, { exact: true }).waitFor();
    await page.getByRole("button", { name: "もう一度", exact: true }).click();
    await alertOf(page).getByText(NO_REPLY_PRIMARY, { exact: true }).waitFor();
    await page.getByRole("button", { name: "もう一度", exact: true }).click();
    // 副の文は改行入りの 1 要素なので、頭の句で部分一致させる。
    await alertOf(page).getByText(REJECTED_SECONDARY).first().waitFor();
    return { sent, captured };
  };
  await visit("rejected", page, async () => (await reachRejected(page)).sent, ["withdraw", "back"]);
  // B-4 後半: 入力に戻した時 D1 にそのターンの行が無い。
  {
    const { sent, captured } = await reachRejected(page);
    await page.getByRole("button", { name: "入力に戻す" }).click();
    await restoredInput(page, sent);
    const { conversationId } = await captured;
    const history = await historyOf(conversationId);
    assert.equal(history?.history?.length ?? -1, 0, "B-4b: そのターンの D1 の行は無い");
    results.push("B-4b: rejected restores text, no D1 rows for failed turn");
  }

  // ---- 故障なし + 複数塊: send_failed / resending / offline / stopped(S-14) / idle / B-1 ----
  await boot("none", LONG_REPLY);
  const submitPath = `/api/chat/${characterId}`;
  const abortSubmit = (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue();
  const reachSendFailed = async (page) => {
    await freshChat(page);
    await page.route(`**${submitPath}`, abortSubmit);
    const sent = `sendfail-${randomBytes(3).toString("hex")}`;
    await sendText(page, sent);
    await alertOf(page).getByText(SEND_FAILED_PRIMARY, { exact: true }).waitFor();
    await page.getByText(SEND_FAILED_MARKER, { exact: true }).waitFor();
    await page.unroute(`**${submitPath}`, abortSubmit);
    return sent;
  };
  await visit("send_failed", page, reachSendFailed, ["retry", "withdraw", "back"]);

  // resending: もう一度を押した直後の表示。送り直しの POST は宙ぶらにして確かめる。
  const reachResending = async (page) => {
    const sent = await reachSendFailed(page);
    await page.route(`**${submitPath}`, async (route) => {
      if (route.request().method() === "POST") return; // 宙ぶらのまま
      await route.continue();
    });
    await page.getByRole("button", { name: "もう一度", exact: true }).click();
    await page.getByText(RESENDING_MARKER, { exact: true }).waitFor();
    return sent;
  };
  await visit("resending", page, reachResending, ["message-action", "back"]);
  await page.unrouteAll();

  // offline: navigator.onLine が偽で送信 → オフラインの枠。もう一度は圏外では送れん
  // （出口として押せるが状態は留まる）ので、状態が動く出口として数えるのは戻るのみ。
  await visit(
    "offline",
    page,
    async () => {
      await context.setOffline(false);
      await freshChat(page);
      const sent = `offline-${randomBytes(3).toString("hex")}`;
      // 画面が仕上がってから回線を切る（先に切ると dev の module 取得が途切れて描画が止まる）。
      await fillText(page, sent);
      await context.setOffline(true);
      await clickSend(page);
      await alertOf(page).getByText(OFFLINE_PRIMARY, { exact: true }).waitFor();
      return sent;
    },
    ["back"],
  );
  {
    // もう一度の押し: 圏外のままでは送れず枠は残る。つなぎ直せば枠は自動で消え、
    // 入力に残った文をそのまま送信できる（自動では送らない・板 TalkError 7）。
    await context.setOffline(false);
    await freshChat(page);
    const sent = `offline-${randomBytes(3).toString("hex")}`;
    await fillText(page, sent);
    await context.setOffline(true);
    await clickSend(page);
    await alertOf(page).getByText(OFFLINE_PRIMARY, { exact: true }).waitFor();
    await page.getByRole("button", { name: "もう一度", exact: true }).click();
    await sleep(500);
    await alertOf(page).getByText(OFFLINE_PRIMARY, { exact: true }).waitFor();
    await context.setOffline(false);
    // 枠が消えて入力の文が残っている事を確かめてから、送信が普通に通る事まで見る。
    await page.waitForFunction(() => document.querySelector('[role="alert"]') === null, undefined, {
      timeout: UI_WAIT_MS,
    });
    await restoredInput(page, sent);
    // 自動では送らないので、入力に残った文を送信ボタンで送り直す。
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await page.locator(".v2-message-turn.user", { hasText: sent }).waitFor({ timeout: UI_WAIT_MS });
    exitsPressed.push("offline:retry");
    results.push("offline: retry press stays put, reconnect clears box, send works");
  }
  await context.setOffline(false);

  // S-14 + stopped: 小出しの途中で止める → shownSeq まで切り詰め →「ここで止めました」。
  const reachStopped = async (page) => {
    await freshChat(page);
    const sent = `stopped-${randomBytes(3).toString("hex")}`;
    const captured = captureSubmit(page);
    let shownSeq;
    await page.route(`**${submitPath}/stop`, async (route) => {
      shownSeq = route.request().postDataJSON()?.shownSeq;
      await route.continue();
    });
    await sendText(page, sent);
    // 塊が 2 つ出た所で止める。最初の assistant はあいさつ文なので、pending でない
    // assistant が 3 つ目（あいさつ＋塊 2 つ）に揃った時が「塊 2 つが出た」時点。
    await page
      .locator(".v2-message-turn.assistant:not(.pending)")
      .nth(2)
      .waitFor({ timeout: UI_WAIT_MS });
    await page.getByRole("button", { name: "返事を止める" }).click();
    await page.getByText(STOPPED_MARKER, { exact: true }).waitFor();
    return { sent, shownSeq, captured };
  };
  {
    const { shownSeq, captured } = await reachStopped(page);
    assert.equal(shownSeq, 1, "S-14: shownSeq は画面に出た最後の塊");
    // 3 つ目の塊は出ない（切り詰め済み）。少し待っても増えん事を確かめる。
    // あいさつ文と残った塊 2 つで、pending でない assistant は 3 つまで。
    await sleep(4_000);
    assert.ok(
      (await page.locator(".v2-message-turn.assistant:not(.pending)").count()) <= 3,
      "S-14: 3 つ目の塊は出ない",
    );
    // D1 側も発言 1・切り詰めた返事 1 の並びで残っている。
    const { conversationId } = await captured;
    const history = await historyOf(conversationId);
    const roles = (history?.history ?? []).map((row) => row.role);
    assert.deepEqual(roles, ["user", "assistant"], "S-14: 履歴は発言 1・返事 1");
    results.push("S-14: mid-reveal stop truncates to shown chunks");
    states.add("stopped");
  }
  await visit("stopped", page, async () => (await reachStopped(page)).sent, ["send", "back"]);
  // S-14b: 止めるの POST が届かん時は、残りの塊を全部出して通常へ戻る。
  {
    await freshChat(page);
    await sendText(page, `s14b-${randomBytes(3).toString("hex")}`);
    // あいさつ＋塊 2 つが出た所で止める（pending の「…」は数えん）。
    await page
      .locator(".v2-message-turn.assistant:not(.pending)")
      .nth(2)
      .waitFor({ timeout: UI_WAIT_MS });
    const abortStop = (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue();
    await page.route(`**${submitPath}/stop`, abortStop);
    const before = await page.locator(".v2-message-turn.assistant:not(.pending)").count();
    await page.getByRole("button", { name: "返事を止める" }).click();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".v2-message-turn.assistant:not(.pending)").length > count,
      before,
      { timeout: UI_WAIT_MS },
    );
    await page.unroute(`**${submitPath}/stop`, abortStop);
    results.push("S-14b: failed stop POST flushes remaining chunks to idle");
  }

  // idle: 送信・戻る
  await visit("idle", page, (page) => freshChat(page), ["send", "back"]);

  // B-1 タブを閉じる: 送信 300ms 後に閉じる → 新しいページで同じ会話 → 返事が 1 回分。
  // 保留を消して開いても同じ。
  {
    await freshChat(page);
    const captured = captureSubmit(page);
    await sendText(page, `b1-${randomBytes(3).toString("hex")}`);
    const { conversationId } = await captured;
    await sleep(300);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${base}${chatPath}`);
    // あいさつ文は履歴が読めた時点で消えるので、位置ではなく返事の本文で待つ。
    // LONG_REPLY の最初の dialogue 塊にだけ出る語を使う。
    const replyBubble = reopened.locator(".v2-message-turn.assistant:not(.pending)", {
      hasText: "詩集ばかり",
    });
    await replyBubble.first().waitFor({ timeout: UI_WAIT_MS });
    // 付け直しの placeholder が残ると「作りかけ」のまま見えるので、消えるまで待つ。
    await reopened.waitForFunction(
      () => document.querySelectorAll(".v2-message-turn.pending").length === 0,
      undefined,
      { timeout: UI_WAIT_MS },
    );
    assert.equal(
      await reopened.locator(".v2-message-turn.user").count(),
      1,
      "B-1: 開き直しで発言が増えていない（重複送信なし）",
    );
    const history = await historyOf(conversationId);
    const roles = (history?.history ?? []).map((row) => row.role);
    assert.deepEqual(roles, ["user", "assistant"], "B-1: 返事は 1 回分だけ");
    // 保留を消して開いても同じ（サーバの履歴に在る）。
    await reopened.evaluate((charId) => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(`v2-chat-pending:${charId}:`)) localStorage.removeItem(key);
      }
    }, characterId);
    await reopened.reload();
    await replyBubble.first().waitFor({ timeout: UI_WAIT_MS });
    // 返事は 1 行にまとまって履歴から出る。重複送信があれば user の吹き出しが
    // 増えるので、発言側の数で確かめる。pending の抜け殻が残るのも詰まりなので見る。
    assert.ok(
      (await reopened.locator(".v2-message-turn.assistant:not(.pending)").count()) >= 1,
      "B-1: 保留を消しても返事は出る",
    );
    assert.equal(
      await reopened.locator(".v2-message-turn.user").count(),
      1,
      "B-1: 発言は 1 つだけ（重複送信なし）",
    );
    assert.equal(
      await reopened.locator(".v2-message-turn.pending").count(),
      0,
      "B-1: pending の吹き出しが残っていない",
    );
    results.push("B-1: closing tab mid-send still delivers exactly one reply");
  }

  // ---- 集計 ----
  const report = {
    states: [...states],
    exitsPressed: exitsPressed.length,
    exits: exitsPressed,
    deadEnds,
    failures,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (deadEnds.length > 0) {
    process.exitCode = 1;
    console.error(`dead ends: ${deadEnds.join(", ")}`);
  }
  if (failures.length > 0) {
    process.exitCode = 1;
    console.error(`failed exits: ${failures.length}`);
  }
} finally {
  await browser?.close().catch(() => {});
  await killServer();
  // .dev.vars は元の中身へ戻す（無かったなら消す）。
  if (originalVars === null) await rm(varsFile, { force: true });
  else await writeFile(varsFile, originalVars, { mode: 0o600 });
}
