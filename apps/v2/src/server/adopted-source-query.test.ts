// @vitest-environment node
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adoptedSourceQuery } from "./adopted-source-query";

const scope = {
  conversationId: "synthetic-conversation",
  ownerUserId: "synthetic-owner",
  characterId: "synthetic-character",
  worldlineId: "synthetic-worldline",
  sourceStartTurn: 2,
};

describe("adopted source selection (in-memory SQLite, no Worker or D1 fixture)", () => {
  let database: DatabaseSync;
  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE v2_conversation (id TEXT PRIMARY KEY, user_id TEXT, character_id TEXT);
      CREATE TABLE v2_message (id TEXT PRIMARY KEY, conversation_id TEXT, turn INTEGER, role TEXT);
      CREATE TABLE v2_memory_source (
        worldline_id TEXT, message_id TEXT, revision INTEGER, state TEXT,
        PRIMARY KEY (worldline_id, message_id, revision)
      );
    `);
    database
      .prepare("INSERT INTO v2_conversation VALUES (?, ?, ?)")
      .run(scope.conversationId, scope.ownerUserId, scope.characterId);
  });
  afterEach(() => database.close());
  const message = (id: string, turn: number, role = "user") =>
    database
      .prepare("INSERT INTO v2_message VALUES (?, ?, ?, ?)")
      .run(id, scope.conversationId, turn, role);
  const register = (id: string, state: string, worldlineId = scope.worldlineId, revision = 1) =>
    database
      .prepare("INSERT INTO v2_memory_source VALUES (?, ?, ?, ?)")
      .run(worldlineId, id, revision, state);
  const read = (overrides: Partial<typeof scope> = {}) => {
    const query = adoptedSourceQuery({ ...scope, ...overrides }).toSQL();
    const params = query.params.map((value: unknown) => {
      if (typeof value === "string" || typeof value === "number") return value;
      throw new Error("Unexpected synthetic query parameter");
    });
    return database.prepare(query.sql).all(...params);
  };

  it("excludes all2000 registered sources regardless of tombstone state in one query", () => {
    for (let index = 0; index < 2000; index++) {
      const id = `synthetic-${index}`;
      message(id, index + 2);
      register(id, ["active", "invalidated", "deleted"][index % 3]);
    }
    expect(read()).toEqual([]);
    // 過去の登録数でパラメータや結果件数が増えると、長い会話の回復まで遅くなる。
    expect(adoptedSourceQuery(scope).toSQL().params).toHaveLength(6);
    message("new-assistant", 2002, "assistant");
    message("new-user", 2002);
    expect(read()).toEqual([
      { id: "new-user", turn: 2002 },
      { id: "new-assistant", turn: 2002 },
    ]);
  });

  it("keeps the cutoff and persisted owner/character/conversation boundaries", () => {
    message("legacy", 1);
    message("adopted", 2);
    expect(read()).toEqual([{ id: "adopted", turn: 2 }]);
    for (const other of [
      { ownerUserId: "other-owner" },
      { characterId: "other-character" },
      { conversationId: "other-conversation" },
    ])
      expect(read(other)).toEqual([]);
  });

  it("does not mistake another worldline or revision for this source registration", () => {
    message("other-worldline", 2);
    register("other-worldline", "active", "other-worldline");
    message("other-revision", 3);
    register("other-revision", "invalidated", scope.worldlineId, 2);
    expect(read()).toEqual([
      { id: "other-worldline", turn: 2 },
      { id: "other-revision", turn: 3 },
    ]);
  });
});
