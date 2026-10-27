import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";

import { createMemoryVersionStore } from "./memory-version-store";

import { createDb, v2MemoryTable, type V2Db } from "./index";

describe("memory version store (isolated synthetic D1)", () => {
  let directory: string;
  let dispose: (() => Promise<void>) | undefined;
  let db: V2Db;

  beforeAll(async () => {
    expect(createMemoryVersionStore).toBeTypeOf("function");
    directory = await mkdtemp(path.join(os.tmpdir(), "rit86-memory-"));
    const configPath = path.join(directory, "wrangler.json");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "rit86-synthetic-memory",
        compatibility_date: "2026-03-17",
        d1_databases: [
          {
            binding: "DB",
            database_name: "rit86-synthetic-memory",
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
    dispose = () => proxy.dispose();
    db = createDb(proxy.env.DB);
    await proxy.env.DB.prepare("CREATE TABLE character (id TEXT PRIMARY KEY)").run();
    const baseSql = await readFile(
      new URL("../../../drizzle/0070_v2_tables.sql", import.meta.url),
      "utf8",
    );
    const applyMigration = async (migration: string) => {
      const statements = migration
        .replaceAll(/--[^\n]*/g, "")
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
      await proxy.env.DB.batch(statements.map((statement) => proxy.env.DB.prepare(statement)));
    };
    await applyMigration(baseSql);
    const versionSql = await readFile(
      new URL("../../../drizzle/0084_v2_memory_supersession.sql", import.meta.url),
      "utf8",
    );
    await proxy.env.DB.prepare("INSERT INTO character (id) VALUES ('synthetic-character')").run();
    for (const id of [
      "preference",
      "scope",
      "other",
      "parallel",
      "constraint",
      "rollback",
      "legacy",
      "invalid",
    ]) {
      await proxy.env.DB.prepare(
        "INSERT INTO v2_conversation (id, user_id, character_id, thread_id, prompt_version, created_at, updated_at) VALUES (?, 'synthetic-user', 'synthetic-character', ?, 'v0001', 0, 0)",
      )
        .bind(id, id)
        .run();
    }
    await proxy.env.DB.prepare(
      "INSERT INTO v2_memory (id, conversation_id, kind, content, created_at) VALUES ('legacy-memory', 'legacy', 'fact', 'a retained legacy fact', 0)",
    ).run();
    await applyMigration(versionSql);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await dispose?.();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("keeps all four preferences and references only the last after three changes", async () => {
    const store = createMemoryVersionStore(db, "preference");
    const contents = ["好きな色は青", "好きな色は緑", "好きな色は黄", "好きな色は紫"];
    const saved = [];
    // 同時刻の変更でも時刻や UUID の大小に現在値を任せん。
    const clock = vi.spyOn(Date, "now").mockReturnValue(123456);
    try {
      for (const [index, content] of contents.entries()) {
        saved.push(
          await store.write({
            key: "favorite-color",
            kind: "preference",
            content,
            sourceTurn: index + 1,
          }),
        );
      }
    } finally {
      clock.mockRestore();
    }

    const current = await store.listCurrent();
    expect(current).toEqual([saved[3]]);
    const history = await store.listHistory({ key: "favorite-color", kind: "preference" });
    expect(history).toHaveLength(4);
    expect(history.map((memory) => memory.content).sort()).toEqual([...contents].sort());
    for (const [index, version] of saved.entries()) {
      expect(history.find((memory) => memory.id === version.id)).toMatchObject({
        content: contents[index],
        sourceTurn: index + 1,
        supersededById: saved[index + 1]?.id ?? null,
      });
    }

    const reopened = createMemoryVersionStore(db, "preference");
    expect(await reopened.listCurrent()).toEqual(current);
    expect(await reopened.listHistory({ key: "favorite-color", kind: "preference" })).toEqual(
      history,
    );
  });

  it("scopes replacement to conversation, kind, and fact key", async () => {
    const store = createMemoryVersionStore(db, "scope");
    const other = createMemoryVersionStore(db, "other");
    const color = await store.write({ key: "color", kind: "preference", content: "green" });
    const food = await store.write({ key: "food", kind: "preference", content: "rice" });
    const fact = await store.write({
      key: "color",
      kind: "fact",
      content: "the notebook is green",
    });
    const elsewhere = await other.write({ key: "color", kind: "preference", content: "orange" });
    const latest = await store.write({ key: "color", kind: "preference", content: "purple" });

    expect(await store.listCurrent()).toEqual(expect.arrayContaining([food, fact, latest]));
    expect(await store.listCurrent()).toHaveLength(3);
    expect(await store.listCurrent({ kind: "fact" })).toEqual([fact]);
    expect(await other.listCurrent()).toEqual([elsewhere]);
    expect(await store.listHistory({ key: "color", kind: "preference" })).toEqual(
      expect.arrayContaining([{ ...color, supersededById: latest.id }, latest]),
    );
  });

  it("serializes concurrent writes into one current version without losing history", async () => {
    const store = createMemoryVersionStore(db, "parallel");
    const versions = await Promise.all(
      ["apple", "pear", "melon", "grape"].map((content) =>
        store.write({ key: "fruit", kind: "preference", content }),
      ),
    );
    const current = await store.listCurrent();
    const history = await store.listHistory({ key: "fruit", kind: "preference" });
    expect(current).toHaveLength(1);
    expect(history).toHaveLength(4);
    const visited = new Set<string>();
    let cursor = history.find((memory) => !history.some((row) => row.supersededById === memory.id));
    while (cursor) {
      expect(visited.has(cursor.id)).toBe(false);
      visited.add(cursor.id);
      cursor = history.find((memory) => memory.id === cursor?.supersededById);
    }
    expect([...visited].sort()).toEqual(versions.map((version) => version.id).sort());
    expect(history.filter((version) => version.supersededById === null)).toEqual(current);
  });

  it("prevents a second current version even when a writer bypasses the store", async () => {
    const store = createMemoryVersionStore(db, "constraint");
    const current = await store.write({ key: "city", kind: "fact", content: "Osaka" });
    await expect(
      db.insert(v2MemoryTable).values({
        ...current,
        id: crypto.randomUUID(),
        content: "conflicting raw insert",
      }),
    ).rejects.toThrow();
    expect(await store.listCurrent({ kind: "fact" })).toEqual([current]);
  });

  it("rolls back the supersession marker if inserting the new version fails", async () => {
    const store = createMemoryVersionStore(db, "rollback");
    const initial = await store.write({ key: "drink", kind: "preference", content: "water" });
    const id = vi.spyOn(crypto, "randomUUID").mockReturnValue(initial.id);
    try {
      await expect(
        store.write({ key: "drink", kind: "preference", content: "tea" }),
      ).rejects.toThrow();
    } finally {
      id.mockRestore();
    }
    expect(await store.listCurrent()).toEqual([initial]);
    expect(await store.listHistory({ key: "drink", kind: "preference" })).toEqual([initial]);
    expect(await db.select().from(v2MemoryTable).where(eq(v2MemoryTable.id, initial.id))).toEqual([
      { ...initial, embedding: null },
    ]);
  });

  it("retains pre-migration unkeyed memories independently of keyed replacements", async () => {
    const store = createMemoryVersionStore(db, "legacy");
    await store.write({ key: "city", kind: "fact", content: "Osaka" });
    const latest = await store.write({ key: "city", kind: "fact", content: "Kyoto" });
    const current = await store.listCurrent();
    expect(current).toHaveLength(2);
    expect(current).toContainEqual(latest);
    expect(current).toContainEqual(
      expect.objectContaining({ id: "legacy-memory", memoryKey: null, supersededById: null }),
    );
  });

  it("rejects invalid writes before changing any current memory", async () => {
    const store = createMemoryVersionStore(db, "invalid");
    const initial = await store.write({ key: "drink", kind: "preference", content: "water" });
    for (const input of [
      { key: " ", kind: "preference", content: "tea" },
      { key: "drink", kind: "preference", content: " " },
      { key: "drink", kind: "preference", content: "tea", sourceTurn: -1 },
    ] as const) {
      await expect(store.write(input)).rejects.toThrow();
    }
    expect(() => createMemoryVersionStore(db, " ")).toThrow();
    expect(await store.listCurrent()).toEqual([initial]);
    expect(await createMemoryVersionStore(db, "missing-conversation").listCurrent()).toEqual([]);
    await expect(
      createMemoryVersionStore(db, "missing-conversation").write({
        key: "drink",
        kind: "fact",
        content: "tea",
      }),
    ).rejects.toThrow();
  });
});
