// RIT-202: 会話の枝分かれ。同じ (conversation, turn, role) の代替系列を branch_no で
// 持ち、active=1 の1本だけが表示・履歴対象。行は消さん（記憶の出処が cascade で消える
// のを防ぐため）。張り替えは 1 batch でやるので途中で2本 active にはならん。
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { v2LedgerTable, v2MessageTable } from "./v2-schema";
import type { V2Db } from "./client";

export type MessageRole = "user" | "assistant";

export type BranchSibling = {
  id: string;
  branchNo: number;
  active: boolean;
  content: string;
  createdAt: number;
};

// 同じ (turn, role) の代替系列を branch_no 順で返す。UI の「◀ 2/3 ▶」表示用。
export const listBranchSiblings = async (
  db: V2Db,
  conversationId: string,
  turn: number,
  role: MessageRole,
): Promise<BranchSibling[]> => {
  const rows = await db
    .select({
      id: v2MessageTable.id,
      branchNo: v2MessageTable.branchNo,
      active: v2MessageTable.active,
      content: v2MessageTable.content,
      createdAt: v2MessageTable.createdAt,
    })
    .from(v2MessageTable)
    .where(
      and(
        eq(v2MessageTable.conversationId, conversationId),
        eq(v2MessageTable.turn, turn),
        eq(v2MessageTable.role, role),
      ),
    )
    .orderBy(asc(v2MessageTable.branchNo));
  return rows.map((row) => ({ ...row, active: row.active === 1 }));
};

// 指定メッセージの所属グループを返す（id から conversation/turn/role を引く）。
const branchGroupOf = async (db: V2Db, messageId: string) => {
  const [row] = await db
    .select({
      conversationId: v2MessageTable.conversationId,
      turn: v2MessageTable.turn,
      role: v2MessageTable.role,
    })
    .from(v2MessageTable)
    .where(eq(v2MessageTable.id, messageId));
  return row ?? null;
};

// active を別の系列へ張り替える（進む/戻るの枝切替）。対象行が無ければ null。
// 代替系列が無い（自分だけの）グループでも同じ行へ張り直すだけなので無害。
export const activateBranch = async (db: V2Db, messageId: string): Promise<"ok" | "not-found"> => {
  const group = await branchGroupOf(db, messageId);
  if (!group) return "not-found";
  const sameGroup = and(
    eq(v2MessageTable.conversationId, group.conversationId),
    eq(v2MessageTable.turn, group.turn),
    eq(v2MessageTable.role, group.role),
  );
  await db.batch([
    db.update(v2MessageTable).set({ active: 0 }).where(sameGroup),
    db.update(v2MessageTable).set({ active: 1 }).where(eq(v2MessageTable.id, messageId)),
  ]);
  return "ok";
};

// turn 以降の表示メッセージを全部眠らせる（戻る＝以降を削除）。行は残すので
// 進む（restoreFromTurn）で最新枝を起こせる。
export const truncateFromTurn = async (
  db: V2Db,
  conversationId: string,
  fromTurn: number,
): Promise<void> => {
  await db
    .update(v2MessageTable)
    .set({ active: 0 })
    .where(
      and(
        eq(v2MessageTable.conversationId, conversationId),
        sql`${v2MessageTable.turn} >= ${fromTurn}`,
      ),
    );
};

// truncateFromTurn の逆向き。fromTurn 以降の各 (turn, role) グループで一番新しい
// branch_no の行を起こす。戻した直後だけ「進む」が効く形になる。
export const restoreFromTurn = async (
  db: V2Db,
  conversationId: string,
  fromTurn: number,
): Promise<void> => {
  const groups = await db
    .select({
      turn: v2MessageTable.turn,
      role: v2MessageTable.role,
      maxBranch: sql<number>`max(${v2MessageTable.branchNo})`,
    })
    .from(v2MessageTable)
    .where(
      and(
        eq(v2MessageTable.conversationId, conversationId),
        sql`${v2MessageTable.turn} >= ${fromTurn}`,
      ),
    )
    .groupBy(v2MessageTable.turn, v2MessageTable.role);
  const ids = await Promise.all(
    groups.map(async (group) => {
      const [row] = await db
        .select({ id: v2MessageTable.id })
        .from(v2MessageTable)
        .where(
          and(
            eq(v2MessageTable.conversationId, conversationId),
            eq(v2MessageTable.turn, group.turn),
            eq(v2MessageTable.role, group.role),
            eq(v2MessageTable.branchNo, group.maxBranch),
          ),
        )
        .limit(1);
      return row?.id;
    }),
  );
  const targets = ids.filter((id): id is string => id !== undefined);
  if (targets.length === 0) return;
  await db.update(v2MessageTable).set({ active: 1 }).where(inArray(v2MessageTable.id, targets));
};

