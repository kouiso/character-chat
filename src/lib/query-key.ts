export const queryKey = {
  conversationList: ["conversation-list"] as const,
  // 全会話分をまとめて消す時の前方一致キー。conversationMessageList と同じ接頭辞を
  // ここから配ることで、呼び出し側が文字列を直書きして取りこぼすのを防ぐ。
  conversationMessageListRoot: ["conversation-message-list"] as const,
  conversationMessageList: (conversationId: string) =>
    ["conversation-message-list", conversationId] as const,
  messageSearch: (query: string, limit: number) => ["message-search", query, limit] as const,
  memoryNotes: (characterId?: string | null) => ["memory-notes", characterId ?? "all"] as const,
  // 場面ブックマーク一覧キーの接頭辞。キャラ絞り込み・検索語は呼び出し側が後ろへ足す。
  sceneBookmarkListRoot: ["scene-bookmarks"] as const,
  // 分岐ツリー一覧キー。rename 後は接頭辞でまとめて無効化する。
  branchListRoot: ["branches"] as const,
  branchList: (conversationId: string | null) => ["branches", conversationId ?? null] as const,
  imageGallery: ["image-gallery"] as const,
  characterList: ["character-list"] as const,
  groupList: ["group-list"] as const,
  group: (groupId: string) => ["group", groupId] as const,
  groupMessages: (groupId: string) => ["group-messages", groupId] as const,
};
