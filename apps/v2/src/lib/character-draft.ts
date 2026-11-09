import { z } from "zod";

// 未完成・上限超過の入力も、保存エラー後に端末から復元できるようにする。
const draftContentSchema = z.object({
  name: z.string(),
  bio: z.string(),
  personality: z.string(),
  speechStyle: z.string(),
  appearance: z.string(),
  background: z.string(),
  worldSetting: z.string(),
  prologue: z.string(),
  greeting: z.string(),
  privateNotes: z.string(),
  // 追加前の下書きを捨てんよう、無い場合は初期値で復元する。
  memoryInstruction: z.string().default(""),
  memoryKinds: z.array(z.enum(["fact", "preference"])).default(["fact", "preference"]),
  tags: z.array(z.string()),
  voiceRef: z.string().nullable(),
  avatarRef: z.string().nullable(),
  visibility: z.enum(["private", "shared", "public"]),
  legacyReconstructed: z.literal(true).optional(),
});
const draftSchema = z.object({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().nonnegative(),
  content: draftContentSchema,
  tagsText: z.string(),
});
export type CharacterDraft = z.infer<typeof draftSchema>;

export const characterDraftKey = (ownerUserId: string, characterId?: string): string =>
  `v2-character-draft:${encodeURIComponent(ownerUserId)}:${encodeURIComponent(characterId ?? "new")}`;

export const readCharacterDraft = (key: string): CharacterDraft | null => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const result = draftSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};
