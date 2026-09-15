import { afterEach, describe, expect, it, vi } from "vitest";

import { streamChat, streamChatWithQualityGuard } from "./api";

const TEST_MESSAGES = [
  { role: "system" as const, content: "you are helpful" },
  { role: "user" as const, content: "hello" },
];

describe("OpenRouter chat reply guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const readFetchPayload = (fetchMock: ReturnType<typeof vi.spyOn>): Record<string, unknown> => {
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.body).toEqual(expect.any(String));
    return JSON.parse(String(init?.body)) as Record<string, unknown>;
  };

  it("streamChat preserves /api/chat request body shape", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("data: [DONE]\\n\\n"));

    await streamChat(
      TEST_MESSAGES,
      "openrouter/test-model",
      () => undefined,
      () => undefined,
      () => undefined,
      "char_123",
      "long",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = readFetchPayload(fetchMock);

    expect(payload).toEqual({
      messages: TEST_MESSAGES,
      model: "openrouter/test-model",
      characterId: "char_123",
      responseLength: "long",
    });
  });

  it("streamChatWithQualityGuard preserves /api/chat request body shape including streamId", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("data: [DONE]\\n\\n"));

    await streamChatWithQualityGuard(
      TEST_MESSAGES,
      "openrouter/test-model",
      () => undefined,
      () => undefined,
      () => undefined,
      { phase: "conversation" },
      "char_456",
      "very_long",
      "stream_789",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = readFetchPayload(fetchMock);

    expect(payload).toEqual({
      messages: TEST_MESSAGES,
      model: "openrouter/test-model",
      characterId: "char_456",
      responseLength: "very_long",
      streamId: "stream_789",
      scenePhase: "conversation",
    });
  });

  it("surfaces sanitized non-ok response errors from streamChat without swallowing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("openrouter upstream failed", { status: 502 }),
    );

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat(TEST_MESSAGES, "openrouter/test-model", onChunk, onDone, onError);

    expect(onError).toHaveBeenCalledWith(
      "サーバーエラーが発生しました。しばらく待ってから再試行してください",
    );
    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("surfaces sanitized non-ok response errors from streamChatWithQualityGuard without swallowing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("guard failed", { status: 500 }));

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChatWithQualityGuard(
      TEST_MESSAGES,
      "openrouter/test-model",
      onChunk,
      onDone,
      onError,
      { phase: "conversation" },
    );

    expect(onError).toHaveBeenCalledWith(
      "サーバーエラーが発生しました。しばらく待ってから再試行してください",
    );
    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
