// @vitest-environment node
// wrangler.jsonc が設計書の束ね（SBI-02-2 / §4.5・§4.8）を満たすかを、deploy と同じ wrangler の
// 解決結果で固定する。env は top-level の一部だけを継承するので、生の JSON では確かめきれん。
// 本番は env.rag（Worker adult-ai-v2）、試し用は env.staging、top-level は手元用。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const { unstable_readConfig: readWranglerConfig } = await import("wrangler");

const WRANGLER = fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url));
// wrangler の型は既定の import 解決で届かんので、この試験が読む項目だけを zod で確かめて取り出す。
const resolvedSchema = z.object({
  name: z.string().optional(),
  vars: z.record(z.string(), z.unknown()),
  workers_dev: z.boolean().optional(),
  preview_urls: z.boolean().optional(),
  assets: z.object({ run_worker_first: z.unknown() }).optional(),
  secrets: z.object({ required: z.array(z.string()).optional() }).optional(),
  d1_databases: z.array(
    z.object({
      binding: z.string(),
      database_name: z.string().optional(),
      database_id: z.string().optional(),
      preview_database_id: z.string().optional(),
      migrations_dir: z.string().optional(),
    }),
  ),
  r2_buckets: z.array(z.object({ binding: z.string(), bucket_name: z.string().optional() })),
  vectorize: z.array(z.object({ binding: z.string(), index_name: z.string().optional() })),
  ai: z.object({ binding: z.string() }).optional(),
  queues: z.object({
    producers: z.array(z.object({ binding: z.string(), queue: z.string() })),
    consumers: z.array(z.object({ queue: z.string() })).optional(),
  }),
  durable_objects: z.object({
    bindings: z.array(z.object({ name: z.string(), class_name: z.string() })),
  }),
  migrations: z.array(
    z.object({
      new_classes: z.array(z.string()).optional(),
      new_sqlite_classes: z.array(z.string()).optional(),
    }),
  ),
  limits: z.object({ cpu_ms: z.number().optional() }).optional(),
});
type ResolvedConfig = z.infer<typeof resolvedSchema>;
const resolve = (env?: string): ResolvedConfig =>
  resolvedSchema.parse(readWranglerConfig({ config: WRANGLER, env }));

const PROD_D1_ID = "b617800c-cf4c-4122-adbb-ce872a258da6";
const LOCAL_D1_ID = "c0ffee00-0000-4000-8000-000000000001";
const REQUIRED_SECRETS = ["BASIC_AUTH_PASSWORD", "BASIC_AUTH_USERNAME", "OPENROUTER_API_KEY"];
const DEPLOYED = [
  { env: "rag", name: "adult-ai-v2", appEnv: "production" },
  { env: "staging", name: "adult-ai-v2-staging", appEnv: "staging" },
] as const;

const migrationClasses = (config: ResolvedConfig): string[] =>
  config.migrations.flatMap((migration) => [
    ...(migration.new_classes ?? []),
    ...(migration.new_sqlite_classes ?? []),
  ]);

