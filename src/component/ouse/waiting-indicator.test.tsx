import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/store/chat-store";

import { HerMessage } from "./her-message";

// 待ち表示が出るのは「まだ層として組み立てられん」あいだだけ。開いたタグだけを
// 渡すと本文は 0 パート、content.length は 10 になる。
const PARTIAL_CONTENT = "<response>";

const streamingMessage = (startedMsAgo: number, content: string): ChatMessage => ({
  id: "msg-streaming",
  role: "assistant",
  content,
  createdAt: Date.now() - startedMsAgo,
  isStreaming: true,
});

describe("返事待ちの表示", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // 25〜45 秒待たされる回があり、静止した「ことばを探している…」だけやと本当に
  // 動いとるか分からんと言われた（局長 2026-08-17）。経過秒は捏造やない唯一の合図。
  it("待ち始めてからの経過秒を出す", () => {
    render(<HerMessage message={streamingMessage(12_000, "")} isStreaming />);

    expect(screen.getByText(/12秒/)).toBeInTheDocument();
  });

  // 静止してへんことが要件そのもの。止まった数字は静止した文言と同じ不安を残す。
  it("待っている間、経過秒が進む", () => {
    render(<HerMessage message={streamingMessage(12_000, "")} isStreaming />);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.getByText(/15秒/)).toBeInTheDocument();
  });

  // 文字が流れ始めても、層が揃うまで本文は出てこん。この表示が出とる間の可視文字数は
  // 定義上 0 なので、動いとる証拠になるのは届いた生の長さだけ。
  it("届いた生の文字数を出す", () => {
    render(<HerMessage message={streamingMessage(4_000, PARTIAL_CONTENT)} isStreaming />);

    expect(screen.getByText(/ことばが届きはじめた/).textContent).toContain(
      `${PARTIAL_CONTENT.length}字`,
    );
  });

  // 一文字も来てへんのに「届きはじめた」と出したら嘘になる。
  it("一文字も届いてへん間は届いたと言わない", () => {
    render(<HerMessage message={streamingMessage(4_000, "")} isStreaming />);

    expect(screen.getByText(/ことばを探している/)).toBeInTheDocument();
    expect(screen.queryByText(/字/)).not.toBeInTheDocument();
  });
});
