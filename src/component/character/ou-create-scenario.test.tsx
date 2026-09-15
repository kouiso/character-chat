import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuCreateScenario } from "./ou-create-scenario";

const SCENARIO_TEXT = "つかさ\n家庭教師として週に二度、俺の部屋にやってくる。";

describe("OuCreateScenario", () => {
  afterEach(cleanup);

  it("未入力では読み取りパネルを出さず、つくるボタンは無効", () => {
    render(<OuCreateScenario onGenerate={vi.fn()} />);
    expect(screen.queryByText("読み取り中…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "つくる" })).toBeDisabled();
  });

  it("テキストを貼ると登場人物と場面を読み取って表示し、ボタンが有効になる", () => {
    render(<OuCreateScenario onGenerate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/週に二度/), {
      target: { value: SCENARIO_TEXT },
    });

    expect(screen.getByText("読み取り中…")).toBeInTheDocument();
    expect(screen.getByText("つかさ")).toBeInTheDocument();
    expect(screen.getByText("家庭教師として週に二度、俺の部屋にやってくる")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "つくる" })).toBeEnabled();
  });

  it("つくるを押すと読み取った場面と全文を渡す", () => {
    const onGenerate = vi.fn();
    render(<OuCreateScenario onGenerate={onGenerate} />);
    fireEvent.change(screen.getByPlaceholderText(/週に二度/), {
      target: { value: SCENARIO_TEXT },
    });
    fireEvent.click(screen.getByRole("button", { name: "つくる" }));

    expect(onGenerate).toHaveBeenCalledWith({
      situation: "家庭教師として週に二度、俺の部屋にやってくる",
      details: SCENARIO_TEXT,
    });
  });

  it("文字数カウンタが入力に追従する", () => {
    render(<OuCreateScenario onGenerate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/週に二度/), { target: { value: "短文" } });
    expect(screen.getByText("2字")).toBeInTheDocument();
  });
});
