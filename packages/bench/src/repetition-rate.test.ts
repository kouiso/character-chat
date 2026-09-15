import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { analyzeDir, calibrateK } from "./repetition-rate";

type HeaderOptions = {
  character?: string;
  turn: number;
  phase?: string;
  visibleChars?: number;
  preExtendVisibleChars?: number | null;
  extended?: number | null;
};

// script-run が書く transcript の最小形。preExtendBodyChars は body 先頭からの
// 文字数なので、fixture は body 全文を pre-extend として切り出せる長さを入れる。
const turnFile = (opts: HeaderOptions, body: string): [string, string] => {
  const {
    character = "Sakura",
    turn,
    phase = "conversation",
    visibleChars = 200,
    preExtendVisibleChars = 200,
    extended = 0,
  } = opts;
  const lines = [
    `# character: ${character}`,
    `# turn: ${turn}`,
    `# intent: ${phase}`,
    `# servedPhase: ${phase}`,
    `# mechanicsPhase: ${phase}`,
    "# servedModel: deepseek/deepseek-v3.2",
  ];
  if (extended !== null) lines.push(`# extended: ${extended}`);
  lines.push("# dropped: 0");
  lines.push(`# visibleChars: ${visibleChars}  innerChars: 0  latencyMs: 1000`);
  if (preExtendVisibleChars !== null) {
    lines.push(
      `# preExtendVisibleChars: ${preExtendVisibleChars}  preExtendBodyChars: ${body.length}`,
    );
  }
  lines.push("# error: -", "# --- ここから本文 ---", body, "");
  return [`${character}-${String(turn).padStart(2, "0")}-session-test.txt`, lines.join("\n")];
};

const TAIL = "窓の外で雨が静かに降り続いている";
const BODY_1 = `<response>\n<action>${TAIL}。彼女は黙ってこちらを見ている。</action>`;
const BODY_2_REPEAT = `<response>\n<dialogue>${TAIL}。</dialogue><action>彼女は頷いた。</action>`;
const BODY_2_FRESH = "<response>\n<action>翌朝の光が部屋に差し込んで、彼女は伸びをした。</action>";

const K_TABLE = new Map([["conversation", 200]]);

describe("analyzeDir", () => {
  let root: string;
  let dir: string;
  const write = (dirPath: string, file: [string, string]) =>
    writeFileSync(join(dirPath, file[0]), file[1]);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "repetition-rate-"));
    dir = join(root, "2026-09-15-a1-1-00000001");
    mkdirSync(dir);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("turn 1 は先行窓が無いので ratio が null", () => {
    write(dir, turnFile({ turn: 1 }, BODY_1));
    const rows = analyzeDir(dir, K_TABLE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ arm: "a1", ratioK: null, ratioFixed: null });
  });

  it("直前ターン末尾の言い回しを使い回すと ratioK / ratioFixed が 0 より大きくなる", () => {
    write(dir, turnFile({ turn: 1 }, BODY_1));
    write(dir, turnFile({ turn: 2 }, BODY_2_REPEAT));
    const rows = analyzeDir(dir, K_TABLE);
    expect(rows[1].ratioK).toBeGreaterThan(0);
    expect(rows[1].ratioFixed).toBeGreaterThan(0);
  });

  it("新しい文なら ratio は 0", () => {
    write(dir, turnFile({ turn: 1 }, BODY_1));
    write(dir, turnFile({ turn: 2 }, BODY_2_FRESH));
    const rows = analyzeDir(dir, K_TABLE);
    expect(rows[1].ratioK).toBe(0);
  });

  it("参照窓から <inner> を剥がす: inner の語句を turn 2 が繰り返しても拾わない", () => {
    const innerPhrase = "この独白は内心だけの声";
    write(
      dir,
      turnFile(
        { turn: 1 },
        `<response>\n<inner>${innerPhrase}</inner><action>彼女は黙っている。</action>`,
      ),
    );
    write(dir, turnFile({ turn: 2 }, `<response>\n<dialogue>${innerPhrase}</dialogue>`));
    const rows = analyzeDir(dir, K_TABLE);
    expect(rows[1].ratioK).toBe(0);
  });

  it("ターン内で同じ 8-gram を繰り返すと intraTurnRepeats が立つ", () => {
    const repeated = "何度も同じ言葉が出てくる";
    write(dir, turnFile({ turn: 1 }, `<response>\n<action>${repeated}。${repeated}。</action>`));
    const rows = analyzeDir(dir, K_TABLE);
    expect(rows[0].intraTurnRepeats).toBeGreaterThan(0);
  });

  it("preExtendBodyChars が無いターンは参照窓に入らない", () => {
    // 旧フォーマット（preExtend フィールド欠損）の turn 1。全文を窓に使うと
    // extend 文が混ざるので空扱いが正しい。turn 2 が turn 1 の語句を繰り返しても 0。
    write(dir, turnFile({ turn: 1, preExtendVisibleChars: null }, BODY_1));
    write(dir, turnFile({ turn: 2 }, BODY_2_REPEAT));
    const rows = analyzeDir(dir, K_TABLE);
    expect(rows[1].ratioK).toBeNull();
  });

  it("ヘッダに extended が無い古い transcript は summary-*.json から補完する", () => {
    write(dir, turnFile({ turn: 1, extended: null }, BODY_1));
    writeFileSync(
      join(dir, "summary-session-test.json"),
      JSON.stringify({ results: [{ character: "Sakura", turn: 1, extended: 1 }] }),
    );
    const rows = analyzeDir(dir, K_TABLE);
    expect(rows[0].extended).toBe(1);
  });
});

describe("calibrateK", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "repetition-rate-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const makeDir = (name: string, values: number[]): string => {
    const dirPath = join(root, name);
    mkdirSync(dirPath);
    for (const [index, value] of values.entries()) {
      const [file, text] = turnFile(
        { turn: index + 1, preExtendVisibleChars: value },
        `<response>\n<action>${"あ".repeat(Math.max(1, Math.min(40, value)))}</action>`,
      );
      writeFileSync(join(dirPath, file), text);
    }
    return dirPath;
  };

  it("phase ごとに run 単位の中央値を取り、その最小値を K にする", () => {
    const run1 = makeDir("2026-09-15-a1-1-00000001", [100, 300, 200]); // median 200
    const run2 = makeDir("2026-09-15-a1-2-00000002", [80, 90]); // median 85
    const k = calibrateK([run1, run2]);
    expect(k.get("conversation")).toBe(85);
  });
});
