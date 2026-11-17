// 音声通話ループの検査。STT の結果を送ってから、返答が確定した時だけ読み上げることを確かめる。
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVoiceCall } from "./use-voice-call";

type Assistant = { text: string; id?: string; turn?: number } | undefined;

class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null =
    null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
}

const quotaResponse = () =>
  new Response(JSON.stringify({ remainingSeconds: 600 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const transcriptEvent = (text: string) => ({ results: [[{ transcript: text }]] });

describe("音声通話の送受話ループ", () => {
  let recognitions: FakeRecognition[];

  beforeEach(() => {
    recognitions = [];
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class {
      constructor() {
        const rec = new FakeRecognition();
        recognitions.push(rec);
        return rec;
      }
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => quotaResponse()),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const startCall = async (deps: Parameters<typeof useVoiceCall>[0]) => {
    const view = renderHook(() => useVoiceCall(deps));
    await act(async () => {
      await view.result.current.start();
    });
    return view;
  };

  it("返答が確定してから新しいアシスタント文を読み上げる", async () => {
    let assistant: Assistant = { text: "前の返事", id: "m1", turn: 1 };
    const sendText = vi.fn(async () => {
      // 本物の sendText は consume 完了まで待つ。解決時には履歴へ新しい返事が載る。
      assistant = { text: "新しい返事", id: "m2", turn: 2 };
    });
    const playVoice = vi.fn();
    const view = await startCall({
      sendText,
      latestAssistant: () => assistant,
      playVoice,
    });
    const rec = recognitions[0];

    await act(async () => {
      rec.onresult?.(transcriptEvent("こんにちは"));
      await Promise.resolve();
    });

    expect(sendText).toHaveBeenCalledWith("こんにちは");
    expect(playVoice).toHaveBeenCalledTimes(1);
    expect(playVoice.mock.calls[0][1]).toBe("新しい返事");
    expect(view.result.current.state).toBe("speaking");
    view.unmount();
  });

  it("返答が載らず終わった時は古い返事を読み直さず聞き返しへ戻る", async () => {
    const assistant: Assistant = { text: "前の返事", id: "m1", turn: 1 };
    const sendText = vi.fn(async () => {});
    const playVoice = vi.fn();
    const view = await startCall({
      sendText,
      latestAssistant: () => assistant,
      playVoice,
    });
    const rec = recognitions[0];

    await act(async () => {
      rec.onresult?.(transcriptEvent("こんにちは"));
      await Promise.resolve();
    });

    expect(playVoice).not.toHaveBeenCalled();
    expect(view.result.current.state).toBe("listening");
    // 聞き返しのために新しい認識が張り直される。
    expect(recognitions.length).toBe(2);
    view.unmount();
  });
});
