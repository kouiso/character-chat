import { z } from "zod";

// 公開キャラへのリアクション API クライアント（RIT-207）。
const reactionsSchema = z.object({
  likeCount: z.number(),
  liked: z.boolean(),
  commentCount: z.number(),
  followedCharacter: z.boolean(),
  followedCreator: z.boolean(),
});
export type Reactions = z.infer<typeof reactionsSchema>;

export const commentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  body: z.string(),
  createdAt: z.number(),
  mine: z.boolean(),
});
export type CatalogComment = z.infer<typeof commentSchema>;

const catalogUrl = (characterId: string, suffix: string) =>
  `/api/catalog/${encodeURIComponent(characterId)}/${suffix}`;

export const loadReactions = async (
  characterId: string,
  signal?: AbortSignal,
): Promise<Reactions> => {
  const res = await fetch(catalogUrl(characterId, "reactions"), {
    signal: signal ?? null,
  });
  if (!res.ok) throw new Error(`リアクションの取得に失敗しました（${res.status}）`);
  return reactionsSchema.parse(await res.json());
};

export const toggleLike = async (characterId: string): Promise<Reactions["liked"]> => {
  const res = await fetch(catalogUrl(characterId, "like"), { method: "POST" });
  if (!res.ok) throw new Error(`いいねできませんでした（${res.status}）`);
  return z.object({ liked: z.boolean() }).parse(await res.json()).liked;
};

export const toggleFollow = async (
  characterId: string,
  kind: "character" | "creator",
): Promise<boolean> => {
  const res = await fetch(catalogUrl(characterId, "follow"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  if (!res.ok) throw new Error(`フォローできませんでした（${res.status}）`);
  return z.object({ following: z.boolean() }).parse(await res.json()).following;
};

export const loadComments = async (characterId: string): Promise<CatalogComment[]> => {
  const res = await fetch(catalogUrl(characterId, "comments"));
  if (!res.ok) throw new Error(`コメントの取得に失敗しました（${res.status}）`);
  return z.object({ items: z.array(commentSchema) }).parse(await res.json()).items;
};

export const postComment = async (characterId: string, body: string): Promise<void> => {
  const res = await fetch(catalogUrl(characterId, "comments"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`コメントを投稿できませんでした（${res.status}）`);
};

export const deleteComment = async (characterId: string, commentId: string): Promise<void> => {
  const res = await fetch(catalogUrl(characterId, `comments/${encodeURIComponent(commentId)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`コメントを削除できませんでした（${res.status}）`);
};
