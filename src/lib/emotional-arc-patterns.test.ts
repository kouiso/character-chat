import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// ScenePhase型の全メンバーがEMOTIONAL_ARC_PATTERNSに存在することを保証
// R4.20で afterglow キー欠落による silent regression が発生したため追加
describe("EMOTIONAL_ARC_PATTERNS completeness guard", () => {
  const SCENE_PHASES = ["conversation", "intimate", "erotic", "climax", "afterglow"] as const;

  it("functions/api/lib/route-context.ts の EMOTIONAL_ARC_PATTERNS に全 ScenePhase キーが存在する", () => {
    const routePath = resolve(__dirname, "../../functions/api/lib/route-context.ts");
    const source = readFileSync(routePath, "utf-8");

    for (const phase of SCENE_PHASES) {
      // eslint-disable-next-line security/detect-non-literal-regexp -- phase is a string union from SCENE_PHASES const
      const pattern = new RegExp(`^\\s+${phase}:\\s*/\\^arc_${phase}:`, "m");
      expect(source).toMatch(pattern);
    }
  });
});
