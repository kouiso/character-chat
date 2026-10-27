import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPlatformProxy } from "wrangler";

export type DocumentFixture = {
  d1: D1Database;
  bucket: R2Bucket;
  dispose: () => Promise<void>;
};

export const openDocumentFixture = async (): Promise<DocumentFixture> => {
  const directory = await mkdtemp(path.join(tmpdir(), "rit-document-fixture-"));
  const variables = {
    MINIFLARE_REGISTRY_PATH: path.join(directory, "registry"),
    WRANGLER_REGISTRY_PATH: path.join(directory, "registry"),
    WRANGLER_LOG_PATH: path.join(directory, "wrangler.log"),
  };
  const previous = Object.keys(variables).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, variables);
  const restoreEnvironment = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const configPath = path.join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "rit-document-synthetic",
      compatibility_date: "2026-10-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: "synthetic-document-db",
          database_id: "00000000-0000-0000-0000-000000000116",
        },
      ],
      r2_buckets: [{ binding: "BUCKET", bucket_name: "synthetic-document-bucket" }],
    }),
  );
  try {
    const proxy = await getPlatformProxy<{ DB: D1Database; BUCKET: R2Bucket }>({
      configPath,
      envFiles: [],
      persist: false,
      remoteBindings: false,
    });
    try {
      const migration = await readFile(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../../../drizzle/0086_v2_document.sql",
        ),
        "utf8",
      );
      await proxy.env.DB.batch(
        migration
          .split("--> statement-breakpoint")
          .map((statement) => proxy.env.DB.prepare(statement)),
      );
      return {
        d1: proxy.env.DB,
        bucket: proxy.env.BUCKET,
        dispose: async () => {
          await proxy.dispose();
          restoreEnvironment();
          await rm(directory, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await proxy.dispose();
      throw error;
    }
  } catch (error) {
    restoreEnvironment();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};
