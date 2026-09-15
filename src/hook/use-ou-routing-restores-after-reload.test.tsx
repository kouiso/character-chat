import { useRef } from "react";

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRoute } from "@/lib/app-route";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

import { useOuRouting } from "./use-ou-routing";

const CHARACTER_ID = "char-1";
const CONV_ID = "conv-alive";

const useHarness = ({
  path,
  restoreConversation,
}: {
  path: string;
  restoreConversation: (conversationId: string) => Promise<void>;
}) => {
  const restorePendingRef = useRef(false);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  return useOuRouting({
    route: parseRoute(path),
    characters: [],
    charactersReady: true,
    activeCharId: CHARACTER_ID,
    currentConversationId,
    restorePendingRef,
    restoreConversation: (id: string) => restoreConversation(id),
  });
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  useChatStore.setState({ currentConversationId: null, messages: [] });
  useSettingsStore.setState({ activeCharacterId: CHARACTER_ID });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("リロード再現", () => {
  it("localStorage から currentConversationId が復活した状態でも履歴を取りに行く", async () => {
    // リロード直後の store の姿。persist の partialize は
    // currentConversationId だけを残し、messages は残さん。
    useChatStore.setState({ currentConversationId: CONV_ID, messages: [] });

    const restoreConversation = vi.fn(async () => undefined);
    const path = `/chat/${CHARACTER_ID}?conv=${CONV_ID}`;
    window.history.replaceState(null, "", path);

    await act(async () => {
      renderHook(() => useHarness({ path, restoreConversation }));
      await Promise.resolve();
    });

    expect(restoreConversation).toHaveBeenCalledWith(CONV_ID);
  });
});
