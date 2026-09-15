import type { ImageInput, VlmGradeScores } from "./vlm-grader";
import type { ScenePhase } from "../../../../src/lib/scene-phase";

// D1から読んだシーン状態（評価の正解データ）
export type SceneStateSnapshot = {
  locationId: string | null;
  locationTags: string[];
  undressLevel: string;
  outfitId: string | null;
  matePresent: boolean;
};

export type CharacterVisualSnapshot = {
  hairColor: string | null;
  hairStyle: string | null;
  eyeColor: string | null;
  skinTone: string | null;
  bodyType: string | null;
  outfitTags: string[];
  undressProgressionTags: string[];
};

export type EvalViolation = {
  tag: string;
  issue: string;
  fix: "remove_tag" | `add_tag:${string}` | `replace_tag:${string}:${string}`;
};

export type ImageGraphState = {
  conversationId: string;
  characterId: string;
  phase: ScenePhase;
  sceneState: SceneStateSnapshot;
  characterVisual: CharacterVisualSnapshot;
  userPrompt: string;
  apiKey: string;
  imagePrompt: string;
  evalStatus: "PENDING" | "PASS" | "FAIL";
  evalViolations: EvalViolation[];
  loopCount: number;
  previousViolationTags: Set<string>;
  taskId?: string;
  provider?: string;
  imagePromptUsed?: string;
  // 生成済み画像のVLM採点入力。評価器に画像グレーダーを注入したときだけ参照する。
  generatedImage?: ImageInput;
  // 最後にVLM採点したスコア。再生成判断・ログ用に surface する。
  vlmScores?: VlmGradeScores;
};
