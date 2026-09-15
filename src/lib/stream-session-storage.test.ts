import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearStreamProgress,
  getAllStreamProgress,
  saveStreamProgress,
  STREAM_STORAGE_PREFIX,
} from "./stream-session-storage";

const entry = {
  messageId: "message-1",
  streamId: "stream-1",
  content: "hello",
};

describe("stream-session-storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("進行中 stream を保存して一覧で復元する", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    saveStreamProgress("conversation-1", entry);

    expect(getAllStreamProgress()).toEqual([
      {
        ...entry,
        conversationId: "conversation-1",
        savedAt: 1000,
      },
    ]);
  });

  it("clearStreamProgress は対象 conversation の保存値だけ削除する", () => {
    saveStreamProgress("conversation-1", entry);
    saveStreamProgress("conversation-2", { ...entry, messageId: "message-2" });

    clearStreamProgress("conversation-1");

    expect(getAllStreamProgress()).toEqual([
      expect.objectContaining({ conversationId: "conversation-2", messageId: "message-2" }),
    ]);
  });

  it("期限切れと壊れた値は復元しない", () => {
    vi.spyOn(Date, "now").mockReturnValue(20 * 60 * 1000);
    sessionStorage.setItem(
      `${STREAM_STORAGE_PREFIX}old`,
      JSON.stringify({ ...entry, conversationId: "old", savedAt: 1 }),
    );
    sessionStorage.setItem(`${STREAM_STORAGE_PREFIX}broken`, "{broken");
    sessionStorage.setItem("unrelated", "ignored");

    expect(getAllStreamProgress()).toEqual([]);
    expect(sessionStorage.getItem(`${STREAM_STORAGE_PREFIX}old`)).toBeNull();
    expect(sessionStorage.getItem(`${STREAM_STORAGE_PREFIX}broken`)).toBeNull();
  });

  it("sessionStorage 例外時は no-op にする", () => {
    const originalSessionStorage = window.sessionStorage;
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    expect(() => saveStreamProgress("conversation-1", entry)).not.toThrow();
    expect(() => clearStreamProgress("conversation-1")).not.toThrow();
    expect(getAllStreamProgress()).toEqual([]);

    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
  });
});
