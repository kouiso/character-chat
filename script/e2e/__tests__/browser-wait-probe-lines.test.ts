import { describe, expect, it } from "vitest";

import {
  handleProbeSseLine,
  sseFrameHasVisibleText,
  type StreamProbeLineState,
} from "../browser-wait";

const makeState = (): StreamProbeLineState => ({
  firstChunkAt: null,
  lastChunkAt: null,
  doneChunkAt: null,
  servedModel: null,
  currentEvent: null,
  regeneratedCount: 0,
});

const feed = (state: StreamProbeLineState, body: string, now = 1_000): void => {
  for (const line of body.split("\n")) handleProbeSseLine(state, line, now);
};

describe("stream probe SSE line handling", () => {
  // TTFT の測定値そのものが壊れる。role だけのフレームは1文字も表示されない。
  it("ignores a role-only opening frame when timing the first token", () => {
    const state = makeState();

    handleProbeSseLine(
      state,
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}`,
      1_000,
    );
    expect(state.firstChunkAt).toBeNull();

    handleProbeSseLine(
      state,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "あ" } }] })}`,
      2_000,
    );
    expect(state.firstChunkAt).toBe(2_000);
  });

  it("does not treat an empty content delta as the first token", () => {
    expect(sseFrameHasVisibleText(JSON.stringify({ choices: [{ delta: { content: "" } }] }))).toBe(
      false,
    );
    expect(sseFrameHasVisibleText("[DONE]")).toBe(false);
    expect(sseFrameHasVisibleText(JSON.stringify({ text: "本文" }))).toBe(true);
  });

  // CRLF やと空行が "\r" になる。currentEvent が閉じず、以降の本文が全部
  // イベント配下の扱いになって計測が全部 null で終わる。
  it("closes the named event on a CRLF blank line", () => {
    const state = makeState();
    const body =
      `event: quality-meta\r\ndata: ${JSON.stringify({ usedModel: "m" })}\r\n\r\n` +
      `data: ${JSON.stringify({ text: "本文" })}\r\n\r\ndata: [DONE]\r\n\r\n`;

    feed(state, body);

    expect(state.servedModel).toBe("m");
    expect(state.firstChunkAt).toBe(1_000);
    expect(state.doneChunkAt).toBe(1_000);
  });

  // 空白なしの "data:{...}" も SSE として正しい形。
  it("accepts a data field written without a space", () => {
    const state = makeState();

    handleProbeSseLine(state, `data:${JSON.stringify({ text: "本文" })}`, 3_000);

    expect(state.firstChunkAt).toBe(3_000);
  });
});

describe("作り直しの宣言", () => {
  it("1文字目の時刻を捨てて、次の本文で測り直す", () => {
    const state = makeState();
    feed(state, 'data: {"choices":[{"delta":{"content":"あ"}}]}\n\n', 1_000);
    expect(state.firstChunkAt).toBe(1_000);

    feed(state, "event: regenerating\ndata: {}\n\n", 5_000);
    expect(state.firstChunkAt).toBeNull();
    expect(state.regeneratedCount).toBe(1);

    feed(state, 'data: {"choices":[{"delta":{"content":"い"}}]}\n\n', 9_000);
    expect(state.firstChunkAt).toBe(9_000);
  });

  it("作り直しが2回宣言されたら2回数える", () => {
    const state = makeState();
    feed(state, "event: regenerating\ndata: {}\n\n", 2_000);
    feed(state, "event: regenerating\ndata: {}\n\n", 3_000);
    expect(state.regeneratedCount).toBe(2);
  });

  it("作り直しが無ければ1文字目はそのまま残る", () => {
    const state = makeState();
    feed(state, 'data: {"choices":[{"delta":{"content":"あ"}}]}\n\n', 1_500);
    feed(state, 'data: {"choices":[{"delta":{"content":"い"}}]}\n\n', 2_500);
    expect(state.firstChunkAt).toBe(1_500);
    expect(state.regeneratedCount).toBe(0);
  });
});
