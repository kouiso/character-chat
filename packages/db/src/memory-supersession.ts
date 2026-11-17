// 食い違いは新しい方が勝つ（RIT-86）。同じ会話・同じ主題の記憶について、
// 有効な行の中で一番新しい 1 つだけを superseded_by = null にし、残りを全部その id へ向ける。
// 「届いた順」ではなく source_turn → id の順で決めるので、Queue のやり直しで
// 古い発言が後から届いても古い値へ戻らん。並べ直しは冪等（何度走っても同じ結果）。
import { sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { v2MemoryTable } from "./v2-schema";

import type { V2Db } from "./client";

// 「有効な行」が出どころの発言ごと今の枝にあるか。置き換えの並べ直しの対象条件:
// 同じ会話・同じ主題・主題が空でない・固定していない（pinned = 0）・論理削除されていない・
// 元の発言が今の枝（v2_message.active = 1）。消した行を外すのは「一番新しい行を消すと
// 次に新しい行が有効に戻る」（FR-6）ため — deleted_at が無いと消えた行が最新のまま選ばれる。
const sourceOnActiveBranch: SQL = sql`exists (
  select 1 from v2_memory_source s
  join v2_message g on g.id = s.source_message_id
  where s.memory_id = ${v2MemoryTable.id} and g.active = 1
)`;

// 有効な行の中で一番新しい 1 件。新しさは source_turn の大きい順、同じなら id の辞書順で後。
// Queue の配送順・created_at は使わん（FR-2）。有効な行が 1 件も無ければ NULL を返す。
const newestActiveId = (conversationId: string, subject: string): SQL => sql`(
  select m.id from v2_memory m
  join v2_memory_source s on s.memory_id = m.id
  join v2_message g on g.id = s.source_message_id
  where m.conversation_id = ${conversationId} and m.subject = ${subject}
    and m.pinned = 0 and m.deleted_at is null and g.active = 1
  order by m.source_turn desc, m.id desc
  limit 1
)`;

// 主題ごとの並べ直し文を返す。D1 batch の途中へ差し込んで使う（同じ batch なら
// 記憶の保存・消去と一緒に失敗するので「保存されて置き換えだけ抜ける」状態にならん）。
// 1 主題あたり 2 文（NFR-1）: 「全部を新しい 1 つへ向ける」→「新しい 1 つを空にする」。
// 一番新しい行が見つからん時は副問い合わせが NULL になり両方とも 0 件で終わる。
export const recomputeSupersessionStatements = (
  db: V2Db,
  conversationId: string,
  subjects: string[],
): BatchItem<"sqlite">[] => {
  const targets = [...new Set(subjects.filter((subject) => subject !== ""))];
  return targets.flatMap((subject) => {
    const newest = newestActiveId(conversationId, subject);
    return [
      db
        .update(v2MemoryTable)
        .set({ supersededBy: newest })
        .where(
          sql`${v2MemoryTable.conversationId} = ${conversationId}
            and ${v2MemoryTable.subject} = ${subject}
            and ${v2MemoryTable.pinned} = 0
            and ${v2MemoryTable.deletedAt} is null
            and ${v2MemoryTable.id} <> ${newest}
            and ${sourceOnActiveBranch}`,
        ),
      db
        .update(v2MemoryTable)
        .set({ supersededBy: null })
        .where(sql`${v2MemoryTable.id} = ${newest}`),
    ];
  });
};

// 並べ直しを今すぐ 1 batch で走らせる版。呼び出し側が自分の batch を持たん時用。
export const recomputeSupersession = async (
  db: V2Db,
  conversationId: string,
  subjects: string[],
): Promise<void> => {
  const statements = recomputeSupersessionStatements(db, conversationId, subjects);
  if (statements.length === 0) return;
  const [first, ...rest] = statements;
  await db.batch([first, ...rest]);
};
