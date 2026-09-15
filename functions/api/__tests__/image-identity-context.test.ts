import { describe, expect, it } from "vitest";

import {
  buildIdentityImg2ImgRequest,
  deriveCharacterImageSeed,
  generateCharacterImageRetrySeed,
  generateCharacterImageSeed,
  resolveCharacterImageIdentity,
  resolveCharacterReferenceSource,
} from "../lib/image-identity-context";

describe("resolveCharacterImageIdentity", () => {
  it("承認済み image_meta をクライアントと旧 visualPrompt より優先する", () => {
    expect(
      resolveCharacterImageIdentity({
        characterId: "sakura",
        imageMeta: {
          appearance: "pink hair, blue eyes",
          artStyle: "anime screencap",
          outfit: "black choker",
          negativePrompt: "white hair, brown eyes",
        },
        requestedDescription: "white hair, brown eyes",
        visualPrompt: "silver hair, red eyes",
        seed: 832,
      }),
    ).toEqual({
      description: "pink hair, blue eyes, anime screencap, black choker",
      imageMetaAnchors: {
        positive: "pink hair, blue eyes, anime screencap, black choker",
        negative: "white hair, brown eyes",
      },
      hasAuthoritativeSource: true,
      seed: 832,
    });
  });

  it("image_meta が無い場合だけ既存 description と visualPrompt へフォールバックする", () => {
    const fallbackSeed = deriveCharacterImageSeed("legacy-character");
    expect(
      resolveCharacterImageIdentity({
        characterId: "legacy-character",
        imageMeta: null,
        requestedDescription: "  client appearance  ",
        visualPrompt: "stored appearance",
        seed: null,
      }),
    ).toMatchObject({
      description: "stored appearance",
      imageMetaAnchors: null,
      hasAuthoritativeSource: true,
      seed: fallbackSeed,
    });

    expect(
      resolveCharacterImageIdentity({
        characterId: "legacy-character",
        imageMeta: null,
        requestedDescription: " ",
        visualPrompt: " stored appearance ",
        seed: -5,
      }),
    ).toMatchObject({
      description: "stored appearance",
      imageMetaAnchors: null,
      hasAuthoritativeSource: true,
      seed: fallbackSeed,
    });
  });

  it("client の人格文だけでは authoritative な画像身元情報として扱わない", () => {
    expect(
      resolveCharacterImageIdentity({
        characterId: "personality-only",
        imageMeta: null,
        requestedDescription: "kind woman with brown hair",
        visualPrompt: null,
        seed: null,
      }),
    ).toMatchObject({
      description: "kind woman with brown hair",
      imageMetaAnchors: null,
      hasAuthoritativeSource: false,
    });
  });

  it("seed 未設定の既存キャラクターにも同じ安定 seed を返す", () => {
    const first = deriveCharacterImageSeed("import-charap-sakura");
    const second = deriveCharacterImageSeed("import-charap-sakura");
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(2_147_483_647);
  });

  it("新規キャラクター用 seed を Novita の正の31bit範囲に収める", () => {
    const seed = generateCharacterImageSeed();
    expect(seed).toBeGreaterThan(0);
    expect(seed).toBeLessThan(2_147_483_647);
  });

  it("VLM 再生成だけ初回と異なる seed を使う", () => {
    const retrySeed = generateCharacterImageRetrySeed(832);
    expect(retrySeed).not.toBe(832);
    expect(retrySeed).toBeGreaterThan(0);
    expect(retrySeed).toBeLessThan(2_147_483_647);
  });
});

describe("buildIdentityImg2ImgRequest", () => {
  it("呼び出し元が指定した seed と strength を保持する", () => {
    expect(
      buildIdentityImg2ImgRequest(
        { seed: 832, strength: 0.45, prompt: "scene", negative_prompt: "wrong hair" },
        "BASE64",
      ),
    ).toEqual({
      seed: 832,
      strength: 0.45,
      prompt: "scene",
      negative_prompt: "wrong hair",
      image_base64: "BASE64",
    });
  });
});

describe("resolveCharacterReferenceSource", () => {
  it("highest-ord のサブ画像をプロフィール avatar より優先する", () => {
    expect(
      resolveCharacterReferenceSource({
        highestOrdSubImageKey: "sub/sakura/latest.png",
        avatarKey: "sakura.png",
      }),
    ).toEqual({ key: "sub/sakura/latest.png", primaryLocation: "root" });
  });

  it("サブ画像が無い場合はプロフィール avatar を使う", () => {
    expect(
      resolveCharacterReferenceSource({
        highestOrdSubImageKey: null,
        avatarKey: "sakura.png",
      }),
    ).toEqual({ key: "sakura.png", primaryLocation: "avatars" });
  });
});
