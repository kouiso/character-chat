// @vitest-environment node
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, expect, it } from "vitest";

import { readStoredReplyEvents } from "./stored-reply";

let database: DatabaseSync;
let binding: Pick<D1Database, "prepare">;
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE v2_message (id TEXT, conversation_id TEXT, turn INTEGER, role TEXT, generation_id TEXT);
    CREATE TABLE v2_chunk (message_id TEXT, seq INTEGER, text TEXT, judge_json TEXT, attempt INTEGER, scheduled_at INTEGER);
    INSERT INTO v2_message VALUES ('synthetic-assistant','synthetic-room',1,'assistant','synthetic-generation');
    INSERT INTO v2_message VALUES ('other','synthetic-other',1,'assistant','other-generation');
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

it("旧schemaの予定時刻なしでは架空の配送時刻を付けない", async () => {
  database.exec("ALTER TABLE v2_chunk DROP COLUMN scheduled_at");
  const events = await readStoredReplyEvents(binding, "synthetic-room", 1, "synthetic-generation");
  expect(events[0]).not.toHaveProperty("scheduledAt");
});
