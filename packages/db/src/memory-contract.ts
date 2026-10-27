import { z } from "zod";

export const memoryKindSchema = z.enum(["fact", "summary", "preference"]);
export const memoryStateSchema = z.enum(["active", "invalidated", "deleted"]);
export const memoryContentSchema = z.string().refine((value) => value.trim().length > 0);
export const memoryIdSchema = z.string().trim().min(1);

export const managedMemorySchema = z.object({
  id: memoryIdSchema,
  conversationId: memoryIdSchema,
  memoryKey: memoryIdSchema,
  kind: memoryKindSchema,
  content: z.string(),
  supersededById: z.string().nullable(),
  sourceTurn: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  state: memoryStateSchema,
  pinned: z.boolean(),
  enabled: z.boolean(),
  eligible: z.boolean(),
  sourceType: z.enum(["user", "extracted", "summary"]),
  sourceMessageId: z.string().nullable(),
  sourceRevision: z.number().int().nullable(),
  characterVersionId: z.string().nullable(),
});

export type ManagedMemory = z.infer<typeof managedMemorySchema>;
export type MemoryScope = {
  ownerUserId: string;
  characterId: string;
  worldlineId: string;
  conversationId: string;
};

export const memoryCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("add"),
    requestKey: memoryIdSchema,
    kind: memoryKindSchema,
    content: memoryContentSchema,
  }),
  z.strictObject({
    action: z.literal("edit"),
    requestKey: memoryIdSchema,
    id: memoryIdSchema,
    content: memoryContentSchema,
  }),
  z.strictObject({ action: z.literal("delete"), id: memoryIdSchema }),
  z.strictObject({ action: z.literal("pin"), id: memoryIdSchema, pinned: z.boolean() }),
  z.strictObject({ action: z.literal("enable"), id: memoryIdSchema, enabled: z.boolean() }),
  z.strictObject({ action: z.literal("set-enabled"), enabled: z.boolean() }),
]);
export type MemoryCommand = z.infer<typeof memoryCommandSchema>;

export const memorySnapshotSchema = z.object({
  enabled: z.boolean(),
  memories: z.array(managedMemorySchema),
});
export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>;

export class MemoryAccessError extends Error {
  constructor() {
    super("memory scope not found");
    this.name = "MemoryAccessError";
  }
}
export class MemoryConflictError extends Error {
  constructor() {
    super("memory changed; reload before retrying");
    this.name = "MemoryConflictError";
  }
}

export type ManagedMemoryStore = {
  snapshot: () => Promise<MemorySnapshot>;
  listCurrent: () => Promise<ManagedMemory[]>;
  history: (id: string) => Promise<ManagedMemory[]>;
  add: (input: {
    requestKey: string;
    kind: ManagedMemory["kind"];
    content: string;
  }) => Promise<ManagedMemory>;
  edit: (input: { requestKey: string; id: string; content: string }) => Promise<ManagedMemory>;
  delete: (id: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  setMemoryEnabled: (id: string, enabled: boolean) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
};
