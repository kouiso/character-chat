/**
 * prod-smoke.ts — 本番診断スクリプト
 *
 * 公開アプリシェルと Bearer トークン（API 認証）を組み合わせて
 * 画像パイプライン・チャットパイプラインを検証する。
 *
 * 使い方:
 *   pnpm verify:prod                             # フル機能テスト
 *   PROD_VERIFY_MODE=reachable pnpm verify:prod  # エッジ疎通のみ
 *   PROD_VERIFY_MODE=auth pnpm verify:prod       # 認証チェックのみ
 *   EXPECT_MODEL=deepseek/deepseek-chat pnpm verify:prod  # モデル identity 検証
 *
 * 設定: .prod-verify.vars (gitignore 済み、chmod 600)
 *   PROD_BASE_URL=https://adult-ai-chat.pages.dev
 *   BASIC_AUTH_USER=<API login username>
 *   BASIC_AUTH_PASS=<API login password>
 *   AUTH_TOKEN=<bearer token>
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseChatSseBody } from "../lib/read-chat-sse";

// ── 設定 ──────────────────────────────────────────────────────────────────

const loadVars = (): Record<string, string> => {
  const varsPath = resolve(process.cwd(), ".prod-verify.vars");
  try {
    const lines = readFileSync(varsPath, "utf8").split("\n");
    return Object.fromEntries(
      lines
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const idx = l.indexOf("=");
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        }),
    );
  } catch {
    console.error(
      `エラー: ${varsPath} の読み込みに失敗しました。ファイルが存在するか、権限を確認してください。`,
    );
    process.exit(1);
  }
};

const vars = loadVars();
const BASE_URL = vars["PROD_BASE_URL"] ?? "https://adult-ai-chat.pages.dev";
const BASIC_USER = vars["BASIC_AUTH_USER"] ?? "";
const BASIC_PASS = vars["BASIC_AUTH_PASS"] ?? "";
let AUTH_TOKEN = vars["AUTH_TOKEN"] ?? "";
const MODE = process.env["PROD_VERIFY_MODE"] ?? "functional";
const EXPECT_MODEL = process.env["EXPECT_MODEL"] ?? "";

// ── HTTP ヘルパー ─────────────────────────────────────────────────────────

interface FetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  rawBody: Buffer;
}

const cfFetch = async (
  path: string,
  opts: {
    method?: string;
    body?: string;
    skipAuth?: boolean;   // skip Bearer token (API-level auth)
  },
): Promise<FetchResult> => {
  const url = new URL(path, BASE_URL);
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 adult-ai-prod-smoke/2.0",
  };
  if (!opts.skipAuth && AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  }
  if (opts.body) {
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body,
      signal: controller.signal,
      redirect: "manual",
    });

    // arrayBuffer() でバイナリを安全に取得し、utf8 文字列とバッファを両方保持する
    const rawBody = Buffer.from(await res.arrayBuffer());
    const resHeaders: Record<string, string | string[] | undefined> = {};
    res.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });

    return {
      status: res.status,
      headers: resHeaders,
      body: rawBody.toString("utf8"),
      rawBody,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── テストステップ ────────────────────────────────────────────────────────

const pass = (msg: string): void => console.log(`  ✓ ${msg}`);
const fail = (msg: string): void => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string): void => console.log(`  → ${msg}`);
const section = (name: string): void => console.log(`\n[${name}]`);

const testGuard = async (): Promise<void> => {
  section("PUBLIC SHELL — no credentials must get non-empty HTML");
  const r = await cfFetch("/", { skipAuth: true });
  const hasHtml = r.body.trim().length > 0 && /<(?:!doctype\s+html|html)\b/i.test(r.body);
  if (r.status === 200 && hasHtml) {
    pass(`public app shell OK (200, ${r.rawBody.length} bytes)`);
  } else {
    fail(`expected 200 with non-empty HTML, got ${r.status} (${r.rawBody.length} bytes)`);
  }
};

const testReachable = async (): Promise<void> => {
  section("REACHABLE — public app shell");
  const r = await cfFetch("/", { skipAuth: true });
  info(`status ${r.status}`);
  if (r.status === 200) {
    pass("public app shell returned 200");
    const hasHtml = r.body.includes("<!doctype html") || r.body.includes("<html");
    info(`HTML detected: ${hasHtml}`);
  } else {
    fail(`expected 200, got ${r.status}`);
  }
};

const testAuth = async (): Promise<void> => {
  section("AUTH — bearer token app auth (/api/me)");
  const r = await cfFetch("/api/me", {});
  info(`status ${r.status}, body: ${r.body.slice(0, 200)}`);
  if (r.status === 200) {
    pass("app auth OK — /api/me returned 200");
    try {
      const json = JSON.parse(r.body) as { email?: string };
      info(`email: ${json.email ?? "(none)"}`);
    } catch {
      /* 無視 */
    }
  } else {
    fail(`/api/me returned ${r.status} — AUTH_TOKEN may not be deployed yet`);
  }
};

