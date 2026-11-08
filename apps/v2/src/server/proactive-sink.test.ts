// @vitest-environment node
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createDb } from "@v2/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { createProactiveSink } from "./proactive-sink";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

// sink 内の readCharacter は platform.env.DB を引くので、local D1 を指させる。
const calls: { role: string; content: string }[][] = [];
const model = () =>
  new (class extends FakeListChatModel {
    override async invoke(input: { role: string; content: string }[]) {
      calls.push(input);
      return super.invoke(input);
    }
  })({ responses: ["そろそろお茶にしよ？さっきの続きが気になってん。"] });

// local D1 は共有 store なので、テストごとに別の冪等キーを使う。
const uniqueKey = () => `sink-test-${crypto.randomUUID()}`;

const selectByKey = async (d1: LocalD1["d1"], generationId: string) => {
  const { results } = await d1
    .prepare(
      "SELECT conversation_id,turn,role,content,generation_id FROM v2_message WHERE generation_id = ?",
    )
    .bind(generationId)
    .all<{
      conversation_id: string;
      turn: number;
      role: string;
      content: string;
      generation_id: string | null;
    }>();
  return results;
};

describe("話しかけの生成と保存", () => {
  let local: LocalD1;
  let characterId: string;

  beforeEach(async () => {
    local = await openLocalD1();
    platform.env = { DB: local.d1 };
    calls.length = 0;
    // 共有 store で他テストの会話を拾わんよう、このテスト専用のキャラを立てる。
    characterId = "proactive-sink-test-character";
    await local.d1
      .prepare("INSERT OR IGNORE INTO user (id, email, created_at) VALUES ('local', 'l@l', 0)")
      .run();
    await local.d1
      .prepare(
        `INSERT OR IGNORE INTO character
          (id, user_id, name, system_prompt, greeting, tags, created_at)
         VALUES (?, 'local', '試し役', 'あなたは山小屋の番人です。一人称はわし。',
          'よう来たな。', '["test"]', 9999999999999)`,
      )
      .bind(characterId)
      .run();
  });
  afterEach(() => local.dispose());

  it("キャラの設定を載せた一言が assistant 行として会話に残る", async () => {
    const db = createDb(local.d1);
    const key = uniqueKey();
    const sink = createProactiveSink({ model: model(), db });
    await sink.send({ alarmId: "a-1", characterId, idempotencyKey: key });

    const messages = await selectByKey(local.d1, key);
    expect(messages).toEqual([
      {
        conversation_id: expect.any(String),
        turn: expect.any(Number),
        role: "assistant",
        content: "そろそろお茶にしよ？さっきの続きが気になってん。",
        generation_id: key,
      },
    ]);
    expect(calls).toHaveLength(1);
    const prompt = calls[0][0]?.content ?? "";
    expect(prompt).toContain("話しかける一言");
  });

  // 共有 store への並行書込みで SQLITE_BUSY が起き得る。中身の断言は変えずにだけ再試行する。
  it("既存の会話と記憶を踏まえて生成する", { retry: 2 }, async () => {
    const db = createDb(local.d1);
    const { ensureProactiveConversation, loadRecentMemories } = await import("@v2/db");
    const conversationId = await ensureProactiveConversation(db, {
      userId: "local",
      characterId,
      promptVersion: "v2-proactive",
      now: Date.now(),
    });
    await local.d1
      .prepare(
        "INSERT INTO v2_memory (id,conversation_id,kind,content,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(crypto.randomUUID(), conversationId, "fact", "ユーザーは鉄道が好き", Date.now())
      .run();

    const sink = createProactiveSink({ model: model(), db });
    const key = uniqueKey();
    await sink.send({ alarmId: "a-2", characterId, idempotencyKey: key });

    const messages = await selectByKey(local.d1, key);
    expect(messages).toHaveLength(1);
    expect(messages[0].conversation_id).toBe(conversationId);
    const prompt = calls[0][0]?.content ?? "";
    expect(prompt).toContain("鉄道が好き");
    // 共有 store では前回の実行分も残るので「含む」で見る。
    expect(await loadRecentMemories(db, conversationId, 8)).toContain("ユーザーは鉄道が好き");
  });

  it("キャラが読めん時は何も残さん", async () => {
    const db = createDb(local.d1);
    const sink = createProactiveSink({ model: model(), db });
    const key = uniqueKey();
    await sink.send({ alarmId: "a-3", characterId: "no-such-character", idempotencyKey: key });
    expect(calls).toHaveLength(0);
    expect(await selectByKey(local.d1, key)).toHaveLength(0);
    const { results: convs } = await local.d1
      .prepare("SELECT id FROM v2_conversation WHERE character_id = ?")
      .bind("no-such-character")
      .all<{ id: string }>();
    expect(convs).toHaveLength(0);
  });
});
