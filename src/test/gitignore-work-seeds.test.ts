import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const gitignore = readFileSync(resolve(process.cwd(), ".gitignore"), "utf8");
const oxlintConfig = readFileSync(resolve(process.cwd(), ".oxlintrc.json"), "utf8");

describe("iteration dumps stay off git; bench stays off root oxlint", () => {
  it(".work/* ignores the seeds directory (no un-ignore exception)", () => {
    expect(gitignore).toMatch(/^\.work\/\*$/m);
    expect(gitignore).not.toMatch(/^!\.work\/seeds\/$/m);
  });

  it("root oxlint does not lint apps/bench", () => {
    expect(oxlintConfig).toContain('"apps/bench/"');
  });
});
