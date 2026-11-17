// 植えた記憶が言い換えの質問で上位 3 件に入るかの実測（RIT-74 UR-1・完成の定義）。
// 使い方: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//   pnpm exec tsx apps/v2/script/memory-paraphrase-check.ts --env staging [--settle-seconds 20]
// 呼ぶ回数は埋め込み 20 回（植える 10＋質問 10）・検索 10 回まで。検索箱への upsert は
// NDJSON の REST。使う区切りは試験用（bench: で始まる値の hash）で、終わったら
// delete_by_ids で消す。記憶の本文はログに出さん（NFR-3）。
import { readFile } from "node:fs/promises";

import { z } from "zod";
import { hashMemorySource } from "@v2/db";

import { memoryNamespace, memoryVectorId, validateMemoryVector } from "../src/server/memory-vector";

type EnvName = "rag" | "staging";

// wrangler.jsonc の束ね名と同じ値。
const INDEX_NAMES: Record<EnvName, string> = {
  rag: "adult-ai-v2-memory",
  staging: "character-chat-v2-staging",
};

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
// 試験の区切りは bench: で始まる値の hash（本番の namespace と混ざらん）。
const BENCH_USER_ID = "bench:memory-paraphrase";
const BENCH_CONVERSATION_ID = "bench:fixture";
const TOP_K = 3;

const fixtureSchema = z.object({
  memories: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(["fact", "preference"]),
        content: z.string().min(1),
      }),
    )
    .length(10),
  queries: z.array(z.object({ memoryId: z.string().min(1), text: z.string().min(1) })).length(10),
});

const parseArgs = (argv: string[]): { env: EnvName; settleSeconds: number } => {
  const envIndex = argv.indexOf("--env");
  const envValue = envIndex >= 0 ? argv[envIndex + 1] : undefined;
  if (envValue !== "rag" && envValue !== "staging") {
    throw new Error("usage: memory-paraphrase-check.ts --env rag|staging [--settle-seconds N]");
  }
  const settleIndex = argv.indexOf("--settle-seconds");
  const settleValue = settleIndex >= 0 ? Number(argv[settleIndex + 1]) : 20;
  if (!Number.isFinite(settleValue) || settleValue < 0) {
    throw new Error("--settle-seconds には 0 以上の数を渡す");
  }
  return { env: envValue, settleSeconds: settleValue };
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

const apiResponseSchema = z.object({
  success: z.boolean().optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
  result: z.unknown().optional(),
});

const apiFetch = async (path: string, init?: RequestInit): Promise<unknown> => {
  const { base, headers } = apiBase();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
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

// Workers AI REST の bge-m3。返事は { data: [[1024 個の数]] }。検査は本物と同じ
// validateMemoryVector を通す（1024 以外・NaN・全 0・float32 超えは止まる）。
const embedText = async (text: string): Promise<number[]> => {
  const result = apiResponseSchema
    .extend({ result: z.object({ data: z.array(z.unknown()) }) })
    .parse(
      await apiFetch(`/ai/run/${EMBEDDING_MODEL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: [text], truncate_inputs: false }),
      }),
    ).result;
  return validateMemoryVector(result.data[0]);
};

const upsertVectors = async (
  indexName: string,
  vectors: { id: string; namespace: string; values: number[]; metadata: Record<string, string> }[],
): Promise<void> => {
  const ndjson = vectors.map((vector) => JSON.stringify(vector)).join("\n");
  await apiFetch(`/vectorize/v2/indexes/${indexName}/upsert`, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body: ndjson,
  });
};

const queryResultSchema = z.object({
  matches: z
    .array(
      z.object({
        id: z.string(),
        score: z.number().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

const queryIndex = async (
  indexName: string,
  namespace: string,
  values: number[],
): Promise<{ id: string; memoryId?: string }[]> => {
  const result = queryResultSchema.parse(
    await apiFetch(`/vectorize/v2/indexes/${indexName}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vector: values,
        namespace,
        topK: TOP_K,
        returnMetadata: "all",
        returnValues: false,
        // 本物の検索（retrieveVectorMemories）と同じ絞り込み。
        filter: { conversation_id: BENCH_CONVERSATION_ID, kind: { $in: ["fact", "preference"] } },
      }),
    }),
  );
  return (result.matches ?? []).map((match) => ({
    id: match.id,
    memoryId: typeof match.metadata?.memory_id === "string" ? match.metadata.memory_id : undefined,
  }));
};

const deleteVectors = async (indexName: string, ids: string[]): Promise<void> => {
  await apiFetch(`/vectorize/v2/indexes/${indexName}/delete_by_ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  const { env, settleSeconds } = parseArgs(process.argv.slice(2));
  const indexName = INDEX_NAMES[env];
  const fixturePath = new URL(
    "../../../packages/bench/fixture/memory-paraphrase-10.json",
    import.meta.url,
  );
  const fixture = fixtureSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));

  const namespace = await memoryNamespace({ userId: BENCH_USER_ID, characterId: `bench-${env}` });
  const vectorIds: string[] = [];
  let passCount = 0;

  try {
    const vectors: Parameters<typeof upsertVectors>[1] = [];
    for (const memory of fixture.memories) {
      const values = await embedText(memory.content);
      const hash = await hashMemorySource(memory.content);
      const vectorId = await memoryVectorId(memory.id, hash);
      vectorIds.push(vectorId);
      vectors.push({
        id: vectorId,
        namespace,
        values,
        metadata: {
          memory_id: memory.id,
          content_hash: hash,
          kind: memory.kind,
          conversation_id: BENCH_CONVERSATION_ID,
        },
      });
    }
    await upsertVectors(indexName, vectors);
    if (settleSeconds > 0) await sleep(settleSeconds * 1_000);

    const queryByMemory = new Map(fixture.queries.map((query) => [query.memoryId, query.text]));
    console.log(`env=${env} index=${indexName} topK=${TOP_K}`);
    console.log(`${"memory_id".padEnd(14)} result`);
    for (const memory of fixture.memories) {
      const text = queryByMemory.get(memory.id);
      if (!text) throw new Error(`fixture の ${memory.id} に質問が無い`);
      const values = await embedText(text);
      const matches = await queryIndex(indexName, namespace, values);
      const rank = matches.findIndex((match) => match.memoryId === memory.id) + 1;
      const hit = rank > 0;
      if (hit) passCount += 1;
      console.log(`${memory.id.padEnd(14)} ${hit ? `hit rank=${rank}` : "miss"}`);
    }
    console.log(`${passCount}/10 hit`);
  } finally {
    if (vectorIds.length > 0) {
      await deleteVectors(indexName, vectorIds).catch(() => {
        // 消し忘れは次回の試験に影響せん（試験の区切りは run ごとでは無く同じ値 — 消えなくても上書き）。
      });
    }
  }
  process.exitCode = passCount === fixture.memories.length ? 0 : 1;
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
