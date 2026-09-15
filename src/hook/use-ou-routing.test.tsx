import { useRef } from "react";

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRoute } from "@/lib/app-route";
import { getRoutePath } from "@/lib/navigation";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

import { useOuRouting } from "./use-ou-routing";

const CHARACTER_ID = "char-1";
const DEAD_CONVERSATION_ID = "conv-dead";
const FRESH_CONVERSATION_ID = "conv-fresh";

interface HarnessInput {
  path: string;
  restoreConversation: (conversationId: string) => Promise<void>;
}

// 本番の呼び出し元(ou-app)と同じ形で hook を回す。restorePendingRef は
// restoreConversation の内側で立てて落とすので、ここでも hook 側へ ref だけ渡す。
const useHarness = ({ path, restoreConversation }: HarnessInput) => {
  const restorePendingRef = useRef(false);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  return useOuRouting({
    route: parseRoute(path),
    characters: [],
    charactersReady: true,
    activeCharId: CHARACTER_ID,
    currentConversationId,
    restorePendingRef,
    restoreConversation: (conversationId: string) => restoreConversation(conversationId),
  });
};

// hook は route（App が parseRoute した結果）と window.location の両方を読むので、
// 実際のリロードと同じく先に URL を置いてから描画する。
const renderRouting = (input: HarnessInput) => {
  window.history.replaceState(null, "", input.path);
  return renderHook(() => useHarness(input));
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  useChatStore.setState({ currentConversationId: null, messages: [] });
  useSettingsStore.setState({ activeCharacterId: CHARACTER_ID });
});

// vitest の globals を切っとるので RTL の自動 cleanup が効かん。畳まんと前のテストの
// hook が生き残り、store を触った瞬間にそいつの URL 書き戻しが走る。
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useOuRouting の ?conv= 書き戻し", () => {
  // 引っ張って更新すると新規セッション画面に飛ばされる(局長 2026-08-17, Android 実機)。
  // 復元が落ちると ou-app の handleHistoryLoadFailure が会話 id を手放すため、
  // store は null・URL は死んだ ?conv= のまま固定されとった。URL が嘘のままやと
  // 次のリロードでも同じ復元が落ちて、同じ空のトーク画面に戻り続ける。
  it("復元が落ちた後は死んだ ?conv= を URL から落とす", async () => {
    const restoreConversation = vi.fn(async (conversationId: string) => {
      await Promise.resolve();
      // handleHistoryLoadFailure の 404 経路と同じ後始末。
      if (useChatStore.getState().currentConversationId === conversationId) {
        useChatStore.getState().setConversationId(null);
      }
    });

    await act(async () => {
      renderRouting({
        path: `/chat/${CHARACTER_ID}?conv=${DEAD_CONVERSATION_ID}`,
        restoreConversation,
      });
    });

    expect(restoreConversation).toHaveBeenCalledWith(DEAD_CONVERSATION_ID);
    expect(getRoutePath()).toBe(`/chat/${CHARACTER_ID}`);
  });

  // 死んだ ?conv= が残ると、その後に始めた会話の id を URL へ書けん。
  // 送り直して新しい会話がでけても、リロードは死んだ会話を復元しにいく。
  it("復元が落ちた後に始めた会話を URL へ書ける", async () => {
    const restoreConversation = vi.fn(async () => {
      await Promise.resolve();
      useChatStore.getState().setConversationId(null);
    });

    await act(async () => {
      renderRouting({
        path: `/chat/${CHARACTER_ID}?conv=${DEAD_CONVERSATION_ID}`,
        restoreConversation,
      });
    });

    await act(async () => {
      useChatStore.getState().setConversationId(FRESH_CONVERSATION_ID);
    });

    expect(getRoutePath()).toBe(`/chat/${CHARACTER_ID}?conv=${FRESH_CONVERSATION_ID}`);
  });

  // 元の early return が守っとった性質。復元が決着する前に書き戻すと、
  // 永続化されとった別会話の id で URL の ?conv= を潰してまう。
  it("復元の決着前は永続化された別会話で ?conv= を潰さない", () => {
    useChatStore.setState({ currentConversationId: "conv-persisted" });
    const restoreConversation = vi.fn(() => new Promise<void>(() => undefined));

    renderRouting({
      path: `/chat/${CHARACTER_ID}?conv=${DEAD_CONVERSATION_ID}`,
      restoreConversation,
    });

    expect(getRoutePath()).toBe(`/chat/${CHARACTER_ID}?conv=${DEAD_CONVERSATION_ID}`);
  });

  // 復元が成功した時は URL をそのまま保つ。ここが崩れると、リロードのたびに
  // 開いとった会話が URL から消える。
  it("復元が成功したら ?conv= を保つ", async () => {
    const restoreConversation = vi.fn(async (conversationId: string) => {
      await Promise.resolve();
      useChatStore.getState().setConversationId(conversationId);
    });

    await act(async () => {
      renderRouting({
        path: `/chat/${CHARACTER_ID}?conv=${FRESH_CONVERSATION_ID}`,
        restoreConversation,
      });
    });

    expect(getRoutePath()).toBe(`/chat/${CHARACTER_ID}?conv=${FRESH_CONVERSATION_ID}`);
  });
});

// 局長報告 2026-08-18:「新しい会話を始めようとしたら前の会話に今回の会話が追加される」。
// openNewConversation は在ったのに呼ぶ側が 0 件で、同じ子と最初から話し直す道が
// 画面に無かった。さらに URL から ?conv= を落とすだけでは、書き戻し effect が
// store の currentConversationId を無条件で ?conv= へ書くので一瞬で戻ってまう。
describe("同じ子と、はじめから話す", () => {
  it("会話 id と本文を手放してから開く", () => {
    useChatStore.setState({
      currentConversationId: FRESH_CONVERSATION_ID,
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "前の会話の本文",
          createdAt: 1,
          conversationId: FRESH_CONVERSATION_ID,
        },
      ],
    });

    const { result } = renderRouting({
      path: `/chat?characterId=${CHARACTER_ID}&conv=${FRESH_CONVERSATION_ID}`,
      restoreConversation: vi.fn(async () => undefined),
    });

    act(() => {
      result.current.openNewConversation();
    });

    expect(useChatStore.getState().currentConversationId).toBeNull();
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(getRoutePath()).not.toContain("conv=");
  });
});
