import { beforeEach, describe, expect, it, vi } from "vitest";

import { migrateLocalStorageBookmarksOnce } from "@/lib/scene-bookmark-migration";

const migrationFlagKey = "solo-scene-bookmarks-migrated:1perfv";

const createdBookmark = () => ({
  id: "bookmark-1",
  conversationId: "conversation-1",
  messageId: "message-1",
  title: "場面 1",
  snippet: "本文",
  characterName: "葵",
  characterId: null,
  createdAt: 1,
});

describe("migrateLocalStorageBookmarksOnce", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("posts stored bookmarks with their original ids and marks migration complete", async () => {
    localStorage.setItem(
      "solo-scene-bookmarks:1perfv",
      JSON.stringify([
        {
          id: "bookmark-1",
          conversationId: "conversation-1",
          messageId: "message-1",
          title: "場面 1",
          snippet: "本文",
          characterName: "葵",
          createdAt: 1,
        },
      ]),
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ bookmark: createdBookmark() })));

    await expect(migrateLocalStorageBookmarksOnce()).resolves.toEqual({ migrated: 1, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scene-bookmarks",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"id":"bookmark-1"'),
      }),
    );
    expect(localStorage.getItem("solo-scene-bookmarks:1perfv")).toBeNull();
    expect(localStorage.getItem(migrationFlagKey)).toBe("1");
  });

  it("does not re-import after the migration flag is set", async () => {
    localStorage.setItem(migrationFlagKey, "1");
    localStorage.setItem(
      "solo-scene-bookmarks:1perfv",
      JSON.stringify([
        {
          id: "bookmark-1",
          conversationId: "conversation-1",
          messageId: "message-1",
          title: "場面 1",
          snippet: "本文",
          characterName: "葵",
          createdAt: 1,
        },
      ]),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(migrateLocalStorageBookmarksOnce()).resolves.toEqual({ migrated: 0, skipped: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("solo-scene-bookmarks:1perfv")).not.toBeNull();
  });

  it("keeps localStorage and leaves the flag unset when a post fails", async () => {
    localStorage.setItem(
      "solo-scene-bookmarks",
      JSON.stringify([
        {
          id: "bookmark-1",
          conversationId: "conversation-1",
          messageId: "message-1",
          title: "場面 1",
          snippet: "本文",
          characterName: "葵",
          createdAt: 1,
        },
      ]),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    await expect(migrateLocalStorageBookmarksOnce()).resolves.toEqual({ migrated: 0, skipped: 0 });
    expect(localStorage.getItem("solo-scene-bookmarks")).not.toBeNull();
    expect(localStorage.getItem(migrationFlagKey)).toBeNull();
  });
});
