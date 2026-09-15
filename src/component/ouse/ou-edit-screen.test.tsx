import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuEditScreen } from "./ou-edit-screen";

const CHARACTER = {
  id: "char-1",
  userId: "user-1",
  name: "テスト",
  avatar: null,
  systemPrompt: "テスト用",
  greeting: "",
  tags: [],
  createdAt: 0,
};

// 金枠・金文字で主要アクションに見えるのに click が no-op やと、押した人が黙って止まる。
// 未実装は他所（返事の設定シート）と同じ「近日対応」で見せる。
describe("OuEditScreen の AI 描き直し", () => {
  afterEach(cleanup);

  it("未実装であることが文字と見た目で分かる", () => {
    render(
      <OuEditScreen character={CHARACTER} onSave={vi.fn()} onDelete={vi.fn()} onBack={vi.fn()} />,
    );

    const redraw = screen.getByRole("button", { name: /AIで描き直す/u });

    expect(redraw).toHaveTextContent("近日対応");
    expect(redraw).toBeDisabled();
    expect(redraw).toHaveAttribute("aria-disabled", "true");
    expect(redraw.className).toContain("opacity-40");
  });
});
