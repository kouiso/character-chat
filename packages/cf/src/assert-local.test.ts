import { describe, expect, it } from "vitest";

import { assertLocalOnly } from "./assert-local";

describe("assertLocalOnly", () => {
  it("rejects --remote", () => {
    expect(() => assertLocalOnly(["wrangler", "d1", "--remote"])).toThrow("v2 D1 is local-only");
  });

  it("allows --local", () => {
    expect(() => assertLocalOnly(["wrangler", "d1", "--local"])).not.toThrow();
  });
});
