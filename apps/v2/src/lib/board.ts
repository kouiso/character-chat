import { z } from "zod";

// 雑談広場 API クライアント（RIT-209）。
export const boardPostSchema = z.object({
  id: z.string(),
  userId: z.string(),
  body: z.string(),
  createdAt: z.number(),
  mine: z.boolean(),
});
export type BoardPost = z.infer<typeof boardPostSchema>;

const pageSchema = z.object({
  items: z.array(boardPostSchema),
  nextCursor: z.string().nullable(),
});
export type BoardPage = z.infer<typeof pageSchema>;

export const loadBoard = async (before?: string, signal?: AbortSignal): Promise<BoardPage> => {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  const res = await fetch(`/api/board${query}`, { signal: signal ?? null });
  if (!res.ok) throw new Error(`広場の取得に失敗しました（${res.status}）`);
  return pageSchema.parse(await res.json());
};

export const postToBoard = async (body: string): Promise<void> => {
  const res = await fetch("/api/board", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`投稿できませんでした（${res.status}）`);
};

export const deleteBoardPost = async (postId: string): Promise<void> => {
  const res = await fetch(`/api/board/${encodeURIComponent(postId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`削除できませんでした（${res.status}）`);
};
