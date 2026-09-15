/**
 * local-smoke.ts — ローカル画像パイプライン診断スクリプト
 *
 * wrangler pages dev のローカル認証バイパスを使い、
 * 画像生成から R2 までの書き込み・読み込み経路を検証する。
 */

import { mkdirSync, writeFileSync } from "node:fs";

// ── 設定 ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env["BASE_URL"] ?? "http://127.0.0.1:8788";
const EVIDENCE_DIR = ".work/e2e-results";

// ── HTTP ヘルパー ─────────────────────────────────────────────────────────

interface FetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  rawBody: Buffer;
}

const localFetch = async (
  path: string,
  opts: { method?: string; body?: string },
): Promise<FetchResult> => {
  const url = new URL(path, BASE_URL);
  const headers: Record<string, string> = {
    "User-Agent": "adult-ai-local-smoke/1.0",
  };
  if (opts.body) {
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 150_000);

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

const saveEvidence = (filename: string, data: Buffer): void => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(`${EVIDENCE_DIR}/${filename}`, data);
};

const fetchRealMessageId = async (): Promise<string | null> => {
  const convsR = await localFetch("/api/conversations", {});
  if (convsR.status !== 200) {
    return null;
  }

  let convIds: string[] = [];
  try {
    const json = JSON.parse(convsR.body) as
      | Array<{ id?: string }>
      | { conversations?: Array<{ id?: string }> };
    const arr = Array.isArray(json) ? json : (json.conversations ?? []);
    convIds = arr
      .slice(0, 20)
      .map((c) => c.id ?? "")
      .filter(Boolean);
  } catch {
    return null;
  }

  if (convIds.length === 0) {
    return null;
  }

  for (const convId of convIds) {
    const msgsR = await localFetch(`/api/conversations/${encodeURIComponent(convId)}/messages`, {});
    if (msgsR.status !== 200) {
      continue;
    }

    try {
      const msgsJson = JSON.parse(msgsR.body) as
        | Array<{ id?: string }>
        | { messages?: Array<{ id?: string }> };
      const msgs = Array.isArray(msgsJson) ? msgsJson : (msgsJson.messages ?? []);
      const firstId = msgs.find((m) => m.id)?.id;
      if (firstId) {
        return firstId;
      }
    } catch {
      continue;
    }
  }

  return null;
};

const pollImageTask = async (
  taskId: string,
  timeoutMs: number,
): Promise<{ status: string; imageUrl?: string } | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    const r = await localFetch(`/api/image/task/${encodeURIComponent(taskId)}`, {});
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

const testAuth = async (): Promise<void> => {
  section("AUTH — local app auth");
  const r = await localFetch("/api/me", {});
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
    fail(`/api/me returned ${r.status} — local auth bypass may not be active`);
  }
};

const testProviders = async (): Promise<void> => {
  section("PROVIDERS — /api/image/providers");
  const r = await localFetch("/api/image/providers", {});
  info(`status ${r.status}, body: ${r.body.slice(0, 300)}`);
  if (r.status === 200) {
    pass("/api/image/providers 200");
    const json = JSON.parse(r.body) as { novita?: boolean };
    info(`novita=${json.novita}`);
  } else {
    fail(`/api/image/providers returned ${r.status}`);
  }
};

