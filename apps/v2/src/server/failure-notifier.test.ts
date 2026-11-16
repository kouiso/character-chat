// @vitest-environment node
// RIT-66 FR-4〜FR-6・NFR-2〜NFR-4: 知らせる失敗だけが、決めた項目だけの本文で、
// 60 秒に 1 件まで Slack の受け口へ届く契約を固定する。
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LogEntry } from "@v2/db";

import { notifyFailure, resetFailureNotifierState, shouldNotifyFailure } from "./failure-notifier";

const waitUntilJobs = vi.hoisted(() => ({ jobs: [] as Promise<unknown>[] }));
vi.mock("cloudflare:workers", () => ({
  waitUntil: (job: Promise<unknown>) => void waitUntilJobs.jobs.push(job),
}));

const { reportFailure } = await import("./log");

const WEBHOOK = "https://hooks.slack.test/T0000000/B0000000/secret-webhook-marker";
const env = { SLACK_ERROR_WEBHOOK_URL: WEBHOOK, APP_ENV: "staging" };

const okFetch = () => {
  const calls: { url: string; body: string }[] = [];
  const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response("ok", { status: 200 });
  });
  return { calls, impl: impl as unknown as typeof fetch };
};

const consoleLines = (spies: ReturnType<typeof vi.spyOn>[]) =>
  spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");

beforeEach(() => {
  resetFailureNotifierState();
  waitUntilJobs.jobs.length = 0;
  vi.restoreAllMocks();
});

describe("shouldNotifyFailure", () => {
  it.each([
    "worker_request_failed",
    "memory_queue_publish_failed",
    "context_budget_config_invalid",
    "binding_unavailable",
    "failure_drill",
  ] as const)("知らせる表の %s は送る", (event) => {
    expect(shouldNotifyFailure({ event, level: "error" })).toBe(true);
  });

  it.each([
    { event: "chat_turn_failed", terminal: true, want: true },
    { event: "chat_turn_failed", terminal: false, want: false },
    { event: "memory_extraction_failed", terminal: true, want: true },
    { event: "memory_extraction_failed", terminal: false, want: false },
    { event: "image_generation_error", status: 500, want: true },
    { event: "image_generation_error", status: 502, want: false },
  ] as const)("%event terminal/status 条件は %want", ({ event, terminal, status, want }) => {
    expect(shouldNotifyFailure({ event, level: "error", terminal, status })).toBe(want);
  });

  it.each([
    "memory_queue_invalid_message",
    "memory_manual_index_failed",
    "document_retrieval_failed",
    "proactive_push_failed",
    "ledger_fallback",
    "failure_notice_failed",
  ] as const)("表に無い %s は記録だけで届けん", (event) => {
    expect(shouldNotifyFailure({ event, level: "error" })).toBe(false);
  });
});

