// followTurn の繋ぎ直しと続き番号の確かめ。差し替えるのは接続口
// （connectChatTurn・attachChatTurn）だけ。出来事の形と切り方は本物で回す。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Session from "./chat-session";
import { ChatConnectionError } from "./chat-session";

import { followTurn, type TurnStreamSignal } from "./turn-stream";

const connect = vi.hoisted(() => vi.fn());
const attach = vi.hoisted(() => vi.fn());

vi.mock("./chat-session", async (importOriginal) => ({
  ...(await importOriginal<typeof Session>()),
  connectChatTurn: connect,
  attachChatTurn: attach,
}));

const pending = {
  requestId: "req-1",
  conversationId: "conv-1",
  characterId: "char-1",
  text: "こんにちは",
  baseTurn: 1,
};

const encoder = new TextEncoder();

// SSE 本文を一本の流れにする。close したら EOF。
const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });

const block = (id: number, event: object): string =>
  `id: ${id}\nevent: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`;

// chunk は判定結果込みの形。通る判定の最小の形（turn-store.test.ts と同じ）。
const OK_JUDGE = {
  ok: true,
  reasons: [],
  warnings: [],
  checks: {
    ngram: { ok: true, ratio: 0, matchedPhrases: [], exactRepeat: false },
    nearDuplicate: { ok: true, matches: [] },
    voice: { ok: true, endingsMismatch: false },
    format: { ok: true },
    empty: { ok: true },
  },
};

const chunkEvent = (seq: number, text: string) => ({
  type: "chunk",
  seq,
  text,
  judge: OK_JUDGE,
  attempt: 1,
  preExtend: true,
});

const drain = async (gen: AsyncGenerator<TurnStreamSignal>): Promise<TurnStreamSignal[]> => {
  const items: TurnStreamSignal[] = [];
  for await (const item of gen) items.push(item);
  return items;
};

