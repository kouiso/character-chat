import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CharacterName } from "./character-name";

describe("CharacterName", () => {
  it("読みがあるならルビを振る", () => {
    const { container } = render(<CharacterName name="霜月 鈴" reading="しもつきすず" />);

    expect(container.querySelector("ruby")).not.toBeNull();
    expect(screen.getByText("しもつきすず")).toBeTruthy();
  });

  it("読みが無いなら素の名前だけを出す（推測で振らん）", () => {
    const { container } = render(<CharacterName name="うしろのあの子" reading={null} />);

    expect(container.querySelector("ruby")).toBeNull();
    expect(screen.getByText("うしろのあの子")).toBeTruthy();
  });

  it("空白だけの読みはルビにせん", () => {
    const { container } = render(<CharacterName name="椿" reading="   " />);

    expect(container.querySelector("ruby")).toBeNull();
  });
});
