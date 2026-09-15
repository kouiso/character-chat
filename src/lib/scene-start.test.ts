import { describe, expect, it } from "vitest";

import { sceneCards, type SceneCard } from "@/data/scene-cards";

import { buildSceneStartPlan } from "./scene-start";

const character = (id: string, name: string) => ({ id, name });
const allSceneCards: readonly SceneCard[] = sceneCards;

describe("buildSceneStartPlan", () => {
  it("selected scene start uses the scene character and scenario prompt", () => {
    const hinaScene = allSceneCards.find((scene) => scene.character.name === "陽菜");

    expect(hinaScene).toBeDefined();

    const plan = buildSceneStartPlan(hinaScene!, character("char-hinata", "陽菜"), [
      character("char-hinata", "陽菜"),
    ]);

    expect(plan.conversationCharacterId).toBe("char-hinata");
    expect(plan.scenePrompt.characterName).toBe("陽菜");
    expect(plan.scenePrompt.systemPrompt).toContain("名前: 陽菜");
    expect(plan.scenePrompt.systemPrompt).toContain("【シナリオ】");
    expect(plan.scenePrompt.systemPrompt).toContain(hinaScene!.summary);
  });

  it("characterId based scenes bind to the persisted character when there is no active match", () => {
    const senaScene = allSceneCards.find((scene) => scene.characterId === "char-sena");

    expect(senaScene).toBeDefined();

    const plan = buildSceneStartPlan(senaScene!, character("char-aoi", "葵"), [
      character("char-aoi", "葵"),
      character("char-sena", "瀬奈"),
    ]);

    expect(plan.conversationCharacterId).toBe("char-sena");
    expect(plan.scenePrompt.characterName).toBe("瀬奈");
    expect(plan.scenePrompt.systemPrompt).toContain(senaScene!.summary);
  });

  it("falls back to scene prompt even when the scene character is not persisted", () => {
    const kaedeScene = allSceneCards.find((scene) => scene.characterId === "char-kaede");

    expect(kaedeScene).toBeDefined();

    const plan = buildSceneStartPlan(kaedeScene!, null, []);

    expect(plan.conversationCharacterId).toBeUndefined();
    expect(plan.scenePrompt.characterName).toBe("楓");
    expect(plan.scenePrompt.systemPrompt).toContain("名前: 楓");
    expect(plan.scenePrompt.systemPrompt).toContain(kaedeScene!.summary);
  });
});
