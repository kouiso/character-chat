import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/protect-main.yml"), "utf8");

describe("Protect main branch workflow", () => {
  it("allows Renovate branches in the enforced branch policy", () => {
    const allowlist = workflow.match(/case "\$HEAD_REF" in\s*([^\n)]+)\)/)?.[1];

    expect(allowlist).toBeDefined();
    expect(allowlist?.trim().split("|")).toContain("renovate/*");
  });

  it("lists Renovate branches in the branch-policy failure guidance", () => {
    const guidance = workflow.match(/body="\$MARKER([\S\s]*?)"\s*existing_id=/)?.[1];

    expect(guidance).toBeDefined();
    expect(guidance).toContain("\\`renovate/*\\`");
  });
});
