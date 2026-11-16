// 記憶 API の出入り口（RIT-92）。画面はここだけを叩き、失敗は code を持つ
// MemoryRequestError で受ける（板の文で出し分けるため message は使わん）。
import { z } from "zod";

const categorySchema = z.enum(["long", "recent", "relation", "future"]);
export const memorySchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  kind: z.enum(["fact", "summary", "preference"]),
  category: categorySchema,
  content: z.string(),
  pinned: z.boolean(),
  origin: z.enum(["extracted", "manual"]),
  editedAt: z.number().nullable(),
  createdAt: z.number(),
  supersededBy: z.string().nullable(),
  usedInLastReply: z.boolean(),
  revision: z.number().int().min(1),
});
export type Memory = z.infer<typeof memorySchema>;
export type MemoryCategory = z.infer<typeof categorySchema>;

const listSchema = z.object({
  conversationId: z.string().nullable(),
  characterName: z.string(),
  memories: z.array(memorySchema),
});
export type MemoryList = z.infer<typeof listSchema>;

const memoryResultSchema = z.object({ memory: memorySchema });
const learnedSchema = z.object({
  state: z.enum(["pending", "done", "failed", "none"]),
  memories: z.array(z.object({ id: z.string(), content: z.string() })),
});
export type LearnedResult = z.infer<typeof learnedSchema>;

export class MemoryRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly currentRevision: number | null;

  constructor(status: number, code: string | null, currentRevision: number | null = null) {
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
    this.code = code;
    this.currentRevision = currentRevision;
    this.name = "MemoryRequestError";
  }
}

// 失敗の体は { code, message }（または revision_conflict の { code, currentRevision }）。
const readErrorDetail = async (
  response: Response,
): Promise<{ code: string | null; currentRevision: number | null }> => {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const code = (body as { code?: unknown }).code;
      const revision = (body as { currentRevision?: unknown }).currentRevision;
      return {
        code: typeof code === "string" ? code : null,
        currentRevision: typeof revision === "number" ? revision : null,
      };
    }
    return { code: null, currentRevision: null };
  } catch {
    return { code: null, currentRevision: null };
  }
};

const endpoint = (characterId: string, suffix = "") =>
  `/api/characters/${encodeURIComponent(characterId)}/memories${suffix}`;

const requestMemory = async <T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new MemoryRequestError(response.status, detail.code, detail.currentRevision);
  }
  return schema.parse(await response.json());
};

export const listMemories = (
  characterId: string,
  conversationId?: string | null,
): Promise<MemoryList> =>
  requestMemory(
    `${endpoint(characterId)}${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ""}`,
    listSchema,
  );

export const addMemory = (
  characterId: string,
  input: {
    conversationId?: string | null;
    content: string;
    category: MemoryCategory;
    kind?: "fact" | "preference";
  },
): Promise<Memory> =>
  requestMemory(endpoint(characterId), memoryResultSchema, {
    method: "POST",
    body: JSON.stringify({ kind: "fact", ...input }),
  }).then((result) => result.memory);

export const updateMemory = (
  characterId: string,
  input: {
    memoryId: string;
    expectedRevision: number;
    content?: string;
    category?: MemoryCategory;
    pinned?: boolean;
  },
): Promise<Memory> =>
  requestMemory(endpoint(characterId), memoryResultSchema, {
    method: "PATCH",
    body: JSON.stringify(input),
  }).then((result) => result.memory);

export const removeMemory = async (characterId: string, memoryId: string): Promise<void> => {
  await requestMemory(endpoint(characterId), z.object({ ok: z.literal(true) }), {
    method: "DELETE",
    body: JSON.stringify({ memoryId }),
  });
};

export const restoreMemory = (characterId: string, memoryId: string): Promise<Memory> =>
  requestMemory(endpoint(characterId, "/restore"), memoryResultSchema, {
    method: "POST",
    body: JSON.stringify({ memoryId }),
  }).then((result) => result.memory);

export const fetchLearnedMemories = (
  characterId: string,
  conversationId: string,
  turn: number,
): Promise<LearnedResult> =>
  requestMemory(
    `${endpoint(characterId, "/learned")}?conversationId=${encodeURIComponent(conversationId)}&turn=${turn}`,
    learnedSchema,
  );
