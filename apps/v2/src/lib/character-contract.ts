import type { CharacterSheet, CharacterVersion } from "@v2/db";

export type CharacterActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "unauthorized" | "not-found" | "conflict" | "invalid" | "unavailable";
      message: string;
    };

export type EditableCharacter = { id: string; name: string };
export type CharacterEditorState = {
  sheet: CharacterSheet;
  currentVersionId: number | null;
  revision: string;
  versions: CharacterVersion[];
};

export type CharacterWriteRequest = {
  sheet: CharacterSheet;
  expectedVersionId: number | null;
  expectedRevision: string;
};

export type CharacterRestoreRequest = {
  characterId: string;
  versionId: number;
  expectedVersionId: number | null;
  expectedRevision: string;
};
