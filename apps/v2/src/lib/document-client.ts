import { z } from "zod";

export const MAX_DOCUMENT_UPLOAD_BYTES = 2 * 1024 * 1024;
const budget = z.number().int().min(0).max(100_000);
const documentSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  name: z.string(),
  contentType: z.string(),
  enabled: z.boolean(),
  budgetChars: budget,
  createdAt: z.number(),
  status: z.enum(["indexing", "ready"]),
});
const listSchema = z.object({
  documents: z.array(documentSchema).max(15),
  settings: z.object({ budgetChars: budget }),
});
const errorSchema = z.object({
  message: z.string().min(1).max(300).optional(),
  code: z.string().max(100).optional(),
  documentId: z.string().max(200).optional(),
});

export type DocumentItem = z.infer<typeof documentSchema>;
export type DocumentListing = z.infer<typeof listSchema>;
export type DocumentClientScope = { characterId: string; conversationId: string };

export class DocumentClientError extends Error {
  readonly code?: string;
  readonly documentId?: string;
  constructor(message: string, details: { code?: string; documentId?: string } = {}) {
    super(message);
    this.name = "DocumentClientError";
    this.code = details.code;
    this.documentId = details.documentId;
  }
}

const endpoint = ({ characterId, conversationId }: DocumentClientScope): string => {
  if (!characterId || !conversationId) throw new DocumentClientError("会話を開き直してください");
  return `/api/chat/${encodeURIComponent(characterId)}/documents?${new URLSearchParams({ conversationId })}`;
};

const send = async (
  scope: DocumentClientScope,
  options: RequestInit,
  signal?: AbortSignal,
): Promise<Response> => {
  const response = await fetch(endpoint(scope), { ...options, signal });
  if (response.ok) return response;
  const parsed = errorSchema.safeParse(await response.json().catch(() => undefined));
  const details = parsed.success ? parsed.data : {};
  throw new DocumentClientError(
    details.message ?? "資料の操作に失敗しました。再試行してください",
    details,
  );
};

export const parseDocumentBudget = (value: string): number => {
  const parsed = budget.safeParse(/^\d+$/.test(value) ? Number(value) : NaN);
  if (!parsed.success) throw new DocumentClientError("字数上限は0〜100000の整数で入力してください");
  return parsed.data;
};

export const listDocuments = async (
  scope: DocumentClientScope,
  signal?: AbortSignal,
): Promise<DocumentListing> => {
  const response = await send(scope, { method: "GET" }, signal);
  const parsed = listSchema.safeParse(await response.json());
  if (!parsed.success) throw new DocumentClientError("資料の一覧を読み直してください");
  return parsed.data;
};

export const uploadDocument = async (
  scope: DocumentClientScope,
  file: File,
  signal?: AbortSignal,
): Promise<void> => {
  if (
    !file.name.toLowerCase().endsWith(".txt") ||
    (file.type !== "text/plain" && file.type !== "") ||
    file.size === 0 ||
    file.size > MAX_DOCUMENT_UPLOAD_BYTES
  )
    throw new DocumentClientError("UTF-8のTXTファイルを2 MiB以下で選んでください");
  const form = new FormData();
  // OSがMIMEを付けない.txtでも、サーバーでUTF-8検査を受けられるようにする。
  form.set("file", file.type ? file : new File([file], file.name, { type: "text/plain" }));
  await send(scope, { method: "POST", body: form }, signal);
};

const sendJson = async (
  scope: DocumentClientScope,
  method: "PATCH" | "DELETE",
  body: unknown,
  signal?: AbortSignal,
): Promise<void> => {
  await send(
    scope,
    { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    signal,
  );
};

export const updateDocument = async (
  scope: DocumentClientScope,
  documentId: string,
  patch: { enabled?: boolean; budgetChars?: number },
  signal?: AbortSignal,
): Promise<void> => {
  const validated = z
    .object({ enabled: z.boolean().optional(), budgetChars: budget.optional() })
    .strict()
    .parse(patch);
  await sendJson(scope, "PATCH", { documentId, ...validated }, signal);
};

export const deleteDocument = (
  scope: DocumentClientScope,
  documentId: string,
  signal?: AbortSignal,
): Promise<void> => sendJson(scope, "DELETE", { documentId }, signal);

export const setDocumentBudget = (
  scope: DocumentClientScope,
  budgetChars: number,
  signal?: AbortSignal,
): Promise<void> => sendJson(scope, "PATCH", { budgetChars: budget.parse(budgetChars) }, signal);
