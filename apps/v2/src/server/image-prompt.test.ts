// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { BASE_NEGATIVE_PROMPT, buildImagePrompt, parseSceneSource } from "./image-prompt";

const source = {
  characterName: "さくら",
  appearance: "long blonde hair, blue eyes",
  ledgerJson: JSON.stringify({
    phase: "conversation",
    location: "リビング",
    time: "午後",
    present: [],
    clothing: {},
    position: null,
    lastEvents: ["窓際で笑った"],
  }),
};

const stubTranslate = (respond: () => Response | Promise<Response>) => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/chat/completions")) throw new Error(`unexpected fetch: ${url}`);
    return respond();
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildImagePrompt", () => {
  it("翻訳が通ると SD タグ＋品質タグになる", async () => {
    stubTranslate(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: "1girl, blonde hair, blue eyes, living room, afternoon light" },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const built = await buildImagePrompt({ OPENROUTER_API_KEY: "k" }, source);
    expect(built.degraded).toBe(false);
    expect(built.prompt).toContain("blonde hair");
    expect(built.prompt).toContain("living room");
    expect(built.prompt).toContain("best quality");
  });

  it("API キーが無いと degraded で生素材の英語断片から組み立てる", async () => {
    const built = await buildImagePrompt({ OPENROUTER_API_KEY: undefined }, source);
    expect(built.degraded).toBe(true);
    expect(built.prompt).toContain("blonde hair");
    expect(built.prompt).toContain("best quality");
  });

  it("翻訳が落ちても生成を止めず degraded で続く", async () => {
    stubTranslate(async () => new Response("bad", { status: 500 }));
    const built = await buildImagePrompt({ OPENROUTER_API_KEY: "k" }, source);
    expect(built.degraded).toBe(true);
    expect(built.prompt).toContain("blonde");
  });

  it("翻訳応答の破損も degraded に畳む", async () => {
    stubTranslate(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    const built = await buildImagePrompt({ OPENROUTER_API_KEY: "k" }, source);
    expect(built.degraded).toBe(true);
  });

  it("翻訳タグは 900 rune に切り詰める", async () => {
    const longTags = "a".repeat(1200);
    stubTranslate(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: longTags } }] }), {
          status: 200,
        }),
    );
    const built = await buildImagePrompt({ OPENROUTER_API_KEY: "k" }, source);
    expect([...built.prompt].length).toBeLessThanOrEqual(
      900 + ", masterpiece, best quality".length,
    );
  });

  it("生素材が全て日本語で英語断片が無い時は既定タグへ倒れる", async () => {
    const built = await buildImagePrompt(
      {},
      { characterName: "はな", appearance: "黒髪ロングの優しそうな女性", ledgerJson: null },
    );
    expect(built.degraded).toBe(true);
    expect(built.prompt).toContain("1girl, solo");
  });
});

describe("parseSceneSource", () => {
  it("台帳 JSON から場面の素だけ拾う", () => {
    const scene = parseSceneSource(source.ledgerJson);
    expect(scene?.location).toBe("リビング");
    expect(scene?.lastEvents).toEqual(["窓際で笑った"]);
  });

  it("壊れた JSON や null は null", () => {
    expect(parseSceneSource(null)).toBeNull();
    expect(parseSceneSource("{broken")).toBeNull();
    expect(parseSceneSource("123")).toBeNull();
  });
});

describe("BASE_NEGATIVE_PROMPT", () => {
  it("品質・構造・写実の除外が入っている", () => {
    expect(BASE_NEGATIVE_PROMPT).toContain("bad anatomy");
    expect(BASE_NEGATIVE_PROMPT).toContain("bad hands");
    expect(BASE_NEGATIVE_PROMPT).toContain("multiple girls");
    expect(BASE_NEGATIVE_PROMPT).toContain("watermark");
    expect(BASE_NEGATIVE_PROMPT).toContain("photorealistic");
  });
});
