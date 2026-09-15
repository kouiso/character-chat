import { describe, expect, it } from "vitest";

import {
  filterSceneCardsForCharacter,
  getSceneCardCharacterName,
  sceneCardMatchesCharacter,
  sceneCards,
} from "./scene-cards";

describe("sceneCards", () => {
  it("starter pack が9件ある", () => {
    expect(sceneCards).toHaveLength(9);
  });

  it("全シーンにキャラクター情報がある", () => {
    for (const scene of sceneCards) {
      expect(scene.character.name.length).toBeGreaterThan(0);
      expect(scene.character.personality.length).toBeGreaterThan(0);
      expect(scene.character.appearance.length).toBeGreaterThan(0);
      expect(scene.character.relationship.length).toBeGreaterThan(0);
      expect(scene.character.speakingStyle.length).toBeGreaterThan(0);
      expect(scene.character.eroticPersonality.length).toBeGreaterThan(0);
      expect(scene.character.escalationStyle.length).toBeGreaterThan(0);
      expect(scene.character.sensitiveSpots.length).toBeGreaterThan(0);
      expect(scene.character.afterSex.length).toBeGreaterThan(0);
      expect(scene.character.signatureMoans.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("カードの表示キャラクター名が実キャラクター名と一致している", () => {
    for (const scene of sceneCards) {
      expect(getSceneCardCharacterName(scene)).toBe(scene.character.name);
    }
  });

  it("選択キャラクターに紐づくシーンだけを返す", () => {
    const hinaScenes = filterSceneCardsForCharacter(sceneCards, {
      id: "char-hinata",
      name: "陽菜",
    });

    expect(hinaScenes.map((scene) => scene.title)).toEqual(["川沿いの散歩道"]);
    expect(hinaScenes.map((scene) => scene.character.name)).not.toContain("葵");
    expect(hinaScenes.map((scene) => scene.character.name)).not.toContain("玲奈");
    expect(hinaScenes.every((scene) => sceneCardMatchesCharacter(scene, { name: "陽菜" }))).toBe(
      true,
    );
  });

  it("DB characterId があるシーンは ID で紐づけられる", () => {
    const kaedeScenes = filterSceneCardsForCharacter(sceneCards, {
      id: "char-kaede",
      name: "別名",
    });

    expect(kaedeScenes.map((scene) => scene.title)).toEqual(["深夜のマッサージ"]);
  });
});
