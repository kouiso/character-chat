import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { revealChunk, scheduleReveal } from "./chunk-reveal";

import type { ChatBubble } from "./chat-session";

const pendingAssistant: ChatBubble = { role: "assistant", text: "", pending: true };
const userBubble: ChatBubble = { role: "user", text: "質問" };

describe("scheduleReveal", () => {
  let revealed: { text: string; more: boolean }[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    revealed = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const start = (texts: string[], sendAt: number[] | undefined) =>
    scheduleReveal(texts, sendAt, (text, more) => revealed.push({ text, more }));

  it("sendAt が無い（旧形式）ときは全部即座に出る", () => {
    const cancel = start(["一", "二"], undefined);
    expect(revealed).toEqual([
      { text: "一", more: true },
      { text: "二", more: false },
    ]);
    cancel();
  });

  it("sendAt が空配列（保存済み復帰）でも全部即座に出る", () => {
    const cancel = start(["一", "二"], []);
    expect(revealed).toHaveLength(2);
    cancel();
  });

  it("予定時刻より前の塊は出さず、時刻が来た順に出す", () => {
    const now = Date.now();
    const cancel = start(["一", "二", "三"], [now, now + 1000, now + 3000]);

    expect(revealed).toEqual([{ text: "一", more: true }]);

    vi.advanceTimersByTime(999);
    expect(revealed).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(revealed).toEqual([
      { text: "一", more: true },
      { text: "二", more: true },
    ]);

    vi.advanceTimersByTime(2000);
    expect(revealed).toEqual([
      { text: "一", more: true },
      { text: "二", more: true },
      { text: "三", more: false },
    ]);
    cancel();
  });

  it("予定時刻を全部過ぎておる分は一度に出る（再オープンで1秒以内に揃う）", () => {
    const now = Date.now();
    const cancel = start(["一", "二", "三"], [now - 3000, now - 2000, now - 1000]);
    expect(revealed).toEqual([
      { text: "一", more: true },
      { text: "二", more: true },
      { text: "三", more: false },
    ]);
    cancel();
  });

  it("裏タブでタイマが遅れても、可視化の戻りで経過分がまとめて出る", () => {
    const now = Date.now();
    const cancel = start(["一", "二", "三"], [now, now + 1000, now + 2000]);
    expect(revealed).toHaveLength(1);

    // タイマを止めたまま時計だけ進める = 裏タブでスロットリングされた状態。
    vi.advanceTimersByTime(5000);
    // 裏ではまだ出ず（タイマが次回予定で残っても、戻った時に一括で出る）。
    const dispatched = new Event("visibilitychange");
    document.dispatchEvent(dispatched);
    expect(revealed).toEqual([
      { text: "一", more: true },
      { text: "二", more: true },
      { text: "三", more: false },
    ]);
    cancel();
  });

  it("時計がサーバより進んでおっても（時刻ズレ）過ぎた分は即出る", () => {
    // サーバ時刻基準の予定時刻が全部過去に見える端末。
    const serverNow = Date.now() - 60_000;
    const cancel = start(["一", "二"], [serverNow, serverNow + 1000]);
    expect(revealed).toHaveLength(2);
    cancel();
  });

  it("時計がサーバより遅れておっても、遅れた分だけ待って出る", () => {
    // サーバの now より端末が 5 分遅れ → 予定時刻が未来に見える。
    const serverNow = Date.now() + 5 * 60_000;
    const cancel = start(["一", "二"], [serverNow, serverNow + 1000]);
    expect(revealed).toHaveLength(0);
    vi.advanceTimersByTime(5 * 60_000 + 1000);
    expect(revealed).toEqual([
      { text: "一", more: true },
      { text: "二", more: false },
    ]);
    cancel();
  });

  it("cancel で途中の塊は出なくなる", () => {
    const now = Date.now();
    const cancel = start(["一", "二"], [now, now + 1000]);
    expect(revealed).toHaveLength(1);
    cancel();
    vi.advanceTimersByTime(5000);
    expect(revealed).toHaveLength(1);
  });
});

describe("revealChunk", () => {
  it("末尾の入力中塊の直前へ届いた分を積む", () => {
    const prev = [userBubble, pendingAssistant];
    const next = revealChunk(prev, "一つ目", true);
    expect(next).toEqual([userBubble, { role: "assistant", text: "一つ目" }, pendingAssistant]);
  });

  it("最後の塊で入力中を外す", () => {
    const prev: ChatBubble[] = [
      userBubble,
      { role: "assistant", text: "一つ目" },
      pendingAssistant,
    ];
    const next = revealChunk(prev, "二つ目", false);
    expect(next).toEqual([
      userBubble,
      { role: "assistant", text: "一つ目" },
      { role: "assistant", text: "二つ目" },
    ]);
  });

  it("入力中塊が無くても末尾へ積む", () => {
    const next = revealChunk([userBubble], "返事", false);
    expect(next).toEqual([userBubble, { role: "assistant", text: "返事" }]);
  });
});
