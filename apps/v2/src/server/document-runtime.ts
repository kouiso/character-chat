import { createDocumentRepository, type DocumentScope } from "@v2/db";
import { createDocumentService, type DocumentBucket } from "@v2/engine";
import { z } from "zod";

const ScopeSchema = z
  .object({
    userId: z.string().min(1),
    characterId: z.string().min(1),
    worldlineId: z.string().min(1),
  })
  .strict();

export const createScopedDocumentService = (
  bindings: { DB: D1Database; BUCKET: DocumentBucket },
  scope: DocumentScope,
) => {
  const snapshot = Object.freeze(ScopeSchema.parse(scope));
  return createDocumentService({
    repository: createDocumentRepository(bindings.DB, snapshot),
    bucket: bindings.BUCKET,
    scope: snapshot,
  });
};
