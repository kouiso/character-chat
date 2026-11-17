// 検索箱・metadata index（kind・conversation_id）・Queue が env ごとに在るかの確かめ（RIT-74 FR-7）。
// 使い方: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm exec tsx apps/v2/script/check-memory-resources.ts --env staging|rag
// 読むだけで資源は作らん（作るのは持ち主、doc/v2/secrets.md の手順）。
// 検索箱にベクトルが在るのに metadata index が無い時は、作った後に
// POST /api/admin/memory-reindex {"mode":"all"} の入れ直しが要る事を出す。
import { z } from "zod";

type EnvName = "rag" | "staging";

// wrangler.jsonc の束ね名と同じ値。本番 env.rag・試し用 env.staging。
const TARGETS: Record<EnvName, { index: string; queue: string }> = {
  rag: { index: "adult-ai-v2-memory", queue: "adult-ai-v2-memory" },
  staging: { index: "character-chat-v2-staging", queue: "adult-ai-v2-memory-staging" },
};

const REQUIRED_METADATA = ["kind", "conversation_id"] as const;

const apiResponseSchema = z.object({
  success: z.boolean().optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
  result: z.unknown().optional(),
});

const parseArgs = (argv: string[]): EnvName => {
  const index = argv.indexOf("--env");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === "rag" || value === "staging") return value;
  throw new Error("usage: check-memory-resources.ts --env rag|staging");
};

const apiBase = (): { base: string; headers: Record<string, string> } => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error("CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID が要る");
  }
  return {
    base: `https://api.cloudflare.com/client/v4/accounts/${accountId}`,
    headers: { Authorization: `Bearer ${token}` },
  };
};

const apiGet = async (path: string): Promise<unknown> => {
  const { base, headers } = apiBase();
  const response = await fetch(`${base}${path}`, { headers });
  const payload = apiResponseSchema.parse(await response.json());
  if (!response.ok || payload.success === false) {
    const message = payload.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(`Cloudflare API ${path}: ${message || `HTTP ${response.status}`}`);
  }
  return payload.result;
};

const indexListSchema = z.array(
  z.object({
    name: z.string().optional(),
    config: z
      .object({ dimensions: z.number().optional(), metric: z.string().optional() })
      .optional(),
  }),
);

const metadataListSchema = z.object({
  metadataIndexes: z
    .array(z.object({ propertyName: z.string().optional(), indexType: z.string().optional() }))
    .optional(),
});

const queueListSchema = z.array(z.object({ queue_name: z.string().optional() }));

// 検索箱にベクトルが残っとるかの確かめ。filter 無しの query で 1 件でも返れば在ると見なす。
const indexHasVectors = async (indexName: string): Promise<boolean | null> => {
  const { base, headers } = apiBase();
  const response = await fetch(`${base}/vectorize/v2/indexes/${indexName}/query`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      vector: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
      topK: 1,
      returnMetadata: "none",
      returnValues: false,
    }),
  });
  if (!response.ok) return null;
  const payload = z
    .object({ matches: z.array(z.unknown()).optional() })
    .parse(apiResponseSchema.parse(await response.json()).result);
  return (payload.matches ?? []).length > 0;
};

const yn = (value: boolean | null): string => (value === null ? "未確認" : value ? "有" : "無");

const main = async (): Promise<void> => {
  const env = parseArgs(process.argv.slice(2));
  const target = TARGETS[env];
  const rows: { resource: string; name: string; exists: string; detail: string }[] = [];

  let indexExists: boolean | null = null;
  let indexDetail = "";
  let metadata: { propertyName?: string; indexType?: string }[] = [];
  let queueExists: boolean | null = null;
  let vectorsPresent: boolean | null = null;

  try {
    const indexes = indexListSchema.parse(await apiGet("/vectorize/v2/indexes"));
    const found = indexes.find((index) => index.name === target.index);
    indexExists = found !== undefined;
    if (found?.config) {
      indexDetail = `dimensions=${found.config.dimensions ?? "?"} metric=${found.config.metric ?? "?"}`;
    }
  } catch {
    indexExists = null;
  }

  if (indexExists === true) {
    try {
      const listed = metadataListSchema.parse(
        await apiGet(`/vectorize/v2/indexes/${target.index}/metadata_index/list`),
      );
      metadata = listed.metadataIndexes ?? [];
    } catch {
      metadata = [];
    }
    vectorsPresent = await indexHasVectors(target.index);
  }

  try {
    const queues = queueListSchema.parse(await apiGet("/queues"));
    queueExists = queues.some((queue) => queue.queue_name === target.queue);
  } catch {
    queueExists = null;
  }

  rows.push({
    resource: "vectorize",
    name: target.index,
    exists: yn(indexExists),
    detail: indexDetail,
  });
  for (const required of REQUIRED_METADATA) {
    const found = metadata.find((index) => index.propertyName === required);
    rows.push({
      resource: "metadata_index",
      name: `${target.index}.${required}`,
      exists: yn(indexExists === true ? found !== undefined : null),
      detail: found?.indexType ?? "",
    });
  }
  rows.push({ resource: "queue", name: target.queue, exists: yn(queueExists), detail: "" });
  rows.push({
    resource: "vectors",
    name: `${target.index} 内の点`,
    exists: yn(vectorsPresent),
    detail: "",
  });

  const nameWidth = Math.max(...rows.map((row) => row.name.length), "name".length);
  console.log(`env=${env}`);
  console.log(`${"resource".padEnd(14)} ${"name".padEnd(nameWidth)}  exists  detail`);
  for (const row of rows) {
    console.log(
      `${row.resource.padEnd(14)} ${row.name.padEnd(nameWidth)}  ${row.exists.padEnd(5)}  ${row.detail}`,
    );
  }

  const missingMetadata = REQUIRED_METADATA.some(
    (required) => !metadata.some((index) => index.propertyName === required),
  );
  if (indexExists === true && missingMetadata && vectorsPresent === true) {
    console.log(
      "注意: ベクトルは在るのに metadata index が無い。metadata index を作った後に " +
        'POST /api/admin/memory-reindex {"mode":"all"} の入れ直しが要る（FR-8）。',
    );
  }

  const missing = rows.some((row) => row.resource !== "vectors" && row.exists === "無");
  process.exitCode = missing ? 1 : 0;
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("未確認: 鍵（CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID）か通信を確かめる");
  process.exitCode = 1;
}
