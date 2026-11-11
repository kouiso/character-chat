import { afterEach, describe, expect, it, vi } from "vitest";

import { listSceneBookmarks } from "@/lib/api";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const bookmarkJson = {
  id: "bm-1",
  conversationId: "conv-1",
  messageId: "msg-1",
  title: "旅館の縁側で",
  snippet: "「ここ、静かでいいね」",
  characterName: "燈子",
  characterId: "char-1",
  createdAt: 1769641600000,
};

describe("listSceneBookmarks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("サーバの複合文字列カーソルを parse し、次ページの cursor クエリへそのまま載せる", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [bookmarkJson], nextCursor: "1794372273722|bm-seed-049" }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await listSceneBookmarks({ limit: 50 });
    expect(first.nextCursor).toBe("1794372273722|bm-seed-049");

    const second = await listSceneBookmarks({ limit: 50, cursor: first.nextCursor! });
    expect(second.items).toEqual([]);
    expect(second.nextCursor).toBeNull();

    const url = new URL(String(fetchMock.mock.calls[1]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/scene-bookmarks");
    expect(url.searchParams.get("cursor")).toBe("1794372273722|bm-seed-049");
    expect(url.searchParams.get("limit")).toBe("50");
  });
});
