import type { ReactNode } from "react";

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { queryKey } from "@/lib/query-key";

import { useChatQuery } from "./use-chat-query";

// 既定値（queries.retry: 1 / mutations.networkMode: "online"）そのものを検証したいので、
// 本番の queryClient をそのまま使う。テスト用に作り直すと検証対象が消える。
// MessageAlreadyDeletedError は本物を使うため、差し替えるのは通信する関数だけにする。
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    listConversations: vi.fn(async () => []),
    listConversationMessages: vi.fn(async () => []),
    createConversationMessage: vi.fn(async () => undefined),
    deleteConversationMessage: vi.fn(async () => undefined),
  };
});

const listConversationMessages = vi.mocked(api.listConversationMessages);
const createConversationMessage = vi.mocked(api.createConversationMessage);
const deleteConversationMessage = vi.mocked(api.deleteConversationMessage);

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const mountHook = () => renderHook(() => useChatQuery(null), { wrapper }).result;

describe("useChatQuery", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("loadMessages", () => {
    // 上限つきの読みに既定の retry: 1 が乗ると、timeoutMs はリクエスト1本ごとの
    // 上限になる。10 秒を渡したつもりが最悪 20 秒待つ＝建て直しが倍かかる。
    it("does not retry the bounded reconciliation read", async () => {
      listConversationMessages.mockRejectedValue(new Error("boom"));
      const result = mountHook();

      await expect(
        result.current.loadMessages("conv-bounded", { timeoutMs: 10_000, fresh: true }),
      ).rejects.toThrow("boom");

      expect(listConversationMessages).toHaveBeenCalledTimes(1);
    });

    it("keeps the default retry for ordinary history loading", async () => {
      listConversationMessages.mockRejectedValue(new Error("boom"));
      const result = mountHook();

      await expect(result.current.loadMessages("conv-plain")).rejects.toThrow("boom");

      expect(listConversationMessages).toHaveBeenCalledTimes(2);
    });

    // fetchQuery は同じキーの取得が走っていればその promise を返す（重複除去）。
    // 建て直しがそこへ相乗りすると、上限なしの履歴読み込みが返るまで待たされる。
    // 上限を渡したのに永久に返らない＝ #993 の永久ロックがそのまま残る。
    it("does not join an in-flight unbounded history load", async () => {
      const rows: never[] = [];
      listConversationMessages
        .mockImplementationOnce(() => new Promise<never>(() => undefined))
        .mockImplementationOnce(async () => rows);
      const result = mountHook();

      // 上限なしの履歴読み込みを先に走らせて、同じキーの取得を in-flight にする。
      void result.current.loadMessages("conv-shared").catch(() => undefined);
      await Promise.resolve();

      await expect(
        result.current.loadMessages("conv-shared", { timeoutMs: 10_000, fresh: true }),
      ).resolves.toEqual([]);

      // 相乗りしていれば 1 回のまま。2 回目が出ている＝自分で取りに行った証拠。
      expect(listConversationMessages).toHaveBeenCalledTimes(2);
      // 取った結果はキャッシュへ書き戻す。後続の読みが古い状態を見ないため。
      expect(queryClient.getQueryData(queryKey.conversationMessageList("conv-shared"))).toEqual(
        rows,
      );
    });

    // codex P2: cancelQueries を挟まないと、こちらが setQueryData した後に
    // 先行していた上限なしの読みが遅れて届いた時、react-query が取得完了のたびに
    // キャッシュへ自動で書き込む仕組みのせいで、そのターンが確定する前に撮った
    // 古い行がこちらの結果を上書きする。cancelQueries でその古い取得を打ち切ってから
    // setQueryData するので、後から届いても react-query 側でコミットされない。
    it("does not let a stale in-flight history load overwrite the reconciled cache", async () => {
      let resolveStale: ((rows: never[]) => void) | undefined;
      const freshRows: never[] = [];
      listConversationMessages
        .mockImplementationOnce(
          () =>
            new Promise<never[]>((resolve) => {
              resolveStale = resolve;
            }),
        )
        .mockImplementationOnce(async () => freshRows);
      const result = mountHook();

      // 上限なしの履歴読み込みを先に走らせて in-flight にする(まだ解決しない)。
      void result.current.loadMessages("conv-race").catch(() => undefined);
      await Promise.resolve();

      // 建て直し側が先に確定してキャッシュへ書く。
      await expect(
        result.current.loadMessages("conv-race", { timeoutMs: 10_000, fresh: true }),
      ).resolves.toEqual(freshRows);
      expect(queryClient.getQueryData(queryKey.conversationMessageList("conv-race"))).toEqual(
        freshRows,
      );

      // 遅れて古い読みが解決する。cancelQueries で打ち切っていなければ、この
      // resolve が最後に走った取得としてキャッシュを古い行で上書きする。
      const staleRows = [{ id: "stale" }] as never[];
      resolveStale?.(staleRows);
      await Promise.resolve();
      await Promise.resolve();

      expect(queryClient.getQueryData(queryKey.conversationMessageList("conv-race"))).toEqual(
        freshRows,
      );
    });
  });

  // 呼び出し元(restoreConversation 等)は loadMessages(convId) を await して
  // そのまま setMessages する。cancelQueries で打ち切った側の呼び出しが例外を
  // 投げると、その呼び出し元が想定してへんエラーで壊れる。
  it("does not reject the caller whose in-flight read gets cancelled", async () => {
    let resolveStale: (() => void) | undefined;
    listConversationMessages
      .mockImplementationOnce(
        () =>
          new Promise<never[]>((resolve) => {
            resolveStale = () => resolve([]);
          }),
      )
      .mockImplementationOnce(async () => []);
    const result = mountHook();

    const staleCall = result.current.loadMessages("conv-cancel-probe");
    await Promise.resolve();

    await result.current.loadMessages("conv-cancel-probe", { timeoutMs: 10_000, fresh: true });

    resolveStale?.();
    await expect(staleCall).resolves.toBeDefined();
  });

  describe("deleteMessageEntry", () => {
    // 既定の mutations.retry: 1 で、1回目の DELETE が commit した後に応答だけが
    // 期限切れになると、自動再送は「もう無い行」に対して 404 を受ける。
    // 行は消えとる＝取り消しは成功しとるので、失敗として投げたらあかん。
    it("treats a 404 as an already-completed rollback", async () => {
      deleteConversationMessage.mockRejectedValue(new api.MessageAlreadyDeletedError("msg-1"));
      const result = mountHook();

      await expect(result.current.deleteMessageEntry("conv-1", "msg-1")).resolves.toBeUndefined();
    });

    it("still fails when the delete really could not complete", async () => {
      deleteConversationMessage.mockRejectedValue(new Error("delete message failed: 500"));
      const result = mountHook();

      await expect(result.current.deleteMessageEntry("conv-1", "msg-1")).rejects.toThrow(
        "delete message failed: 500",
      );
    });
  });

  describe("createMessageEntry", () => {
    // networkMode: "online" の mutation は接続が落ちると失敗せず一時停止する。
    // 永続化とその入れ直しは送信ロック解除の手前に居るため、返らなければ
    // 入力欄が永久に disabled で残る。必ず期限で落ちること。
    it("gives up instead of waiting forever when the mutation never settles", async () => {
      vi.useFakeTimers();
      createConversationMessage.mockImplementation(() => new Promise<void>(() => undefined));
      const result = mountHook();

      const pending = result.current.createMessageEntry({
        conversationId: "conv-1",
        id: "msg-1",
        role: "user",
        content: "ん",
      });
      const settled = expect(pending).rejects.toThrow(/timed out/);

      await vi.advanceTimersByTimeAsync(30_000);
      await settled;
    });

    // 待つのをやめるだけでは、一時停止した mutation が待ち行列に残る。再接続で走って
    // 行を書くため、既に「書かれてない」として揃え直したターンの行が後から生える。
    // react-query に一時停止中の取り消し API は無いので、signal を先に落として
    // 再開時の fetch が即失敗するようにする。
    it("cancels the write instead of leaving it queued when the deadline fires", async () => {
      vi.useFakeTimers();
      let received: AbortSignal | undefined;
      createConversationMessage.mockImplementation((input) => {
        received = input.signal;
        return new Promise<void>(() => undefined);
      });
      const result = mountHook();

      const pending = result.current.createMessageEntry({
        conversationId: "conv-1",
        id: "msg-1",
        role: "user",
        content: "ん",
      });
      const settled = expect(pending).rejects.toThrow(/timed out/);

      // mutationFn は次のマイクロタスクで走る。期限はまだ来ていない＝中断もされていない。
      await vi.advanceTimersByTimeAsync(0);
      expect(received).toBeInstanceOf(AbortSignal);
      expect(received?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(30_000);
      await settled;

      expect(received?.aborted).toBe(true);
    });
  });
});
