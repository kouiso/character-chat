import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const gitignore = readFileSync(resolve(process.cwd(), ".gitignore"), "utf8");
const eslintConfig = readFileSync(resolve(process.cwd(), "eslint.config.js"), "utf8");

describe("iteration dumps stay off git; bench stays off root eslint", () => {
  it(".work/* ignores the seeds directory (no un-ignore exception)", () => {
    expect(gitignore).toMatch(/^\.work\/\*$/m);
    expect(gitignore).not.toMatch(/^!\.work\/seeds\/$/m);
  });

  it("root eslint does not lint apps/bench", () => {
    expect(eslintConfig).toContain('"apps/bench/"');
  });
});
