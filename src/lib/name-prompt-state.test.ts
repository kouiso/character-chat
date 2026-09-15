import { afterEach, describe, expect, it } from "vitest";

import { hasAskedForName, markNamePromptAsked } from "./name-prompt-state";

describe("name-prompt-state", () => {
  afterEach(() => {
    localStorage.removeItem("ou_name_prompt_asked");
  });

  it("既定では未読(=まだ尋ねていない)扱い", () => {
    expect(hasAskedForName()).toBe(false);
  });

  it("既読にすると二度と尋ねない扱いになる", () => {
    markNamePromptAsked();
    expect(hasAskedForName()).toBe(true);
    expect(localStorage.getItem("ou_name_prompt_asked")).toBe("1");
  });
});
