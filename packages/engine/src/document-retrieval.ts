import { z } from "zod";

export const DocumentMetadataSchema = z.object({
  id: z.string().min(1).max(200),
  characterId: z.string().min(1),
  enabled: z.boolean(),
  budgetChars: z.number().int().nonnegative().max(100_000),
});

export const DocumentSettingsSchema = z
  .object({
    budgetChars: z.number().int().nonnegative().max(100_000),
    documents: z.array(DocumentMetadataSchema).max(15),
  })
  .superRefine(({ documents }, context) => {
    const ids = new Set<string>();
    for (const document of documents) {
      if (ids.has(document.id)) {
        context.addIssue({ code: "custom", message: "資料 ID が重複しとる" });
      }
      ids.add(document.id);
    }
  });

export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type DocumentSettings = z.infer<typeof DocumentSettingsSchema>;
export type DocumentChunk = { id: string; documentId: string; characterId: string; text: string };

export type DocumentSource = {
  loadSettings: (characterId: string) => Promise<DocumentSettings>;
  search: (input: {
    characterId: string;
    query: string;
    documentIds: readonly string[];
  }) => Promise<readonly DocumentChunk[]>;
};

export type DocumentProjectionInput = {
  characterId: string;
  query: string;
  maxChars: number;
};
export type DocumentProjection = (input: DocumentProjectionInput) => Promise<string[]>;

const PREFIX = "【設定資料】\n";

// 資料枠だけを数える。会話 window や生成の maxTokens はこの層から変更せん。
const charCount = (text: string): number => Array.from(text).length;
const takeChars = (text: string, count: number): string =>
  Array.from(text).slice(0, count).join("");

type Selection = {
  usedByDocument: Map<string, number>;
  seen: Map<string, Set<string>>;
  parts: string[];
  remaining: number;
};

const takeDocumentChunk = (
  document: DocumentMetadata,
  chunk: DocumentChunk,
  selection: Selection,
): string => {
  const documentSeen = selection.seen.get(document.id) ?? new Set<string>();
  if (documentSeen.has(chunk.id) || chunk.text.trim().length === 0) return "";
  documentSeen.add(chunk.id);
  selection.seen.set(document.id, documentSeen);
  const separatorChars = selection.parts.length > 0 ? 1 : 0;
  const used = selection.usedByDocument.get(document.id) ?? 0;
  const available = Math.min(selection.remaining - separatorChars, document.budgetChars - used);
  return available > 0 ? takeChars(chunk.text, available) : "";
};

const selectChunks = (
  chunks: readonly DocumentChunk[],
  enabled: ReadonlyMap<string, DocumentMetadata>,
  characterId: string,
  budgetChars: number,
): string[] => {
  const usedByDocument = new Map<string, number>();
  const parts: string[] = [];
  const selection: Selection = {
    usedByDocument,
    seen: new Map(),
    parts,
    remaining: budgetChars - charCount(PREFIX),
  };

  for (const chunk of chunks) {
    const document = enabled.get(chunk.documentId);
    // 検索側の絞り込み漏れや古い索引でも、OFF・別キャラの資料を生成側へ渡さん。
    if (!document || chunk.characterId !== characterId) continue;
    const text = takeDocumentChunk(document, chunk, selection);
    if (text.length === 0) continue;
    const separatorChars = parts.length > 0 ? 1 : 0;
    const used = usedByDocument.get(document.id) ?? 0;
    const count = charCount(text);
    parts.push(text);
    usedByDocument.set(document.id, used + count);
    selection.remaining -= count + separatorChars;
    if (selection.remaining <= 0) break;
  }

  return parts.length > 0 ? [PREFIX + parts.join("\n")] : [];
};

const enabledDocuments = (settings: DocumentSettings, characterId: string) =>
  new Map(
    settings.documents
      .filter(
        (document) =>
          document.characterId === characterId && document.enabled && document.budgetChars > 0,
      )
      .map((document) => [document.id, document]),
  );

const projectionLimit = (maxChars: number | undefined): number => {
  if (maxChars === undefined) return 100_000;
  if (!Number.isSafeInteger(maxChars) || maxChars < 0)
    throw new RangeError("資料の利用字数枠が不正です");
  return maxChars;
};

export const retrieveDocumentContext = async (
  source: DocumentSource | undefined,
  input: { characterId: string; query: string; maxChars?: number },
): Promise<string[]> => {
  const maxChars = projectionLimit(input.maxChars);
  if (!source || maxChars <= charCount(PREFIX)) return [];
  const settings = DocumentSettingsSchema.parse(await source.loadSettings(input.characterId));
  if (settings.budgetChars <= charCount(PREFIX)) return [];
  const enabled = enabledDocuments(settings, input.characterId);
  if (enabled.size === 0) return [];
  const chunks = await source.search({
    characterId: input.characterId,
    query: input.query,
    documentIds: [...enabled.keys()],
  });
  // 検索待ちの間にOFF・削除・予算変更された資料を、古い設定のまま本文へ戻さない。
  const current = DocumentSettingsSchema.parse(await source.loadSettings(input.characterId));
  const allowed = new Map(
    [...enabledDocuments(current, input.characterId)].filter(([id]) => enabled.has(id)),
  );
  const budget = Math.min(current.budgetChars, maxChars);
  if (budget <= charCount(PREFIX)) return [];
  return selectChunks(chunks, allowed, input.characterId, budget);
};

export const createDocumentProjection =
  (source: DocumentSource): DocumentProjection =>
  (input) =>
    retrieveDocumentContext(source, input);
