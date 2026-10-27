/// <reference types="@cloudflare/workers-types" />

export type DocumentScope = { userId: string; characterId: string; worldlineId: string };
export type DocumentMetadata = {
  id: string;
  characterId: string;
  enabled: boolean;
  budgetChars: number;
};
export type DocumentChunk = { id: string; documentId: string; characterId: string; text: string };
export type StoredDocument = DocumentMetadata & {
  worldlineId: string;
  name: string;
  contentType: string;
  objectKey: string;
  createdAt: number;
  status: "indexing" | "ready" | "deleted";
};
type Reservation = Omit<StoredDocument, "enabled" | "characterId" | "worldlineId" | "status">;
type DocumentPatch = { enabled?: boolean; budgetChars?: number };
export type DocumentRepository = {
  list: () => Promise<StoredDocument[]>;
  reserve: (input: Reservation) => Promise<boolean>;
  complete: (id: string, chunks: readonly string[]) => Promise<boolean>;
  remove: (id: string) => Promise<StoredDocument | null>;
  update: (id: string, patch: DocumentPatch) => Promise<StoredDocument | null>;
  loadSettings: () => Promise<{ budgetChars: number; documents: DocumentMetadata[] }>;
  setBudget: (budgetChars: number) => Promise<void>;
  search: (input: { query: string; documentIds: readonly string[] }) => Promise<DocumentChunk[]>;
};

type DocumentRow = Omit<StoredDocument, "enabled"> & { enabled: number };
const COLUMNS =
  "id, character_id AS characterId, worldline_id AS worldlineId, name, content_type AS contentType, object_key AS objectKey, enabled, budget_chars AS budgetChars, created_at AS createdAt, status";
const storedDocument = (row: DocumentRow): StoredDocument => ({
  ...row,
  enabled: row.enabled === 1,
});
const validateBudget = (budgetChars: number): void => {
  if (!Number.isInteger(budgetChars) || budgetChars < 0 || budgetChars > 100_000) {
    throw new RangeError("資料予算が範囲外");
  }
};

const queryTerms = (query: string): string[] => {
  const terms = new Set(query.toLowerCase().match(/[\da-z]{1,64}/g) ?? []);
  for (const run of query.match(
    /(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〻ゝゞヽヾ〆〇]|\u3099|\u309a)+/gu,
  ) ?? []) {
    const chars = Array.from(run);
    if (chars.length === 1) terms.add(run);
    for (let index = 0; index + 1 < chars.length && terms.size < 24; index += 1) {
      terms.add(chars[index] + chars[index + 1]);
    }
  }
  return [...terms].slice(0, 24);
};

