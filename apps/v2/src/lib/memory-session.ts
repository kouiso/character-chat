import {
  memoryDeletedResponseSchema,
  memoryListResponseSchema,
  memoryOneResponseSchema,
  type MemoryChange,
  type MemoryDelete,
  type NewMemory,
} from "@v2/db/memory-contract";

export class MemoryRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "MemoryRequestError";
  }
}

export const memoryRequest = async (
  characterId: string,
  conversationId: string,
  method: string,
  body?: NewMemory | MemoryChange | MemoryDelete,
) => {
  const response = await fetch(
    `/api/memory/${encodeURIComponent(characterId)}?${new URLSearchParams({ conversationId })}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (!response.ok)
    throw new MemoryRequestError(
      response.status,
      response.status === 409
        ? "別の画面で変更されています。入力は残っています。最新の内容を読み直してください。"
        : "処理できませんでした。入力は残っています。再試行してください。",
    );
  const payload: unknown = await response.json();
  if (method === "GET") return memoryListResponseSchema.parse(payload).memories;
  if (method === "DELETE") {
    memoryDeletedResponseSchema.parse(payload);
    return [];
  }
  return [memoryOneResponseSchema.parse(payload).memory];
};
