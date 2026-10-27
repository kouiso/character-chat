import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";

import { getPlatformProxy } from "wrangler";

import { createDb } from "../client";

import type { LocalD1 } from "./local-d1";

// 共有の D1 やキャラ本文を開かず、保存経路の回帰試験を合成データだけで行う。
export const openChunkD1 = async (): Promise<LocalD1> => {
  const directory = await mkdtemp(path.join(tmpdir(), "rit-67-"));
  const configPath = path.join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "rit-67-synthetic",
      compatibility_date: "2026-03-17",
      d1_databases: [{ binding: "DB", database_name: "rit-67", database_id: "rit-67" }],
    }),
  );
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath,
    envFiles: [],
    persist: false,
    remoteBindings: false,
  });
  const dispose = async (): Promise<void> => {
    await proxy.dispose();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const ddl = await readFile(
      new URL("../../../../drizzle/0070_v2_tables.sql", import.meta.url),
      "utf8",
    );
    const migration = await readFile(
      new URL("../../../../drizzle/0076_v2_chunk_scheduled_at.sql", import.meta.url),
      "utf8",
    );
    const rejections = await readFile(
      new URL("../../../../drizzle/0077_v2_chunk_rejection.sql", import.meta.url),
      "utf8",
    );
    const anchors = await readFile(
      new URL("../../../../drizzle/0078_v2_turn_delivery.sql", import.meta.url),
      "utf8",
    );
    const commits = await readFile(
      new URL("../../../../drizzle/0079_v2_turn_commit.sql", import.meta.url),
      "utf8",
    );
    const audit = await readFile(
      new URL("../../../../drizzle/0082_v2_generation_attempt.sql", import.meta.url),
      "utf8",
    );
    const attemptAudit = await readFile(
      new URL("../../../../drizzle/0083_v2_model_attempt_audit.sql", import.meta.url),
      "utf8",
    );
    await proxy.env.DB.batch([
      proxy.env.DB.prepare("CREATE TABLE character (id TEXT PRIMARY KEY)"),
      ...ddl
        .split(";")
        .filter((statement) => statement.trim())
        .map((statement) => proxy.env.DB.prepare(statement)),
      proxy.env.DB.prepare(migration),
      proxy.env.DB.prepare(rejections),
      proxy.env.DB.prepare(anchors),
      proxy.env.DB.prepare(commits),
      proxy.env.DB.prepare(audit),
      ...attemptAudit
        .split(";")
        .filter((statement) => statement.trim())
        .map((statement) => proxy.env.DB.prepare(statement)),
      proxy.env.DB.prepare("INSERT INTO character (id) VALUES ('rit-67-synthetic')"),
    ]);
    return { db: createDb(proxy.env.DB), d1: proxy.env.DB, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
};