const REFUSAL_PATTERNS = [
  "申し訳",
  "お断り",
  "できません",
  "不適切",
  "refused",
  "cannot",
  "inappropriate",
  "I'm sorry",
  "I can't",
];

const isRefusal = (text: string): boolean =>
  REFUSAL_PATTERNS.some((p) => text.toLowerCase().includes(p.toLowerCase()));

const extractSseText = (body: string): string => parseChatSseBody(body).text;

// eslint-disable-next-line complexity
const testChatSmoke = async (): Promise<void> => {
  section("CHAT SMOKE — model identity + refusal check (N=3 turns)");

  const TURNS = 3;
  const PROMPT = "こんにちは。調子はどう？";
  let refusals = 0;
  const modelsSeen = new Set<string>();

  for (let i = 1; i <= TURNS; i += 1) {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      info(`ターン ${i}/${TURNS}: POST /api/chat (attempt ${attempt}/${maxAttempts})`);
      const body = JSON.stringify({
        messages: [{ role: "user", content: PROMPT }],
        safeMode: false,
      });

      let r: Awaited<ReturnType<typeof cfFetch>>;
      try {
        r = await cfFetch("/api/chat", { method: "POST", body });
      } catch (e) {
        fail(`ターン ${i}: fetch error — ${String(e)}`);
        refusals += 1;
        break;
      }

      info(`  status ${r.status}`);
      if (r.status !== 200) {
        fail(`ターン ${i}: /api/chat returned ${r.status} — ${r.body.slice(0, 200)}`);
        refusals += 1;
        break;
      }

      const modelUsed = (r.headers["x-model-used"] as string | undefined) ?? "(none)";
      modelsSeen.add(modelUsed);
      info(`  x-model-used: ${modelUsed}`);

      if (EXPECT_MODEL && modelUsed !== EXPECT_MODEL) {
        fail(`  model mismatch: expected ${EXPECT_MODEL}, got ${modelUsed}`);
      } else if (EXPECT_MODEL) {
        pass(`  model identity OK: ${modelUsed}`);
      }

      const text = extractSseText(r.body);
      info(`  text (first 120): ${text.slice(0, 120).replace(/\n/g, " ")}`);

      if (isRefusal(text)) {
        fail(`ターン ${i}: refusal detected`);
        refusals += 1;
        break;
      }
      if (text.length > 0) {
        pass(`ターン ${i}: non-refusal response (${text.length} chars)`);
        break;
      }

      const emptyReason = r.body.length === 0 ? "empty response body" : "empty extracted SSE text";
      if (attempt < maxAttempts) {
        info(`ターン ${i}: ${emptyReason} — retrying once`);
        continue;
      }

      fail(`ターン ${i}: ${emptyReason}`);
      refusals += 1;
      break;
    }
  }

  const summary = `refusals=${refusals}/${TURNS}  models=${[...modelsSeen].join(",")}`;
  info(summary);
  if (refusals === 0) {
    pass(`chat smoke PASS — ${summary}`);
  } else {
    fail(`chat smoke FAIL — ${summary}`);
  }
};

const pollTaskResult = async (
  taskId: string,
  timeoutMs: number,
  // eslint-disable-next-line complexity
): Promise<{ status: string; imageUrl?: string } | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    const r = await cfFetch(`/api/image/task/${encodeURIComponent(taskId)}`, {});
    if (r.status !== 200) {
      info(`  poll ${r.status}: ${r.body.slice(0, 200)}`);
      continue;
    }
    const json = JSON.parse(r.body) as {
      task?: { status?: string };
      images?: Array<{ image_url?: string }>;
    };
    const taskStatus: string = json?.task?.status ?? "unknown";
    info(`  task status: ${taskStatus}`);
    if (taskStatus === "TASK_STATUS_SUCCEED") {
      const imageUrl: string | undefined = json?.images?.[0]?.image_url;
      return { status: "succeed", imageUrl };
    }
    if (taskStatus === "TASK_STATUS_FAILED" || taskStatus === "TASK_STATUS_CANCELED") {
      return { status: taskStatus };
    }
  }
  return null;
};

