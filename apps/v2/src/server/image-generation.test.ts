// RIT-182: 会話起点の画像生成の確かめ — Novita 模擬 fetch＋模擬 R2＋実 D1 で、
// 成功時に画像が R2 へ入り image_key 付きメッセージと生成記録が残ること、
// 失敗時に理由つき記録だけが残ることを見る。
// @vitest-environment node
import { v2ConversationTable, v2MessageTable } from "@v2/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";
import { characterTable } from "../../../../src/schema/character";

import { buildImagePrompt, generateConversationImage } from "./image-generation";

const NOW = 1794290000000;
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const novitaFetch = (taskStatus: string, includeImages = true): typeof fetch => {
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/txt2img") || url.endsWith("/img2img")) {
      expect(init?.method).toBe("POST");
      return Response.json({ task_id: "rit182-task" });
    }
    if (url.includes("/task-result")) {
      return Response.json({
        task: { task_id: "rit182-task", status: taskStatus, progress_percent: 100 },
        ...(includeImages
          ? { images: [{ image_url: "https://example.com/rit182.png", seed: 12345 }] }
          : {}),
      });
    }
    if (url === "https://example.com/rit182.png") {
      return new Response(PNG_HEAD, { headers: { "content-type": "image/png" } });
    }
    return new Response("unexpected", { status: 500 });
  });
  return impl as unknown as typeof fetch;
};

const bucketOf = (objects?: Map<string, Uint8Array>) => {
  const stored = new Map<string, Uint8Array>();
  const source = objects ?? new Map<string, Uint8Array>();
  return {
    stored,
    put: (async (key: string, value: ArrayBuffer | Uint8Array) => {
      stored.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
      return { key };
    }) as unknown as R2Bucket["put"],
    get: (async (key: string) => {
      const value = source.get(key);
      return value ? { arrayBuffer: async () => value.buffer } : null;
    }) as unknown as R2Bucket["get"],
  } as { stored: Map<string, Uint8Array>; put: R2Bucket["put"]; get: R2Bucket["get"] } & Pick<
    R2Bucket,
    "put" | "get"
  >;
};

