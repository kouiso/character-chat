import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertLocalOnly } from "./assert-local";

describe("assertLocalOnly", () => {
  it("rejects --remote", () => {
    expect(() => assertLocalOnly(["wrangler", "d1", "--remote"])).toThrow("v2 D1 is local-only");
  });

  it("allows --local", () => {
    expect(() => assertLocalOnly(["wrangler", "d1", "--local"])).not.toThrow();
  });

  // ローカル用の設定は本番と同じ D1 id を持つ。入口が検査を飛ばすと、--remote で本番に届く。
  it("package.json の tsx 入口はすべて、引数を assertLocalOnly に通す", () => {
    const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const entries = Object.values(manifest.scripts).flatMap((script) =>
      [...script.matchAll(/tsx (src\/[\w-]+\.ts)/g)].map((match) => match[1]),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const source = readFileSync(path.join(packageRoot, entry), "utf8");
      expect({ entry, guarded: source.includes("assertLocalOnly(process.argv") }).toEqual({
        entry,
        guarded: true,
      });
    }
  });
});
