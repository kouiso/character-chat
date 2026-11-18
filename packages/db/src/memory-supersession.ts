// 食い違いは新しい方が勝つ（RIT-86）。同じ会話・同じ主題の記憶について、
// 有効な行の中で一番新しいターンの行だけを superseded_by = null にし、
// 古いターンの行を全部その代表 id へ向ける。「届いた順」ではなく source_turn → id の
// 順で決めるので、Queue のやり直しで古い発言が後から届いても古い値へ戻らん。
// 並べ直しは冪等（何度走っても同じ結果）。
// 同じターンの記憶どうしは置き換えん: 1 発言から複数の記憶を抜き出した時、
// それらは同時に言われた別の事実であって「新しい言い直し」ではない
// （例: 「姉は看護師。夜勤が多い」で「看護師」まで消える事故を staging で確認した）。
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

// 一番新しい行の source_turn。このターンの行は全部「最新世代」として有効のまま残す。
// 全行が NULL ターン（手動記憶だけの主題等）の時は NULL を返し、呼び出し側は従来どおり
// 「id が一番後ろの 1 行だけ残す」へ倒れる。
const newestActiveTurn = (newest: SQL): SQL => sql`(
  select m2.source_turn from v2_memory m2 where m2.id = ${newest}
)`;

// 主題ごとの並べ直し文を返す。D1 batch の途中へ差し込んで使う（同じ batch なら
// 記憶の保存・消去と一緒に失敗するので「保存されて置き換えだけ抜ける」状態にならん）。
// 1 主題あたり 2 文（NFR-1）: 「古いターンの行を全部代表 id へ向ける」→
// 「最新ターンの行を全部空にする」。一番新しい行が見つからん時は副問い合わせが
// NULL になり両方とも 0 件で終わる。
export const recomputeSupersessionStatements = (
  db: V2Db,
  conversationId: string,
  subjects: string[],
): BatchItem<"sqlite">[] => {
  const targets = [...new Set(subjects.filter((subject) => subject !== ""))];
  return targets.flatMap((subject) => {
    const newest = newestActiveId(conversationId, subject);
    const newestTurn = newestActiveTurn(newest);
    return [
      db
        .update(v2MemoryTable)
        .set({ supersededBy: newest })
        .where(
          // 置き換えるのは「代表より古いターン」の行だけ。ターン不明（NULL）の行は
          // 常に古い扱い（従来どおり置き換わる）。最新ターンが取れん時
          // （newestTurn IS NULL）は同ターンの行が無いので全行が対象＝従来の挙動。
          sql`${v2MemoryTable.conversationId} = ${conversationId}
            and ${v2MemoryTable.subject} = ${subject}
            and ${v2MemoryTable.pinned} = 0
            and ${v2MemoryTable.deletedAt} is null
            and ${v2MemoryTable.id} <> ${newest}
            and (${newestTurn} is null
              or ${v2MemoryTable.sourceTurn} is null
              or ${v2MemoryTable.sourceTurn} < ${newestTurn})
            and ${sourceOnActiveBranch}`,
        ),
      db
        .update(v2MemoryTable)
        .set({ supersededBy: null })
        .where(
          // 最新ターンの行を全部有効へ戻す。代表 1 行だけでなく、同じターンから
          // 抜き出された兄弟分も過去の向き先を消す。
          sql`${v2MemoryTable.conversationId} = ${conversationId}
            and ${v2MemoryTable.subject} = ${subject}
            and ${v2MemoryTable.pinned} = 0
            and ${v2MemoryTable.deletedAt} is null
            and (${v2MemoryTable.id} = ${newest}
              or (${newestTurn} is not null and ${v2MemoryTable.sourceTurn} = ${newestTurn}))
            and ${sourceOnActiveBranch}`,
        ),
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