// eslint-disable-next-line complexity
const testImagePipeline = async (): Promise<void> => {
  section("IMAGE PIPELINE — generate → poll → persist (write path)");

  // ステップ1: POST /api/image
  info("ステップ1: POST /api/image");
  const initBody = JSON.stringify({
    prompt: "anime girl smiling, outdoor scene",
    characterId: "default-character",
    characterDescription: "young woman, black hair, friendly",
    negative_prompt: "ugly, deformed",
    width: 512,
    height: 768,
    phase: "conversation",
  });
  const initR = await cfFetch("/api/image", { method: "POST", body: initBody });
  info(`  status ${initR.status}, body: ${initR.body.slice(0, 400)}`);

  if (initR.status !== 200 && initR.status !== 201) {
    fail(`POST /api/image returned ${initR.status} — PIPELINE BLOCKED HERE`);
    return;
  }

  let taskId: string;
  try {
    const json = JSON.parse(initR.body) as {
      error?: string;
      task_id?: string;
      loraModel?: string | null;
    };
    if (json.error) {
      fail(`POST /api/image error: ${json.error}`);
      return;
    }
    if (!json.loraModel) {
      fail("POST /api/image did not use LoRA for default-character");
      return;
    }
    taskId = json.task_id ?? "";
    pass(`POST /api/image OK — task_id: ${taskId} (LoRA: ${json.loraModel})`);
  } catch {
    fail(`POST /api/image response not JSON: ${initR.body.slice(0, 200)}`);
    return;
  }

  // ステップ2: タスクポーリング（最大 90s）
  info("ステップ2: /api/image/task/:id をポーリング (最大 90s)");
  const taskResult = await pollTaskResult(taskId, 90_000);
  if (!taskResult) {
    fail("task poll timed out (90s)");
    return;
  }
  if (taskResult.status !== "succeed") {
    fail(`task ended with status: ${taskResult.status}`);
    return;
  }
  const ephemeralUrl = taskResult.imageUrl;
  pass(`task succeeded — ephemeral URL: ${ephemeralUrl?.slice(0, 80) ?? "(none)"}`);

  if (!ephemeralUrl) {
    fail("no imageUrl in task result — cannot proceed to persist");
    return;
  }

  // ステップ3: R2 へ永続化（診断用のダミー messageId を使用）
  // 偽 messageId の 404 は、認証・許可ホスト検証後に所有者事前チェックへ到達した証拠として扱う。
  // R2 表示確認（所有者チェック込み）は testR2Display() で実施。
  info("ステップ3: POST /api/image/persist → R2");
  const fakeMessageId = `smoke-test-${Date.now()}`;
  const persistBody = JSON.stringify({ imageUrl: ephemeralUrl, messageId: fakeMessageId });
  const persistR = await cfFetch("/api/image/persist", { method: "POST", body: persistBody });
  info(`  status ${persistR.status}, body: ${persistR.body.slice(0, 400)}`);

  if (persistR.status === 404 && persistR.body.includes("message not found")) {
    pass("persist ownership pre-check reached — fake messageId correctly returned message not found");
    return;
  }

  if (persistR.status !== 200 && persistR.status !== 201) {
    fail(`POST /api/image/persist returned ${persistR.status} — PIPELINE BLOCKED HERE`);
    return;
  }

  try {
    const json = JSON.parse(persistR.body) as { error?: string; imageKey?: string };
    if (json.error) {
      fail(`persist error: ${json.error}`);
      return;
    }
    pass(`persist OK — imageKey: ${json.imageKey ?? "(none)"} (write path verified)`);
  } catch {
    fail(`persist response not JSON: ${persistR.body.slice(0, 200)}`);
  }
};

