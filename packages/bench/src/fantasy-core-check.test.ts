import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanDir } from "./fantasy-core-check";

const turnFile = (label: string, turn: number, body: string): [string, string] => [
  `${label}-${String(turn).padStart(2, "0")}-session-test.txt`,
  [
    `# character: ${label}`,
    `# turn: ${turn}`,
    "# intent: conversation",
    "# servedPhase: conversation",
    "# --- ここから本文 ---",
    body,
    "",
  ].join("\n"),
];

describe("scanDir", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fantasy-core-check-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("芯の要素が本文に出たターンを項目別に拾う", () => {
    const [name, text] = turnFile(
      "Sakura",
      5,
      "<response>\n<action>押さえつけられ、無理やり中に注ぎ込まれる。涙が滲む。</action>\n<dialogue>やめて…いけません…</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const rows = scanDir(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ character: "Sakura", turn: 5 });
    expect(rows[0].items.resistance).toBe(true);
    expect(rows[0].items.forced).toBe(true);
    expect(rows[0].items.creampie).toBe(true);
    expect(rows[0].items.despair).toBe(true);
    expect(rows[0].hitCount).toBeGreaterThanOrEqual(4);
  });

  it("会話ターンは芯項目ゼロ", () => {
    const [name, text] = turnFile(
      "Sakura",
      1,
      "<response>\n<dialogue>……コーヒー、甘いですね。</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const rows = scanDir(dir);
    expect(rows[0].hitCount).toBe(0);
  });

  it("ターン順とキャラ名でソートする", () => {
    const [n1, t1] = turnFile("Sakura", 2, "<response><action>x</action></response>");
    const [n2, t2] = turnFile("Sakura", 1, "<response><action>y</action></response>");
    const [n3, t3] = turnFile("Downer", 1, "<response><action>z</action></response>");
    writeFileSync(join(dir, n1), t1);
    writeFileSync(join(dir, n2), t2);
    writeFileSync(join(dir, n3), t3);
    const rows = scanDir(dir);
    expect(rows.map((row) => `${row.character}:${row.turn}`)).toEqual([
      "Downer:1",
      "Sakura:1",
      "Sakura:2",
    ]);
  });
});
