import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuCreateEntry } from "./ou-create-entry";

describe("OuCreateEntry", () => {
  afterEach(cleanup);

  it("3つの作成ルートを表示する", () => {
    render(
      <OuCreateEntry onSelectAuto={vi.fn()} onSelectScenario={vi.fn()} onSelectWizard={vi.fn()} />,
    );
    expect(screen.getByText("おまかせでつくる")).toBeInTheDocument();
    expect(screen.getByText("シナリオからつくる")).toBeInTheDocument();
    expect(screen.getByText("こだわってつくる")).toBeInTheDocument();
  });

  it("おまかせを押すと onSelectAuto だけを呼ぶ", () => {
    const onSelectAuto = vi.fn();
    const onSelectScenario = vi.fn();
    const onSelectWizard = vi.fn();
    render(
      <OuCreateEntry
        onSelectAuto={onSelectAuto}
        onSelectScenario={onSelectScenario}
        onSelectWizard={onSelectWizard}
      />,
    );
    fireEvent.click(screen.getByText("おまかせでつくる"));
    expect(onSelectAuto).toHaveBeenCalledTimes(1);
    expect(onSelectScenario).not.toHaveBeenCalled();
    expect(onSelectWizard).not.toHaveBeenCalled();
  });

  it("シナリオからつくるを押すと onSelectScenario を呼ぶ", () => {
    const onSelectScenario = vi.fn();
    render(
      <OuCreateEntry
        onSelectAuto={vi.fn()}
        onSelectScenario={onSelectScenario}
        onSelectWizard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("シナリオからつくる"));
    expect(onSelectScenario).toHaveBeenCalledTimes(1);
  });

  it("こだわってつくるを押すと onSelectWizard を呼ぶ", () => {
    const onSelectWizard = vi.fn();
    render(
      <OuCreateEntry
        onSelectAuto={vi.fn()}
        onSelectScenario={vi.fn()}
        onSelectWizard={onSelectWizard}
      />,
    );
    fireEvent.click(screen.getByText("こだわってつくる"));
    expect(onSelectWizard).toHaveBeenCalledTimes(1);
  });
});
