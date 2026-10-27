import { characterSheetSchema } from "@v2/db";
import { z } from "zod";

import type { CharacterSheet } from "@v2/db";

const characterDraftSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    idea: z.string(),
    name: z.string(),
    introduction: z.string(),
    tags: z.string(),
    greeting: z.string(),
    systemPrompt: z.string(),
    exampleDialogue: z.string(),
    world: z.string(),
    appearance: z.string(),
    age: z.string(),
    adultCategory: z.enum(["general", "adult"]),
    proactiveEnabled: z.boolean(),
    intervalMinutes: z.string(),
    avatar: z.string(),
    gender: z.string(),
    slug: z.string(),
  })
  .strict();

export type CharacterDraft = z.infer<typeof characterDraftSchema>;
export type CharacterDraftErrors = Partial<Record<keyof CharacterDraft, string>>;

export const characterDraftStorageKey = (key: string): string =>
  `v2:character-draft:${encodeURIComponent(key)}`;

const emptyCharacterDraft = (): CharacterDraft => ({
  id: crypto.randomUUID(),
  createdAt: Date.now(),
  idea: "",
  name: "",
  introduction: "",
  tags: "",
  greeting: "",
  systemPrompt: "",
  exampleDialogue: "",
  world: "",
  appearance: "",
  age: "",
  adultCategory: "general",
  proactiveEnabled: false,
  intervalMinutes: "60",
  avatar: "",
  gender: "",
  slug: "",
});

export const createCharacterDraft = (initial: CharacterSheet | null): CharacterDraft => {
  if (!initial) return emptyCharacterDraft();
  return {
    id: initial.id,
    createdAt: initial.createdAt,
    idea: "",
    name: initial.name,
    introduction: initial.introduction,
    tags: initial.tags.join("\n"),
    greeting: initial.greeting,
    systemPrompt: initial.systemPrompt,
    exampleDialogue: initial.exampleDialogue,
    world: initial.world,
    appearance: initial.appearance,
    age: String(initial.age),
    adultCategory: initial.adultCategory,
    proactiveEnabled: initial.proactiveSettings.enabled,
    intervalMinutes: String(initial.proactiveSettings.intervalMinutes),
    avatar: initial.avatar ?? "",
    gender: initial.gender ?? "",
    slug: initial.slug ?? "",
  };
};

export const loadCharacterDraft = (
  storage: Pick<Storage, "getItem"> | null,
  key: string,
  initial: CharacterSheet | null,
): { draft: CharacterDraft | null; error: string | null } => {
  try {
    if (!storage) return { draft: null, error: "端末の下書きを読み込めませんでした。" };
    const raw = storage.getItem(characterDraftStorageKey(key));
    if (raw === null) return { draft: null, error: null };
    const envelope = z
      .object({
        version: z.literal(1),
        characterId: z.string().nullable(),
        draft: characterDraftSchema,
      })
      .strict()
      .safeParse(JSON.parse(raw) as unknown);
    if (!envelope.success || envelope.data.characterId !== (initial?.id ?? null)) {
      return { draft: null, error: "端末の下書きを読み込めませんでした。" };
    }
    const draft = envelope.data.draft;
    return {
      draft: initial ? { ...draft, id: initial.id, createdAt: initial.createdAt } : draft,
      error: null,
    };
  } catch {
    return { draft: null, error: "端末の下書きを読み込めませんでした。" };
  }
};

export const persistCharacterDraft = (
  storage: Pick<Storage, "setItem"> | null,
  key: string,
  initial: CharacterSheet | null,
  draft: CharacterDraft,
): string | null => {
  try {
    if (!storage) return "下書きをこの端末に保存できません。入力はこの画面に残っています。";
    storage.setItem(
      characterDraftStorageKey(key),
      JSON.stringify({ version: 1, characterId: initial?.id ?? null, draft }),
    );
    return null;
  } catch {
    return "下書きをこの端末に保存できません。入力はこの画面に残っています。";
  }
};

export const clearCharacterDraft = (
  storage: Pick<Storage, "removeItem"> | null,
  key: string,
): string | null => {
  try {
    if (!storage) return "保存は完了しましたが、端末の下書きを削除できませんでした。";
    storage.removeItem(characterDraftStorageKey(key));
    return null;
  } catch {
    return "保存は完了しましたが、端末の下書きを削除できませんでした。";
  }
};

export const createDraftFromIdea = (draft: CharacterDraft, idea: string): CharacterDraft => {
  const text = idea.trim();
  if (!text) return draft;
  return {
    ...draft,
    name: draft.name || text.split("\n")[0].slice(0, 40),
    introduction: draft.introduction || text,
    greeting: draft.greeting || "こんにちは。",
    systemPrompt: draft.systemPrompt || `次の設定に沿って会話してください。\n${text}`,
  };
};

const positiveInteger = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const characterMetadata = (draft: CharacterDraft, initial: CharacterSheet | null) => {
  if (initial)
    return {
      id: initial.id,
      createdAt: initial.createdAt,
      isOfficial: initial.isOfficial,
      displayOrder: initial.displayOrder,
    };
  return { id: draft.id, createdAt: draft.createdAt, isOfficial: false, displayOrder: 0 };
};

const nullableText = (value: string): string | null => value || null;

export const validateCharacterDraft = (
  draft: CharacterDraft,
  initial: CharacterSheet | null,
): { sheet: CharacterSheet; errors: null } | { sheet: null; errors: CharacterDraftErrors } => {
  const errors: CharacterDraftErrors = {};
  for (const field of ["name", "greeting", "systemPrompt"] as const) {
    if (!draft[field].trim()) errors[field] = "入力してください。";
  }
  const age = positiveInteger(draft.age);
  if (age === null || age < 18) errors.age = "18歳以上の整数を入力してください。";
  const intervalMinutes = positiveInteger(draft.intervalMinutes);
  if (intervalMinutes === null) errors.intervalMinutes = "1分以上の整数を入力してください。";
  if (Object.keys(errors).length > 0) return { sheet: null, errors };
  const parsed = characterSheetSchema.safeParse({
    ...characterMetadata(draft, initial),
    name: draft.name,
    introduction: draft.introduction,
    tags: draft.tags
      .split("\n")
      .map((tag) => tag.trim())
      .filter(Boolean),
    greeting: draft.greeting,
    systemPrompt: draft.systemPrompt,
    exampleDialogue: draft.exampleDialogue,
    world: draft.world,
    appearance: draft.appearance,
    age,
    adultCategory: draft.adultCategory,
    proactiveSettings: { enabled: draft.proactiveEnabled, intervalMinutes },
    avatar: nullableText(draft.avatar),
    gender: nullableText(draft.gender),
    slug: nullableText(draft.slug),
  });
  if (!parsed.success) {
    return { sheet: null, errors: { name: "入力内容を確認してください。" } };
  }
  return { sheet: parsed.data, errors: null };
};
