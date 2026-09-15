import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolvePhaseSampling } from "../lib/route-context";

import type { ScenePhase } from "../../../src/lib/scene-phase";

// 2026-08-21 まで、段ごとの sampling は very_long にしか当たっとらんかった。
// それ以外の段は `{ temperature: 0.7, max_tokens }` 固定で、frequency_penalty も
// presence_penalty も**一切送っとらん**。出荷既定は medium（src/store/settings-store.ts）
// なので、局長へ届いとった返信は全部「モデル側に反復を抑える仕組みが 1 つも無い」状態で
// 生成されとったことになる。phase66 の通読は 20 ターン中 16 が反復で落ちとる。
//
// 罠 §5-5「very_long だけ守られて medium が無防備」の 4 件目。
const ROUTE_SOURCE = readFileSync(path.resolve(__dirname, "../[[route]].ts"), "utf8");

const ALL_PHASES: ScenePhase[] = ["conversation", "intimate", "erotic", "climax", "afterglow"];

describe("段ごとの sampling が出荷既定にも届く", () => {
  it("どの段でも反復を抑える penalty がゼロやない", () => {
    for (const phase of ALL_PHASES) {
      const sampling = resolvePhaseSampling(phase);

      expect(sampling.frequency_penalty, phase).toBeGreaterThan(0);
      expect(sampling.presence_penalty, phase).toBeGreaterThan(0);
    }
  });

  // #1392 で実測否定された 0.3/0.4 の表へ戻らんこと。あれは語彙の少ない官能文で
  // 早期終了を誘発する。
  it("否定済みの強い penalty へ戻っとらん", () => {
    for (const phase of ALL_PHASES) {
      expect(resolvePhaseSampling(phase).frequency_penalty, phase).toBeLessThan(0.2);
    }
  });

  // 値そのものより「very_long でだけ分岐しとらんこと」が本体。ここが戻ると
  // medium が無防備に戻るが、値の比較だけでは検出でけへん。
  it("生成パラメータが isVeryLongResponse で分岐しとらん", () => {
    const block = ROUTE_SOURCE.slice(
      ROUTE_SOURCE.indexOf("const lengthGenParams"),
      ROUTE_SOURCE.indexOf("const assembledInputChars"),
    );

    expect(block).not.toContain("isVeryLongResponse\n      ?");
    expect(block).toContain("phaseSampling.frequency_penalty");
    // stop の解除だけは very_long のまま（#1362）。ここは分岐が残っとってええ。
    expect(block).toContain("isVeryLongResponse ? { stop: [] } : {}");
  });
});
