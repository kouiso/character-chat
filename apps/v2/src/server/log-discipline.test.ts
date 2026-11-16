// @vitest-environment node
// RIT-66 FR-2: v2 の記録は logEvent だけを通る。log.ts（console を束ねる唯一の
// 場所）の外に console. が現れたら落ちる。テストファイルは対象外（記録ではなく
// 仕掛けなので）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../..", import.meta.url));
const SCAN_ROOTS = [
  "apps/v2/src",
  "packages/db/src",
  "packages/engine/src",
  "packages/judge/src",
  "packages/prompt/src",
];
// console を直接呼んでよい唯一のファイル。ここを通らん記録は型の保証を受けん。
const ALLOWED = "packages/db/src/log.ts";

const collectSources = (dir: string): string[] => {
  const found: string[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
};

describe("logEvent 以外の console 使用を検挙する", () => {
  it("log.ts の外に console. が無い", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of collectSources(join(REPO, root))) {
        const relative = file
          .slice(REPO.length)
          .replace(/^[\\/]/, "")
          .split("\\")
          .join("/");
        if (relative === ALLOWED) continue;
        const source = readFileSync(file, "utf8");
        source.split("\n").forEach((line, index) => {
          if (/\bconsole\.(log|info|warn|error|debug|trace|dir|table)\b/.test(line)) {
            offenders.push(`${relative}:${index + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("走査が実際にファイルへ届いている（空振りで終わらん）", () => {
    const total = SCAN_ROOTS.flatMap((root) => collectSources(join(REPO, root)));
    expect(total.length).toBeGreaterThan(50);
    expect(total).toContain(join(REPO, ALLOWED));
  });
});
