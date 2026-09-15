import { describe, expect, it } from "vitest";

import { waitForStreamComplete } from "../browser-wait";

import type { Page } from "playwright";

type ProbeState = {
  installedAt: number;
  lastChatRequestAt: number | null;
  firstChunkAt: number | null;
  lastChunkAt: number | null;
  doneChunkAt: number | null;
};

type FakePageOptions = {
  probe: () => ProbeState;
  assistantText: () => string;
};

// waitForStreamComplete は page.evaluate へ文字列スクリプトを渡す。
// スクリプト本文で probe 読み取りと吹き出し読み取りを見分ける。
const createFakePage = ({ probe, assistantText }: FakePageOptions): Page => {
  const evaluate = async (script: unknown): Promise<unknown> => {
    const source = String(script);
    if (source.includes("__adultAiE2eStreamProbe") && source.includes("installedAt")) {
      return probe();
    }
    if (source.includes("message-bubble")) {
      const text = assistantText();
      return { exists: true, text, messageCount: 1, hasUiDone: false };
    }
    return undefined;
  };
  return { evaluate } as unknown as Page;
};

describe("waitForStreamComplete — 前ターンの完了信号で早期解決せん", () => {
  it("送信より前の doneChunkAt しか無い間は完了扱いにせん", async () => {
    const sendIssuedAt = Date.now();
    // 前ターンの要求と完了。どちらも送信クリックより前の時刻。
    const stale: ProbeState = {
      installedAt: sendIssuedAt - 60_000,
      lastChatRequestAt: sendIssuedAt - 30_000,
      firstChunkAt: sendIssuedAt - 29_000,
      lastChunkAt: sendIssuedAt - 25_000,
      doneChunkAt: sendIssuedAt - 24_000,
    };
    // 逐次配信で1文字目だけ描画された状態を再現する。
    const page = createFakePage({ probe: () => stale, assistantText: () => "赤" });

    await expect(waitForStreamComplete(page, 1_500, sendIssuedAt)).rejects.toThrow(
      /stream complete wait timed out/,
    );
  });

  it("このターンの要求と完了が揃えば本文を確定する", async () => {
    const sendIssuedAt = Date.now();
    const fresh: ProbeState = {
      installedAt: sendIssuedAt - 60_000,
      lastChatRequestAt: sendIssuedAt + 200,
      firstChunkAt: sendIssuedAt + 1_400,
      lastChunkAt: sendIssuedAt + 5_000,
      doneChunkAt: sendIssuedAt + 5_100,
    };
    const page = createFakePage({
      probe: () => fresh,
      assistantText: () => "本文がぜんぶ揃っとる返事",
    });

    const result = await waitForStreamComplete(page, 5_000, sendIssuedAt);

    expect(result.hasDoneSignal).toBe(true);
    expect(result.firstTokenMs).toBe(1_200);
  });

  it("基準時刻を渡さん場合は従来どおり probe の完了信号だけで解決する", async () => {
    const now = Date.now();
    const probe: ProbeState = {
      installedAt: now - 60_000,
      lastChatRequestAt: now - 30_000,
      firstChunkAt: now - 29_000,
      lastChunkAt: now - 25_000,
      doneChunkAt: now - 24_000,
    };
    const page = createFakePage({ probe: () => probe, assistantText: () => "既存の本文" });

    const result = await waitForStreamComplete(page, 5_000);

    expect(result.hasDoneSignal).toBe(true);
  });
});
