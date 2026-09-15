// home「つづきから」で同一キャラクターの会話が重複しないよう、
// キャラクターごとに最新 1 件だけを抽出する。
export interface RecentConversationLike {
  characterId: string;
  updatedAt: number;
}

export const recentConversations = <T extends RecentConversationLike>(
  conversations: T[],
  limit = 5,
): T[] => {
  const byCharacter = new Map<string, T>();
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const conversation of sorted) {
    if (!byCharacter.has(conversation.characterId)) {
      byCharacter.set(conversation.characterId, conversation);
    }
  }
  return Array.from(byCharacter.values()).slice(0, limit);
};
