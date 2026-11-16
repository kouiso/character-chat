// /api/tts が応答しない環境（本番の Cloudflare Workers では localhost エンジンへ
// 届かない）でもブラウザ内蔵 TTS へ倒れて音声が出ることの回帰テスト。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const utterances: { text: string; lang: string }[] = [];

class FakeUtterance {
  text: string;
  lang = "";
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
    utterances.push(this);
  }
}

const fakeSpeech = {
  speaking: true,
  pending: false,
  getVoices: () => [],
  speak: vi.fn((u: FakeUtterance) => {
    setTimeout(() => {
      fakeSpeech.speaking = false;
      u.onend?.();
    }, 0);
  }),
  cancel: vi.fn(),
};

const loadTts = async () => {
  vi.resetModules();
  return import("./tts");
};

beforeEach(() => {
  utterances.length = 0;
  fakeSpeech.speaking = true;
  fakeSpeech.speak.mockClear();
  fakeSpeech.cancel.mockClear();
  vi.stubGlobal("speechSynthesis", fakeSpeech);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("playVoiceText fallback", () => {
  it("falls back to browser speechSynthesis when /api/tts fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const { playVoiceText } = await loadTts();
    playVoiceText("char-1", "<dialogue>こんにちは</dialogue>", () => {});
    await vi.advanceTimersByTimeAsync(10);
    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("こんにちは");
    expect(utterances[0].lang).toBe("ja-JP");
    expect(fakeSpeech.speak).toHaveBeenCalled();
  });

  it("skips server retry within cooldown and speaks further layers via browser TTS", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { playVoiceText } = await loadTts();
    playVoiceText("char-1", "<dialogue>一つ目</dialogue><dialogue>二つ目</dialogue>", () => {});
    await vi.advanceTimersByTimeAsync(10);
    // 1回目の /api/tts 失敗でダウン判定 → 2レイヤ目はサーバへ投げない
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(utterances.map((u) => u.text)).toEqual(["一つ目", "二つ目"]);
  });

  it("treats 501 (engine not configured) as permanent and never retries /api/tts", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 501 }));
    vi.stubGlobal("fetch", fetchMock);
    const { playVoiceText } = await loadTts();
    playVoiceText("char-1", "<dialogue>一発目</dialogue>", () => {});
    await vi.advanceTimersByTimeAsync(10);
    playVoiceText("char-1", "<dialogue>二発目</dialogue>", () => {});
    await vi.advanceTimersByTimeAsync(60_000);
    // 501 を受けた後はクールダウン切れを待たずに以後一切サーバへ投げない
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(utterances.map((u) => u.text)).toEqual(["一発目", "二発目"]);
  });

  it("does not speak narration or inner layers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const { playVoiceText } = await loadTts();
    playVoiceText(
      "char-1",
      "<action>微笑む</action><dialogue>台詞</dialogue><inner>心の声</inner>",
      () => {},
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(utterances.map((u) => u.text)).toEqual(["台詞"]);
  });
});
