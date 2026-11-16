import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CharacterMemorySection,
  memoryKindsSummary,
  type CharacterMemoryPolicy,
} from "./character-memory-section";

const base: CharacterMemoryPolicy = {
  memoryInstruction: "",
  memoryKinds: ["fact", "preference"],
};

afterEach(cleanup);

const openSection = () => fireEvent.click(screen.getByRole("button", { name: /^記憶/ }));

describe("CharacterMemorySection", () => {
  it("畳んだ時は「記憶」と要約の 1 行だけを出し、中身は出さん", () => {
    render(<CharacterMemorySection value={base} onChange={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: /^記憶/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("記憶");
    expect(toggle).toHaveTextContent("事実と好みを覚える");
    expect(screen.queryByLabelText("何を覚えるか")).toBeNull();
    expect(screen.queryByRole("button", { name: "覚える種類: 事実" })).toBeNull();
  });

  it("要約は選んだ種類だけを言う（両方・事実だけ・好みだけ・なし）", () => {
    expect(memoryKindsSummary(["fact", "preference"])).toBe("事実と好みを覚える");
    expect(memoryKindsSummary(["fact"])).toBe("事実を覚える");
    expect(memoryKindsSummary(["preference"])).toBe("好みを覚える");
    expect(memoryKindsSummary([])).toBe("何も覚えない");
  });

  it("ひらくと「何を覚えるか」・「覚える種類」の切り替え・注を板どおりに出す", () => {
    render(
      <CharacterMemorySection
        value={{ ...base, memoryInstruction: "いつもの注文と、疲れていた日のことを覚えておく。" }}
        onChange={vi.fn()}
      />,
    );
    openSection();
    expect(screen.getByRole("button", { name: /^記憶/ })).toHaveAttribute("aria-expanded", "true");

    const textarea = screen.getByLabelText("何を覚えるか");
    expect(textarea).toHaveAttribute("maxlength", "2000");
    expect(textarea).toHaveValue("いつもの注文と、疲れていた日のことを覚えておく。");

    const group = screen.getByRole("group", { name: "覚える種類" });
    expect(group).toBeInTheDocument();
    const fact = screen.getByRole("button", { name: "覚える種類: 事実" });
    const preference = screen.getByRole("button", { name: "覚える種類: 好み" });
    expect(fact).toHaveAttribute("aria-pressed", "true");
    expect(preference).toHaveAttribute("aria-pressed", "true");

    expect(screen.getByText("両方切ると、何も覚えません。")).toBeInTheDocument();
    expect(screen.getByText(/覚えた事は、会話ごとに見られます。/)).toHaveTextContent(
      "トークの「≡」→「記憶」にあります。",
    );
  });

  it("種類のボタンを押すと onChange に選び直した種類を渡す（外す・足す）", () => {
    const onChange = vi.fn();
    const view = render(<CharacterMemorySection value={base} onChange={onChange} />);
    openSection();

    fireEvent.click(screen.getByRole("button", { name: "覚える種類: 事実" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...base, memoryKinds: ["preference"] });

    view.unmount();
    onChange.mockClear();
    render(<CharacterMemorySection value={{ ...base, memoryKinds: [] }} onChange={onChange} />);
    openSection();
    const fact = screen.getByRole("button", { name: "覚える種類: 事実" });
    expect(fact).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(fact);
    expect(onChange).toHaveBeenLastCalledWith({ ...base, memoryKinds: ["fact"] });
  });

  it("「何を覚えるか」への入力は onChange へそのまま渡る", () => {
    const onChange = vi.fn();
    render(<CharacterMemorySection value={base} onChange={onChange} />);
    openSection();
    fireEvent.change(screen.getByLabelText("何を覚えるか"), {
      target: { value: "好きな食べ物と飲み物を覚える" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...base,
      memoryInstruction: "好きな食べ物と飲み物を覚える",
    });
  });

  it("もう一度押すと畳んで要約へ戻る", () => {
    render(
      <CharacterMemorySection
        value={{ ...base, memoryKinds: ["preference"] }}
        onChange={vi.fn()}
      />,
    );
    openSection();
    fireEvent.click(screen.getByRole("button", { name: /^記憶/ }));
    const toggle = screen.getByRole("button", { name: /^記憶/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("好みを覚える");
    expect(screen.queryByLabelText("何を覚えるか")).toBeNull();
  });
});
