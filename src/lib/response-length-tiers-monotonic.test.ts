import { describe, expect, it } from "vitest";

import { resolvePhaseAwareResponseLength } from "../../functions/api/lib/route-context";

import type { ScenePhase } from "./scene-phase";
import type { ResponseLength } from "../store/settings-store";

// 引き継ぎ書の L1: 「UI の 4 段が実際に 4 段の長さになる」。
// chips-panel.tsx が出す「短め/ふつう/長め/たっぷり」は、フロア・上限・max_tokens の
// 3 指標**すべて**で狭義単調でなければ、段を選んでも変わらん段が出る。
// 実際 2026-08-18 時点でハーネスの matrix モードは long を測っとらんかったので、
// 実測だけに頼ると 4 段のうち 1 段が誰にも確かめられんまま残る。ここは純関数なので
// 全組み合わせを費用ゼロで押さえられる。
const PHASES: ScenePhase[] = ["conversation", "intimate", "erotic", "climax", "afterglow"];
const LENGTHS: ResponseLength[] = ["short", "medium", "long", "very_long"];
// energyMultiplier の 3 段（<=20 / <=80 / >80）をそれぞれ代表させる
const ENERGIES = [3, 50, 200];

describe("UI の 4 段が 3 指標すべてで狭義単調", () => {
  it.each(PHASES)("%s", (phase) => {
    for (const energy of ENERGIES) {
      const rows = LENGTHS.map((length) => {
        const r = resolvePhaseAwareResponseLength(phase, length, energy);
        return { length, minChars: r.minChars, maxChars: r.maxChars, maxTokens: r.maxTokens };
      });
      for (const key of ["minChars", "maxChars", "maxTokens"] as const) {
        for (let i = 1; i < rows.length; i += 1) {
          expect(
            rows[i][key],
            `${phase} energy=${energy} ${key}: ${rows[i - 1].length}=${rows[i - 1][key]} -> ${rows[i].length}=${rows[i][key]}`,
          ).toBeGreaterThan(rows[i - 1][key]);
        }
      }
    }
  });

  // L1: Sakura・Downer の very_long erotic/climax は 1300〜1800 可視文字。
  // フロアがその下限を割っとったら、実測が届かんのは機構の側の問題になる。
  it.each(["erotic", "climax"] as const)("very_long の %s はフロアが 1300 字以上", (phase) => {
    for (const energy of ENERGIES) {
      const { minChars } = resolvePhaseAwareResponseLength(phase, "very_long", energy);
      expect(minChars, `${phase} energy=${energy}`).toBeGreaterThanOrEqual(1300);
    }
  });
});
