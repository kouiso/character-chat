import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeFixtureReply, readFixtureChatRequest } from "../test/chat-fixture";

import { ChatView } from "./chat-view";

import type { FixtureChatRequest } from "../test/chat-fixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const reply = (request: FixtureChatRequest) =>
  makeFixtureReply(request, [{ seq: 0, text: "合成Aの返信", scheduledAt: 1000 }], 2000);

describe("ChatView", () => {
  it("キャラ名と入力フォームを描画する", () => {
    render(<ChatView characterId="char-koharu-ex" characterName="小春" />);

    expect(screen.getByText("小春")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("メッセージを入力")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });

  it("別キャラクターへ切り替えたら旧本文と会話識別子を持ち越さない", async () => {
    const bodies: FixtureChatRequest[] = [];
    let completed: ReturnType<typeof reply> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) => {
        if (options.method !== "POST") return Response.json(completed?.history);
        const body = readFixtureChatRequest(options);
        bodies.push(body);
        completed = reply(body);
        return completed.response();
      }),
    );
    const { rerender } = render(<ChatView characterId="synthetic-A" characterName="合成A" />);
    fireEvent.change(screen.getByPlaceholderText("メッセージを入力"), {
      target: { value: "合成Aの質問" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "送信" }));
    });
    expect(screen.getByText("合成Aの返信")).toBeInTheDocument();
    rerender(<ChatView characterId="synthetic-B" characterName="合成B" />);
    expect(screen.queryByText("合成Aの返信")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("メッセージを入力"), {
      target: { value: "合成Bの質問" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "送信" }));
    });
    expect(bodies[1]).toMatchObject({ text: "合成Bの質問", turn: 1, retry: false });
    expect(bodies[1].conversationId).not.toBe(bodies[0].conversationId);
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
  });

  it("切替前の送信を中断し、遅い応答が新しい入力へ混ざらない", async () => {
    let finish: ((value: Response) => void) | undefined;
    let signal: AbortSignal | null | undefined;
    let sent: FixtureChatRequest | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => {
        signal = options.signal;
        sent = readFixtureChatRequest(options);
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }),
    );
    const { rerender } = render(<ChatView characterId="synthetic-A" characterName="合成A" />);
    fireEvent.change(screen.getByPlaceholderText("メッセージを入力"), {
      target: { value: "合成Aの質問" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(signal?.aborted).toBe(false);
    rerender(<ChatView characterId="synthetic-B" characterName="合成B" />);
    expect(signal?.aborted).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("メッセージを入力"), {
      target: { value: "合成Bの下書き" },
    });
    await act(async () => {
      if (!sent) throw new Error("合成送信がありません");
      finish?.(reply(sent).response());
    });
    expect(screen.queryByText("合成Aの返信")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("メッセージを入力")).toHaveValue("合成Bの下書き");
    expect(screen.getByPlaceholderText("メッセージを入力")).toBeEnabled();
  });
});
