// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// RIT-213: 音声通話クォータ。JST 日次区切り・積算・上限頭打ちを見る。
const state = vi.hoisted(() => ({
  usage: new Map<string, { user_id: string; day_start: number; seconds: number }>(),
}));

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      V2_VOICE_CALL_FREE_SECONDS: "180",
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            first: async () => {
              if (sql.includes("FROM v2_voice_call_usage"))
                return state.usage.get(`${args[0]}:${args[1]}`) ?? null;
              return null;
            },
            run: async () => {
              if (sql.includes("INSERT INTO v2_voice_call_usage")) {
                const key = `${args[0]}:${args[1]}`;
                const cur = state.usage.get(key)?.seconds ?? 0;
                state.usage.set(key, {
                  user_id: args[0] as string,
                  day_start: args[1] as number,
                  seconds: cur + (args[2] as number),
                });
                return { success: true };
              }
              if (sql.includes("UPDATE v2_voice_call_usage")) {
                const key = `${args[1]}:${args[2]}`;
                const row = state.usage.get(key);
                if (row) row.seconds = args[0] as number;
                return { success: true };
              }
              return { success: false };
            },
          }),
        }),
      },
    },
  })),
}));

const { handleVoiceCallQuotaAdd, handleVoiceCallQuotaGet } = await import("./api-voice-call");

const post = (body: unknown): Request =>
  new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => state.usage.clear());

describe("api-voice-call quota", () => {
  it("初期は満額 180 秒", async () => {
    const res = await handleVoiceCallQuotaGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      limitSeconds: 180,
      usedSeconds: 0,
      remainingSeconds: 180,
    });
  });

  it("POST で積算され残りが減る", async () => {
    const res = await handleVoiceCallQuotaAdd(post({ seconds: 30 }));
    const body: { remainingSeconds: number } = await res.json();
    expect(body.remainingSeconds).toBe(150);
    await handleVoiceCallQuotaAdd(post({ seconds: 60 }));
    const got: { usedSeconds: number } = await (await handleVoiceCallQuotaGet()).json();
    expect(got.usedSeconds).toBe(90);
  });

  it("上限を超える積算は頭打ちされる", async () => {
    await handleVoiceCallQuotaAdd(post({ seconds: 60 }));
    await handleVoiceCallQuotaAdd(post({ seconds: 60 }));
    const res = await handleVoiceCallQuotaAdd(post({ seconds: 60 }));
    const body: { remainingSeconds: number } = await res.json();
    expect(body.remainingSeconds).toBe(0);
    await handleVoiceCallQuotaAdd(post({ seconds: 30 }));
    const got: { usedSeconds: number } = await (await handleVoiceCallQuotaGet()).json();
    expect(got.usedSeconds).toBe(180);
  });

  it("sendBeacon 相当の text/plain ボディも積算できる", async () => {
    const req = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ seconds: 12 }),
    });
    const res = await handleVoiceCallQuotaAdd(req);
    expect(res.status).toBe(200);
    const got: { usedSeconds: number } = await (await handleVoiceCallQuotaGet()).json();
    expect(got.usedSeconds).toBe(12);
  });

  it("本文不正は400", async () => {
    expect((await handleVoiceCallQuotaAdd(post({}))).status).toBe(400);
    expect((await handleVoiceCallQuotaAdd(post({ seconds: 0 }))).status).toBe(400);
    expect((await handleVoiceCallQuotaAdd(post({ seconds: 61 }))).status).toBe(400);
  });
});