describe("notifyFailure", () => {
  it("受け口が未設定なら送らず unconfigured を返す", async () => {
    const { impl } = okFetch();
    await expect(
      notifyFailure({}, { event: "worker_request_failed", level: "error" }, { fetchImpl: impl }),
    ).resolves.toBe("unconfigured");
    expect(impl).not.toHaveBeenCalled();
  });

  it("本文は決めた項目だけで組む（例外文・URL・会話やキャラの id は入れん）", async () => {
    const { calls, impl } = okFetch();
    const entry: LogEntry = {
      event: "chat_turn_failed",
      level: "error",
      reason: "unexpected:Error",
      status: 500,
      route: "/api/chat/:id",
      // NFR-1 で記録には出してよいが、知らせには乗らん項目。本文へ出ん事を確かめる。
      jobId: "job-secret-9f2e",
      conversationId: "conv-secret-8b1d",
    };
    await expect(
      notifyFailure({ ...env, CF_VERSION_METADATA: { tag: "v-abc123" } }, entry, {
        fetchImpl: impl,
      }),
    ).resolves.toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(WEBHOOK);
    const payload = JSON.parse(calls[0]?.body ?? "{}") as {
      text: string;
      blocks: { fields: { text: string }[] }[];
    };
    expect(payload.text).toBe("[character-chat v2][staging] chat_turn_failed");
    const body = calls[0]?.body ?? "";
    for (const label of ["environment", "event", "reason", "status", "route", "version"]) {
      expect(body).toContain(`*${label}:*`);
    }
    expect(body).toContain("v-abc123");
    expect(body).not.toContain("job-secret-9f2e");
    expect(body).not.toContain("conv-secret-8b1d");
    expect(body).not.toContain("jobId");
    expect(body).not.toContain("conversationId");
  });

  it("同じ失敗は 60 秒に 1 件まで。過ぎたら抑えた回数を添えて送る", async () => {
    const { calls, impl } = okFetch();
    const entry: LogEntry = { event: "worker_request_failed", level: "error", reason: "r" };
    const start = 1_000_000;
    await expect(notifyFailure(env, entry, { now: start, fetchImpl: impl })).resolves.toBe("sent");
    for (let index = 0; index < 8; index += 1) {
      await expect(
        notifyFailure(env, entry, { now: start + 10_000 + index, fetchImpl: impl }),
      ).resolves.toBe("suppressed");
    }
    expect(calls).toHaveLength(1);
    await expect(notifyFailure(env, entry, { now: start + 61_000, fetchImpl: impl })).resolves.toBe(
      "sent",
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toContain("*suppressed:*");
    expect(calls[1]?.body).toContain("8");
  });

  it("環境・出来事・理由が違う失敗は別の指紋なので抑えられん", async () => {
    const { calls, impl } = okFetch();
    const base = 1_000_000;
    await notifyFailure(
      env,
      { event: "worker_request_failed", level: "error" },
      { now: base, fetchImpl: impl },
    );
    await notifyFailure(
      env,
      { event: "failure_drill", level: "info" },
      { now: base + 1, fetchImpl: impl },
    );
    await notifyFailure(
      env,
      { event: "worker_request_failed", level: "error", reason: "x" },
      { now: base + 2, fetchImpl: impl },
    );
    await notifyFailure(
      { ...env, APP_ENV: "production" },
      { event: "worker_request_failed", level: "error" },
      { now: base + 3, fetchImpl: impl },
    );
    expect(calls).toHaveLength(4);
  });

  it("受け口が 2xx 以外を返しても例外を投げず failure_notice_failed を記録する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const impl = vi.fn(async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    await expect(
      notifyFailure(env, { event: "worker_request_failed", level: "error" }, { fetchImpl: impl }),
    ).resolves.toBe("rejected");
    const logged = consoleLines([warn]);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      event: "failure_notice_failed",
      level: "warn",
      status: 500,
    });
    expect(logged).not.toContain("secret-webhook-marker");
  });

  it("送信そのものが例外でも元の処理を失敗にせん（NFR-3）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const impl = vi.fn(async () => {
      throw new TypeError("network is down secret-webhook-marker");
    }) as unknown as typeof fetch;
    await expect(
      notifyFailure(env, { event: "worker_request_failed", level: "error" }, { fetchImpl: impl }),
    ).resolves.toBe("rejected");
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      event: "failure_notice_failed",
      reason: "unexpected:TypeError",
    });
    // NFR-4: 受け口の URL も、例外に混ざった URL 文字列も記録へ出さん。
    expect(consoleLines([warn])).not.toContain("secret-webhook-marker");
  });
});

describe("reportFailure", () => {
  it("知らせる失敗は記録してから送信を waitUntil に渡す（応答を待たせん）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const impl = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", impl);
    reportFailure(env, { event: "worker_request_failed", level: "error", method: "GET" });
    // 送信の完了を待たずに同期で返る。記録は先に出ている。
    expect(error).toHaveBeenCalledOnce();
    expect(waitUntilJobs.jobs).toHaveLength(1);
    await expect(Promise.all(waitUntilJobs.jobs)).resolves.toBeDefined();
    expect(impl).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("表に無い出来事は記録だけで送信を起こさん", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const impl = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", impl);
    reportFailure(env, { event: "ledger_fallback", level: "warn", count: 2 });
    expect(warn).toHaveBeenCalledOnce();
    expect(waitUntilJobs.jobs).toHaveLength(0);
    await Promise.resolve();
    expect(impl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
