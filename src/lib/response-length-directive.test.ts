import { describe, expect, it } from "vitest";

import { getPhaseTonePreservationDirective } from "./response-length-directive";

describe("getPhaseTonePreservationDirective", () => {
  it("conversationには成人向けトーン指示を入れない", () => {
    expect(getPhaseTonePreservationDirective("conversation")).toBe("");
  });

  it("conversation以外は既存の指示を維持する", () => {
    for (const phase of ["intimate", "erotic", "climax", "afterglow"] as const) {
      expect(getPhaseTonePreservationDirective(phase)).not.toBe("");
    }
  });
});
