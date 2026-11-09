import { z } from "zod";

// 公開カタログ API クライアント（RIT-206）。
export const catalogItemSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  greeting: z.string(),
  summary: z.string().nullable(),
  authorUserId: z.string(),
  publishedAt: z.number(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

const publishUrl = (characterId: string) =>
  `/api/characters/${encodeURIComponent(characterId)}/publish`;

export const readPublishStatus = async (
  characterId: string,
  signal?: AbortSignal,
): Promise<{ published: boolean; summary: string | null }> => {
  const res = await fetch(publishUrl(characterId), { signal: signal ?? null });
  if (!res.ok) throw new Error(`公開状態の取得に失敗しました（${res.status}）`);
  return z
    .object({ published: z.boolean(), summary: z.string().nullable() })
    .parse(await res.json());
};

export const setPublished = async (characterId: string, summary?: string): Promise<void> => {
  const res = await fetch(publishUrl(characterId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(summary === undefined ? {} : { summary }),
  });
  if (!res.ok) throw new Error(`公開できませんでした（${res.status}）`);
};

export const unsetPublished = async (characterId: string): Promise<void> => {
  const res = await fetch(publishUrl(characterId), { method: "DELETE" });
  if (!res.ok) throw new Error(`非公開にできませんでした（${res.status}）`);
};

export const loadCatalog = async (signal?: AbortSignal): Promise<CatalogItem[]> => {
  const res = await fetch("/api/catalog", { signal: signal ?? null });
  if (!res.ok) throw new Error(`公開一覧の取得に失敗しました（${res.status}）`);
  return z.object({ items: z.array(catalogItemSchema) }).parse(await res.json()).items;
};

export const forkCatalogItem = async (characterId: string): Promise<{ id: string }> => {
  const res = await fetch(`/api/catalog/${encodeURIComponent(characterId)}/fork`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`フォークに失敗しました（${res.status}）`);
  return z.object({ id: z.string() }).parse(await res.json());
};
