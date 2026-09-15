import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ScenePhase } from "../../src/lib/scene-phase";

const execFileAsync = promisify(execFile);
const MODEL_ID = "@cf/baai/bge-m3";
const VECTOR_LENGTH = 1024;
const D1_DATABASE_NAME = process.env.RAG_D1_DATABASE ?? "adult-ai-db";

type RagChunkType = "glossary" | "exemplar";

type GlossaryRecord = {
  id: string;
  term: string;
  reading: string;
  usage: string;
  situationTags: string[];
  phase: ScenePhase;
};

type ExemplarRecord = {
  id: string;
  text: string;
  character: string;
  phase: ScenePhase;
  sceneTags: string[];
};

type IngestChunk = {
  sourceId: string;
  type: RagChunkType;
  phase: ScenePhase;
  characterId: string | null;
  text: string;
};

type WorkersAiEmbeddingResponse = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: { data?: number[] | number[][] };
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isScenePhase = (value: unknown): value is ScenePhase =>
  value === "conversation" ||
  value === "intimate" ||
  value === "erotic" ||
  value === "climax" ||
  value === "afterglow";

const isGlossaryRecord = (value: unknown): value is GlossaryRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.term === "string" &&
    typeof record.reading === "string" &&
    typeof record.usage === "string" &&
    isStringArray(record.situationTags) &&
    isScenePhase(record.phase)
  );
};

const isExemplarRecord = (value: unknown): value is ExemplarRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.text === "string" &&
    typeof record.character === "string" &&
    isScenePhase(record.phase) &&
    isStringArray(record.sceneTags)
  );
};

const readJsonl = async (path: string): Promise<unknown[]> => {
  const body = await readFile(path, "utf8");
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
};

const buildChunks = async (): Promise<IngestChunk[]> => {
  const glossaryRows = await readJsonl("prompt/rag/glossary.jsonl");
  const exemplarRows = await readJsonl("prompt/rag/exemplars.jsonl");

  const glossary = glossaryRows.map((row, index) => {
    if (!isGlossaryRecord(row)) throw new Error(`Invalid glossary row at ${index + 1}`);
    return row;
  });
  const exemplars = exemplarRows.map((row, index) => {
    if (!isExemplarRecord(row)) throw new Error(`Invalid exemplar row at ${index + 1}`);
    return row;
  });

  return [
    ...glossary.map((row) => ({
      sourceId: row.id,
      type: "glossary" as const,
      phase: row.phase,
      characterId: null,
      text: `${row.term}（${row.reading}）: ${row.usage} / tags: ${row.situationTags.join(", ")}`,
    })),
    ...exemplars.map((row) => ({
      sourceId: row.id,
      type: "exemplar" as const,
      phase: row.phase,
      characterId: row.character,
      text: `${row.text} / tags: ${row.sceneTags.join(", ")}`,
    })),
  ];
};

const contentHashId = (chunk: IngestChunk): string => {
  const hash = createHash("sha256")
    .update(`${chunk.type}\n${chunk.phase}\n${chunk.characterId ?? ""}\n${chunk.text}`)
    .digest("hex")
    .slice(0, 24);
  return `rag-${chunk.type}-${hash}`;
};

const packEmbeddingHex = (vec: number[]): string =>
  Buffer.from(new Uint8Array(new Float32Array(vec).buffer)).toString("hex");

const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const sqlNullableString = (value: string | null): string => (value ? sqlString(value) : "NULL");

const extractVector = (payload: WorkersAiEmbeddingResponse): number[] => {
  const data = payload.result?.data;
  if (!data) throw new Error("Workers AI response did not include result.data");

  const vec = Array.isArray(data[0]) ? (data as number[][])[0] : (data as number[]);
  if (vec.length !== VECTOR_LENGTH) {
    throw new Error(`bge-m3 returned unexpected vector length: ${vec.length}`);
  }
  return vec;
};

const embedText = async (text: string): Promise<number[]> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID or ACCOUNT_ID is required");
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required");

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL_ID}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: [text] }),
    },
  );

  const payload = (await response.json()) as WorkersAiEmbeddingResponse;
  if (!response.ok || payload.success === false) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Workers AI embedding request failed: ${message || response.statusText}`);
  }

  return extractVector(payload);
};

const upsertChunk = async (chunk: IngestChunk, embedding: number[]): Promise<void> => {
  const command = `INSERT OR REPLACE INTO rag_chunk (id, type, phase, character_id, text, embedding, created_at) VALUES (${sqlString(
    contentHashId(chunk),
  )}, ${sqlString(chunk.type)}, ${sqlString(chunk.phase)}, ${sqlNullableString(
    chunk.characterId,
  )}, ${sqlString(chunk.text)}, X'${packEmbeddingHex(embedding)}', unixepoch());`;

  await execFileAsync("wrangler", ["d1", "execute", D1_DATABASE_NAME, "--local", "--command", command]);
};

const main = async (): Promise<void> => {
  const chunks = await buildChunks();
  for (const [index, chunk] of chunks.entries()) {
    const embedding = await embedText(chunk.text);
    await upsertChunk(chunk, embedding);
    console.log(`[rag:ingest] ${index + 1}/${chunks.length} upserted ${contentHashId(chunk)}`);
  }
};

await main();
