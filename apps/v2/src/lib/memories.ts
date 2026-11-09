import { z } from "zod";

export const memorySchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  kind: z.enum(["fact", "summary", "preference"]),
  content: z.string(),
  pinned: z.boolean(),
  sourceTurn: z.number().nullable(),
  createdAt: z.number(),
});
export type Memory = z.infer<typeof memorySchema>;

const memoriesSchema = z.object({ memories: z.array(memorySchema) });
const memoryResultSchema = z.object({ memory: memorySchema });

export class MemoryRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(
      status === 404
        ? "記憶が見つかりません。別の画面で消えた可能性があります。"
        : status === 409
          ? "会話が始まってから記憶を追加できます。"
          : status === 422
            ? "入力内容を確認してください。"
            : "保存先に接続できませんでした。再試行してください。",
    );
    this.status = status;
    this.name = "MemoryRequestError";
  }
}

const requestMemory = async <T>(
  characterId: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}/memories`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) throw new MemoryRequestError(response.status);
  return schema.parse(await response.json());
};

export const listMemories = (characterId: string): Promise<Memory[]> =>
  requestMemory(characterId, memoriesSchema).then((result) => result.memories);

export const addMemory = (
  characterId: string,
  input: { content: string; kind: "fact" | "preference" },
): Promise<Memory> =>
  requestMemory(characterId, memoryResultSchema, {
    method: "POST",
    body: JSON.stringify(input),
  }).then((result) => result.memory);

export const updateMemory = (
  characterId: string,
  memoryId: string,
  input: { content?: string; pinned?: boolean },
): Promise<Memory> =>
  requestMemory(characterId, memoryResultSchema, {
    method: "PATCH",
    body: JSON.stringify({ memoryId, ...input }),
  }).then((result) => result.memory);

export const removeMemory = async (characterId: string, memoryId: string): Promise<void> => {
  await requestMemory(characterId, z.object({ ok: z.literal(true) }), {
    method: "DELETE",
    body: JSON.stringify({ memoryId }),
  });
};
