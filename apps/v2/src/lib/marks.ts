import { z } from "zod";

// /api/chat/:id/marks — メッセージへの印（RIT-204）。
const markSchema = z.object({
  messageId: z.string(),
  kind: z.enum(["bookmark", "feedback"]),
  value: z.number(),
});
export type MessageMark = z.infer<typeof markSchema>;

const listResponseSchema = z.object({
  marks: z.array(markSchema),
  bookmarks: z
    .array(z.object({ messageId: z.string(), turn: z.number(), excerpt: z.string() }))
    .optional(),
});
export type BookmarkItem = { messageId: string; turn: number; excerpt: string };

const marksUrl = (characterId: string) => `/api/chat/${encodeURIComponent(characterId)}/marks`;

export const loadMarks = async (
  characterId: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<MessageMark[]> => {
  const res = await fetch(
    `${marksUrl(characterId)}?conversationId=${encodeURIComponent(conversationId)}`,
    { signal: signal ?? null },
  );
  if (!res.ok) throw new Error(`印の取得に失敗しました（${res.status}）`);
  return listResponseSchema.parse(await res.json()).marks;
};

export const loadBookmarkItems = async (
  characterId: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<BookmarkItem[]> => {
  const res = await fetch(
    `${marksUrl(characterId)}?conversationId=${encodeURIComponent(conversationId)}&detail=bookmark`,
    { signal: signal ?? null },
  );
  if (!res.ok) throw new Error(`ブックマークの取得に失敗しました（${res.status}）`);
  return listResponseSchema.parse(await res.json()).bookmarks ?? [];
};

export const toggleMark = async (
  characterId: string,
  body: {
    conversationId: string;
    messageId: string;
    kind: "bookmark" | "feedback";
    value?: 1 | -1;
  },
): Promise<MessageMark[]> => {
  const res = await fetch(marksUrl(characterId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`印の更新に失敗しました（${res.status}）`);
  return listResponseSchema.parse(await res.json()).marks;
};
