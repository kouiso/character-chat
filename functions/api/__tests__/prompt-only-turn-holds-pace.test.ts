import { describe, expect, it } from "vitest";

import {
  CLIMAX_LONGFORM_HINT,
  EROTIC_LONGFORM_HINT,
  VERY_LONG_EROTIC_LONGFORM_HINT,
  dropEscalationForPromptOnlyTurn,
  resolvePhaseAwareResponseLength,
} from "../lib/route-context";

const ESCALATION = "絶頂寸前のぎりぎりまで高め";
const VERY_LONG_ESCALATION = "クライマックス寸前まで強く高めて終える";
// climax へ先送りする歯止め。これまで escalation と同じ一文に同居しとったので、
// 落とす時に一緒に消えてまうと絶頂がフェーズを飛び越える。
const BRAKE = "climaxフェーズまで先送りする";

describe("dropEscalationForPromptOnlyTurn", () => {
  it("「もっと」だけのターンでは高める指示を落とす", () => {
    const hint = dropEscalationForPromptOnlyTurn(EROTIC_LONGFORM_HINT, "もっと".length);
    expect(hint).not.toContain(ESCALATION);
  });

  it("落としても絶頂を climax へ先送りする歯止めは残る", () => {
    const hint = dropEscalationForPromptOnlyTurn(EROTIC_LONGFORM_HINT, "もっと".length);
    expect(hint).toContain(BRAKE);
  });

  it("very_long 側の言い回しも落とす", () => {
    const hint = dropEscalationForPromptOnlyTurn(VERY_LONG_EROTIC_LONGFORM_HINT, 3);
    expect(hint).not.toContain(VERY_LONG_ESCALATION);
  });

  it("自分から書いてきたターンには手を入れん", () => {
    const written = "あ".repeat(60);
    expect(dropEscalationForPromptOnlyTurn(EROTIC_LONGFORM_HINT, written.length)).toBe(
      EROTIC_LONGFORM_HINT,
    );
  });
});

describe("resolvePhaseAwareResponseLength", () => {
  it("erotic の hint 選択に相手のターンの長さが効く", () => {
    const prompted = resolvePhaseAwareResponseLength("erotic", "medium", 3);
    const written = resolvePhaseAwareResponseLength("erotic", "medium", 60);
    expect(prompted.eroticLongformHint).not.toContain(ESCALATION);
    expect(written.eroticLongformHint).toContain(ESCALATION);
  });

  it("climax は促しだけのターンでも指示を削らん", () => {
    const { eroticLongformHint } = resolvePhaseAwareResponseLength("climax", "medium", 3);
    expect(eroticLongformHint).toBe(CLIMAX_LONGFORM_HINT);
  });
});
