import { z } from "zod/v4";

import { createSceneBookmark } from "@/lib/api";

const SOLO_BOOKMARKS_KEY = "solo-scene-bookmarks";

const hashStorageNamespace = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
};

const CURRENT_NAMESPACE = hashStorageNamespace("local");
const MIGRATED_FLAG_KEY = `${SOLO_BOOKMARKS_KEY}-migrated:${CURRENT_NAMESPACE}`;
const MIGRATION_BATCH_SIZE = 5;

const storedBookmarkSchema = z.object({
  id: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  snippet: z.string().max(500),
  characterName: z.string().max(80),
  characterId: z.string().min(1).max(128).nullable().optional(),
});

type StoredBookmark = z.infer<typeof storedBookmarkSchema>;

const getBookmarkStorageKeys = (): string[] => {
  const keys = new Set<string>([SOLO_BOOKMARKS_KEY]);
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === SOLO_BOOKMARKS_KEY || key?.startsWith(`${SOLO_BOOKMARKS_KEY}:`)) {
      keys.add(key);
    }
  }
  return [...keys].filter((key) => localStorage.getItem(key) !== null);
};

const parseStoredBookmarks = (raw: string): { bookmarks: StoredBookmark[]; skipped: number } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { bookmarks: [], skipped: 1 };
  }
  if (!Array.isArray(parsed)) return { bookmarks: [], skipped: 1 };

  const bookmarks: StoredBookmark[] = [];
  let skipped = 0;
  for (const item of parsed) {
    const bookmark = storedBookmarkSchema.safeParse(item);
    if (bookmark.success) {
      bookmarks.push(bookmark.data);
    } else {
      skipped += 1;
    }
  }
  return { bookmarks, skipped };
};

const postStoredBookmark = async (bookmark: StoredBookmark): Promise<void> => {
  const { characterId, ...input } = bookmark;
  await createSceneBookmark({
    ...input,
    ...(characterId ? { characterId } : {}),
  });
};

export const migrateLocalStorageBookmarksOnce = async (): Promise<{
  migrated: number;
  skipped: number;
}> => {
  if (typeof localStorage === "undefined") return { migrated: 0, skipped: 0 };
  if (localStorage.getItem(MIGRATED_FLAG_KEY) === "1") return { migrated: 0, skipped: 0 };

  const keys = getBookmarkStorageKeys();
  let migrated = 0;
  let skipped = 0;
  const bookmarksToMigrate: StoredBookmark[] = [];

  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const parsed = parseStoredBookmarks(raw);
    skipped += parsed.skipped;
    bookmarksToMigrate.push(...parsed.bookmarks);
  }

  for (let index = 0; index < bookmarksToMigrate.length; index += MIGRATION_BATCH_SIZE) {
    const batch = bookmarksToMigrate.slice(index, index + MIGRATION_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(postStoredBookmark));
    for (const result of results) {
      if (result.status === "fulfilled") {
        migrated += 1;
      } else {
        return { migrated, skipped };
      }
    }
  }

  for (const key of keys) {
    localStorage.removeItem(key);
  }
  localStorage.setItem(MIGRATED_FLAG_KEY, "1");
  return { migrated, skipped };
};
