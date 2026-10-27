// @vitest-environment node
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readChunkDelivery, readStoredReplyEvents, type ChunkDelivery } from "./stored-reply";

import type * as DbModule from "@v2/db";
import type { V2Db } from "@v2/db";

const fixture = vi.hoisted(() => ({
  deliveries: [] as ChunkDelivery[] | null,
  scopes: [] as unknown[],
}));
vi.mock("@v2/db", async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  loadChunkDeliveries: async (_db: unknown, scope: unknown) => {
    fixture.scopes.push(scope);
    return fixture.deliveries;
  },
}));

let database: DatabaseSync;
let binding: Pick<D1Database, "prepare">;
beforeEach(() => {
  fixture.deliveries = [];
  fixture.scopes.length = 0;
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE v2_message (id TEXT, conversation_id TEXT, turn INTEGER, role TEXT, generation_id TEXT, created_at INTEGER);
    CREATE TABLE v2_chunk (message_id TEXT, seq INTEGER, text TEXT, judge_json TEXT, attempt INTEGER, scheduled_at INTEGER);
    INSERT INTO v2_message VALUES ('synthetic-assistant','synthetic-room',1,'assistant','synthetic-generation',500);
    INSERT INTO v2_message VALUES ('other','synthetic-other',1,'assistant','other-generation',700);
    INSERT INTO v2_chunk VALUES ('synthetic-assistant',1,'synthetic second','{}',1,2200);
    INSERT INTO v2_chunk VALUES ('synthetic-assistant',0,'synthetic first','{}',2,1000);
    INSERT INTO v2_chunk VALUES ('other',0,'other synthetic','{}',1,9999);
  `);
  binding = {
    prepare: (sql: string) => ({
      bind: (...values: (string | number)[]) => ({
        all: async () => ({ results: database.prepare(sql).all(...values) }),
      }),
    }),
  } as unknown as Pick<D1Database, "prepare">;
});
afterEach(() => {
  database.close();
});

it("確定chunkのseq/attempt/予定時刻をそのまま配送用に復元する", async () => {
  const events = await readStoredReplyEvents(binding, "synthetic-room", 1, "synthetic-generation");
  expect(events).toMatchObject([
    { type: "chunk", seq: 0, text: "synthetic first", attempt: 2, scheduledAt: 1000 },
    { type: "chunk", seq: 1, text: "synthetic second", attempt: 1, scheduledAt: 2200 },
  ]);
  expect(await readStoredReplyEvents(binding, "synthetic-room", 1, "other-generation")).toEqual([]);
  expect(await readStoredReplyEvents(binding, "synthetic-other", 2, "other-generation")).toEqual(
    [],
  );
});

it("旧schemaの予定時刻なしはassistant作成時刻へ戻す", async () => {
  database.exec("ALTER TABLE v2_chunk DROP COLUMN scheduled_at");
  const events = await readStoredReplyEvents(binding, "synthetic-room", 1, "synthetic-generation");
  expect(events[0]).toMatchObject({ scheduledAt: 500 });
});

it("統合readerのowner scopeとturnを使い、空replyの生成idも保つ", async () => {
  const delivery: ChunkDelivery = {
    conversationId: "synthetic-room",
    turn: 2,
    generationId: "synthetic-empty-generation",
    serverNow: 1200,
    chunks: [],
  };
  fixture.deliveries = [
    { ...delivery, turn: 1 },
    { ...delivery, conversationId: "other-synthetic-room" },
    delivery,
  ];
  const scope = {
    userId: "synthetic-user",
    characterId: "synthetic-character",
    conversationId: "synthetic-room",
  };
  expect(await readChunkDelivery({} as V2Db, scope, 2)).toEqual(delivery);
  expect(fixture.scopes).toEqual([scope]);
});

it("統合readerのscoped nullを履歴fallbackへ流さず拒否する", async () => {
  fixture.deliveries = null;
  await expect(
    readChunkDelivery(
      {} as V2Db,
      {
        userId: "synthetic-user",
        characterId: "synthetic-character",
        conversationId: "synthetic-room",
      },
      1,
    ),
  ).rejects.toMatchObject({ name: "ConversationAccessError" });
});
