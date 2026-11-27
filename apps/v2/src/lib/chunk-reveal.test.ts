import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { revealBaseAt, revealChunk, scheduleReveal } from "./chunk-reveal";

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
    // 部屋が保存してから 2 分後に開き直した。再生された done の経過（serverNow - savedAt）は 2 分。
    const savedAt = 5_000_000;
    const baseAt = revealBaseAt({ savedAt, serverNow: savedAt + 120_000 });
    const cancel = scheduleReveal(
      ["一", "二", "三"],
      [0, 5000, 10_000],
      (text, more) => revealed.push({ text, more }),
      baseAt,
    );
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

  // 予定は「最初の塊からの経過ミリ秒」。サーバと端末の時計が数分ずれても間は同じ。
  it.each([
    ["サーバが端末より 5 分進んでいる", 5 * 60_000],
    ["サーバが端末より 5 分遅れている", -5 * 60_000],
    ["時計はずれていない", 0],
  ])("%s: 塊の間隔は変わらない", (_label, skew) => {
    const serverNow = Date.now() + skew;
    // 経過ミリ秒の形（新）と絶対時刻の形（旧）の両方で、同じ間隔になる。
    for (const sendAt of [
      [0, 1000, 3000],
      [serverNow, serverNow + 1000, serverNow + 3000],
    ]) {
      revealed = [];
      const cancel = start(["一", "二", "三"], sendAt);
      expect(revealed.map((item) => item.text)).toEqual(["一"]);
      vi.advanceTimersByTime(999);
      expect(revealed).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(revealed).toHaveLength(2);
      vi.advanceTimersByTime(1999);
      expect(revealed).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(revealed).toHaveLength(3);
      cancel();
    }
  });

  it("旧形式の絶対時刻でも、先頭を引いた同じ間隔として読む（端末の時計と無関係）", () => {
    const serverNow = Date.now() - 5 * 60_000;
    const cancel = start(["一", "二"], [serverNow, serverNow + 1000]);
    expect(revealed).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(revealed).toHaveLength(2);
    cancel();
  });

  // 生成の 60 秒は保存より前なので、done の経過（保存から配るまで）には入らん。間は崩れない。
  it("生成に 60 秒かかっても、保存直後に配った done なら間は崩れない", () => {
    const savedAt = 9_000_000;
    vi.advanceTimersByTime(60_000);
    const baseAt = revealBaseAt({ savedAt, serverNow: savedAt + 30 });
    const cancel = scheduleReveal(
      ["一", "二", "三"],
      [0, 1000, 3000],
      (text, more) => revealed.push({ text, more }),
      baseAt,
    );
    expect(revealed).toHaveLength(1);
    vi.advanceTimersByTime(969);
    expect(revealed).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(revealed).toHaveLength(2);
    cancel();
  });

  it.each([5 * 60_000, -5 * 60_000])(
    "端末の時計が %i ms ずれても、基準はサーバどうしの差だけで決まる",
    (skew) => {
      vi.setSystemTime(1_000_000 + skew);
      expect(revealBaseAt({ savedAt: 7_000_000, serverNow: 7_000_400 })).toBe(Date.now() - 400);
      expect(revealBaseAt({ savedAt: 7_000_000, serverNow: 6_999_000 })).toBe(Date.now());
    },
  );

  it("経過が付かん done（旧形式）は受け取った今が基準", () => {
    expect(revealBaseAt({})).toBe(Date.now());
    expect(revealBaseAt({ savedAt: 1 })).toBe(Date.now());
  });

  it("待たせた分が間より短い時は、残りの間だけ待つ", () => {
    const firstChunkAt = Date.now();
    vi.advanceTimersByTime(800);
    const cancel = scheduleReveal(
      ["一", "二"],
      [0, 1000],
      (text, more) => revealed.push({ text, more }),
      firstChunkAt,
    );
    expect(revealed).toHaveLength(1);
    vi.advanceTimersByTime(199);
    expect(revealed).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(revealed).toHaveLength(2);
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
