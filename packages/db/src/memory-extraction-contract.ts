import { z } from "zod";

export const MEMORY_EXTRACTION_LIMIT = 8;
export const MEMORY_PUBLISH_ATTEMPTS = 5;

export const extractedMemorySchema = z
  .object({
    kind: z.enum(["fact", "preference"]),
    content: z.string().trim().min(1).max(500),
    // 食い違い判定の主題ラベル（RIT-86）。同じ話題の事実を同じ短い語で名付ける。
    subject: z.string().trim().max(80).default(""),
    // 記憶の置き場（RIT-92）。抽出が返さん・不正な値を返した時は long へ倒す。
    category: z.enum(["long", "recent", "relation", "future"]).catch("long"),
    importance: z.number().int().min(1).max(5),
    validFrom: z.iso.date().nullable(),
    validUntil: z.iso.date().nullable(),
  })
  .strict()
  .refine(
    (memory) => !memory.validFrom || !memory.validUntil || memory.validFrom <= memory.validUntil,
    "記憶の有効期間が逆転しています。",
  );

export const memoryExtractionSchema = z
  .object({ memories: z.array(extractedMemorySchema).max(MEMORY_EXTRACTION_LIMIT) })
  .strict();

// 伏せ直しの仕事（RIT-94）。本文は Queue の体に入れん（NFR-2）— 受け手が D1 の墓標から読む。
export const summaryRedactBodySchema = z
  .object({ type: z.literal("summary_redact"), conversationId: z.string().min(1).max(120) })
  .strict();

export const memoryQueueBodySchema = z.union([
  z.object({ jobId: z.string().uuid() }).strict(),
  summaryRedactBodySchema,
]);

export type ExtractedMemory = z.infer<typeof extractedMemorySchema>;
export type MemoryQueueBody = z.infer<typeof memoryQueueBodySchema>;
export type ExtractionScope = { userId: string; characterId: string; conversationId: string };

export const validateExtractedMemories = (value: unknown, source: string): ExtractedMemory[] => {
  const { memories } = memoryExtractionSchema.parse(value);
  if (memories.some((memory) => !source.includes(memory.content))) {
    throw new Error("元の発言に無い記憶は保存できません。");
  }
  if (
    memories.some((memory) =>
      [memory.validFrom, memory.validUntil].some((date) => date !== null && !source.includes(date)),
    )
  ) {
    throw new Error("元の発言に無い有効期間は保存できません。");
  }
  return memories.filter(
    (memory, index) =>
      memories.findIndex((candidate) => candidate.content === memory.content) === index,
  );
};
