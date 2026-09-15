import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiResponseError,
  classifyApiError,
  createConversationShare,
  extractMemoryNotes,
  listConversationMessages,
  QUOTA_EXCEEDED_EVENT,
  shouldShowCharacterListError,
  streamChatWithQualityGuard,
} from "./api";

import type { ChatStreamResult } from "./api";

const streamFromSse = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
};

const emptyDoneResponse = (): Response => new Response(streamFromSse(["data: [DONE]\n\n"]));

const chatMessages = [{ role: "user" as const, content: "hello" }];

describe("classifyApiError", (): void => {
  it("classifies rate limit status for users", (): void => {
    expect(classifyApiError(429)).toContain("制限");
  });

  it("classifies server status for users", (): void => {
    expect(classifyApiError(500)).toContain("サーバーエラー");
  });

  it("classifies fetch failures as network errors", (): void => {
    expect(classifyApiError("Failed to fetch")).toContain("ネットワーク");
  });

  it("classifies server rate limit keys without exposing raw details", (): void => {
    expect(classifyApiError("rate_limited: daily_limit_exceeded")).toContain("制限");
  });

  it("hides unknown internal error details", (): void => {
    const message = classifyApiError("some internal stack trace TypeError at handler");

    expect(message).not.toContain("TypeError");
    expect(message).not.toContain("stack");
  });

  it("classifies credit exhaustion separately from transient upstream errors", (): void => {
    const creditMessage = classifyApiError(
      JSON.stringify({ error: "upstream service error", code: "credit_exhausted" }),
    );

    expect(creditMessage).toBe(
      "AIの利用枠が一時的に不足しています。時間をおいて試すか、運営にご連絡ください",
    );
    expect(creditMessage).not.toBe(classifyApiError(502));
  });
});

describe("createConversationShare 429 interception", (): void => {
  beforeEach((): void => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  // 共有エンドポイントが apiFetch を経由することで 429 が中央の quota インターセプタに届くことを保証する。
  // 旧実装は raw fetch を使い QUOTA_EXCEEDED_EVENT を発火させなかったため、このテストは退行を捕捉する。
  it("dispatches QUOTA_EXCEEDED_EVENT and throws on 429", async (): Promise<void> => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    const quotaEvents: Event[] = [];
    const onQuota = (event: Event): void => {
      quotaEvents.push(event);
    };
    window.addEventListener(QUOTA_EXCEEDED_EVENT, onQuota);

    try {
      await expect(createConversationShare("conv-1")).rejects.toThrow("rate_limited");
    } finally {
      window.removeEventListener(QUOTA_EXCEEDED_EVENT, onQuota);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/share",
      expect.objectContaining({ method: "POST" }),
    );
    expect(quotaEvents).toHaveLength(1);
  });
});

describe("chat stream empty-response handling", (): void => {
  beforeEach((): void => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it("first-token-null empty assistant response surfaces a retry signal without mutating messages", async (): Promise<void> => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(emptyDoneResponse());
    const chunks: string[] = [];
    const doneResults: ChatStreamResult[] = [];
    const errors: string[] = [];

    await streamChatWithQualityGuard(
      chatMessages,
      "test-model",
      (chunk) => chunks.push(chunk),
      (result) => doneResults.push(result),
      (error) => errors.push(error),
      { phase: "conversation" },
    );

    const needsRetry = doneResults.some((result) => result.content.trim() === "");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([]);
    expect(errors).toEqual([]);
    expect(doneResults).toEqual([{ content: "", warningLevel: false, usedMemoryIds: undefined }]);
    expect(needsRetry).toBe(true);
    expect(chatMessages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("keeps returning non-empty responses over 8 sequential turns with long histories", async (): Promise<void> => {
    const encoder = new TextEncoder();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(input).toBe("/api/chat");
      const payload = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      };

      const totalChars = payload.messages.reduce((sum, message) => sum + message.content.length, 0);
      expect(totalChars).toBeLessThanOrEqual(120_000);
      expect(payload.messages[0]?.role).toBe("system");

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller): void {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"ok-turn"}}]}\n\n'),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
      );
    });

    const baseMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: "sys ".repeat(500) },
    ];

    for (let turn = 0; turn < 8; turn += 1) {
      baseMessages.push({ role: "user", content: `u${turn} ${"x".repeat(2_000)}` });
      if (turn > 0) {
        baseMessages.push({ role: "assistant", content: `a${turn} ${"y".repeat(2_000)}` });
      }

      let finalContent = "";
      await streamChatWithQualityGuard(
        baseMessages,
        "test-model",
        () => undefined,
        (result) => {
          finalContent = result.content;
        },
        () => undefined,
        { phase: "conversation" },
      );

      expect(finalContent.trim().length).toBeGreaterThan(0);
    }

    expect(fetchMock).toHaveBeenCalledTimes(8);
  });
});