describe("followTurn", () => {
  beforeEach(() => {
    connect.mockReset();
    attach.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("POST でつなぎ、done が来たら終わる", async () => {
    connect.mockResolvedValue(
      streamOf(
        block(1, chunkEvent(0, "やあ")) +
          block(2, { type: "done", conversationId: "conv-1", turn: 1, generationId: "g1" }),
      ),
    );
    const items = await drain(
      followTurn(pending, { attach: false, signal: new AbortController().signal }),
    );
    expect(items).toEqual([
      { type: "event", id: 1, event: chunkEvent(0, "やあ") },
      {
        type: "event",
        id: 2,
        event: { type: "done", conversationId: "conv-1", turn: 1, generationId: "g1" },
      },
    ]);
    expect(connect).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0].slice(1)).toEqual([expect.any(AbortSignal), false, 0]);
    expect(attach).not.toHaveBeenCalled();
  });

  it("終わりの印が来んまま切れたら、読んだ番号の続きから GET で繋ぎ直す", async () => {
    vi.useFakeTimers();
    // 1 本目: 塊だけ届いて EOF（部屋の配信期限 180 秒の切れの再現）。
    connect.mockResolvedValueOnce(streamOf(block(1, chunkEvent(0, "途中"))));
    attach.mockResolvedValueOnce(
      streamOf(
        block(2, chunkEvent(1, "続き")) +
          block(3, { type: "done", conversationId: "conv-1", turn: 1, generationId: "g1" }),
      ),
    );

    const gen = followTurn(pending, { attach: false, signal: new AbortController().signal });
    const seen: TurnStreamSignal[] = [];
    const consume = (async () => {
      for await (const item of gen) seen.push(item);
    })();
    // reconnecting が出たら待ち時間（最初の戻しは 1 秒）を進める。
    await vi.waitFor(() => expect(seen.some((item) => item.type === "reconnecting")).toBe(true));
    expect(seen[1]).toEqual({ type: "reconnecting", attempt: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    await consume;

    // 続きは GET /events で、読んだ番号（1）の続きを要求する。
    expect(attach).toHaveBeenCalledOnce();
    expect(attach.mock.calls[0].slice(0, 3)).toEqual(["char-1", "conv-1", "req-1"]);
    expect(attach.mock.calls[0][3]).toBe(1);
    expect(seen.map((item) => item.type)).toEqual(["event", "reconnecting", "event", "event"]);
    expect((seen.at(-1) as { event: { type: string } }).event.type).toBe("done");
  });

  it("読み出しの途中で切れても（TypeError）番号の続きから繋ぎ直す", async () => {
    vi.useFakeTimers();
    let delivered = false;
    // ブラウザは流れの途中の切断を TypeError で投げる。受付済みの送信を「送れなかった」へ落とさん。
    // pull で 1 回目に塊を渡し、2 回目の読み出しで切れる（start で即 error すると未読の塊が捨てられる）。
    connect.mockResolvedValueOnce(
      new ReadableStream({
        pull(controller) {
          if (!delivered) {
            delivered = true;
            controller.enqueue(encoder.encode(block(1, chunkEvent(0, "届いた"))));
            return;
          }
          controller.error(new TypeError("network error"));
        },
      }),
    );
    attach.mockResolvedValueOnce(
      streamOf(block(2, { type: "done", conversationId: "conv-1", turn: 1, generationId: "g1" })),
    );

    const gen = followTurn(pending, { attach: false, signal: new AbortController().signal });
    const seen: TurnStreamSignal[] = [];
    const consume = (async () => {
      for await (const item of gen) seen.push(item);
    })();
    await vi.waitFor(() => expect(seen.some((item) => item.type === "reconnecting")).toBe(true));
    expect(seen[1]).toEqual({ type: "reconnecting", attempt: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    await consume;

    expect(attach.mock.calls[0][3]).toBe(1);
    expect((seen.at(-1) as { event: { type: string } }).event.type).toBe("done");
  });

  it("バイトが来んまま 45 秒経っても繋ぎ直す", async () => {
    vi.useFakeTimers();
    // 1 本目: 読み出しだけがぶら下がる流れ（返事が一度も来ない）。
    attach
      .mockResolvedValueOnce(new ReadableStream({ start() {} }))
      .mockResolvedValueOnce(
        streamOf(block(1, { type: "done", conversationId: "conv-1", turn: 1, generationId: "g1" })),
      );

    const gen = followTurn(pending, { attach: true, signal: new AbortController().signal });
    const seen: TurnStreamSignal[] = [];
    const consume = (async () => {
      for await (const item of gen) seen.push(item);
    })();
    // 45 秒の見切りタイマーが切れて reconnecting が出る。
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.waitFor(() => expect(seen.some((item) => item.type === "reconnecting")).toBe(true));
    expect(seen[0]).toEqual({ type: "reconnecting", attempt: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    await consume;
    expect((seen.at(-1) as { event: { type: string } }).event.type).toBe("done");
  });

  it("受付前（attach:false）の通信失敗は例外のまま返す。繋ぎ直しには行かん", async () => {
    connect.mockRejectedValue(new ChatConnectionError());
    await expect(
      drain(followTurn(pending, { attach: false, signal: new AbortController().signal })),
    ).rejects.toThrow(ChatConnectionError);
    expect(attach).not.toHaveBeenCalled();
  });

  it("受付済み（attach:true）の GET 失敗は繋ぎ直しへ回る", async () => {
    vi.useFakeTimers();
    attach
      .mockRejectedValueOnce(new ChatConnectionError())
      .mockResolvedValueOnce(
        streamOf(block(1, { type: "done", conversationId: "conv-1", turn: 1, generationId: "g1" })),
      );

    const gen = followTurn(pending, { attach: true, signal: new AbortController().signal });
    const seen: TurnStreamSignal[] = [];
    const consume = (async () => {
      for await (const item of gen) seen.push(item);
    })();
    await vi.waitFor(() => expect(seen.some((item) => item.type === "reconnecting")).toBe(true));
    expect(seen[0]).toEqual({ type: "reconnecting", attempt: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    await consume;
    expect((seen.at(-1) as { event: { type: string } }).event.type).toBe("done");
  });

  it("終わらん出来事でも error は呼び出し側へ届ける（画面が失敗の状態を決める）", async () => {
    connect.mockResolvedValue(
      streamOf(
        block(1, {
          type: "error",
          code: "generation_failed",
          message: "返信を完了できませんでした。再試行してください。",
          terminal: false,
        }),
      ),
    );
    const controller = new AbortController();
    const seen: TurnStreamSignal[] = [];
    const gen = followTurn(pending, { attach: false, signal: controller.signal });
    const consume = (async () => {
      for await (const item of gen) seen.push(item);
    })();
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]).toMatchObject({
      type: "event",
      event: { type: "error", code: "generation_failed", terminal: false },
    });
    // terminal じゃない失敗は流れ自体は続く。切ったら EOF で繋ぎ直しへ。
    controller.abort();
    await consume;
    expect(connect).toHaveBeenCalledOnce();
  });

  it("中断されたら繋ぎ直さず静かに終わる", async () => {
    const controller = new AbortController();
    connect.mockImplementationOnce(
      (_pending: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    controller.abort();
    const items = await drain(followTurn(pending, { attach: false, signal: controller.signal }));
    expect(items).toEqual([]);
  });

  it("ずっと終わりが見えん時は待ちの天井（300 秒）で gave_up を返す", async () => {
    vi.useFakeTimers();
    // GET が落ち続ける。reconnecting のたびに待ち時間を進めて 300 秒の天井を越す。
    attach.mockRejectedValue(new ChatConnectionError());

    const gen = followTurn(pending, { attach: true, signal: new AbortController().signal });
    const seen: TurnStreamSignal[] = [];
    const consume = (async () => {
      for await (const item of gen) seen.push(item);
    })();
    // 300 秒 + 戻し時間のぶん時計を進める。
    await vi.advanceTimersByTimeAsync(310_000);
    await consume;
    expect(seen.at(-1)).toEqual({ type: "gave_up" });
  });
});