export const createDocumentRepository = (
  d1: D1Database,
  scope: DocumentScope,
): DocumentRepository => {
  if (
    [scope.userId, scope.characterId, scope.worldlineId].some(
      (value) => typeof value !== "string" || value.length === 0,
    )
  ) {
    throw new TypeError("資料の利用者・キャラ・世界線 scope が必要");
  }
  const scoped = (sql: string, ...values: (string | number | null)[]) =>
    d1.prepare(sql).bind(...values);
  const list = async (): Promise<StoredDocument[]> => {
    const result = await scoped(
      `SELECT ${COLUMNS} FROM v2_document WHERE user_id = ? AND character_id = ? AND worldline_id = ? AND status IN ('ready', 'indexing') ORDER BY created_at, id`,
      scope.userId,
      scope.characterId,
      scope.worldlineId,
    ).all<DocumentRow>();
    return result.results.map(storedDocument);
  };
  const getReady = async (id: string): Promise<StoredDocument | null> => {
    const row = await scoped(
      `SELECT ${COLUMNS} FROM v2_document WHERE id = ? AND user_id = ? AND character_id = ? AND worldline_id = ? AND status = 'ready'`,
      id,
      scope.userId,
      scope.characterId,
      scope.worldlineId,
    ).first<DocumentRow>();
    return row ? storedDocument(row) : null;
  };

  return {
    list,
    reserve: async (input) => {
      validateBudget(input.budgetChars);
      const result = await scoped(
        `WITH RECURSIVE slots(slot) AS (SELECT 0 UNION ALL SELECT slot + 1 FROM slots WHERE slot < 14)
        INSERT INTO v2_document (id, user_id, character_id, worldline_id, name, content_type, object_key, enabled, budget_chars, created_at, slot, status)
        SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, slots.slot, 'indexing' FROM slots
        WHERE NOT EXISTS (SELECT 1 FROM v2_document d WHERE d.user_id = ? AND d.character_id = ? AND d.slot = slots.slot)
        ORDER BY slots.slot LIMIT 1`,
        input.id,
        scope.userId,
        scope.characterId,
        scope.worldlineId,
        input.name,
        input.contentType,
        input.objectKey,
        input.budgetChars,
        input.createdAt,
        scope.userId,
        scope.characterId,
      ).run();
      return result.meta.changes === 1;
    },
    complete: async (id, chunks) => {
      if (chunks.length === 0 || chunks.length > 1000)
        throw new RangeError("資料 chunk 数が範囲外");
      const statements = chunks.map((text, ord) => {
        if (text.trim().length === 0 || Array.from(text).length > 1200)
          throw new RangeError("資料 chunk 長が範囲外");
        return scoped(
          `INSERT INTO v2_document_chunk (document_id, ord, text) SELECT id, ?, ? FROM v2_document WHERE id = ? AND user_id = ? AND character_id = ? AND worldline_id = ? AND status = 'indexing'`,
          ord,
          text,
          id,
          scope.userId,
          scope.characterId,
          scope.worldlineId,
        );
      });
      statements.push(
        scoped(
          "UPDATE v2_document SET status = 'ready' WHERE id = ? AND user_id = ? AND character_id = ? AND worldline_id = ? AND status = 'indexing'",
          id,
          scope.userId,
          scope.characterId,
          scope.worldlineId,
        ),
      );
      const results = await d1.batch(statements);
      return results.at(-1)?.meta.changes === 1;
    },
    remove: async (id) => {
      const results = await d1.batch<DocumentRow>([
        scoped(
          `UPDATE v2_document SET status = 'deleted', slot = NULL, enabled = 0 WHERE id = ? AND user_id = ? AND character_id = ? AND worldline_id = ? RETURNING ${COLUMNS}`,
          id,
          scope.userId,
          scope.characterId,
          scope.worldlineId,
        ),
        scoped(
          "DELETE FROM v2_document_chunk WHERE document_id IN (SELECT id FROM v2_document WHERE id = ? AND user_id = ? AND character_id = ? AND worldline_id = ? AND status = 'deleted')",
          id,
          scope.userId,
          scope.characterId,
          scope.worldlineId,
        ),
      ]);
      const row = results[0]?.results[0];
      return row ? storedDocument(row) : null;
    },
    update: async (id, patch) => {
      if (patch.budgetChars !== undefined) validateBudget(patch.budgetChars);
      const enabled = patch.enabled === undefined ? null : Number(patch.enabled);
      const result = await scoped(
        "UPDATE v2_document SET enabled = COALESCE(?, enabled), budget_chars = COALESCE(?, budget_chars) WHERE id = ? AND user_id = ? AND character_id = ? AND worldline_id = ? AND status = 'ready'",
        enabled,
        patch.budgetChars ?? null,
        id,
        scope.userId,
        scope.characterId,
        scope.worldlineId,
      ).run();
      return result.meta.changes === 1 ? getReady(id) : null;
    },
    loadSettings: async () => {
      const row = await scoped(
        "SELECT budget_chars AS budgetChars FROM v2_document_setting WHERE user_id = ? AND character_id = ? AND worldline_id = ?",
        scope.userId,
        scope.characterId,
        scope.worldlineId,
      ).first<{ budgetChars: number }>();
      const documents = (await list()).filter((document) => document.status === "ready");
      return { budgetChars: row?.budgetChars ?? 4000, documents };
    },
    setBudget: async (budgetChars) => {
      validateBudget(budgetChars);
      await scoped(
        "INSERT INTO v2_document_setting (user_id, character_id, worldline_id, budget_chars) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, character_id, worldline_id) DO UPDATE SET budget_chars = excluded.budget_chars",
        scope.userId,
        scope.characterId,
        scope.worldlineId,
        budgetChars,
      ).run();
    },
    search: async ({ query, documentIds }) => {
      const ids = [...new Set(documentIds)].slice(0, 15);
      const terms = queryTerms(query.slice(0, 4000));
      if (ids.length === 0 || terms.length === 0) return [];
      const score = terms
        .map(() => "CASE WHEN instr(lower(c.text), ?) > 0 THEN 1 ELSE 0 END")
        .join(" + ");
      const placeholders = ids.map(() => "?").join(", ");
      const result = await scoped(
        `SELECT c.document_id AS documentId, d.character_id AS characterId, c.ord, c.text, (${score}) AS score FROM v2_document_chunk c JOIN v2_document d ON d.id = c.document_id WHERE d.user_id = ? AND d.character_id = ? AND d.worldline_id = ? AND d.status = 'ready' AND d.enabled = 1 AND d.budget_chars > 0 AND d.id IN (${placeholders}) AND (${score}) > 0 ORDER BY score DESC, d.created_at, d.id, c.ord LIMIT 64`,
        ...terms,
        scope.userId,
        scope.characterId,
        scope.worldlineId,
        ...ids,
        ...terms,
      ).all<{ documentId: string; characterId: string; ord: number; text: string }>();
      return result.results.map((row) => ({
        id: `${row.documentId}:${row.ord}`,
        documentId: row.documentId,
        characterId: row.characterId,
        text: row.text,
      }));
    },
  };
};
