import { hashMemorySource, type ExtractionScope } from "@v2/db";
import { z } from "zod";

export const MEMORY_EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const MEMORY_VECTOR_DIMENSIONS = 1024;

export type MemoryVectorBindings = {
  V2_RAG_ENABLED?: string;
  AI?: Pick<Ai, "run">;
  MEMORY_INDEX?: Pick<VectorizeIndex, "upsert" | "query">;
};

export const memoryVectorReady = (
  env: MemoryVectorBindings,
): env is MemoryVectorBindings & {
  AI: Pick<Ai, "run">;
  MEMORY_INDEX: Pick<VectorizeIndex, "upsert" | "query">;
} => env.V2_RAG_ENABLED === "1" && Boolean(env.AI && env.MEMORY_INDEX);

const vectorSchema = z
  .array(z.number().finite())
  .length(MEMORY_VECTOR_DIMENSIONS)
  .refine(
    (values) => values.some((value) => Math.fround(value) !== 0),
    "空の埋め込みは使えません。",
  )
  .refine(
    (values) => values.every((value) => Number.isFinite(Math.fround(value))),
    "埋め込みが範囲外です。",
  );

export const validateMemoryVector = (value: unknown): number[] => vectorSchema.parse(value);

export const embedMemoryText = async (ai: Pick<Ai, "run">, text: string): Promise<number[]> => {
  const result = await ai.run(MEMORY_EMBEDDING_MODEL, { text: [text], truncate_inputs: false });
  const parsed = z.object({ data: z.array(z.unknown()).length(1) }).parse(result);
  return validateMemoryVector(parsed.data[0]);
};

export const memoryNamespace = (scope: Pick<ExtractionScope, "userId" | "characterId">) =>
  hashMemorySource(JSON.stringify([scope.userId, scope.characterId]));

export const memoryVectorId = (id: string, hash: string) =>
  hashMemorySource(JSON.stringify([id, hash]));
