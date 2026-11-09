import { z } from "zod";

// POST /api/chat/:id/suggest — 次の発話候補（RIT-203）。
const suggestSchema = z.object({
  suggestions: z.array(z.string()),
});

export const fetchSuggestions = async (
  characterId: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<string[]> => {
  const res = await fetch(`/api/chat/${encodeURIComponent(characterId)}/suggest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId }),
    signal: signal ?? null,
  });
  if (!res.ok) throw new Error(`発話候補の取得に失敗しました（${res.status}）`);
  return suggestSchema.parse(await res.json()).suggestions;
};