describe.each(DEPLOYED)("出す環境 env.$env の束ね", ({ env, name, appEnv }) => {
  const config = resolve(env);

  it(`Worker 名は ${name}、APP_ENV は ${appEnv}`, () => {
    expect(config.name).toBe(name);
    expect(config.vars.APP_ENV).toBe(appEnv);
    // 固定モデルと障害注入は APP_ENV=test の時しか効かんが、出す環境では値ごと切っておく。
    expect(config.vars.V2_FAKE_MODEL).toBe("0");
    expect(config.vars.V2_TEST_FAULT).toBe("none");
  });

  it("別 URL を全部閉じ、静的ファイルも必ず Worker を通す", () => {
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.assets?.run_worker_first).toBe(true);
  });

  // secrets.required は env へ継承されん。書き忘れると secret 未設定のまま deploy が通る。
  it("入口検査に必要な secret が deploy 時必須として宣言されとる", () => {
    expect([...(config.secrets?.required ?? [])].sort()).toEqual(REQUIRED_SECRETS);
  });

  it("D1・R2・Vectorize・Workers AI・Queue が全部束ねられとる", () => {
    expect(config.d1_databases).toEqual([
      expect.objectContaining({ binding: "DB", migrations_dir: "../../drizzle" }),
    ]);
    expect(config.d1_databases[0]?.database_id).not.toBe(LOCAL_D1_ID);
    expect(config.r2_buckets).toEqual([expect.objectContaining({ binding: "BUCKET" })]);
    expect(config.vectorize).toEqual([expect.objectContaining({ binding: "MEMORY_INDEX" })]);
    expect(config.ai?.binding).toBe("AI");
    expect(config.vars.V2_RAG_ENABLED).toBe("1");
  });

  it("Queue は producer と consumer が同じ名前の行列を指す", () => {
    const names = [
      ...config.queues.producers.map((producer) => producer.queue),
      ...(config.queues.consumers ?? []).map((consumer) => consumer.queue),
    ];
    expect(config.queues.producers.map((producer) => producer.binding)).toEqual(["MEMORY_QUEUE"]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(1);
  });

  it("ChatRoom DO の束ねと移行設定は両方必要（片方だけでは出せん）", () => {
    expect(config.durable_objects.bindings).toEqual([
      expect.objectContaining({ name: "CHAT_ROOMS", class_name: "ChatRoom" }),
      expect.objectContaining({
        name: "PROACTIVE_SCHEDULERS",
        class_name: "ProactiveScheduler",
      }),
    ]);
    expect(migrationClasses(config)).toContain("ChatRoom");
    expect(migrationClasses(config)).toContain("ProactiveScheduler");
  });

  it("長い生成に耐える CPU 上限（有料 standard で 5 分まで）", () => {
    expect(config.limits?.cpu_ms).toBeGreaterThanOrEqual(30_000);
    expect(config.limits?.cpu_ms).toBeLessThanOrEqual(300_000);
  });
});

describe("本番と試し用の分離", () => {
  const production = resolve("rag");
  const staging = resolve("staging");

  it("本番は旧アプリと同じ本番 D1・R2 を正本として読む", () => {
    expect(production.d1_databases[0]).toMatchObject({
      database_name: "adult-ai-db",
      database_id: PROD_D1_ID,
    });
    expect(production.r2_buckets[0]?.bucket_name).toBe("adult-ai-images");
  });

  it("staging は本番と別の資源だけを指す", () => {
    const resources = (config: ResolvedConfig) => [
      ...config.d1_databases.map((db) => `d1:${db.database_id}`),
      ...config.d1_databases.map((db) => `d1:${db.preview_database_id}`),
      ...config.r2_buckets.map((bucket) => `r2:${bucket.bucket_name}`),
      ...config.vectorize.map((index) => `vectorize:${index.index_name}`),
      ...config.queues.producers.map((producer) => `queue:${producer.queue}`),
      ...(config.queues.consumers ?? []).map((consumer) => `queue:${consumer.queue}`),
    ];
    const shared = resources(staging).filter((resource) =>
      resources(production).includes(resource),
    );
    expect(shared).toEqual([]);
  });
});

describe("手元用の top-level", () => {
  const local = resolve();

  // top-level を誤って deploy しても、Cloudflare に実体の無い D1 id なので束ね解決で止まる。
  // 本番の id をここへ書くと、手元の `--remote` や素の deploy が本番へ届く。
  it("本番 D1 を指さず、記憶の Queue・AI・Vectorize を起こさん", () => {
    expect(local.d1_databases.map((db) => [db.database_id, db.preview_database_id])).toEqual([
      [LOCAL_D1_ID, LOCAL_D1_ID],
    ]);
    expect(local.queues.producers).toEqual([]);
    expect(local.ai).toBeUndefined();
    expect(local.vectorize).toEqual([]);
    expect(local.vars.V2_RAG_ENABLED).toBe("0");
  });

  // AI・Vectorize を remote で束ねた環境を既定の dev で起こすと、Cloudflare の本物へつなぎに行く。
  // 資格情報の無い CI が止まり、手元の試験が本番の資源へ触る。明示した時だけ本物を使う。
  it("本物の Cloudflare 資源へは、明示した時しかつながん", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain('remoteBindings: process.env.V2_REMOTE_BINDINGS === "1"');
  });
});