// 次の branch_no を出す。新しい代替系列は常に末尾へ足す。
const nextBranchNo = async (
  db: V2Db,
  conversationId: string,
  turn: number,
  role: MessageRole,
): Promise<number> => {
  const [row] = await db
    .select({ maxBranch: sql<number>`coalesce(max(${v2MessageTable.branchNo}), -1)` })
    .from(v2MessageTable)
    .where(
      and(
        eq(v2MessageTable.conversationId, conversationId),
        eq(v2MessageTable.turn, turn),
        eq(v2MessageTable.role, role),
      ),
    );
  return (row?.maxBranch ?? -1) + 1;
};

// リライト: ユーザー行を新しい枝として差し替える（本文の履歴は残る）。
// 戻り値は新しい表示行の id。対象会話・ターンが無ければ null。
export const rewriteUserMessage = async (
  db: V2Db,
  conversationId: string,
  turn: number,
  content: string,
): Promise<string | null> => {
  const siblings = await listBranchSiblings(db, conversationId, turn, "user");
  if (siblings.length === 0) return null;
  const branchNo = await nextBranchNo(db, conversationId, turn, "user");
  const id = crypto.randomUUID();
  const group = and(
    eq(v2MessageTable.conversationId, conversationId),
    eq(v2MessageTable.turn, turn),
    eq(v2MessageTable.role, "user"),
  );
  await db.batch([
    db.update(v2MessageTable).set({ active: 0 }).where(group),
    db.insert(v2MessageTable).values({
      id,
      conversationId,
      turn,
      role: "user",
      content,
      branchNo,
      active: 1,
      createdAt: Date.now(),
    }),
  ]);
  return id;
};

// 再生成/リライト後の assistant 行を新しい枝として保存する。ユーザー行は触らん。
// chunks・台帳・生成記録は新しい行側へ紐付け、ターンの台帳は最新生成で上書きする。
export const saveAssistantBranch = async (
  db: V2Db,
  input: {
    conversationId: string;
    turn: number;
    content: string;
    action: string | null;
    dialogue: string | null;
    inner: string | null;
    generationId: string | null;
    provider: string | null;
    upstreamId: string | null;
    ledgerJson: string;
  },
): Promise<string> => {
  const branchNo = await nextBranchNo(db, input.conversationId, input.turn, "assistant");
  const id = crypto.randomUUID();
  const now = Date.now();
  const group = and(
    eq(v2MessageTable.conversationId, input.conversationId),
    eq(v2MessageTable.turn, input.turn),
    eq(v2MessageTable.role, "assistant"),
  );
  await db.batch([
    db.update(v2MessageTable).set({ active: 0 }).where(group),
    db.insert(v2MessageTable).values({
      id,
      conversationId: input.conversationId,
      turn: input.turn,
      role: "assistant",
      content: input.content,
      action: input.action,
      dialogue: input.dialogue,
      inner: input.inner,
      generationId: input.generationId,
      provider: input.provider,
      upstreamId: input.upstreamId,
      branchNo,
      active: 1,
      createdAt: now,
    }),
    // 台帳はターンに1本。枝を戻した時の世界状態までは追わんので、常に最新の
    // 生成結果で上書きする（旧台帳は消さず turn 単位で入れ直す運用は後続で検討）。
    db
      .delete(v2LedgerTable)
      .where(
        and(
          eq(v2LedgerTable.conversationId, input.conversationId),
          eq(v2LedgerTable.turn, input.turn),
        ),
      ),
    db.insert(v2LedgerTable).values({
      conversationId: input.conversationId,
      turn: input.turn,
      ledgerJson: input.ledgerJson,
      createdAt: now,
    }),
  ]);
  return id;
};

// 枝を眠らせても記憶は残す（眠った行から取った事実も「あったこと」として残る設計。
// 消したい時は記憶リセット RIT-196 側で対象を選ぶ）。
