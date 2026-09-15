import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuOnboarding } from "./ou-onboarding";

// オンボーディング（設計 2d）: 3タップ選択で CTA が有効化し、完了で onComplete を呼ぶ。
describe("OuOnboarding", () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem("ou_onboarded");
    localStorage.removeItem("ou-onboarding-prefs");
  });

  it("初期は3つの気分軸と非活性の会いに行くCTAを表示する", () => {
    render(<OuOnboarding onComplete={vi.fn()} />);
    expect(screen.getByText("距離感")).toBeInTheDocument();
    expect(screen.getByText("相手")).toBeInTheDocument();
    expect(screen.getByText("ことば")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "会いに行く →" })).toBeDisabled();
  });

  it("3つ選ぶとCTAが有効化し完了で選択を保存して onComplete を呼ぶ", () => {
    const onComplete = vi.fn();
    render(<OuOnboarding onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "甘やかされたい" }));
    fireEvent.click(screen.getByRole("button", { name: "年上" }));
    fireEvent.click(screen.getByRole("button", { name: "敬語" }));

    const cta = screen.getByRole("button", { name: "会いに行く →" });
    expect(cta).toBeEnabled();

    fireEvent.click(cta);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("ou_onboarded")).toBe("1");
    expect(JSON.parse(localStorage.getItem("ou-onboarding-prefs") ?? "{}")).toMatchObject({
      distance: "甘やかされたい",
      partner: "年上",
      tone: "敬語",
    });
  });
});
