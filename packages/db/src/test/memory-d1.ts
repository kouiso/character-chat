import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

import { getPlatformProxy } from "wrangler";

import { createDb } from "../client";
import { registerMemoryConversation } from "../managed-memory-store";

import type { MemoryScope } from "../memory-contract";

export const openSyntheticMemoryD1 = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rit86-managed-"));
  const configPath = path.join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "rit86-managed-synthetic",
      compatibility_date: "2026-03-17",
      d1_databases: [
        {
          binding: "DB",
          database_name: "rit86-synthetic",
          database_id: "00000000-0000-4000-8000-000000000086",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath,
    envFiles: [],
    persist: { path: path.join(directory, "state") },
    remoteBindings: false,
  });
  const d1 = proxy.env.DB;
  const db = createDb(d1);
  try {
    await d1.prepare("CREATE TABLE character (id TEXT PRIMARY KEY)").run();
    for (const file of [
      "0070_v2_tables.sql",
      "0084_v2_memory_supersession.sql",
      "0085_v2_memory_management.sql",
    ]) {
      const sql = await readFile(new URL(`../../../../drizzle/${file}`, import.meta.url), "utf8");
      const statements = sql
        .replaceAll(/--[^\n]*/g, "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
      await d1.batch(statements.map((statement) => d1.prepare(statement)));
    }
    await d1.batch([
      d1.prepare("insert into character (id) values ('character-a')"),
      d1.prepare("insert into character (id) values ('character-b')"),
    ]);
  } catch (error) {
    await proxy.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    db,
    d1,
    scope: async (suffix: string, overrides: Partial<MemoryScope> = {}): Promise<MemoryScope> => {
      const scope: MemoryScope = {
        ownerUserId: "synthetic-owner",
        characterId: "character-a",
        worldlineId: `worldline-${suffix}`,
        conversationId: `conversation-${suffix}`,
        ...overrides,
      };
      await d1
        .prepare(
          "insert into v2_conversation (id, user_id, character_id, thread_id, prompt_version, created_at, updated_at) values (?, ?, ?, ?, 'v0001', 0, 0)",
        )
        .bind(scope.conversationId, scope.ownerUserId, scope.characterId, scope.conversationId)
        .run();
      await registerMemoryConversation(db, scope);
      return scope;
    },
    message: async (scope: MemoryScope, id: string, turn = 1) => {
      await d1
        .prepare(
          "insert into v2_message (id, conversation_id, turn, role, content, created_at) values (?, ?, ?, 'user', 'synthetic fact', 0)",
        )
        .bind(id, scope.conversationId, turn)
        .run();
    },
    dispose: async () => {
      await proxy.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
};
