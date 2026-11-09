// 記憶ドリブン能動想起（RIT-198）。DO スケジューラの recall トリガが発火した時、
// 「話題にする記憶（キュー）」が有るかを D1 から判定する。キューが無い時は送らんので、
// 記憶の無いキャラは従来スケジューラと同じ挙動になる。
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
  memories: { content: string; created_at: number }[],
  now: number,
): RecallCue | null => {
  let anniversary: RecallCue | null = null;
  const yesterday = japanDay(now - DAY_MS);
  let yesterdayCue: RecallCue | null = null;
  for (const memory of memories) {
    const days = anniversaryOf(memory.created_at, now);
    if (days !== null && (!anniversary || days > anniversary.days)) {
      anniversary = { kind: "anniversary", days, content: memory.content };
    }
    if (japanDay(memory.created_at) === yesterday) {
      yesterdayCue ??= { kind: "yesterday", content: memory.content };
    }
  }
  return anniversary ?? yesterdayCue;
};

// 記念日 > 昨日の話 > 久しぶり、の優先でキューを1件選ぶ。
export const findRecallCue = async (
  db: D1Database,
  input: { userId: string; characterId: string; now: number },
): Promise<RecallCue | null> => {
  const conversations = await db
    .prepare("SELECT id FROM v2_conversation WHERE user_id = ? AND character_id = ?")
    .bind(input.userId, input.characterId)
    .all<{ id: string }>();
  const conversationIds = (conversations.results ?? []).map((row) => row.id);
  if (conversationIds.length === 0) return null;
  const marks = conversationIds.map(() => "?").join(",");

  const memoryRows = await db
    .prepare(
      `SELECT content, created_at FROM v2_memory WHERE conversation_id IN (${marks}) ORDER BY created_at DESC LIMIT ${MEMORY_SCAN_LIMIT}`,
    )
    .bind(...conversationIds)
    .all<{ content: string; created_at: number }>();
  const memories = memoryRows.results ?? [];
  if (memories.length === 0) return null;

  const seasonal = pickSeasonalCue(memories, input.now);
  if (seasonal) return seasonal;

  const latestMessage = await db
    .prepare(
      `SELECT MAX(created_at) AS last_at FROM v2_message WHERE conversation_id IN (${marks})`,
    )
    .bind(...conversationIds)
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
