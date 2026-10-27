// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { connectChatTurn, readChatEvents, type PendingTurn } from "./chat-session";

const pending: PendingTurn = {
  characterId: "synthetic",
  conversationId: "synthetic-room",
  requestId: "synthetic-request",
  text: "合成入力",
  baseTurn: 4,
};
const encoder = new TextEncoder();
const event = (id: number, type = "token", payload: object = { text: `synthetic-${id}` }): string =>
  `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
const done = (id: number): string =>
  event(id, "done", {
    conversationId: pending.conversationId,
    turn: pending.baseTurn,
    generationId: pending.requestId,
  });
const response = (body: string): Response =>
  new Response(body, { headers: { "content-type": "text/event-stream" } });
const collect = async (body: ReadableStream<Uint8Array>) => {
  const events = [];
  for await (const value of readChatEvents(body)) events.push(value);
  return events;
};
const postBodies = (fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] =>
  fetchMock.mock.calls.map(
    (call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>,
  );
const cursors = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls.map(
    (call) => new Headers((call[1] as RequestInit).headers).get("last-event-id") ?? "missing",
  );

describe("連番から再接続する transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("10 回連続の切断で同じ受付を使い、続きだけ届ける", async () => {
    let request = 0;
    const fetchMock = vi.fn(async () => {
      request++;
      const replay = request > 1 ? event(request - 1) : "";
      return response(request <= 10 ? replay + event(request) : replay + done(11));
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = await collect(
      await connectChatTurn(pending, new AbortController().signal, true),
    );
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(events.map((value) => value.type)).toEqual([
      ...new Array<string>(10).fill("token"),
      "done",
    ]);
    expect(events.filter((value) => value.type === "token").map((value) => value.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `synthetic-${index + 1}`),
    );
    expect(cursors(fetchMock)).toEqual(Array.from({ length: 11 }, (_, index) => String(index)));
    expect(postBodies(fetchMock)).toEqual(
      Array.from({ length: 11 }, (_, index) => ({
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        turn: pending.baseTurn,
        text: pending.text,
        retry: index === 0,
      })),
    );
  });

  it("保存済みカーソルから再開し完了番号は端末へ先取り保存しない", async () => {
    const fetchMock = vi.fn(async () => response(event(4) + event(6) + done(7)));
    const checkpoints: number[] = [];
    vi.stubGlobal("fetch", fetchMock);
    const events = await collect(
      await connectChatTurn(
        { ...pending, lastEventId: 5 },
        new AbortController().signal,
        false,
        (cursor) => checkpoints.push(cursor),
      ),
    );
    expect(events.map((value) => value.type)).toEqual(["token", "done"]);
    expect(cursors(fetchMock)).toEqual(["5"]);
    expect(checkpoints).toEqual([6]);
  });

  it("明示した生成再試行だけは古い試行カーソルをリセットする", async () => {
    const fetchMock = vi.fn(async () => response(event(1) + done(2)));
    vi.stubGlobal("fetch", fetchMock);
    const events = await collect(
      await connectChatTurn({ ...pending, lastEventId: 5 }, new AbortController().signal, true),
    );
    expect(events.map((value) => value.type)).toEqual(["token", "done"]);
    expect(cursors(fetchMock)).toEqual(["0"]);
    expect(postBodies(fetchMock)[0]).toMatchObject({ requestId: pending.requestId, retry: true });
  });

  it("複数data行のJSONをひとつのSSE本文として復元する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          'id: 1\nevent: token\ndata: {\ndata: "text": "合成の複数行"\ndata: }\n\n' + done(2),
        ),
      ),
    );
    const events = await collect(await connectChatTurn(pending, new AbortController().signal));
    expect(events[0]).toEqual({ type: "token", text: "合成の複数行" });
  });

  it("途中の UTF-8 と CRLF を捨て、受け取り済み番号の次から復元する", async () => {
    const complete = event(1, "token", { text: "こんにちは" }).replace(/\n/g, "\r\n");
    const bytes = encoder.encode(complete + 'id: 2\r\nevent: token\r\ndata: {"text":"途');
    const first = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    let request = 0;
    const fetchMock = vi.fn(async () =>
      ++request === 1
        ? new Response(first)
        : response(event(1) + event(2, "token", { text: "続き" }) + done(3)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events = await collect(await connectChatTurn(pending, new AbortController().signal));
    expect(events).toEqual([
      { type: "token", text: "こんにちは" },
      { type: "token", text: "続き" },
      {
        type: "done",
        conversationId: pending.conversationId,
        turn: 4,
        generationId: pending.requestId,
      },
    ]);
    expect(cursors(fetchMock)).toEqual(["0", "1"]);
  });

  it("reader の失敗も同じカーソルで再接続する", async () => {
    let read = 0;
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (read++ === 0) controller.enqueue(encoder.encode(event(1)));
        else controller.error(new Error("synthetic disconnect"));
      },
    });
    let request = 0;
    const fetchMock = vi.fn(async () =>
      ++request === 1 ? new Response(broken) : response(done(2)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events = await collect(await connectChatTurn(pending, new AbortController().signal));
    expect(events.map((value) => value.type)).toEqual(["token", "done"]);
    expect(cursors(fetchMock)).toEqual(["0", "1"]);
  });

  it("再接続の HTTP 失敗を含め最大10回で止まり、初回 HTTP 失敗は呼び出し元に返す", async () => {
    const fetchMock = vi.fn(async () => response(""));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      collect(await connectChatTurn(pending, new AbortController().signal)),
    ).rejects.toThrow("接続を復元できませんでした");
    expect(fetchMock).toHaveBeenCalledTimes(11);
    fetchMock.mockReset().mockResolvedValue(new Response("", { status: 503 }));
    await expect(connectChatTurn(pending, new AbortController().signal)).rejects.toThrow(
      "返信を受け取れませんでした",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("空の204をストリーム切断と扱って自動再POSTしない", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(connectChatTurn(pending, new AbortController().signal)).rejects.toThrow(
      "返信を受け取れませんでした",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("自動再接続中の HTTP 失敗を10回で止め、生成の retry を送らない", async () => {
    let request = 0;
    const fetchMock = vi.fn(async () =>
      ++request === 1 ? response("") : new Response("", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      collect(await connectChatTurn(pending, new AbortController().signal)),
    ).rejects.toThrow("接続を復元できませんでした");
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(postBodies(fetchMock).every((body) => body.retry === false)).toBe(true);
  });

  it.each(["", "id: 1\n"])(
    "terminal error を番号の有無に関わらず届け、再生成しない（%j）",
    async (prefix) => {
      const fetchMock = vi.fn(async () =>
        response(event(1) + `${prefix}event: error\ndata: {"message":"synthetic failure"}\n\n`),
      );
      vi.stubGlobal("fetch", fetchMock);
      expect(await collect(await connectChatTurn(pending, new AbortController().signal))).toEqual([
        { type: "token", text: "synthetic-1" },
        { type: "error", message: "synthetic failure" },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("done 後に reader が閉じなくても解放し再接続しない", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(done(1)));
      },
      cancel,
    });
    const fetchMock = vi.fn(async () => new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await collect(await connectChatTurn(pending, new AbortController().signal)))[0].type,
    ).toBe("done");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("AbortSignal が待機中の reader を止めて再接続しない", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchMock = vi.fn(async () => new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    const stream = await connectChatTurn(pending, abort.signal);
    const events = collect(stream);
    abort.abort();
    await expect(events).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("consumer cancel が reader を止めて再接続しない", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchMock = vi.fn(async () => new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const stream = await connectChatTurn(pending, new AbortController().signal);
    await stream.cancel("synthetic navigation");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