// R2 表示確認: 既存の実メッセージの imageKey を使って所有者チェック込みで検証する。
// 偽 messageId では IDOR 防御の所有者チェックが通らないため、実メッセージを使う。
// eslint-disable-next-line complexity
const testR2Display = async (): Promise<void> => {
  section("R2 DISPLAY — read path via real owned message");

  // 会話一覧を取得
  const convsR = await cfFetch("/api/conversations", {});
  if (convsR.status !== 200) {
    info(`/api/conversations returned ${convsR.status} — skipping R2 display test`);
    return;
  }

  let convIds: string[] = [];
  try {
    const json = JSON.parse(convsR.body) as
      | Array<{ id?: string }>
      | { conversations?: Array<{ id?: string }> };
    const arr = Array.isArray(json) ? json : (json.conversations ?? []);
    convIds = arr.slice(0, 20).map((c) => c.id ?? "").filter(Boolean);
  } catch {
    info("conversations parse error — skipping R2 display test");
    return;
  }

  if (convIds.length === 0) {
    info("no conversations found — skipping R2 display test");
    return;
  }

  // imageKey を持つメッセージを探す
  let foundKey: string | null = null;
  for (const convId of convIds) {
    const msgsR = await cfFetch(`/api/conversations/${encodeURIComponent(convId)}/messages`, {});
    if (msgsR.status !== 200) continue;
    try {
      const msgsJson = JSON.parse(msgsR.body) as
        | Array<{ imageKey?: string | null }>
        | { messages?: Array<{ imageKey?: string | null }> };
      const msgs = Array.isArray(msgsJson) ? msgsJson : (msgsJson.messages ?? []);
      const withImage = msgs.find((m) => m.imageKey);
      if (withImage?.imageKey) {
        foundKey = withImage.imageKey;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!foundKey) {
    info("no message with imageKey found in recent conversations — skipping R2 display test");
    return;
  }

  info(`found imageKey: ${foundKey}`);
  const r2R = await cfFetch(`/api/image/r2/${encodeURIComponent(foundKey)}`, {});
  info(
    `  status ${r2R.status}, content-type: ${r2R.headers["content-type"] ?? "(none)"}, bytes: ${r2R.rawBody.length}`,
  );

  if (r2R.status === 200) {
    pass(`R2 image fetch 200 — ${r2R.rawBody.length} bytes`);

    const ts = Date.now();
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const evidenceDir = ".work/e2e-results";
    try {
      mkdirSync(evidenceDir, { recursive: true });
      const outPath = `${evidenceDir}/prod-smoke-${ts}.jpg`;
      writeFileSync(outPath, r2R.rawBody);
      pass(`evidence written → ${outPath}`);
    } catch {
      info("エビデンスファイルの書き込みに失敗しました");
    }
  } else {
    fail(`R2 image fetch ${r2R.status} — DISPLAY FAILURE`);
    info(`  body: ${r2R.body.slice(0, 400)}`);
  }
};

// ── メイン ────────────────────────────────────────────────────────────────

// .prod-verify.vars の AUTH_TOKEN が本番のシークレットとズレていても、
// /api/auth/basic-login で新規JWTを都度取得できる。
// AUTH_TOKEN がまだ有効ならそのまま使い、無効時のみフォールバックする。
const resolveAuthToken = async (): Promise<string> => {
  if (AUTH_TOKEN) {
    const probe = await cfFetch("/api/me", {});
    if (probe.status === 200) return AUTH_TOKEN;
  }

  if (!BASIC_USER || !BASIC_PASS) return AUTH_TOKEN;

  const fd = new URLSearchParams();
  fd.set("username", BASIC_USER);
  fd.set("password", BASIC_PASS);
  const url = new URL("/api/auth/basic-login", BASE_URL);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: fd.toString(),
  });
  if (!res.ok) return AUTH_TOKEN;
  const data = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!data?.token) return AUTH_TOKEN;
  console.log("[INFO] AUTH_TOKEN stale — obtained fresh token via /api/auth/basic-login");
  return data.token;
};

const main = async (): Promise<void> => {
  console.log(`\n=== prod-smoke: mode=${MODE} target=${BASE_URL} ===`);

  AUTH_TOKEN = await resolveAuthToken();

  console.log(
    `basic_user=${BASIC_USER || "(unset)"}  auth_token_len=${AUTH_TOKEN.length}${EXPECT_MODEL ? `  expect_model=${EXPECT_MODEL}` : ""}`,
  );

  await testGuard();

  if (MODE === "reachable") {
    await testReachable();
    return;
  }

  await testReachable();
  await testAuth();

  if (MODE === "auth") {
    console.log(`\n=== DONE (exit=${process.exitCode ?? 0}) ===`);
    return;
  }

  if (MODE === "functional") {
    await testChatSmoke();
    await testImagePipeline();
    await testR2Display();
  }

  console.log(`\n=== DONE (exit=${process.exitCode ?? 0}) ===`);
};

void main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
