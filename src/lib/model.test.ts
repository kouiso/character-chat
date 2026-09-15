import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_MODEL,
  EROTIC_CHAT_MODEL,
  EURYALE_CHAT_MODEL,
  NSFW_CHAT_MODEL_RECOMMENDATION,
  MODEL_CATALOG,
  MODEL_FALLBACKS,
  getDefaultModelForPhase,
  resolvePhaseRoutedChatModel,
} from "./model";

describe("phase-based model routing", () => {
  it("routes default chat model to Qwen for conversational phases", () => {
    expect(getDefaultModelForPhase("conversation")).toBe(DEFAULT_CHAT_MODEL);
    expect(getDefaultModelForPhase("intimate")).toBe(DEFAULT_CHAT_MODEL);
    expect(getDefaultModelForPhase("afterglow")).toBe(DEFAULT_CHAT_MODEL);
  });

  it("routes default chat model to Euryale for erotic and climax phases", () => {
    expect(getDefaultModelForPhase("erotic")).toBe(EURYALE_CHAT_MODEL);
    expect(getDefaultModelForPhase("climax")).toBe(EURYALE_CHAT_MODEL);
  });

  it("preserves explicit user-selected models", () => {
    const explicitModel = "sao10k/l3.3-euryale-70b";

    expect(resolvePhaseRoutedChatModel(explicitModel, "erotic")).toBe(explicitModel);
    expect(resolvePhaseRoutedChatModel(explicitModel, "conversation")).toBe(explicitModel);
  });

  it("only routes requests that use the default model", () => {
    expect(resolvePhaseRoutedChatModel(DEFAULT_CHAT_MODEL, "erotic")).toBe(EURYALE_CHAT_MODEL);
    expect(resolvePhaseRoutedChatModel(DEFAULT_CHAT_MODEL, "climax")).toBe(EURYALE_CHAT_MODEL);
    expect(resolvePhaseRoutedChatModel(DEFAULT_CHAT_MODEL, "conversation")).toBe(
      DEFAULT_CHAT_MODEL,
    );
  });

  it("documents Euryale as the primary NSFW chat recommendation", () => {
    expect(NSFW_CHAT_MODEL_RECOMMENDATION.primaryModel).toBe(EURYALE_CHAT_MODEL);
    expect(NSFW_CHAT_MODEL_RECOMMENDATION.backupModels).toContain(EROTIC_CHAT_MODEL);
    expect(NSFW_CHAT_MODEL_RECOMMENDATION.backupModels).toContain(DEFAULT_CHAT_MODEL);
  });

  it("keeps Euryale fallback away from unavailable Magnum", () => {
    expect(MODEL_FALLBACKS["sao10k/l3.3-euryale-70b"]).toEqual([
      EROTIC_CHAT_MODEL,
      DEFAULT_CHAT_MODEL,
    ]);
  });

  it("adds Euryale as the third fallback for conversational model chains", () => {
    expect(MODEL_FALLBACKS[DEFAULT_CHAT_MODEL]).toEqual([EROTIC_CHAT_MODEL, EURYALE_CHAT_MODEL]);
  });

  it("keeps model picker copy focused on behavior instead of regulatory wording", () => {
    const visibleCopy = MODEL_CATALOG.map((model) => `${model.name} ${model.desc ?? ""}`).join(
      "\n",
    );

    expect(visibleCopy).not.toContain("制限なし");
  });
});
