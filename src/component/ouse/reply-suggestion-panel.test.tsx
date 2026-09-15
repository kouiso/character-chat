import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OU2 } from "./ouse-tokens";
import { ReplySuggestionPanel } from "./reply-suggestion-panel";

const SUGGESTIONS = [
  "（優しく微笑み）可愛いなぁ、本当に俺のものだよ。",
  "（少し困った顔）どうしよう、止められないくらい気持ち良すぎて。",
  "（耳元に口を寄せ）今どこが一番いいか、言ってみて。",
];

describe("返信候補パネル", () => {
  afterEach(cleanup);

  it("候補を押せる行として並べる", () => {
    const onSelect = vi.fn();
    render(
      <ReplySuggestionPanel
        status="ready"
        suggestions={SUGGESTIONS}
        onSelect={onSelect}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: SUGGESTIONS[1] }));

    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[1]);
  });

  // 送らんことがこの機能の前提。押した先の文言でそれを伝えとらんと、送信済みと誤解される。
  it("押しても送らんことを画面で言う", () => {
    render(
      <ReplySuggestionPanel
        status="ready"
        suggestions={SUGGESTIONS}
        onSelect={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("押すと入力欄に入る。送信はまだせん。")).toBeVisible();
  });

  it("読み込み中は候補を出さず、出し直しも押させん", () => {
    render(
      <ReplySuggestionPanel
        status="loading"
        suggestions={[]}
        onSelect={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("言いかたを探しとる…")).toBeVisible();
    expect(screen.getByRole("button", { name: "出し直す" })).toBeDisabled();
  });

  it("失敗しても閉じずに、もう一度の口を残す", () => {
    const onRegenerate = vi.fn();
    render(
      <ReplySuggestionPanel
        status="error"
        suggestions={[]}
        onSelect={vi.fn()}
        onRegenerate={onRegenerate}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));

    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("別の組を取りに行ける", () => {
    const onRegenerate = vi.fn();
    render(
      <ReplySuggestionPanel
        status="ready"
        suggestions={SUGGESTIONS}
        onSelect={vi.fn()}
        onRegenerate={onRegenerate}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "出し直す" }));

    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("閉じる口が支援技術にも届く", () => {
    const onClose = vi.fn();
    render(
      <ReplySuggestionPanel
        status="ready"
        suggestions={SUGGESTIONS}
        onSelect={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "返信の候補を閉じる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // OU2「燈」のチップと同じ見た目にしとかんと、入力欄の上に別のデザインが挟まる。
  it("候補行はチップと同じトークンで描く", () => {
    render(
      <ReplySuggestionPanel
        status="ready"
        suggestions={SUGGESTIONS}
        onSelect={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: SUGGESTIONS[0] })).toHaveStyle({
      border: `1px solid ${OU2.chipBorder}`,
      background: OU2.chipBg,
      color: OU2.chipText,
    });
  });
});
