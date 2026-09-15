import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OuBottomNav } from "./ou-bottom-nav";

describe("OuBottomNav", () => {
  afterEach(cleanup);

  it("4つのメインタブを表示して選択を通知する", async () => {
    const onScreen = vi.fn();
    render(<OuBottomNav screen="home" onScreen={onScreen} />);

    expect(screen.getByRole("button", { name: "ホーム" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "さがす" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "アルバム" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "マイ" }));
    expect(onScreen).toHaveBeenCalledWith("my");
  });
});
