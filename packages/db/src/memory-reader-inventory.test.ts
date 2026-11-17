// 記憶の読み手一覧（RIT-89 FR-5）。v2_memory を触る非テストファイルを全部集め、
// 凍結した一覧と完全一致させる。一覧に無い読み手を足すとこの試験が落ちるので、
// 新しい読み手は必ず区切り（memory-scope）を通すか、書き手として理由を書いて一覧に足す。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// 役割:
//   scoped  — 区切りの読み手。memory-scope（またはそれを通る scoped 関数）を参照する事。
//   writer  — 書き手・消し手・移行・リセット。区切りは通さん（通すと書き損なう）。
//   bench   — いじわる試験。生の照合で「壊れた経路」を意図的に作るので区切りは通さん。
//   schema  — 表の定義。
//   scope   — 区切りの関数そのもの（この票で新設）。
// 一覧はリポジトリの根からのパス。新しい読み手を足す時はその票で行を足す。
const MEMORY_READERS: Record<string, "scoped" | "writer" | "bench" | "schema" | "scope"> = {
  "apps/v2/src/server/legacy-memory-migration.ts": "writer",
  "apps/v2/src/server/memory-reset.ts": "writer",
  // 記憶の読み出しは @v2/db の loadRecallCueMemories（scoped）へ集約してある。
  "apps/v2/src/server/proactive-recall.ts": "scoped",
  "packages/bench/src/memory-adversarial-check.ts": "bench",
  "packages/db/src/legacy-memory-migration.ts": "writer",
  "packages/db/src/memory-crud-store.ts": "scoped",
  "packages/db/src/memory-extraction-store.ts": "scoped",
  "packages/db/src/memory-index-store.ts": "scoped",
  "packages/db/src/memory-scope.ts": "scope",
  "packages/db/src/proactive-store.ts": "scoped",
  "packages/db/src/turn-store.ts": "writer",
  "packages/db/src/v2-schema.ts": "schema",
};

// 区切りを通っている印。packages/db 内は相対 import、apps/v2 は @v2/db 経由で
// scoped 関数を呼ぶので、モジュール名か scoped の入口の名を見る。
const SCOPED_MARK =
  /memory-scope|memoryReadConditions|selectScopedMemories|loadRecallCueMemories|loadRecentMemories/;

const collect = (dir: string, found: string[]): void => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, found);
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
    const source = readFileSync(full, "utf8");
    if (/v2MemoryTable|\bv2_memory\b/.test(source)) {
      found.push(path.relative(REPO_ROOT, full));
    }
  }
};

describe("memory reader inventory (FR-5)", () => {
  it("v2_memory を触る非テストファイルが凍結一覧と一致する", () => {
    const found: string[] = [];
    collect(path.join(REPO_ROOT, "apps/v2/src"), found);
    const packagesDir = path.join(REPO_ROOT, "packages");
    for (const pkg of readdirSync(packagesDir)) {
      const src = path.join(packagesDir, pkg, "src");
      try {
        if (statSync(src).isDirectory()) collect(src, found);
      } catch {
        // src の無い package（設定のみ）は無視する
      }
    }
    found.sort();
    const expected = Object.keys(MEMORY_READERS).sort();
    const missing = found.filter((file) => !(file in MEMORY_READERS));
    expect(missing, `一覧に無い読み手: ${missing.join(", ")}`).toEqual([]);
    const stale = expected.filter((file) => !found.includes(file));
    expect(stale, `一覧だけ残った読み手: ${stale.join(", ")}`).toEqual([]);
    expect(found).toEqual(expected);
  });

  it("scoped の読み手は区切り（memory-scope）を通っている", () => {
    const violations = Object.entries(MEMORY_READERS)
      .filter(([, role]) => role === "scoped")
      .filter(([file]) => !SCOPED_MARK.test(readFileSync(path.join(REPO_ROOT, file), "utf8")))
      .map(([file]) => file);
    expect(violations, `区切りを通っていない読み手: ${violations.join(", ")}`).toEqual([]);
  });
});
