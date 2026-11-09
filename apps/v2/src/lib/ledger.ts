// 台帳の読み取り・手直し API のクライアント側（RIT-118）。
// サーバー側の sceneLedgerSchema は @v2/db（drizzle を引く）なので、画面用の形はここで自前に持つ。
import { z } from "zod";

export const ledgerSchema = z.object({
  phase: z.enum(["conversation", "intimate", "erotic", "climax", "afterglow"]),
  location: z.string().nullable(),
  time: z.string().nullable(),
  present: z.array(z.string()),
  clothing: z.record(z.string(), z.string()),
  position: z.string().nullable(),
  lastEvents: z.array(z.string()),
  items: z.record(z.string(), z.string()).default({}),
});

export type LedgerData = z.infer<typeof ledgerSchema>;

const getSchema = z.object({ ledger: ledgerSchema.nullable() });

export const loadLedger = async (
  characterId: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<LedgerData | null> => {
  const query = new URLSearchParams({ conversationId });
  const response = await fetch(
    `/api/chat/${encodeURIComponent(characterId)}/ledger?${query}`,
    { signal },
  );
  if (response.status === 404) throw new Error("会話が見つかりません。");
  if (!response.ok) throw new Error("台帳を読み込めませんでした。");
  return getSchema.parse(await response.json()).ledger;
};

// 保存成功時は書き込んだターン番号。台帳未作成なら null。
export const saveLedger = async (
  characterId: string,
  conversationId: string,
  ledger: LedgerData,
): Promise<number | null> => {
  const response = await fetch(`/api/chat/${encodeURIComponent(characterId)}/ledger`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId, ledger }),
  });
  if (response.status === 404) throw new Error("会話が見つかりません。");
  if (response.status === 409) return null;
  if (!response.ok) throw new Error("台帳を保存できませんでした。");
  const body = z.object({ turn: z.number() }).parse(await response.json());
  return body.turn;
};
