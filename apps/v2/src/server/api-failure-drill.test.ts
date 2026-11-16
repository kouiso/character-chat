// @vitest-environment node
// RIT-66 FR-7: POST /api/admin/failure-drill — 訓練用の知らせを 1 件送り、
// 届いたかを応答で答える。受け口の有無・成否をそのまま 202/503/502 に写す。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetFailureNotifierState } from "./failure-notifier";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => ({ env: platform.env }) }));

const { handleFailureDrill } = await import("./api-failure-drill");

const fetchMock = vi.hoisted(() =>
  vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    void url;
    void init;
    return new Response("ok", { status: 200 });
  }),
);
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  resetFailureNotifierState();
  fetchMock.mockClear();
  platform.env = {};
});

describe("POST /api/admin/failure-drill", () => {
  it("受け口が生きていれば 202 {sent:true} を返し、訓練の知らせを 1 件送る", async () => {
    platform.env = { SLACK_ERROR_WEBHOOK_URL: "https://hooks.slack.test/x", APP_ENV: "staging" };
    const response = await handleFailureDrill();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(body).toContain("failure_drill");
    expect(body).toContain("staging");
  });

  it("受け口が未設定なら 503 notifier_unconfigured（送信も起きん）", async () => {
    platform.env = { APP_ENV: "staging" };
    const response = await handleFailureDrill();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: "notifier_unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("受け口が 2xx 以外を返したら 502 notifier_rejected", async () => {
    platform.env = { SLACK_ERROR_WEBHOOK_URL: "https://hooks.slack.test/x", APP_ENV: "staging" };
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 500 }));
    const response = await handleFailureDrill();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ reason: "notifier_rejected" });
  });

  it("訓練の知らせは 60 秒の抑えを素通りする（届く経路の生死を確かめるため）", async () => {
    platform.env = { SLACK_ERROR_WEBHOOK_URL: "https://hooks.slack.test/x", APP_ENV: "staging" };
    await handleFailureDrill();
    await handleFailureDrill();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
