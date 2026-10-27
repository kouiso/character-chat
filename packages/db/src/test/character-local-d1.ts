import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";

import { getPlatformProxy } from "wrangler";

import { createDb } from "../client";

type CharacterTestEnv = { DB: D1Database };

// 既存の seed・migration はキャラ本文を含むため、空の専用 D1 に構造だけを作る。
export const openCharacterTestDb = async (beforeMigration?: (d1: D1Database) => Promise<void>) => {
  const root = await mkdtemp(path.join(tmpdir(), "rit-105-character-"));
  const configPath = path.join(root, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "rit-105-character-test",
      compatibility_date: "2026-10-01",
      d1_databases: [
        { binding: "DB", database_name: "rit-105-synthetic", database_id: crypto.randomUUID() },
      ],
    }),
  );
  const start = () =>
    getPlatformProxy<CharacterTestEnv>({
      configPath,
      envFiles: [],
      persist: { path: path.join(root, "state") },
      remoteBindings: false,
    });
  let proxy = await start();
  try {
    for (const [index, url] of [
      new URL("./character-base.sql", import.meta.url),
      new URL("../../../../drizzle/0080_character_profile.sql", import.meta.url),
      new URL("../../../../drizzle/0081_character_version.sql", import.meta.url),
    ].entries()) {
      const sql = await readFile(url, "utf8");
      const statements = sql.split("--> statement-breakpoint").filter((text) => text.trim());
      await proxy.env.DB.batch(statements.map((statement) => proxy.env.DB.prepare(statement)));
      if (index === 0) await beforeMigration?.(proxy.env.DB);
    }
    await proxy.env.DB.prepare("INSERT INTO user (id, email, created_at) VALUES (?, ?, ?)")
      .bind("synthetic-owner", "owner@example.invalid", 1)
      .run();
  } catch (error) {
    await proxy.dispose();
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  const local = {
    db: createDb(proxy.env.DB),
    d1: proxy.env.DB,
    async reopen() {
      await proxy.dispose();
      proxy = await start();
      local.db = createDb(proxy.env.DB);
      local.d1 = proxy.env.DB;
    },
    async dispose() {
      await proxy.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
  return local;
};

export type CharacterTestDb = Awaited<ReturnType<typeof openCharacterTestDb>>;
