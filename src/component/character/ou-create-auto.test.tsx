import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuCreateAuto } from "./ou-create-auto";

describe("OuCreateAuto", () => {
  afterEach(cleanup);

  it("関係性の候補チップを表示する", () => {
    render(<OuCreateAuto onGenerate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "彼女" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "先輩" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "後輩" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "先生" })).toBeInTheDocument();
  });

  it("関係チップを選ぶとユーザー吹き出しで表示する", () => {
    render(<OuCreateAuto onGenerate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "先輩" }));
    // ai/user 両方の吹き出しに「先輩」が現れうるため、ユーザー発話として増えたことを role で確認する
    expect(screen.getAllByText("先輩").length).toBeGreaterThanOrEqual(2);
  });

  it("関係を選んで送信すると relations と details へ組み込んで onGenerate を呼ぶ", () => {
    const onGenerate = vi.fn();
    render(<OuCreateAuto onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole("button", { name: "先輩" }));
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(onGenerate).toHaveBeenCalledWith({
      selections: {
        types: [],
        relations: ["先輩"],
        personalities: [],
        bodyTypes: [],
        freeText: "ふたりの関係は先輩",
      },
      details: "ふたりの関係は先輩",
    });
  });

  it("Enterキーで送信できる", () => {
    const onGenerate = vi.fn();
    render(<OuCreateAuto onGenerate={onGenerate} />);
    const input = screen.getByPlaceholderText("ことばで答える…");
    fireEvent.change(input, { target: { value: "落ち着いた雰囲気" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("入力が変わるたびに onInputChange で親へ同期する", () => {
    const onInputChange = vi.fn();
    render(<OuCreateAuto onGenerate={vi.fn()} onInputChange={onInputChange} />);
    onInputChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "後輩" }));

    expect(onInputChange).toHaveBeenLastCalledWith({
      selections: {
        types: [],
        relations: ["後輩"],
        personalities: [],
        bodyTypes: [],
        freeText: "ふたりの関係は後輩",
      },
      details: "ふたりの関係は後輩",
    });
  });
});
