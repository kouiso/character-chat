import { describe, expect, it } from "vitest";

import { emptyCheck } from "./empty-check";

describe("emptyCheck", () => {
  it("本文があれば通る", () => {
    expect(emptyCheck("<dialogue>ただいま</dialogue>")).toEqual({ ok: true });
  });

  it("タグを剥がすと空なら ng", () => {
    expect(emptyCheck("<action></action>")).toEqual({ ok: false });
  });

  it("空白だけでも ng", () => {
    expect(emptyCheck("<inner>   \n  </inner>")).toEqual({ ok: false });
  });
});
