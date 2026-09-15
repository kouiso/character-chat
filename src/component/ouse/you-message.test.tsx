import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YouMessage } from "./you-message";

// 設計 C-3: 未送達（sendFailed）の自分の発言は破線＋再送/削除導線で描画する。
describe("YouMessage", () => {
  // フェイクタイマーの後始末をテスト本文から出し、途中失敗でも実タイマーへ確実に戻す
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("通常の発言は本文をそのまま表示し再送導線を出さない", () => {
    render(<YouMessage message={{ id: "u1", role: "user", content: "おはよう" }} />);
    expect(screen.getByText("おはよう")).toBeInTheDocument();
    expect(screen.queryByText("↻ タップで再送")).toBeNull();
  });

  it("未送達の発言はタップで再送、長押しで削除する", () => {
    const onRetry = vi.fn();
    const onDelete = vi.fn();
    render(
      <YouMessage
        message={{ id: "u2", role: "user", content: "それで？", sendFailed: true }}
        onRetry={onRetry}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText("↻ タップで再送")).toBeInTheDocument();
    expect(screen.getByText("長押しで削除")).toBeInTheDocument();

    const bubble = screen.getByRole("button", { name: "それで？（タップで再送）" });

    // 短いタップ: pointerdown → click で再送、削除は呼ばれない
    fireEvent.pointerDown(bubble);
    fireEvent.click(bubble);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();

    // 長押し: pointerdown のまま閾値経過で削除、その後の click では再送しない
    fireEvent.pointerDown(bubble);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(bubble);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // Chromium (Pixel 7 プロファイル) の実測イベント順:
  // pointerdown → touchstart → pointerup → pointerout → pointerleave → touchend
  // → mousedown → mouseup → click。pointerleave が click より先に来るため、
  // 離脱で「長押し済み」を立てとると、タッチのタップは必ず自分で自分を打ち消して
  // 再送が一度も走らんかった（マウスでは pointerleave が来んので気づけんかった）。
  it("タッチのイベント順（pointerup→pointerleave→click）でも再送する", () => {
    const onRetry = vi.fn();
    const onDelete = vi.fn();
    render(
      <YouMessage
        message={{ id: "u5", role: "user", content: "ねえ", sendFailed: true }}
        onRetry={onRetry}
        onDelete={onDelete}
      />,
    );
    const bubble = screen.getByRole("button", { name: "ねえ（タップで再送）" });

    fireEvent.pointerDown(bubble);
    fireEvent.pointerUp(bubble);
    fireEvent.pointerOut(bubble);
    fireEvent.pointerLeave(bubble);
    fireEvent.click(bubble);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  // タッチの長押しは「閾値で削除 → 指を離す → pointerout/pointerleave → click」の順で来る。
  // 離脱で長押し済みの印を消してまうと、削除した直後の click が再送として通り、
  // 消したはずの発言が送られる。離脱はタイマーを畳むだけで印には触らせん。
  it("タッチの長押しで削除した後、続く pointerleave→click で再送せん", () => {
    const onRetry = vi.fn();
    const onDelete = vi.fn();
    render(
      <YouMessage
        message={{ id: "u8", role: "user", content: "けして", sendFailed: true }}
        onRetry={onRetry}
        onDelete={onDelete}
      />,
    );
    const bubble = screen.getByRole("button", { name: "けして（タップで再送）" });

    fireEvent.pointerDown(bubble);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDelete).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(bubble);
    fireEvent.pointerOut(bubble);
    fireEvent.pointerLeave(bubble);
    fireEvent.click(bubble);

    expect(onRetry).not.toHaveBeenCalled();
  });

  // pointerleave が長押しタイマーを畳まんと、指が離れた後に閾値が来て
  // 触ってもいない削除が走る。畳むだけ・立てへんことの両方を固定する。
  it("指が離れた後は長押しの閾値が来ても削除せん", () => {
    const onDelete = vi.fn();
    render(
      <YouMessage
        message={{ id: "u6", role: "user", content: "まだ？", sendFailed: true }}
        onRetry={vi.fn()}
        onDelete={onDelete}
      />,
    );
    const bubble = screen.getByRole("button", { name: "まだ？（タップで再送）" });

    fireEvent.pointerDown(bubble);
    fireEvent.pointerLeave(bubble);
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(onDelete).not.toHaveBeenCalled();
  });

  // スクロール等で操作が奪われた（pointercancel）時は click 自体が来んのが普通やが、
  // 来た場合に再送してまうと「触ってへんのに送られた」になる。ここは抑え続ける。
  it("pointercancel で操作が奪われたら、その後の click では再送せん", () => {
    const onRetry = vi.fn();
    render(
      <YouMessage
        message={{ id: "u7", role: "user", content: "うん", sendFailed: true }}
        onRetry={onRetry}
        onDelete={vi.fn()}
      />,
    );
    const bubble = screen.getByRole("button", { name: "うん（タップで再送）" });

    fireEvent.pointerDown(bubble);
    fireEvent.pointerCancel(bubble);
    fireEvent.click(bubble);

    expect(onRetry).not.toHaveBeenCalled();
  });

  it("キーボードでも削除できる独立ボタンを備える", () => {
    const onDelete = vi.fn();
    render(
      <YouMessage
        message={{ id: "u3", role: "user", content: "ねえ", sendFailed: true }}
        onRetry={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "この発言を削除" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  // aria-label を「タップで再送」で上書きしとると、スクリーンリーダーは発言本文を
  // 一切読まず「タップで再送」としか聞こえない。本文をアクセシブル名の先頭に含める。
  it("未送達バブルのアクセシブル名は発言本文を含む", () => {
    render(
      <YouMessage
        message={{ id: "u4", role: "user", content: "今夜ひとりで寂しい", sendFailed: true }}
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "今夜ひとりで寂しい（タップで再送）" }),
    ).toBeInTheDocument();
  });
});

// 局長報告 2026-08-18:「タップで再送」を押しても何も起きん。
// cancelPress が立てる打ち消しの印を finishPress が戻してへんかったので、
// 一度 pointercancel が走った吹き出しは、以後どの click も飲み込んで
// 永久に再送でけへんボタンになっとった。
describe("再送ボタンが二度と押せんくならんこと", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("pointercancel で飲み込んだ後、次の click では再送する", () => {
    const onRetry = vi.fn();
    render(
      <YouMessage
        message={{ id: "u9", role: "user", content: "うん", sendFailed: true }}
        onRetry={onRetry}
        onDelete={vi.fn()}
      />,
    );
    const bubble = screen.getByRole("button", { name: "うん（タップで再送）" });

    fireEvent.pointerDown(bubble);
    fireEvent.pointerCancel(bubble);
    fireEvent.click(bubble);
    expect(onRetry).not.toHaveBeenCalled();

    // 支援技術やキーボードの click は pointerdown を伴わん。打ち消しの印が残っとると
    // ここも飲み込まれ、二度と再送でけへんボタンになる。
    fireEvent.click(bubble);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
