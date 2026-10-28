// @vitest-environment node
// wrangler.jsonc が設計書の束ね（SBI-02-2 / §4.5・§4.8）を満たすかを固定する。
// DO の移行設定や別 URL 封じを消した版はこの試験を通らず出せん。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;
const asObjects = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? (value as JsonObject[]) : [];
const obj = (value: unknown): JsonObject => (value ?? {}) as JsonObject;

const config = obj(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)), "utf8")),
);

const PROD_D1_ID = "b617800c-cf4c-4122-adbb-ce872a258da6";

const migrationClasses = (migrations: unknown): string[] =>
  asObjects(migrations).flatMap((migration) => [
    ...((migration.new_classes as string[] | undefined) ?? []),
    ...((migration.new_sqlite_classes as string[] | undefined) ?? []),
  ]);

describe("wrangler.jsonc の束ね", () => {
  it("別 URL を全部閉じ、静的ファイルも必ず Worker を通す", () => {
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(obj(config.assets).run_worker_first).toBe(true);
  });

  it("入口検査に必要な secret が deploy 時必須として宣言されとる", () => {
    expect(obj(config.secrets).required).toEqual(
      expect.arrayContaining(["BASIC_AUTH_USERNAME", "BASIC_AUTH_PASSWORD", "OPENROUTER_API_KEY"]),
    );
  });

  it("本番 D1・R2・Vectorize・Workers AI・Queue が全部束ねられとる", () => {
    expect(config.d1_databases).toEqual([
      expect.objectContaining({
        binding: "DB",
        database_name: "adult-ai-db",
        database_id: PROD_D1_ID,
        preview_database_id: PROD_D1_ID,
      }),
    ]);
    expect(config.r2_buckets).toEqual([
      expect.objectContaining({ binding: "BUCKET", bucket_name: "adult-ai-images" }),
    ]);
    expect(config.vectorize).toEqual([expect.objectContaining({ binding: "MEMORY_INDEX" })]);
    expect(obj(config.ai).binding).toBe("AI");
  });

  it("Queue は producer と consumer が同じ名前の行列を指す", () => {
    const queues = obj(config.queues);
    const names = [
      ...asObjects(queues.producers).map((producer) => producer.queue),
      ...asObjects(queues.consumers).map((consumer) => consumer.queue),
    ];
    expect(asObjects(queues.producers)[0]?.binding).toBe("MEMORY_JOBS");
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(1);
  });

  it("ChatRoom DO の束ねと移行設定は両方必要（片方だけでは出せん）", () => {
    expect(obj(config.durable_objects).bindings).toEqual([
      expect.objectContaining({ name: "CHAT_ROOMS", class_name: "ChatRoom" }),
    ]);
    expect(migrationClasses(config.migrations)).toContain("ChatRoom");
  });

  it("長い生成に耐える CPU 上限（有料 standard で 5 分まで）", () => {
    expect(obj(config.limits).cpu_ms).toBeGreaterThanOrEqual(30_000);
    expect(obj(config.limits).cpu_ms).toBeLessThanOrEqual(300_000);
  });

  it("試し用の staging 環境は本番と別の資源を指す", () => {
    const staging = obj(obj(config.env).staging);
    expect(staging.name).toBe("adult-ai-v2-staging");
    for (const db of asObjects(staging.d1_databases)) {
      expect(db.database_id).not.toBe(PROD_D1_ID);
    }
    for (const bucket of asObjects(staging.r2_buckets)) {
      expect(bucket.bucket_name).not.toBe("adult-ai-images");
    }
  });

  it("staging も DO 束ねと移行設定を持つ（環境ごとに宣言が要る）", () => {
    const staging = obj(obj(config.env).staging);
    expect(obj(staging.durable_objects).bindings).toEqual([
      expect.objectContaining({ name: "CHAT_ROOMS" }),
    ]);
    expect(migrationClasses(staging.migrations)).toContain("ChatRoom");
  });
});
