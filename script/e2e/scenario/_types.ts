import type { FailureCategory } from "../failure-taxonomy";
import type { Phase, ScenarioId } from "../types";

export type ScenarioTurn = {
  turnIndex: number;
  userMsg: string;
  expectedPhase: Phase;
  characterSlug?: string;
  isImageTrigger?: boolean;
  isMonkey?: boolean;
  monkeyKind?: "empty" | "emoji" | "english" | "xml" | "long";
  isCreampie?: boolean;
  isSubtextProbe?: boolean;
  notes?: string;
};

export type ScenarioDefinition = {
  scenarioId: ScenarioId;
  characterSlug: string;
  firstPerson: string;
  turns: ScenarioTurn[];
  onFailFast?: (turn: number, failureCategory: FailureCategory) => boolean;
};
