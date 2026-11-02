import { z } from "zod";

export const MAX_MEMORY_LENGTH = 1_000;
export const memoryIdSchema = z.string().min(1).max(120);
export const memoryFieldsSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MEMORY_LENGTH),
  kind: z.enum(["fact", "summary", "preference"]),
  pinned: z.boolean(),
});
export const newMemorySchema = memoryFieldsSchema.extend({ id: memoryIdSchema });
export const memoryRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1);
export const memoryChangeSchema = newMemorySchema.extend({ revision: memoryRevisionSchema });
export const memoryDeleteSchema = z.object({ id: memoryIdSchema, revision: memoryRevisionSchema });
export const memoryRecordSchema = memoryChangeSchema.extend({
  content: z.string(),
  conversationId: memoryIdSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const memoryListResponseSchema = z.object({ memories: z.array(memoryRecordSchema) });
export const memoryOneResponseSchema = z.object({ memory: memoryRecordSchema });
export const memoryDeletedResponseSchema = z.object({ deleted: z.literal(true) });
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type NewMemory = z.infer<typeof newMemorySchema>;
export type MemoryChange = z.infer<typeof memoryChangeSchema>;
export type MemoryDelete = z.infer<typeof memoryDeleteSchema>;
