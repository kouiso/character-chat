import {
  sceneCardMatchesCharacter,
  type SceneCard,
  type SceneCardCharacterFilter,
} from "@/data/scene-cards";
import { buildSystemPrompt } from "@/lib/prompt-builder";

export type SceneConversationPrompt = {
  systemPrompt: string;
  characterName: string;
};

export type SceneStartPlan = {
  conversationCharacterId: string | undefined;
  scenePrompt: SceneConversationPrompt;
};

type SceneStartCharacter = SceneCardCharacterFilter & {
  id: string;
};

export const buildSceneConversationPrompt = (scene: SceneCard): SceneConversationPrompt => ({
  systemPrompt: buildSystemPrompt(
    {
      name: "",
      personality: "",
      appearance: "",
      scenario: scene.summary,
      custom: "",
    },
    scene.character,
  ),
  characterName: scene.character.name,
});

export const resolveSceneConversationCharacterId = (
  scene: SceneCard,
  activeCharacter: SceneStartCharacter | null | undefined,
  characters: readonly SceneStartCharacter[],
): string | undefined => {
  if (scene.characterId && characters.some((character) => character.id === scene.characterId)) {
    return scene.characterId;
  }

  if (activeCharacter && sceneCardMatchesCharacter(scene, activeCharacter)) {
    return activeCharacter.id;
  }

  return undefined;
};

export const buildSceneStartPlan = (
  scene: SceneCard,
  activeCharacter: SceneStartCharacter | null | undefined,
  characters: readonly SceneStartCharacter[],
): SceneStartPlan => ({
  conversationCharacterId: resolveSceneConversationCharacterId(scene, activeCharacter, characters),
  scenePrompt: buildSceneConversationPrompt(scene),
});
