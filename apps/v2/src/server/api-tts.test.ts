// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// RIT-211: TTS 合成 API。所有者確認・既定設定・エンジン未起動 503・エンジン失敗 503 を見る。
const state = vi.hoisted(() => ({
  voices: new Map<
    string,
    { engine: string; speaker_id: string; speed: number; pitch: number; intonation: number }
  >(),
  characters: new Map<string, { user_id: string }>(),
  fetchCalls: [] as string[],
  fetchResult: "ok" as "ok" | "query_fail" | "synth_fail" | "throw",
}));

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            first: async () => {
              if (sql.includes("SELECT user_id FROM character WHERE id")) {
                const c = state.characters.get(args[0] as string);
                return c ? { user_id: c.user_id } : null;
              }
              if (sql.includes("FROM v2_character_voice")) {
                return state.voices.get(args[0] as string) ?? null;
              }
              return null;
            },
          }),
        }),
      },
    },
  })),
}));

vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string | URL) => {
    const u = String(url);
    state.fetchCalls.push(u);
    if (state.fetchResult === "throw") throw new Error("ECONNREFUSED");
    if (u.includes("/audio_query")) {
      if (state.fetchResult === "query_fail") return new Response("x", { status: 500 });
      return Response.json({ speedScale: 1, pitchScale: 0, intonationScale: 1 });
    }
    if (u.includes("/synthesis")) {
      if (state.fetchResult === "synth_fail") return new Response("x", { status: 500 });
      return new Response(new Uint8Array([82, 73, 70, 70]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    }
    return new Response("?", { status: 404 });
  }),
);

const { handleTtsRequest } = await import("./api-tts");

const post = (body: unknown): Request =>
  new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.voices.clear();
  state.characters.clear();
  state.fetchCalls.length = 0;
  state.fetchResult = "ok";
  state.characters.set("c1", { user_id: "local" });
  state.characters.set("c2", { user_id: "other" });
});

describe("api-tts", () => {
  it("既定設定で2段合成し wav を返す", async () => {
    const res = await handleTtsRequest(post({ characterId: "c1", text: "こんにちは" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(state.fetchCalls.some((u) => u.includes("audio_query"))).toBe(true);
    expect(state.fetchCalls.some((u) => u.includes("synthesis"))).toBe(true);
    expect(state.fetchCalls[0]).toContain("speaker=1");
  });

  it("キャラのボイス設定（エンジン・話者）を使う", async () => {
    state.voices.set("c1", {
      engine: "aivisspeech",
      speaker_id: "888753760",
      speed: 1.2,
      pitch: 0.05,
      intonation: 1.3,
    });
    const res = await handleTtsRequest(post({ characterId: "c1", text: "やあ" }));
    expect(res.status).toBe(200);
    expect(state.fetchCalls[0]).toContain("speaker=888753760");
    expect(state.fetchCalls[0]).toContain("localhost:10101");
  });

  it("他人のキャラは404・エンジン未起動は503", async () => {
    expect((await handleTtsRequest(post({ characterId: "c2", text: "x" }))).status).toBe(404);
    state.fetchResult = "throw";
    expect((await handleTtsRequest(post({ characterId: "c1", text: "x" }))).status).toBe(503);
  });

  it("エンジン側エラーは503・本文不正は400", async () => {
    state.fetchResult = "synth_fail";
    expect((await handleTtsRequest(post({ characterId: "c1", text: "x" }))).status).toBe(503);
    expect((await handleTtsRequest(post({ characterId: "c1" }))).status).toBe(400);
    expect((await handleTtsRequest(post({ characterId: "c1", text: "" }))).status).toBe(400);
  });
});
