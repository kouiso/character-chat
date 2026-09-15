import { describe, expect, it } from "vitest";

import { stripXmlTags } from "../../../src/lib/xml-response-parser";
import {
  collectOpenAICompatibleStream,
  extractOpenAISseContentFromLines,
  type LiveChatRelay,
} from "../lib/route-context";

const encoder = new TextEncoder();

const makeLiveRelay = (onText: (text: string) => void): LiveChatRelay => ({
  push: (raw) => {
    onText(extractOpenAISseContentFromLines(raw.split("\n").filter(Boolean)));
  },
  noteModel: () => {},
  noteRelayedText: () => {},
  noteRegenerating: () => {},
  hasStarted: () => false,
});

const makeSseStream = (contentChunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of contentChunks) {
        const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`;
        controller.enqueue(encoder.encode(frame));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

const plainLength = (text: string): number => stripXmlTags(text).length;

describe("collectOpenAICompatibleStream の maxChars 打ち切り", () => {
  it("maxChars を超えたら中継を止めて、最終返却値は打ち切らん", async () => {
    const content = "あ".repeat(10);
    const frames = Array.from({ length: 300 }, () => content);
    const stream = makeSseStream(frames);

    let relayed = "";
    const collected = await collectOpenAICompatibleStream(
      stream,
      makeLiveRelay((text) => {
        relayed += text;
      }),
      2_200,
    );

    // 中継は上限内で止まる
    expect(plainLength(relayed)).toBeLessThanOrEqual(2_200);
    // 内部の responseText は最後まで読み込むので、打ち切り判定用に残る
    expect(collected.text.length).toBe(3_000);
  });

  it("上限内なら最後まで中継する", async () => {
    const frames = Array.from({ length: 10 }, () => "い".repeat(10));
    const stream = makeSseStream(frames);

    let relayed = "";
    const collected = await collectOpenAICompatibleStream(
      stream,
      makeLiveRelay((text) => {
        relayed += text;
      }),
      2_200,
    );

    expect(plainLength(relayed)).toBe(100);
    expect(collected.text.length).toBe(100);
  });

  it("maxChars 未指定なら全量を中継する", async () => {
    const frames = Array.from({ length: 10 }, () => "う".repeat(100));
    const stream = makeSseStream(frames);

    let relayed = "";
    const collected = await collectOpenAICompatibleStream(
      stream,
      makeLiveRelay((text) => {
        relayed += text;
      }),
    );

    expect(plainLength(relayed)).toBe(1_000);
    expect(collected.text.length).toBe(1_000);
  });

  it("1フレームで上限を超える場合はそのフレームを中継せず、最終返却値は読み込んだまま", async () => {
    const stream = makeSseStream(["え".repeat(3_000)]);

    let relayed = "";
    let callbackCount = 0;
    const collected = await collectOpenAICompatibleStream(
      stream,
      makeLiveRelay((text) => {
        callbackCount += 1;
        relayed += text;
      }),
      2_200,
    );

    expect(callbackCount).toBe(0);
    expect(plainLength(relayed)).toBe(0);
    expect(collected.text.length).toBe(3_000);
  });
});
