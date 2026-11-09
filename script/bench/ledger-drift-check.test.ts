import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scanDir, scanTurn, type LedgerRow } from "./ledger-drift-check";

const BODY_MARKER = "# --- ここから本文 ---";

const ledger = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  character: "Sakura",
  turn: 1,
  location: "ベッドの上",
  time: "深夜",
  clothing: { Sakura: "全裸" },
  ...over,
});

const writeRun = (body: string, row: LedgerRow | null): string => {
  const dir = mkdtempSync(join(tmpdir(), "drift-"));
  writeFileSync(
    join(dir, "Sakura-01-session-x-1-model-abc.txt"),
    `# character: Sakura\n${BODY_MARKER}\n${body}`,
  );
  if (row)
    writeFileSync(join(dir, "ledger.jsonl"), JSON.stringify(row) + "\n");
  return dir;
};

describe("scanTurn", () => {
  it("台帳と本文が一致したら食い違いゼロ", () => {
    const drift = scanTurn(
      "ベッドの上で過ごす。彼女は全裸のまま微笑んだ。",
      ledger(),
    );
    expect(drift).toEqual({ location: 0, time: 0, clothing: 0 });
  });

  it("台帳の場所と別の場所が本文に出たら location を数える", () => {
    const drift = scanTurn("二人はキッチンへ移って立ったまま続けた。", ledger());
    expect(drift.location).toBe(1);
  });

  it("台帳と同じ場所語が混ざっとっても別場所だけ数える", () => {
    const drift = scanTurn(
      "ベッドの上から車を思い出す。あの時は車の中だった。",
      ledger(),
    );
    expect(drift.location).toBe(1);
  });

  it("台帳の時刻と別の時刻が本文に出たら time を数える", () => {
    const drift = scanTurn("朝の光が差し込んできた。", ledger({ time: "深夜" }));
    expect(drift.time).toBe(1);
  });

  it("台帳が全裸なのに本文が着衣扱いなら clothing を数える", () => {
    const drift = scanTurn("彼女は制服姿のまま微笑んだ。", ledger());
    expect(drift.clothing).toBe(1);
  });

  it("台帳が着衣なのに本文が全裸扱いなら clothing を数える", () => {
    const drift = scanTurn(
      "彼女は全裸になってベッドに倒れた。",
      ledger({ clothing: { Sakura: "制服姿" } }),
    );
    expect(drift.clothing).toBe(1);
  });

  it("台帳無し版は本文の場所・時刻を確定できん件数として数える", () => {
    const drift = scanTurn("深夜のベッドの上。", null);
    expect(drift.location).toBe(1);
    expect(drift.time).toBe(1);
  });
});

describe("scanDir", () => {
  it("ledger.jsonl のターン行と本文を突き合わせる", () => {
    const dir = writeRun("キッチンで朝を迎えた。", ledger());
    const rows = scanDir(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0].drift.location).toBe(1);
    expect(rows[0].drift.time).toBe(1);
    expect(rows[0].hitCount).toBe(2);
  });

  it("わざと台帳を消した版の方が件数が増える", () => {
    const dir = writeRun("ベッドの上で深夜を過ごした。", ledger());
    const withLedger = scanDir(dir)[0].hitCount;
    const without = scanDir(dir, true)[0].hitCount;
    expect(without).toBeGreaterThan(withLedger);
  });
});
