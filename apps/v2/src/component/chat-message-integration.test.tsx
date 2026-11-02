import { extractVoice, judgeChunk } from "@v2/judge";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatView } from "./chat-view";

import type { ChatSseEvent } from "../lib/sse-events";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ChatView message 表示接続", () => {
  it("既存の復旧対応経路から chunk を表示し、更新と履歴読込でも本文を重複させない", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const reply =
      "<action>地図を開く。</action><dialogue>「出発しよう👩🏽‍🚀」</dialogue><inner>次の道が楽しみ。</inner>";
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST")
        return Response.json({
          turn: 2,
          history: [
            { role: "user", content: "合成の公園へ行こう🙂" },
            { role: "assistant", content: reply },
          ],
        });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView characterId="synthetic-guide" characterName="サンプル案内役" />);
    fireEvent.change(screen.getByPlaceholderText("メッセージを入力"), {
      target: { value: "合成の公園へ行こう🙂" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/synthetic-guide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: expect.any(AbortSignal),
      body: expect.any(String),
    });
    const posted: unknown = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(posted).toEqual({
      conversationId: expect.any(String),
      requestId: expect.any(String),
      text: "合成の公園へ行こう🙂",
      retry: false,
    });
    expect(screen.getByRole("group", { name: "あなたのメッセージ" })).toHaveTextContent(
      "合成の公園へ行こう🙂",
    );
    const encoder = new TextEncoder();
    const emit = (event: ChatSseEvent) => {
      if (!streamController) throw new Error("合成ストリームが未接続");
      streamController.enqueue(
        encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
      );
    };
    const emitChunk = (seq: number, text: string) =>
      emit({
        type: "chunk",
        seq,
        text,
        judge: judgeChunk(text, { previousChunks: [], voice: extractVoice("合成案内役") }),
        attempt: 1,
        preExtend: false,
      });

    emitChunk(0, "<response><action>仮の描写。</action><dia");
    expect(await screen.findByRole("group", { name: "描写" })).toHaveTextContent("仮の描写。");
    expect(screen.queryByText(/<dia/)).not.toBeInTheDocument();

    emitChunk(0, "<action>地図を開く。</action><dialogue>「出発しよう👩🏽‍🚀」</dialogue>");
    emitChunk(1, "<inner>次の道が楽しみ。</inner>");
    emit({ type: "done", conversationId: "synthetic-conversation", turn: 1, generationId: null });
    streamController?.close();

    expect(await screen.findByRole("group", { name: "心の声" })).toHaveTextContent(
      "次の道が楽しみ。",
    );
    expect(screen.getByRole("group", { name: "描写" })).toHaveTextContent("地図を開く。");
    expect(screen.getAllByRole("group", { name: "台詞" })).toHaveLength(1);
    expect(screen.queryByText("仮の描写。")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText("メッセージを入力")).toBeEnabled());
    expect(screen.getByRole("group", { name: "心の声" }).closest(".pending")).toBeNull();
  });
});
