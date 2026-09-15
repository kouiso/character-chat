import { describe, expect, it } from "vitest";

import { assertLocalOnly, assertNotProdD1, V1_PROD_D1_ID, V2_LOCAL_D1_ID } from "./assert-local";

describe("assertLocalOnly", () => {
  it("rejects --remote", () => {
    expect(() => assertLocalOnly(["wrangler", "d1", "--remote"])).toThrow("v2 D1 is local-only");
  });

  it("allows --local", () => {
    expect(() => assertLocalOnly(["wrangler", "d1", "--local"])).not.toThrow();
  });
});

describe("assertNotProdD1", () => {
  it("v2 local id is not the production database", () => {
    expect(V2_LOCAL_D1_ID).not.toEqual(V1_PROD_D1_ID);
    expect(() => assertNotProdD1(V1_PROD_D1_ID)).toThrow("v2 must not bind the production D1 id");
    expect(() => assertNotProdD1(V2_LOCAL_D1_ID)).not.toThrow();
  });
});
