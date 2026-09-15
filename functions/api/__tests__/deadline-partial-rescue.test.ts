import { describe, expect, it } from "vitest";

import {
  PARTIAL_RESCUE_MIN_VISIBLE_CHARS,
  PartialStreamAbortError,
  collectOpenAICompatibleStream,
  salvageCompletedBlocks,
} from "../lib/route-context";

const sseChunk = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

// 実測 2026-08-18 matrix02 の Sakura-33。完成した4ブロックの後ろで切れとった。
const CUT_OFF_TURN =
  "<response>" +
  "<action>ふと視線を上げると、あなたが優しく微笑んでいる。その笑顔に胸が温かくなる。体の奥からまだ温かいものがじわりと溢れてくる。</action>" +
  "<dialogue>「あの…これ、恥ずかしいです…」</dialogue>" +
  "<action>目を伏せ、髪飾りに触れる。汗ばんだ肌が冷えてきて、少しずつ体温が落ちていく。</action>" +
  "<dialogue>「でも、あなたが傍にいてくれるから、大丈夫だよ…」</dialogue>" +
  "<action>あなたがそっと手を伸ばし、わたしの頬を優しく";

describe("salvageCompletedBlocks", () => {
  it("閉じ切ったブロックだけを残し、開いたままの尻尾を落とす", () => {
    const rescued = salvageCompletedBlocks(CUT_OFF_TURN);
    expect(rescued).not.toBeNull();
    expect(rescued).toContain("大丈夫だよ");
    expect(rescued).not.toContain("わたしの頬を優しく");
    expect(rescued?.endsWith("</response>")).toBe(true);
  });

  it("閉じたブロックが1つも無ければ諦める", () => {
    expect(salvageCompletedBlocks("<response><action>途中で切れた")).toBeNull();
  });

  it("拾えた本文が下限に届かんなら諦める（ほぼ空の吹き出しを残さん）", () => {
    const tiny = "<response><action>短い</action></response>";
    expect(salvageCompletedBlocks(tiny)).toBeNull();
    expect(PARTIAL_RESCUE_MIN_VISIBLE_CHARS).toBeGreaterThan(0);
  });
});

describe("PartialStreamAbortError", () => {
  it("中断した流れの本文を載せて投げ直す", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(
            new TextEncoder().encode(sseChunk("<response><action>届いた分</action>")),
          );
          return;
        }
        controller.error(new Error("aborted"));
      },
    });

    const thrown = await collectOpenAICompatibleStream(stream).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(PartialStreamAbortError);
    expect((thrown as PartialStreamAbortError).partialText).toContain("届いた分");
  });

  it("1文字も届いとらんなら元のエラーをそのまま投げる", async () => {
    const boom = new Error("nothing arrived");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(boom);
      },
    });

    const thrown = await collectOpenAICompatibleStream(stream).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBe(boom);
  });
});