const testImagePipeline = async (): Promise<void> => {
  section("IMAGE PIPELINE — generate → poll → persist → R2");

  info("ステップ1: POST /api/image");
  // char-codex-sample は無効な lora_model が seed されていて Runware 400 を返すため、
  // seed 済みの非 LoRA キャラ char-yuzuki を使って画像パイプラインを検証する。
  const initBody = JSON.stringify({
    prompt: "anime girl smiling, outdoor scene",
    characterId: "char-yuzuki",
    characterDescription: "young woman, black hair, friendly",
    negative_prompt: "ugly, deformed",
    width: 512,
    height: 768,
    phase: "conversation",
  });
  const initR = await localFetch("/api/image", { method: "POST", body: initBody });
  info(`  status ${initR.status}, body: ${initR.body.slice(0, 400)}`);

  if (initR.status === 402) {
    fail("Novita 課金エラー (402)");
    return;
  }
  if (initR.status === 429) {
    fail("レートリミット or アプリ上限 (429)");
    return;
  }
  if (initR.status !== 200 && initR.status !== 201) {
    fail(`POST /api/image returned ${initR.status} — PIPELINE BLOCKED HERE`);
    return;
  }

  let taskId: string;
  try {
    const json = JSON.parse(initR.body) as {
      error?: string;
      task_id?: string;
      taskId?: string;
      loraModel?: string | null;
    };
    if (json.error) {
      fail(`POST /api/image error: ${json.error}`);
      return;
    }
    taskId = json.task_id ?? json.taskId ?? "";
    info(`LoRA: ${json.loraModel ?? "none"}`);
    pass(`POST /api/image OK — task_id: ${taskId}`);
  } catch {
    fail(`POST /api/image response not JSON: ${initR.body.slice(0, 200)}`);
    return;
  }

  info("ステップ2: /api/image/task/:id をポーリング (最大 90s)");
  const taskResult = await pollImageTask(taskId, 90_000);
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

  info("ステップ3: POST /api/image/persist → R2");
  const messageId = await fetchRealMessageId();
  if (!messageId) {
    fail("no real messageId found — cannot verify persist");
    return;
  }

  const persistBody = JSON.stringify({ imageUrl: ephemeralUrl, messageId });
  const persistR = await localFetch("/api/image/persist", { method: "POST", body: persistBody });
  info(`  status ${persistR.status}, body: ${persistR.body.slice(0, 400)}`);

  if (persistR.status !== 200 && persistR.status !== 201) {
    fail(`POST /api/image/persist returned ${persistR.status} — PIPELINE BLOCKED HERE`);
    return;
  }

  let imageKey: string;
  try {
    const json = JSON.parse(persistR.body) as { error?: string; imageKey?: string };
    if (json.error) {
      fail(`persist error: ${json.error}`);
      return;
    }
    imageKey = json.imageKey ?? "";
    pass(`persist OK — imageKey: ${imageKey} (write path verified)`);
  } catch {
    fail(`persist response not JSON: ${persistR.body.slice(0, 200)}`);
    return;
  }

  if (!imageKey) {
    fail("no imageKey in persist result — cannot proceed to R2 fetch");
    return;
  }

  info("ステップ4: GET /api/image/r2/:key");
  const r2R = await localFetch(`/api/image/r2/${encodeURIComponent(imageKey)}`, {});
  info(
    `  status ${r2R.status}, content-type: ${r2R.headers["content-type"] ?? "(none)"}, bytes: ${r2R.rawBody.length}`,
  );

  if (r2R.status === 200) {
    if (r2R.rawBody.length === 0) {
      fail("R2 image fetch returned 0 bytes — empty artifact not valid evidence");
      return;
    }
    const filename = `local-smoke-img-${Date.now()}.jpg`;
    saveEvidence(filename, r2R.rawBody);
    pass(`R2 image fetch 200 — evidence written → ${EVIDENCE_DIR}/${filename}`);
    return;
  }

  fail(`R2 image fetch ${r2R.status} — DISPLAY FAILURE`);
  info(`  body: ${r2R.body.slice(0, 400)}`);
};

// ── メイン ────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  console.log(`\n=== local-smoke: target=${BASE_URL} ===`);

  await testAuth();

  if (process.exitCode === 1) {
    console.log("\n=== ABORTED (auth failed) ===");
    return;
  }

  await testProviders();
  await testImagePipeline();

  console.log(`\n=== DONE (exit=${process.exitCode ?? 0}) ===`);
};

void main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
