import type { ScenePhase } from "./scene-phase";

const ADULT_TONE_PRESERVATION_DIRECTIVE = "露骨さ・エロティックなトーンは決して弱めない。";

export const getPhaseTonePreservationDirective = (phase: ScenePhase): string =>
  phase === "conversation" ? "" : ADULT_TONE_PRESERVATION_DIRECTIVE;
