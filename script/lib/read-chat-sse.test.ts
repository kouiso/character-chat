import { describe, expect, it } from "vitest";

import { describeChatSseFailure, parseChatSseBody, readChatSseResponse } from "./read-chat-sse";

const delta = (content: string, model?: string): string =>
  `data: ${JSON.stringify({ ...(model ? { model } : {}), choices: [{ delta: { content } }] })}\n\n`;

const qualityMeta = (usedModel: string): string =>
  `event: quality-meta\ndata: ${JSON.stringify({ retryCount: 1, refusalDetected: false, usedModel, warningLevel: false, refusalRetryCount: 0 })}\n\n`;

const REGENERATING = "event: regenerating\ndata: {}\n\n";

describe("read-chat-sse", () => {
  it("drops the rejected attempt when regenerating separates two attempts", () => {
    const body = [
      delta("不採用になった試行の本文"),
      REGENERATING,
      delta("採用された本文"),
      "data: [DONE]\n\n",
    ].join("");

    const snapshot = parseChatSseBody(body);

    expect(snapshot.text).toBe("採用された本文");
    expect(snapshot.regenerateCount).toBe(1);
    expect(snapshot.doneSignal).toBe(true);
  });

  // quality-meta の usedModel は最終的に採用した本文のモデル。
  // 1トークン目のモデル(delta の model)とは作り直しの後でズレる。
  it("prefers the quality-meta model over the first relayed chunk's model", () => {
    const body = [
      delta("最初の試行", "first-attempt-model"),
      REGENERATING,
      delta("採用された本文", "retry-model"),
      qualityMeta("retry-model"),
      "data: [DONE]\n\n",
    ].join("");

    expect(parseChatSseBody(body).servedModel).toBe("retry-model");
  });

  it("falls back to the chunk model when quality-meta is absent", () => {
    expect(parseChatSseBody(delta("本文", "chunk-model")).servedModel).toBe("chunk-model");
  });

  // quality-meta はどの生成ルートがこのターンを出したかを示す唯一の情報源。
  // usedModel だけ拾って残りを捨てると、後から読む側は再現・拒否・警告の経路を追えん。
  it("surfaces the full quality-meta payload on the snapshot", () => {
    const body = [delta("採用された本文"), qualityMeta("retry-model"), "data: [DONE]\n\n"].join("");

    const snapshot = parseChatSseBody(body);

    expect(snapshot.qualityMeta).toEqual({
      retryCount: 1,
      refusalDetected: false,
      warningLevel: false,
      refusalRetryCount: 0,
      // この見本の quality-meta はこの 2 つを送っとらん＝古い形。null で「測っとらん」。
      generationCount: null,
      deterministicCategory: null,
    });
  });

  it("has a null qualityMeta when the stream never sends the event", () => {
    expect(parseChatSseBody(delta("本文")).qualityMeta).toBeNull();
  });

  it("reads a chunked stream and reports deltas in order", async () => {
    const encoder = new TextEncoder();
    const frames = [delta("捨てられる"), REGENERATING, delta("採用"), "data: [DONE]\n\n"];
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        // フレーム境界をまたぐ分割でも壊れんことを確認する
        const joined = frames.join("");
        controller.enqueue(encoder.encode(joined.slice(0, 30)));
        controller.enqueue(encoder.encode(joined.slice(30)));
        controller.close();
      },
    });

    const deltas: string[] = [];
    const snapshot = await readChatSseResponse(stream, {
      onDelta: (value) => deltas.push(value),
    });

    expect(snapshot.text).toBe("採用");
    expect(deltas).toEqual(["捨てられる", "採用"]);
  });

  // 中継開始後の失敗は HTTP 200 + event: error + [DONE] なしで届く。
  // 見落とすと、途中で切れた本文が正常な返答として履歴と採点へ入る。
  it("surfaces a streamed error event as a failed turn", () => {
    const body = [
      delta("途中まで出た本文"),
      `event: error\ndata: ${JSON.stringify({ reason: "upstream service error" })}\n\n`,
    ].join("");

    const snapshot = parseChatSseBody(body);

    expect(snapshot.errorReason).toBe("upstream service error");
    expect(snapshot.doneSignal).toBe(false);
    expect(describeChatSseFailure(snapshot)).toContain("upstream service error");
  });

  it("treats a stream that ends without [DONE] as a failed turn", () => {
    expect(describeChatSseFailure(parseChatSseBody(delta("途中まで")))).toBe(
      "stream ended without [DONE]",
    );
  });

  it("reports no failure for a complete stream", () => {
    const snapshot = parseChatSseBody([delta("本文"), "data: [DONE]\n\n"].join(""));

    expect(describeChatSseFailure(snapshot)).toBeNull();
  });

  // 作り直しの境界は event 行そのもので閉じる。data 行が付かん形で届いても
  // 不採用の試行が採用本文の頭に残ったらあかん。
  it("resets on a regenerating event that carries no data line", () => {
    const body = [delta("不採用"), "event: regenerating\n\n", delta("採用"), "data: [DONE]\n\n"].join(
      "",
    );

    const snapshot = parseChatSseBody(body);

    expect(snapshot.text).toBe("採用");
    expect(snapshot.regenerateCount).toBe(1);
  });

  it("counts a regenerating event only once when it carries a data line", () => {
    const body = [delta("不採用"), REGENERATING, delta("採用"), "data: [DONE]\n\n"].join("");

    expect(parseChatSseBody(body).regenerateCount).toBe(1);
  });

  // サーバは generationCount / deterministicCategory を送っとるのに、ここが捨てとった。
  // ダンプに残るのは `retryCount`(= refusalRetryCount の複製)だけで、品質の撮り直しが
  // 走ったかどうかは実測の全文からもローカル D1 からも読めんかった。2026-08-20 の通読は
  // その列を根拠に「climax の床が発火しとらん」と誤読しとる。
  it("keeps the quality retry count and the failure category", () => {
    const body =
      `event: quality-meta\ndata: ${JSON.stringify({
        usedModel: "m",
        retryCount: 0,
        refusalDetected: false,
        warningLevel: false,
        refusalRetryCount: 0,
        generationCount: 3,
        deterministicCategory: "too_short",
      })}\n\n` + "data: [DONE]\n\n";

    expect(parseChatSseBody(body).qualityMeta).toMatchObject({
      generationCount: 3,
      deterministicCategory: "too_short",
    });
  });

  // 古いダンプにはこの 2 つが無い。0 を既定にすると「撮り直しゼロ」と読み違えるので
  // null で「測っとらん」と区別する。
  it("reports an older stream without the two fields as unmeasured, not as zero retakes", () => {
    const body = qualityMeta("m") + "data: [DONE]\n\n";

    expect(parseChatSseBody(body).qualityMeta).toMatchObject({
      generationCount: null,
      deterministicCategory: null,
    });
  });

  // 上流のフレームはそのまま中継されるので CRLF で届くことがある。
  it("reads a CRLF stream", () => {
    const body =
      `event: quality-meta\r\ndata: ${JSON.stringify({ usedModel: "m" })}\r\n\r\n` +
      `data: ${JSON.stringify({ text: "本文" })}\r\n\r\ndata: [DONE]\r\n\r\n`;

    const snapshot = parseChatSseBody(body);

    expect(snapshot.text).toBe("本文");
    expect(snapshot.doneSignal).toBe(true);
    expect(snapshot.servedModel).toBe("m");
  });
});
