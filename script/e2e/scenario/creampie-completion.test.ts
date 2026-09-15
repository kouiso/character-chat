import { describe, expect, it } from "vitest";
import type { ScenarioDefinition, ScenarioTurn } from "./_types";
import s1 from "./s1-midnight-meeting";
import s2 from "./s2-cohabitation-24h";
import s3 from "./s3-multi-round";
import s4 from "./s4-character-switch";
import s5 from "./s5-monkey-kink";
import s6 from "./s6-rinka-lab";
import s7 from "./s7-saya-rain";
import s8 from "./s8-reina-reversal";

const scenarios = [s1, s2, s3, s4, s5, s6, s7, s8] as const satisfies readonly ScenarioDefinition[];
const CREAMPIE_MARKER_PATTERN = /中に出|膣内|射精|精液|子宮/;

const isCreampieClimaxTurn = (turn: ScenarioTurn): boolean =>
  turn.expectedPhase === "climax" &&
  turn.isCreampie === true &&
  CREAMPIE_MARKER_PATTERN.test(turn.userMsg);

describe("scenario creampie completion gate", () => {
  it("requires all 8 scenarios to declare climax creampie markers before afterglow", () => {
    const result = scenarios.map((scenario) => {
      const creampieTurnIndex = scenario.turns.findIndex(isCreampieClimaxTurn);
      const afterglowTurnIndex = scenario.turns.findIndex(
        (turn, index) => index > creampieTurnIndex && turn.expectedPhase === "afterglow",
      );

      return {
        scenarioId: scenario.scenarioId,
        hasCreampieClimax: creampieTurnIndex >= 0,
        hasLaterAfterglow: afterglowTurnIndex > creampieTurnIndex,
      };
    });

    expect(result).toEqual(
      scenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        hasCreampieClimax: true,
        hasLaterAfterglow: true,
      })),
    );
  });
});