describe("chat stream regeneration handling", (): void => {
  beforeEach((): void => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  // 本文は 50ms のフラッシュ待ちに溜まるだけなので、regenerating が同じ読み取りで届くと
  // 捨てたはずの試行の末尾が採用本文の頭に残る。ここが残ると D1 保存本文まで汚れる。
  it("drops chunks still waiting to be flushed when regenerating arrives", async (): Promise<void> => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"棄却された試行の末尾"}}]}\n\n',
      "event: regenerating\ndata: {}\n\n",
      'data: {"choices":[{"delta":{"content":"採用された本文"}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(streamFromSse([sse])));

    const chunks: string[] = [];
    const doneResults: ChatStreamResult[] = [];
    let regenerateCount = 0;

    await streamChatWithQualityGuard(
      chatMessages,
      "test-model",
      (chunk) => chunks.push(chunk),
      (result) => doneResults.push(result),
      () => undefined,
      { phase: "conversation" },
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        regenerateCount += 1;
      },
    );

    expect(regenerateCount).toBe(1);
    expect(doneResults[0]?.content).toBe("採用された本文");
    expect(chunks.join("")).not.toContain("棄却された試行の末尾");
  });
});

describe("shouldShowCharacterListError (#559 初回タイムアウトの誤バナー)", (): void => {
  // 初回ロードで一度タイムアウト(408)した後、再取得が間に合ってキャラ一覧が
  // 出ている状況。react-query の error は次の成功まで残るが、表示できる
  // キャラがあるならバナーは出してはいけない。
  it("タイムアウト error が残っていてもキャラが1件以上あればバナーを出さない", (): void => {
    const timeoutError = new ApiResponseError("list characters timed out", 408);
    const hasCharacters = true;
    expect(shouldShowCharacterListError(timeoutError, hasCharacters)).toBe(false);
  });

  // 本物の失敗ケースは温存する。取得できたキャラが0件で error があるなら
  // バナー+再試行を出す。
  it("error があってキャラが0件なら本物の失敗としてバナーを出す", (): void => {
    const timeoutError = new ApiResponseError("list characters timed out", 408);
    expect(shouldShowCharacterListError(timeoutError, false)).toBe(true);
  });

  it("error が無ければキャラの有無に関わらずバナーは出さない", (): void => {
    expect(shouldShowCharacterListError(null, false)).toBe(false);
    expect(shouldShowCharacterListError(undefined, true)).toBe(false);
  });

  // タイムアウト以外(500等)でもキャラが出ていれば抑止する。
  it("500 error でもキャラが出ていればバナーを抑止する", (): void => {
    const serverError = new ApiResponseError("list characters failed", 500);
    expect(shouldShowCharacterListError(serverError, true)).toBe(false);
    expect(shouldShowCharacterListError(serverError, false)).toBe(true);
  });
});

describe("listConversationMessages の失敗", (): void => {
  beforeEach((): void => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  // 会話が D1 から消えとる（別端末で削除・履歴の全消し）時、この読みは 404 で落ちる。
  // 呼び出し側は「もう無い」と「通信が届かん」を分けて画面を戻さなあかんが、
  // 素の Error では文言を正規表現で読むしか手が無かった。status を型で取れるようにする。
  it("404 は status を読める ApiResponseError で投げる", async (): Promise<void> => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "conversation not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const rejection: unknown = await listConversationMessages("conv-gone").then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(ApiResponseError);
    expect((rejection as ApiResponseError).status).toBe(404);
    // 既存の catch は文言で拾っとる箇所がある。文字列は一字も変えん。
    expect((rejection as Error).message).toBe("list messages failed: 404");
  });
});

// 記憶抽出は毎ターン走る。since を送らんとサーバは毎回直近50件を読み直し、
// 同じ往復を会話が続く限り抽出モデルへ食わせ続ける（#敵対レビュー指摘 1）。
describe("extractMemoryNotes の抽出済み境界", (): void => {
  const NEXT_SINCE = 1_700_000_000_123;

  const readSentBody = (init: RequestInit | undefined): { since?: number } =>
    JSON.parse(String(init?.body ?? "{}")) as { since?: number };

  const extractResponse = (nextSince?: number): Response =>
    new Response(JSON.stringify({ inserted: 0, facts: [], nextSince }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  beforeEach((): void => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach((): void => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("初回は since 無しで送り、2回目は前回の nextSince を since として送る", async (): Promise<void> => {
    // Response の body は一度しか読めんので、呼ばれるたびに新しく作る。
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(extractResponse(NEXT_SINCE)));

    await extractMemoryNotes({ conversationId: "conv-1", characterId: "char-1" });
    await extractMemoryNotes({ conversationId: "conv-1", characterId: "char-1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readSentBody(fetchMock.mock.calls[0]?.[1]).since).toBeUndefined();
    expect(readSentBody(fetchMock.mock.calls[1]?.[1]).since).toBe(NEXT_SINCE);
  });

  it("会話ごとに境界を分ける（別会話へ持ち越さん）", async (): Promise<void> => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(extractResponse(NEXT_SINCE)));

    await extractMemoryNotes({ conversationId: "conv-1", characterId: "char-1" });
    await extractMemoryNotes({ conversationId: "conv-2", characterId: "char-1" });

    expect(readSentBody(fetchMock.mock.calls[1]?.[1]).since).toBeUndefined();
  });

  // 抽出が走らんかった回（往復が足りん等）はサーバが境界を返さん。ここで進めてまうと、
  // まだ抽出してへん往復を二度と見んようになる。
  it("nextSince が返らん回は境界を進めん", async (): Promise<void> => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(extractResponse(undefined)));

    await extractMemoryNotes({ conversationId: "conv-1", characterId: "char-1" });
    await extractMemoryNotes({ conversationId: "conv-1", characterId: "char-1" });

    expect(readSentBody(fetchMock.mock.calls[1]?.[1]).since).toBeUndefined();
  });
});
