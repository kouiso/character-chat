import { z } from "zod";

// RIT-202: 枝操作 API の薄いクライアント。失敗時はメッセージだけ返し、
// 表示の更新は呼び出し側が履歴の再読込で行う。

const siblingSchema = z.object({
  id: z.string(),
  branchNo: z.number().int(),
  active: z.boolean(),
  content: z.string(),
});
export type BranchSibling = z.infer<typeof siblingSchema>;

export const listBranchSiblings = async (
  characterId: string,
  conversationId: string,
  turn: number,
  role: "user" | "assistant",
): Promise<BranchSibling[]> => {
  const query = new URLSearchParams({ conversationId, turn: String(turn), role });
  const response = await fetch(`/api/chat/${encodeURIComponent(characterId)}/branch?${query}`);
  if (!response.ok) throw new Error("枝の一覧を読み込めませんでした。");
  const body = z.object({ siblings: z.array(siblingSchema) }).parse(await response.json());
  return body.siblings;
};

export type BranchAction =
  | { action: "activate"; messageId: string }
  | { action: "truncate"; fromTurn: number }
  | { action: "restore"; fromTurn: number }
  | { action: "rewrite"; turn: number; content: string }
  | { action: "regenerate"; turn: number };

export const runBranchAction = async (
  characterId: string,
  conversationId: string,
  action: BranchAction,
): Promise<Response> => {
  const response = await fetch(`/api/chat/${encodeURIComponent(characterId)}/branch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId, ...action }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "枝の操作に失敗しました。");
  }
  return response;
};

// 再生成は完了時に更新後の系列を返す。◀ n/m ▶ の表示更新に使う。
export const regenerateBranch = async (
  characterId: string,
  conversationId: string,
  turn: number,
): Promise<BranchSibling[]> => {
  const response = await runBranchAction(characterId, conversationId, {
    action: "regenerate",
    turn,
  });
  const body = z.object({ siblings: z.array(siblingSchema) }).parse(await response.json());
  return body.siblings;
};
