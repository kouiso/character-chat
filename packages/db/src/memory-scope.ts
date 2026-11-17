// 記憶の読み出し区切り（RIT-89）。v2_memory を読む全ての道が必ず通す条件をここに置く。
// 「漏れ」とは、別の利用者・別のキャラ（同名でも）・同じキャラの別会話・同じ会話の
// 眠った枝の記憶が、指示文・話しかけ・画面に出る事。読み手は memoryReadConditions を
// 自分の and(...) に足すか、selectScopedMemories から始める。
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { v2ConversationTable, v2MemoryTable, v2MessageTable } from "./v2-schema";

import type { V2Db } from "./client";

// 区切りの設定（RIT-89 の読み手表）。
// - conversationId: 会話まで絞る読み手は必ず渡す。話しかけの記念日キュー（findRecallCue）
//   だけ未定義で会話をまたぐ（未決 1: 同じ利用者・同じキャラの中なので漏れに数えん）。
// - excludeSuperseded: 返事・話しかけの経路は true。記憶の画面は「新しい記憶に
//   置き換わった」と出すために false（RIT-86）。
// - activeBranchOnly: 固定の経路（loadPinnedMemories）だけ false（未決 3:
//   利用者が手で固定した物だから枝では絞らん）。
// - kinds: 指示文・話しかけに入るのは事実と好みだけ。summary は経路に出さん。
export type MemoryReadScope = {
  userId: string;
  characterId: string;
  conversationId?: string;
  excludeSuperseded: boolean;
  activeBranchOnly: boolean;
  kinds?: ("fact" | "preference")[];
};

// 利用者 id が空 = 呼び出し側の誤り。黙って全件を読ませない（RIT-89 失敗時の振る舞い）。
export class MemoryScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryScopeError";
  }
}

// 枝の条件（FR-2）。抜き出した記憶は出どころの発言が眠っていたら（active = 0）読まん。
// 手で足した記憶も出どころ行を持つが、利用者がはっきり足した物は枝に関係なく残す
// （未決 2）ので、origin = 'manual' は眠った出どころを持っていても通す。
export const sourceOnActiveBranch: SQL = sql`(
  ${v2MemoryTable.origin} = 'manual'
  or not exists (
    select 1 from v2_memory_source s
    join v2_message m on m.id = s.source_message_id
    where s.memory_id = ${v2MemoryTable.id} and m.active = 0
  )
)`;

// 出どころの v2_message を join 済みの問い合わせ向けの同じ条件（FR-8 の exists 節など）。
// source は記憶 1 件につき 1 行なので、結んだ行の active がそのまま枝の生死になる。
export const joinedSourceOnActiveBranch: SQL | undefined = or(
  eq(v2MemoryTable.origin, "manual"),
  eq(v2MessageTable.active, 1),
);

// 読み手が必ず掛ける条件の束。v2_memory と v2_conversation の join を前提にする
// （記憶自身は所有者を持たんので、親の会話で利用者・キャラを照合する）。
// 論理削除（deleted_at）もここで除く — 消した記憶が出るのも漏れであり、
// 各読み手への書き写し忘れをここで防ぐ。
export const memoryReadConditions = (scope: MemoryReadScope): SQL | undefined => {
  if (!scope.userId) throw new MemoryScopeError("memoryReadScope の userId が空です");
  if (!scope.characterId) {
    throw new MemoryScopeError("memoryReadScope の characterId が空です");
  }
  return and(
    eq(v2ConversationTable.userId, scope.userId),
    eq(v2ConversationTable.characterId, scope.characterId),
    isNull(v2MemoryTable.deletedAt),
    scope.conversationId === undefined
      ? undefined
      : eq(v2MemoryTable.conversationId, scope.conversationId),
    scope.excludeSuperseded ? isNull(v2MemoryTable.supersededBy) : undefined,
    scope.activeBranchOnly ? sourceOnActiveBranch : undefined,
    scope.kinds === undefined ? undefined : inArray(v2MemoryTable.kind, scope.kinds),
  );
};

// join 済みの区切り select。区切りの本体（memoryReadConditions）はここで掛けるので、
// 読み手は固有の追加条件を第 3 引数に並べるだけでよい（drizzle の select は where を
// 一度しか掛けられんため）。行は { v2_memory, v2_conversation } の入れ子で返る —
// 全列を取るので、応答へ出す前に使う列だけへ絞るのは各読み手の仕事。
export const selectScopedMemories = (
  db: V2Db,
  scope: MemoryReadScope,
  conditions: (SQL | undefined)[] = [],
) =>
  db
    .select()
    .from(v2MemoryTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryTable.conversationId))
    .where(and(memoryReadConditions(scope), ...conditions));
