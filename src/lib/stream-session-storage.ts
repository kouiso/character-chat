export const STREAM_STORAGE_PREFIX = "stream_in_progress:";

const TEN_MIN_MS = 10 * 60 * 1000;

export interface StreamInProgressEntry {
  messageId: string;
  streamId: string;
  content: string;
  savedAt: number;
  conversationId: string;
}

const getSessionStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStreamInProgressEntry = (value: unknown): value is StreamInProgressEntry =>
  isRecord(value) &&
  typeof value.messageId === "string" &&
  typeof value.streamId === "string" &&
  typeof value.content === "string" &&
  typeof value.savedAt === "number" &&
  typeof value.conversationId === "string";

const parseStreamProgress = (raw: string): StreamInProgressEntry | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStreamInProgressEntry(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const removeStorageKey = (storage: Storage, key: string): void => {
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
};

const readStreamProgress = (storage: Storage, key: string): StreamInProgressEntry | null => {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const entry = parseStreamProgress(raw);
    if (!entry || Date.now() - entry.savedAt > TEN_MIN_MS) {
      removeStorageKey(storage, key);
      return null;
    }

    return entry;
  } catch {
    return null;
  }
};

export function saveStreamProgress(
  conversationId: string,
  entry: Omit<StreamInProgressEntry, "conversationId" | "savedAt">,
): void {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.setItem(
      STREAM_STORAGE_PREFIX + conversationId,
      JSON.stringify({ ...entry, conversationId, savedAt: Date.now() }),
    );
  } catch {
    return;
  }
}

export function clearStreamProgress(conversationId: string): void {
  const storage = getSessionStorage();
  if (!storage) return;

  removeStorageKey(storage, STREAM_STORAGE_PREFIX + conversationId);
}

export function getAllStreamProgress(): StreamInProgressEntry[] {
  const storage = getSessionStorage();
  if (!storage) return [];

  try {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key?.startsWith(STREAM_STORAGE_PREFIX) ?? false)
      .flatMap((key) => {
        const entry = readStreamProgress(storage, key);
        return entry ? [entry] : [];
      });
  } catch {
    return [];
  }
}
