import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuScenePicker } from "./ou-scene-picker";

// 「あたらしいシーンをはじめる」のチップは padding 8px + 12px 文字で約 30px 高しかなく、
// 折り返した密な行に並ぶ。新規シーンの主導線なので、掴めんと入口ごと失う。
// jsdom は ::before を計算せんため、当たりを広げるクラスと行間の値で固定する。
describe("OuScenePicker のシーンチップ", () => {
  afterEach(cleanup);

  const renderPicker = () =>
    render(
      <OuScenePicker
        characterId="char-mitsuki"
        characterName="みつき"
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

  it("チップは 44px の当たりを持つが、描画の padding は据え置き", () => {
    renderPicker();

    const chip = screen.getByRole("button", { name: "自由に書く…" });
    expect(chip.className).toContain("before:min-h-[44px]");
    expect(chip.className).toContain("before:min-w-[44px]");
    expect(chip.style.padding).toBe("8px 14px");
  });

  it("折り返した行同士で当たりが重ならないだけの rowGap を持つ", () => {
    renderPicker();

    const row = screen.getByRole("button", { name: "自由に書く…" }).parentElement;
    // 当たりは上下 7px ずつはみ出す。rowGap がそれを下回ると上の行のタップが下へ吸われる。
    expect(Number.parseFloat(row?.style.rowGap ?? "0")).toBeGreaterThanOrEqual(14);
  });
});
