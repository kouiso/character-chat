// 記憶ドリブン能動想起（RIT-198）。DO スケジューラの recall トリガが発火した時、
// 「話題にする記憶（キュー）」が有るかを D1 から判定する。キューが無い時は送らんので、
// 記憶の無いキャラは従来スケジューラと同じ挙動になる。
import { createDb, loadRecallCueMemories } from "@v2/db";

export const RECALL_INTERVAL_MS = 24 * 60 * 60 * 1000;
// 「昨日話したこと」は JST の前日に作られた記憶で判定する。
const DAY_MS = 24 * 60 * 60 * 1000;
const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;
const ANNIVERSARY_TOLERANCE_MS = 12 * 60 * 60 * 1000;
// 記念日として拾う節目（日数）。月イチ・半期・周年。
const ANNIVERSARY_DAYS = [30, 60, 90, 180, 365];
// 最終会話からこの日数を越えたら「久しぶり」の話題にする。
export const LONGTIME_DAYS = 3;
const MEMORY_SCAN_LIMIT = 500;

export type RecallCue =
  | { kind: "anniversary"; days: number; content: string }
  | { kind: "yesterday" | "longtime"; content: string };

const japanDay = (time: number): string =>
  new Date(time + JAPAN_OFFSET_MS).toISOString().slice(0, 10);

const anniversaryOf = (createdAt: number, now: number): number | null => {
  const elapsed = now - createdAt;
  for (const days of ANNIVERSARY_DAYS) {
    if (Math.abs(elapsed - days * DAY_MS) <= ANNIVERSARY_TOLERANCE_MS) return days;
  }
  return null;
};

// 記念日 > 昨日の話、の優先で時候キューを1件選ぶ。
const pickSeasonalCue = (
  memories: { content: string; createdAt: number }[],
  now: number,
): RecallCue | null => {
  let anniversary: RecallCue | null = null;
  const yesterday = japanDay(now - DAY_MS);
  let yesterdayCue: RecallCue | null = null;
  for (const memory of memories) {
    const days = anniversaryOf(memory.createdAt, now);
    if (days !== null && (!anniversary || days > anniversary.days)) {
      anniversary = { kind: "anniversary", days, content: memory.content };
    }
    if (japanDay(memory.createdAt) === yesterday) {
      yesterdayCue ??= { kind: "yesterday", content: memory.content };
    }
  }
  return anniversary ?? yesterdayCue;
};

// 記念日 > 昨日の話 > 久しぶり、の優先でキューを1件選ぶ。
// 区切り（RIT-89 FR-4）: 記憶は同じ利用者・同じキャラの全会話をまたいでよい（未決 1）が、
// 置き換わった記憶・眠った枝の記憶・summary は話題に使わん。v2_memory の読み出しは
// @v2/db の memory-scope を通る loadRecallCueMemories に集約してある（apps/v2 から
// drizzle を直接 import すると @v2/db と別インスタンスの型が衝突するため）。
export const findRecallCue = async (
  db: D1Database,
  input: { userId: string; characterId: string; now: number },
): Promise<RecallCue | null> => {
  const memories = await loadRecallCueMemories(
    createDb(db),
    { userId: input.userId, characterId: input.characterId },
    MEMORY_SCAN_LIMIT,
  );
  if (memories.length === 0) return null;

  const seasonal = pickSeasonalCue(memories, input.now);
  if (seasonal) return seasonal;

  // 最後に話した日時。記憶ではなく発話の読み手なので区切りの対象外 —
  // 生の D1 のまま（apps/v2 は drizzle を直接 import すると @v2/db と型が衝突する）。
  const latestMessage = await db
    .prepare(
      `SELECT MAX(m.created_at) AS last_at FROM v2_message m
       JOIN v2_conversation c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND c.character_id = ?`,
    )
    .bind(input.userId, input.characterId)
    .first<{ last_at: number | null }>();
  const lastAt = latestMessage?.last_at ?? 0;
  if (input.now - lastAt >= LONGTIME_DAYS * DAY_MS) {
    return { kind: "longtime", content: memories[0].content };
  }
  return null;
};

export const recallCueLead = (cue: RecallCue): string => {
  switch (cue.kind) {
    case "anniversary":
      return `今日は${cue.days}日前の記念日です。この思い出を覚えています:`;
    case "yesterday":
      return "昨日話してくれたことを覚えています:";
    case "longtime":
      return "しばらく会っていません。覚えている思い出:";
  }
};
