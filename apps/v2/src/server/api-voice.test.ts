// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// RIT-210: キャラ別ボイス設定 API。所有者確認・既定値・upsert を見る。
const state = vi.hoisted(() => ({
  voices: new Map<
    string,
    {
      engine: string;
      speaker_id: string;
      speed: number;
      pitch: number;
      intonation: number;
      updated_at: number;
    }
  >(),
  characters: new Map<string, { user_id: string }>(),
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
            run: async () => {
              if (sql.includes("INSERT INTO v2_character_voice")) {
                state.voices.set(args[0] as string, {
                  engine: args[1] as string,
                  speaker_id: args[2] as string,
                  speed: args[3] as number,
                  pitch: args[4] as number,
                  intonation: args[5] as number,
                  updated_at: args[6] as number,
                });
                return { success: true };
              }
              return { success: false };
            },
          }),
          first: async () => null,
          run: async () => ({ success: false }),
          all: async () => ({ results: [] }),
        }),
      },
    },
  })),
}));

const { handleVoiceGet, handleVoicePut } = await import("./api-voice");

const putReq = (body: unknown): Request =>
  new Request("http://x/", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.voices.clear();
  state.characters.clear();
  state.characters.set("c1", { user_id: "local" });
  state.characters.set("c2", { user_id: "other-user" });
});

describe("api-voice", () => {
  it("未設定は既定ボイスへ倒れる", async () => {
    const res = await handleVoiceGet("c1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      engine: "voicevox",
      speakerId: "1",
      isDefault: true,
    });
  });

  it("PUT 保存→GET で読める・冪等上書き", async () => {
    const res = await handleVoicePut(
      "c1",
      putReq({ engine: "aivisspeech", speakerId: "888753760", speed: 1.2, pitch: 0.05, intonation: 1.3 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ engine: "aivisspeech", isDefault: false });
    const res2 = await handleVoiceGet("c1");
    const body2: { speakerId?: string } = await res2.json();
    expect(body2.speakerId).toBe("888753760");
  });

  it("他人のキャラは404", async () => {
    expect((await handleVoiceGet("c2")).status).toBe(404);
    expect(
      (
        await handleVoicePut(
          "c2",
          putReq({ engine: "voicevox", speakerId: "1", speed: 1, pitch: 0, intonation: 1 }),
        )
      ).status,
    ).toBe(404);
  });

  it("範囲外・未知エンジンは400", async () => {
    expect(
      (
        await handleVoicePut(
          "c1",
          putReq({ engine: "bad", speakerId: "1", speed: 1, pitch: 0, intonation: 1 }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleVoicePut(
          "c1",
          putReq({ engine: "voicevox", speakerId: "1", speed: 9, pitch: 0, intonation: 1 }),
        )
      ).status,
    ).toBe(400);
  });
});
