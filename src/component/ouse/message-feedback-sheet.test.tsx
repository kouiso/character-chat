import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageFeedbackSheet } from "./message-feedback-sheet";

// 2026-07-14: 局長の bad フィードバックで reason が D1 に NULL 保存された実インシデントの再現。
// 原因は「理由未選択のまま送信できる」UX ギャップ（配線自体は正しい）。
// このテストは理由未選択のままの送信を禁止し、選択後は reason 付きで送信されることを固定する。
describe("MessageFeedbackSheet", () => {
  afterEach(() => {
    cleanup();
  });

  const renderSheet = (onSubmit = vi.fn()) => {
    render(<MessageFeedbackSheet open={true} onOpenChange={vi.fn()} onSubmit={onSubmit} />);
    return onSubmit;
  };

  it("理由未選択のまま「伝えて書き直させる」を押しても送信されない（サイレントバグの再現防止）", () => {
    const onSubmit = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "伝えて書き直させる" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("理由未選択のまま「伝えるだけ」を押しても送信されない", () => {
    const onSubmit = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "伝えるだけ" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("未選択のあいだ両ボタンは disabled になっている", () => {
    renderSheet();

    expect(screen.getByRole("button", { name: "伝えて書き直させる" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "伝えるだけ" })).toBeDisabled();
  });

  // チップは描画上 36px 高で、指の当たりが 44px に届いていなかった。
  // jsdom は ::before を計算せんため、当たりを広げるクラスの有無で固定する。
  it("理由チップは 44px の当たりを持つ（見た目の 36px は据え置き）", () => {
    renderSheet();

    const chip = screen.getByRole("button", { name: "口調がちがう" });
    expect(chip.className).toContain("min-h-[36px]");
    expect(chip.className).toContain("before:min-h-[44px]");
    expect(chip.className).toContain("before:min-w-[44px]");
  });

  it("定型理由を選択すると reason 付きで送信できる", () => {
    const onSubmit = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "口調がちがう" }));
    expect(screen.getByRole("button", { name: "伝えて書き直させる" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "伝えて書き直させる" }));

    expect(onSubmit).toHaveBeenCalledWith({ reason: "口調がちがう", rewrite: true });
  });

  it("自由記述を選んだだけ（未入力）では送信できない", () => {
    const onSubmit = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "ことばで伝える…" }));
    expect(screen.getByRole("button", { name: "伝えるだけ" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "伝えるだけ" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("自由記述を入力すると reason 付きで送信できる", () => {
    const onSubmit = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "ことばで伝える…" }));
    fireEvent.change(screen.getByLabelText("ことばで伝える"), {
      target: { value: "もっと察してほしかった" },
    });
    expect(screen.getByRole("button", { name: "伝えるだけ" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "伝えるだけ" }));

    expect(onSubmit).toHaveBeenCalledWith({
      reason: "もっと察してほしかった",
      rewrite: false,
    });
  });

  it("自由記述が空白のみの場合は送信できない", () => {
    const onSubmit = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "ことばで伝える…" }));
    fireEvent.change(screen.getByLabelText("ことばで伝える"), {
      target: { value: "   " },
    });

    fireEvent.click(screen.getByRole("button", { name: "伝えるだけ" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
