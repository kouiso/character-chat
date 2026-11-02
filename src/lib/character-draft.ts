import { z } from "zod";

import { generatedCharacterSchema } from "./character-generator";

export const CHARACTER_DRAFT_KEY = "ou-character-draft-v1";

const selectionsSchema = z.object({
  types: z.array(z.string()),
  relations: z.array(z.string()),
  personalities: z.array(z.string()),
  bodyTypes: z.array(z.string()),
  freeText: z.string(),
});

export const autoDraftSchema = z.object({
  relation: z.string().nullable(),
  answer: z.string(),
  hint: z.string(),
});

export type AutoDraft = z.infer<typeof autoDraftSchema>;

const draftSchema = z.object({
  version: z.literal(1),
  step: z.enum(["entry", "auto", "scenario", "wizard-step1", "wizard-step2", "preview"]),
  selections: selectionsSchema,
  situation: z.string(),
  details: z.string(),
  imageMode: z.enum(["ai", "upload"]),
  uploadedImageDataUrl: z.string().nullable(),
  result: generatedCharacterSchema.nullable(),
  lastRequest: z
    .object({ selections: selectionsSchema, situation: z.string(), details: z.string() })
    .nullable(),
  autoDraft: autoDraftSchema,
  scenarioText: z.string(),
});

export type CharacterDraft = z.infer<typeof draftSchema>;

export const createEmptyCharacterDraft = (): CharacterDraft => ({
  version: 1,
  step: "entry",
  selections: { types: [], relations: [], personalities: [], bodyTypes: [], freeText: "" },
  situation: "",
  details: "",
  imageMode: "ai",
  uploadedImageDataUrl: null,
  result: null,
  lastRequest: null,
  autoDraft: { relation: null, answer: "", hint: "" },
  scenarioText: "",
});

export const hasCharacterDraftContent = (draft: CharacterDraft): boolean =>
  draft.step !== "entry" ||
  [
    draft.result,
    draft.lastRequest,
    draft.situation,
    draft.details,
    draft.uploadedImageDataUrl,
    draft.scenarioText,
    ...Object.values(draft.autoDraft),
  ].some(Boolean) ||
  Object.values(draft.selections).some((value) => value.length > 0);

export const readCharacterDraft = (): CharacterDraft | null => {
  try {
    const raw = localStorage.getItem(CHARACTER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.step === "preview" && !parsed.data.result) parsed.data.step = "entry";
    return parsed.data;
  } catch {
    return null;
  }
};

export const writeCharacterDraft = (draft: CharacterDraft): boolean => {
  try {
    localStorage.setItem(CHARACTER_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
};

export const clearCharacterDraft = (): boolean => {
  try {
    localStorage.removeItem(CHARACTER_DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
};
