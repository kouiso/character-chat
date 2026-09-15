import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuReplySettingsSheet } from "./ou-reply-settings-sheet";

// この子との設定シートは、トグルが 46x26、セグメントが約 40px 高で、
// どちらも指の当たりが 44px に届いていなかった。密な見た目は仕様なので、
// 描画サイズは据え置きのまま ::before で当たりだけ広げる。
// jsdom は ::before を計算せんため、クラスの有無で固定する。
describe("OuReplySettingsSheet のタップ領域", () => {
  afterEach(cleanup);

  const renderSheet = () =>
    render(
      <OuReplySettingsSheet open onOpenChange={vi.fn()} characterId="c1" characterName="みつき" />,
    );

  it("トグルは 46x26 の描画のまま 44px の当たりを持つ", () => {
    renderSheet();

    // 「文章のみモード」のトグルは 2026-08-17 に撤去した（写真を混ぜる OFF と同義で、
    // 両方 ON が矛盾する状態を作れとった）。残っとるトグルで当たり判定を見る。
    const toggle = screen.getByRole("switch", { name: "会話に写真を混ぜる" });
    expect(toggle.className).toContain("h-[26px]");
    expect(toggle.className).toContain("w-[46px]");
    expect(toggle.className).toContain("before:min-h-[44px]");
    expect(toggle.className).toContain("before:min-w-[44px]");
  });

  it("文章の長さのセグメントも 44px の当たりを持つ", () => {
    renderSheet();

    const segment = screen.getByRole("button", { name: "たっぷり" });
    expect(segment.className).toContain("before:min-h-[44px]");
    expect(segment.className).toContain("before:min-w-[44px]");
    // 描画の余白は据え置き（膨らませて解決してへんこと）
    expect(segment.className).toContain("py-2.5");
  });
});
