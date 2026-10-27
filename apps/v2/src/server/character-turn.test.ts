// @vitest-environment node
// DB の保存内容を graph まで渡すため、DOM と実providerを使わず合成モデルで確認する。
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import {
  createD1TurnStore,
  getCharacterEditState,
  listCharacterVersions,
  loadCharacter,
  restoreCharacterVersion,
  saveCharacter,
} from "@v2/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterFixture } from "../../../../packages/db/src/test/character-fixture";
import {
  openCharacterTestDb,
  type CharacterTestDb,
} from "../../../../packages/db/src/test/character-local-d1";
import { createTurnGraph, runTurn } from "../../../../packages/engine/src/graph";

import type { TurnModelCallOptions } from "../../../../packages/engine/src/graph";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { CharacterSheet, TurnEvent } from "@v2/db";

const RESPONSES = {
  polite: "ご案内いたします。中央広場の左側へお進みください。",
  concise: "中央広場の左側です。",
  friendly: "中央広場の左側へ進むといいよ。",
};

class SyntheticCharacterModel extends BaseChatModel<TurnModelCallOptions> {
  readonly prompts: string[] = [];

  constructor() {
    super({});
  }

  _llmType(): string {
    return "synthetic-character-contract";
  }

  private reply(messages: BaseMessage[]): string {
    const system = messages.find((message) => message.type === "system")?.content;
    if (typeof system !== "string") throw new Error("合成モデルにsystem指示が届いていません。");
    this.prompts.push(system);
    const text = Object.entries(RESPONSES).find(([key]) =>
      system.includes(`[synthetic-style:${key}]`),
    )?.[1];
    if (!text) throw new Error("保存した合成の口調設定が届いていません。");
    return `<response><dialogue>${text}</dialogue></response>`;
  }

  _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const text = this.reply(messages);
    return Promise.resolve({ generations: [{ text, message: new AIMessage(text) }] });
  }

  async *_streamResponseChunks(messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
    const text = this.reply(messages);
    yield new ChatGenerationChunk({ text, message: new AIMessageChunk(text) });
  }
}

describe("restored character prompt reaches the reply graph", () => {
  let local: CharacterTestDb;

  beforeAll(async () => {
    local = await openCharacterTestDb();
    const ddl = await readFile(
      new URL("../../../../drizzle/0070_v2_tables.sql", import.meta.url),
      "utf8",
    );
    await local.d1.batch(
      ddl
        .split(";")
        .filter((statement) => statement.trim())
        .map((statement) => local.d1.prepare(statement)),
    );
    for (const migration of [
      "0076_v2_chunk_scheduled_at.sql",
      "0077_v2_chunk_rejection.sql",
      "0078_v2_turn_delivery.sql",
      "0079_v2_turn_commit.sql",
      "0082_v2_generation_attempt.sql",
    ]) {
      const sql = await readFile(
        new URL(`../../../../drizzle/${migration}`, import.meta.url),
        "utf8",
      );
      await local.d1.batch(
        sql
          .split("--> statement-breakpoint")
          .filter((statement) => statement.trim())
          .map((statement) => local.d1.prepare(statement)),
      );
    }
  }, 60_000);

  afterAll(async () => {
    await local?.dispose();
  }, 60_000);

  const talk = async (sheet: CharacterSheet) => {
    const model = new SyntheticCharacterModel();
    const store = createD1TurnStore(local.db, {
      userId: "synthetic-owner",
      characterId: sheet.id,
      promptVersion: "v0001",
    });
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });
    const conversationId = crypto.randomUUID();
    const events: TurnEvent[] = [];
    for await (const event of runTurn(
      graph,
      {
        conversationId,
        character: sheet,
        userText: "受付の場所を教えてください。",
        timeoutMs: 5_000,
      },
      conversationId,
    ))
      events.push(event);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.some((event) => event.type === "done")).toBe(true);
    const chunks = events.filter((event) => event.type === "chunk");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.judge.ok)).toBe(true);
    expect(model.prompts).toHaveLength(1);
    expect(model.prompts.every((prompt) => prompt.includes(sheet.systemPrompt))).toBe(true);
    const reply = chunks.map((chunk) => chunk.text).join("");
    const persisted = await store.load(conversationId);
    expect(persisted.history[1]).toEqual({ role: "assistant", content: reply });
    return { reply, conversationId };
  };

  it("3回保存してから前の版へ戻すと設定・graphへの指示・返事が戻り、記憶も残る", async () => {
    const first = {
      ...characterFixture,
      systemPrompt: "[synthetic-style:polite] 丁寧に案内してください。",
    };
    const second = { ...first, systemPrompt: "[synthetic-style:concise] 簡潔に案内してください。" };
    const third = {
      ...first,
      systemPrompt: "[synthetic-style:friendly] 親しみある口調で案内してください。",
    };
    const replies: string[] = [];
    for (const sheet of [first, second, third]) {
      await saveCharacter(local.db, "synthetic-owner", sheet);
      const saved = await loadCharacter(local.db, sheet.id);
      expect(saved.ok).toEqual(sheet);
      if (!saved.ok) throw new Error("合成キャラを読み出せません。");
      const result = await talk(saved.ok);
      replies.push(result.reply);
      if (replies.length === 1) {
        await local.d1
          .prepare(
            "INSERT INTO v2_memory(id, conversation_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(
            "synthetic-memory",
            result.conversationId,
            "preference",
            "説明は短くお願いします。",
            1,
          )
          .run();
      }
    }
    const memoryBefore = await local.d1.prepare("SELECT * FROM v2_memory").all();
    const versions = await listCharacterVersions(local.db, "synthetic-owner", first.id);
    expect(versions).toHaveLength(3);
    const current = await getCharacterEditState(local.db, "synthetic-owner", first.id);
    await restoreCharacterVersion(local.db, "synthetic-owner", first.id, versions[1].id, {
      expectedVersionId: current?.currentVersionId,
      expectedRevision: current?.revision,
    });
    await local.reopen();
    const restored = await getCharacterEditState(local.db, "synthetic-owner", first.id);
    expect(restored?.sheet).toEqual(second);
    expect(restored?.currentVersionId).toBe(versions[1].id);
    if (!restored) throw new Error("復元した合成キャラを読み出せません。");
    const afterRestore = await talk(restored.sheet);
    expect(replies).toEqual(Object.values(RESPONSES).map((text) => `<dialogue>${text}</dialogue>`));
    expect(afterRestore.reply).toBe(replies[1]);
    expect(afterRestore.reply).not.toBe(replies[2]);
    expect((await local.d1.prepare("SELECT * FROM v2_memory").all()).results).toEqual(
      memoryBefore.results,
    );
  }, 60_000);
});
