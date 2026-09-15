import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChipsPanel } from "./chips-panel";

// 「セリフを渡す」「ふるまいを渡す」はトグルなのに、選択中かどうかが枠線と背景の
// 色差だけで示されていた。支援技術にも色を見分けられん人にも状態が届いていない。
describe("ChipsPanel の say/do トグル", () => {
  afterEach(cleanup);

  const renderPanel = (sayDoMode: "say" | "do" | null) =>
    render(
      <ChipsPanel
        sayDoMode={sayDoMode}
        onSayDoChange={vi.fn()}
        responseLength="medium"
        onLengthChange={vi.fn()}
        onSuggestToggle={vi.fn()}
        suggestOpen={false}
        canSuggest
        disabled={false}
      />,
    );

  it("未選択なら両方 aria-pressed=false", () => {
    renderPanel(null);

    expect(screen.getByRole("button", { name: "セリフを渡す" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "ふるまいを渡す" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("選択中のほうだけ aria-pressed=true になる", () => {
    renderPanel("say");

    expect(screen.getByRole("button", { name: "セリフを渡す" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "ふるまいを渡す" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("押すと呼び出し側へトグルが伝わる（状態表示を足しても配線は変わらん）", () => {
    const onSayDoChange = vi.fn();
    render(
      <ChipsPanel
        sayDoMode="do"
        onSayDoChange={onSayDoChange}
        responseLength="medium"
        onLengthChange={vi.fn()}
        onSuggestToggle={vi.fn()}
        suggestOpen={false}
        canSuggest
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "ふるまいを渡す" }));

    expect(onSayDoChange).toHaveBeenCalledWith(null);
  });
});

// 会話が始まるまで押せんのに、生きたチップと同じ見た目やと押しても何も起きん。
// 初心者が最初に触るチップなので、押せんことが見た目で分からんと行き止まりになる。
describe("ChipsPanel の「なんて言う？」チップ", () => {
  afterEach(cleanup);

  const renderPanel = (canSuggest: boolean) =>
    render(
      <ChipsPanel
        sayDoMode={null}
        onSayDoChange={vi.fn()}
        responseLength="medium"
        onLengthChange={vi.fn()}
        onSuggestToggle={vi.fn()}
        suggestOpen={false}
        canSuggest={canSuggest}
        disabled={false}
      />,
    );

  it("押せん時は生きたチップと見た目が変わる", () => {
    renderPanel(false);

    const suggest = screen.getByRole("button", { name: "なんて言う？" });
    const alive = screen.getByRole("button", { name: "セリフを渡す" });

    expect(suggest).toBeDisabled();
    expect(suggest.style.opacity).not.toBe(alive.style.opacity);
    expect(Number(suggest.style.opacity)).toBeLessThan(1);
    expect(suggest).toHaveAttribute("aria-disabled", "true");
    expect(suggest).toHaveAttribute("title");
  });

  it("押せる時は薄めん", () => {
    renderPanel(true);

    const suggest = screen.getByRole("button", { name: "なんて言う？" });

    expect(suggest).toBeEnabled();
    expect(suggest.style.opacity).toBe("");
  });
});