describe("generateConversationImage", () => {
  let local: LocalD1;
  let charId: string;

  const env = (bucket: Pick<R2Bucket, "put">) => ({
    DB: local.d1,
    BUCKET: bucket as R2Bucket,
    NOVITA_API_KEY: "test-key",
  });

  const imageMessages = async () =>
    local.d1
      .prepare("SELECT id, turn, image_key FROM v2_message WHERE image_key IS NOT NULL")
      .all<{ id: string; turn: number; image_key: string }>();

  const generationRows = async () =>
    local.d1
      .prepare(
        "SELECT status, failure_reason, task_id, seed, image_key, message_id, width, height, steps, guidance_scale, strength, prompt, negative_prompt FROM v2_image_generation WHERE conversation_id = ?",
      )
      .bind("rit182-conv")
      .all<{
        status: string;
        failure_reason: string | null;
        task_id: string | null;
        seed: number | null;
        image_key: string | null;
        message_id: string | null;
        width: number | null;
        height: number | null;
        steps: number | null;
        guidance_scale: number | null;
        strength: number | null;
        prompt: string;
        negative_prompt: string | null;
      }>();

  beforeAll(async () => {
    local = await openLocalD1();
    const chars = await local.db
      .select({ id: characterTable.id, imageMeta: characterTable.imageMeta })
      .from(characterTable)
      .limit(1);
    charId = chars[0].id;
    if (!chars[0].imageMeta) {
      // seed キャラに外見が無い時だけ補う。確かめの都合で prompt 組立対象が必要なため。
      await local.d1
        .prepare("UPDATE character SET image_meta = ? WHERE id = ?")
        .bind(
          JSON.stringify({
            appearance: "long silver hair, blue eyes",
            artStyle: "anime style",
            outfit: "white dress",
            negativePrompt: "extra fingers",
          }),
          charId,
        )
        .run();
    }
    await local.db.insert(v2ConversationTable).values({
      id: "rit182-conv",
      userId: "local",
      characterId: charId,
      title: "",
      threadId: "rit182-conv",
      promptVersion: "test",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await local.db.insert(v2MessageTable).values({
      id: "rit182-msg-1",
      conversationId: "rit182-conv",
      turn: 1,
      role: "assistant",
      content: "海辺を歩きながら微笑んだ。潮風が髪を揺らす。",
      createdAt: NOW,
    });
  });

  // 共有ローカル D1 は前回 run の行が残る。対象会話の生成・画像行を毎回掃除して
  // 「最後の行」を今回のテスト生成に確定させる。
  beforeEach(async () => {
    await local.d1
      .prepare("DELETE FROM v2_image_generation WHERE conversation_id = ?")
      .bind("rit182-conv")
      .run();
    await local.d1
      .prepare("DELETE FROM v2_message WHERE conversation_id = ? AND image_key IS NOT NULL")
      .bind("rit182-conv")
      .run();
  });

  afterAll(async () => {
    await local.d1.batch([
      local.d1
        .prepare("DELETE FROM v2_image_generation WHERE conversation_id = ?")
        .bind("rit182-conv"),
      local.d1.prepare("DELETE FROM v2_message WHERE conversation_id = ?").bind("rit182-conv"),
      local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind("rit182-conv"),
    ]);
    await local.dispose();
  });

  it("成功: R2 へ画像を置き、image_key 付きメッセージと生成記録が残る", async () => {
    const bucket = bucketOf();
    const result = await generateConversationImage({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit182-conv",
      fetchImpl: novitaFetch("TASK_STATUS_SUCCEED"),
    });
    expect(result.ok).toBe(true);
    const messages = (await imageMessages()).results;
    expect(messages).toHaveLength(1);
    expect(messages[0].image_key).toMatch(/^images\/[\da-f-]+\.png$/);
    expect(bucket.stored.get(messages[0].image_key)).toEqual(PNG_HEAD);
    const rows = (await generationRows()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].task_id).toBe("rit182-task");
    expect(rows[0].seed).toBe(12345);
    expect(rows[0].message_id).toBe(messages[0].id);
    // 画像はターンを1つ消費する（次の会話ターンが重ならんよう）。
    expect(messages[0].turn).toBe(2);
  });

  it("失敗: 理由つき記録だけ残り、メッセージは出さん", async () => {
    const bucket = bucketOf();
    const result = await generateConversationImage({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit182-conv",
      fetchImpl: novitaFetch("TASK_STATUS_FAILED"),
    });
    expect(result.ok).toBe(false);
    const messages = (await imageMessages()).results;
    expect(messages).toHaveLength(0); // 失敗時は画像メッセージを増やさん
    const rows = (await generationRows()).results;
    const failed = rows.filter((row) => row.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].failure_reason).toContain("TASK_STATUS_FAILED");
    expect(failed[0].task_id).toBe("rit182-task");
    expect(bucket.stored.size).toBe(0);
  });

  it("他人の会話は弾く", async () => {
    await local.db.insert(v2ConversationTable).values({
      id: "rit182-foreign",
      userId: "someone-else",
      characterId: charId,
      title: "",
      threadId: "rit182-foreign",
      promptVersion: "test",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await expect(
      generateConversationImage({
        env: env(bucketOf()),
        characterId: charId,
        conversationId: "rit182-foreign",
        fetchImpl: novitaFetch("TASK_STATUS_SUCCEED"),
      }),
    ).rejects.toThrow();
    await local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind("rit182-foreign").run();
  });

  // RIT-183: 指定パラメータが Novita の request body と生成記録の両方へ届くこと。
  it("指定パラメータが上流 body と記録へ残る", async () => {
    const bucket = bucketOf();
    const captured: { initBody?: { request: Record<string, unknown> } } = {};
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/txt2img")) {
        captured.initBody = JSON.parse(String(init?.body));
        return Response.json({ task_id: "rit183-task" });
      }
      if (url.includes("/task-result")) {
        return Response.json({
          task: { task_id: "rit183-task", status: "TASK_STATUS_SUCCEED" },
          images: [{ image_url: "https://example.com/rit183.png", seed: 777 }],
        });
      }
      if (url === "https://example.com/rit183.png") {
        return new Response(PNG_HEAD, { headers: { "content-type": "image/png" } });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await generateConversationImage({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit182-conv",
      params: {
        cfg: 9,
        seed: 42,
        negativePrompt: "lowres, monochrome",
        width: 1024,
        height: 768,
        strength: 0.4,
      },
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!captured.initBody) throw new Error("init body not captured");
    const request = captured.initBody.request;
    expect(request.width).toBe(1024);
    expect(request.height).toBe(768);
    expect(request.guidance_scale).toBe(9);
    expect(request.seed).toBe(42);
    // txt2img では strength を上流へ送らん（img2img 専用。記録には残る）。
    expect(request.strength).toBeUndefined();
    // ユーザー negative が先頭、品質基線は重複なしで残る。
    expect(String(request.negative_prompt)).toMatch(/^lowres, monochrome/);
    expect(String(request.negative_prompt)).toContain("extra limbs");
    expect(String(request.negative_prompt).split("lowres")).toHaveLength(2);

    const rows = (await generationRows()).results;
    const last = rows.at(-1);
    expect(last?.width).toBe(1024);
    expect(last?.height).toBe(768);
    expect(last?.steps).toBe(30);
    expect(last?.guidance_scale).toBe(9);
    expect(last?.strength).toBe(0.4);
    // 上流が返した実績 seed を残す。
    expect(last?.seed).toBe(777);
  });

  it("未指定はレシピ既定値へ倒れ、既定値も記録へ残る", async () => {
    const result = await generateConversationImage({
      env: env(bucketOf()),
      characterId: charId,
      conversationId: "rit182-conv",
      fetchImpl: novitaFetch("TASK_STATUS_SUCCEED"),
    });
    expect(result.ok).toBe(true);
    const last = (await generationRows()).results.at(-1);
    expect(last?.width).toBe(832);
    expect(last?.height).toBe(1216);
    expect(last?.steps).toBe(30);
    expect(last?.guidance_scale).toBe(5);
    expect(last?.strength).toBeNull();
    expect(last?.seed).toBe(12345);
  });

  it("失敗行にも確定パラメータと指定 seed が残る", async () => {
    const result = await generateConversationImage({
      env: env(bucketOf()),
      characterId: charId,
      conversationId: "rit182-conv",
      params: { cfg: 12, seed: 99, width: 640, height: 896 },
      fetchImpl: novitaFetch("TASK_STATUS_FAILED"),
    });
    expect(result.ok).toBe(false);
    const last = (await generationRows()).results.at(-1);
    expect(last?.status).toBe("failed");
    expect(last?.width).toBe(640);
    expect(last?.height).toBe(896);
    expect(last?.guidance_scale).toBe(12);
    expect(last?.seed).toBe(99);
  });

  // RIT-184: 履歴画像を参照元に img2img で表情変更。base64・strength・依頼文・派生関係を見る。
  it("i2i: 参照元メッセージの R2 画像を base64 で渡し、strength と派生元を記録する", async () => {
    // 先に txt2img で参照元画像を1枚作る。
    const bucket = bucketOf();
    const first = await generateConversationImage({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit182-conv",
      fetchImpl: novitaFetch("TASK_STATUS_SUCCEED"),
    });
    expect(first.ok).toBe(true);
    const sourceMessage = (await imageMessages()).results.at(-1);
    if (!sourceMessage || first.ok !== true) throw new Error("source image missing");
    const sourceGeneration = (await generationRows()).results.at(-1);

    // 参照元画像の R2 内容を既知のバイトで埋め、img2img init body を捕まえる。
    const r2 = new Map([[sourceMessage.image_key, PNG_HEAD]]);
    const bucket2 = bucketOf(r2);
    const captured: { body?: { request: Record<string, unknown> } } = {};
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/img2img")) {
        captured.body = JSON.parse(String(init?.body));
        return Response.json({ task_id: "rit184-task" });
      }
      if (url.includes("/task-result")) {
        return Response.json({
          task: { task_id: "rit184-task", status: "TASK_STATUS_SUCCEED" },
          images: [{ image_url: "https://example.com/rit184.png", seed: 55 }],
        });
      }
      if (url === "https://example.com/rit184.png") {
        return new Response(PNG_HEAD, { headers: { "content-type": "image/png" } });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await generateConversationImage({
      env: env(bucket2),
      characterId: charId,
      conversationId: "rit182-conv",
      params: { strength: 0.3 },
      sourceMessageId: sourceMessage.id,
      instruction: "怒った顔",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!captured.body) throw new Error("img2img init body not captured");
    const request = captured.body.request;
    expect(request.strength).toBe(0.3);
    expect(request.image_base64).toBe(btoa(String.fromCharCode(...PNG_HEAD)));
    expect(String(request.prompt)).toMatch(/^怒った顔,/);

    const last = (await generationRows()).results.at(-1);
    expect(last?.status).toBe("ok");
    expect(last?.strength).toBe(0.3);
    expect(sourceGeneration).toBeTruthy();
    // generation id 列は select 句に入ってないので直接読む。
    const lineage = await local.d1
      .prepare("SELECT source_generation_id FROM v2_image_generation WHERE id = ?")
      .bind((result as { generationId: string }).generationId)
      .first<{ source_generation_id: string | null }>();
    const sourceGen = await local.d1
      .prepare("SELECT id FROM v2_image_generation WHERE message_id = ?")
      .bind(sourceMessage.id)
      .first<{ id: string }>();
    expect(lineage?.source_generation_id).toBe(sourceGen?.id);
  });

  it("i2i: strength 未指定は v1 既定 0.45 へ倒す", async () => {
    const bucket = bucketOf();
    await generateConversationImage({
      env: env(bucket),
      characterId: charId,
      conversationId: "rit182-conv",
      fetchImpl: novitaFetch("TASK_STATUS_SUCCEED"),
    });
    const sourceMessage = (await imageMessages()).results.at(-1);
    if (!sourceMessage) throw new Error("source image missing");
    const r2 = new Map([[sourceMessage.image_key, PNG_HEAD]]);
    const bucket2 = bucketOf(r2);
    const fetchImpl = novitaFetch("TASK_STATUS_SUCCEED");
    const result = await generateConversationImage({
      env: env(bucket2),
      characterId: charId,
      conversationId: "rit182-conv",
      sourceMessageId: sourceMessage.id,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    const last = (await generationRows()).results.at(-1);
    expect(last?.strength).toBe(0.45);
  });

  it("i2i: 参照元が無い・画像でないメッセージは 404", async () => {
    await expect(
      generateConversationImage({
        env: env(bucketOf()),
        characterId: charId,
        conversationId: "rit182-conv",
        sourceMessageId: "rit182-msg-1", // テキストのみのメッセージ
        fetchImpl: novitaFetch("TASK_STATUS_SUCCEED"),
      }),
    ).rejects.toThrow("参照元の画像が見つかりません");
    await expect(
      generateConversationImage({
        env: env(bucketOf()),
        characterId: charId,
        conversationId: "rit182-conv",
        sourceMessageId: "no-such-message",
        fetchImpl: novitaFetch("TASK_STATUS_SUCCEED"),
      }),
    ).rejects.toThrow("参照元の画像が見つかりません");
  });
});

describe("buildImagePrompt", () => {
  it("外見 anchor・衣装・シーンを1本の prompt に組み、negative を合わせる", () => {
    const { prompt, negativePrompt } = buildImagePrompt(
      {
        visualPrompt: "soft lighting",
        imageMeta: {
          appearance: "silver hair",
          artStyle: "anime",
          outfit: "white dress",
          negativePrompt: "extra limbs",
        },
        loraModel: null,
        loraWeight: null,
        loraTriggerPrompt: null,
      },
      [{ role: "assistant", content: "浜辺で微笑む" }],
      "conversation",
      1,
    );
    expect(prompt).toContain("anime");
    expect(prompt).toContain("silver hair");
    expect(prompt).toContain("white dress");
    expect(prompt).toContain("soft lighting");
    expect(prompt).toContain("浜辺で微笑む");
    expect(negativePrompt).toContain("extra limbs");
    expect(negativePrompt).toContain("lowres");
  });

  it("ユーザー negative を先頭へ置き、品質基線は重複を間引いて残す", () => {
    const { negativePrompt } = buildImagePrompt(
      {
        visualPrompt: null,
        imageMeta: { appearance: "x", artStyle: "y", negativePrompt: "bad anatomy" },
        loraModel: null,
        loraWeight: null,
        loraTriggerPrompt: null,
      },
      [],
      "conversation",
      1,
      "monochrome, lowres",
    );
    expect(negativePrompt).toMatch(/^monochrome, lowres/);
    // キャラ設定の bad anatomy と基線の品質語は残り、lowres は重複しない。
    expect(negativePrompt).toContain("bad anatomy");
    expect(negativePrompt).toContain("watermark");
    expect(negativePrompt.split("lowres")).toHaveLength(2);
  });

  // RIT-186: 台帳フェーズでガードが切り替わる（v1 組み立ての移植）。
  const visual = {
    visualPrompt: "long hair",
    imageMeta: { appearance: "silver hair, blue eyes", artStyle: "anime" },
    loraModel: null,
    loraWeight: null,
    loraTriggerPrompt: null,
  };

  it("conversation フェーズは着衣ヒントと性的 negative で締める", () => {
    const { prompt, negativePrompt } = buildImagePrompt(visual, [], "conversation", 1);
    expect(prompt).toContain("fully clothed");
    expect(prompt).toContain("1girl, solo");
    expect(prompt).toContain("(silver hair:1.5)"); // conversation は anchor 弱め
    expect(negativePrompt).toContain("nsfw");
    expect(negativePrompt).toContain("nipples");
    expect(negativePrompt).toContain("male, man"); // solo フェーズは男タグを殺す
  });

  it("erotic/climax フェーズは裸体肯定とクライマックス系ガードへ切り替わる", () => {
    const erotic = buildImagePrompt(visual, [], "erotic", 2);
    expect(erotic.prompt).toContain("completely_nude");
    expect(erotic.prompt).toContain("1girl, 1boy, hetero, couple");
    expect(erotic.prompt).toContain("(silver hair:1.6)");
    expect(erotic.negativePrompt).toContain("cumshot");
    expect(erotic.negativePrompt).not.toContain("male, man");

    const climax = buildImagePrompt(visual, [], "climax", 1);
    expect(climax.prompt).toContain("creampie");
    // 顔・髪まみれホラー対策: 浮遊cumはpositiveから剥がれ、negative側で殺す。
    expect(climax.prompt).not.toMatch(/(?:^|, )cum(?:,|$)/);
    expect(climax.negativePrompt).toContain("cum_on_face");
    expect(climax.negativePrompt).toContain("bukkake");
  });

  it("シーン文の明示キーワードを対応タグへ翻し、conversation では露出系タグを剥がす", () => {
    const history = [{ role: "assistant", content: "中出しをねだる声が震えた" }];
    const erotic = buildImagePrompt(visual, history, "erotic", 1);
    expect(erotic.prompt).toContain("creampie");
    // conversation でも明示検知タグは残る（フェーズ誤判定への保護）が、
    // 露出系の語（nude/pussy 等）は剥がれる。
    const conversation = buildImagePrompt(
      visual,
      [{ role: "assistant", content: "中出しをねだって nude になった" }],
      "conversation",
      1,
    );
    expect(conversation.prompt).toContain("creampie");
    expect(conversation.prompt).not.toContain("cum_in_pussy");
    expect(conversation.prompt).not.toContain("nude");
  });

  it("既知の失敗タグは常に negative 側へ入る", () => {
    const { negativePrompt } = buildImagePrompt(visual, [], "erotic", 1);
    expect(negativePrompt).toContain("impregnation");
    expect(negativePrompt).toContain("mosaic_censoring");
    expect(negativePrompt).toContain("camera");
  });

  it("LoRA 持ちキャラは trigger が anchor を置換し、negative はピン留め短文になる", () => {
    const loraVisual = {
      ...visual,
      loraModel: "aiadultapp:testlora@1",
      loraWeight: 0.85,
      loraTriggerPrompt: "testlora, 1girl",
    };
    const { prompt, negativePrompt, loraActive } = buildImagePrompt(
      loraVisual,
      [],
      "climax",
      1,
    );
    expect(loraActive).toBe(true);
    expect(prompt).toMatch(/^testlora, 1girl/);
    expect(prompt).not.toContain("silver hair:1.6");
    expect(negativePrompt).toContain("huge breasts");
    expect(negativePrompt).not.toContain("cum_on_face");
  });

  it("loraWeight 0 は無効扱いで通常経路へ倒す", () => {
    const disabled = buildImagePrompt(
      { ...visual, loraModel: "x@1", loraWeight: 0, loraTriggerPrompt: "t" },
      [],
      "erotic",
      1,
    );
    expect(disabled.loraActive).toBe(false);
    expect(disabled.prompt).toContain("(silver hair:1.6)");
  });

  it("身元ソースが全経路空なら prompt 空で 422 ゲートへ渡す", () => {
    const { prompt } = buildImagePrompt(
      {
        visualPrompt: null,
        imageMeta: null,
        loraModel: null,
        loraWeight: null,
        loraTriggerPrompt: null,
      },
      [],
      "conversation",
      1,
    );
    expect(prompt).toBe("");
  });
});
