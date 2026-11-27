// 顔に選べる画像の一覧: この子との会話で届いた静止画。
export type AvatarCandidate = { messageId: string; imageUrl: string };

export const listAvatarCandidates = async (characterId: string): Promise<AvatarCandidate[]> => {
  // 会話・フォームの単体テストが cloudflare:workers を引き込まんよう、呼ぶ時まで読まない。
  const { listAvatarCandidateItems } = await import("../server/album");
  const items = await listAvatarCandidateItems({ data: { characterId } });
  return items.map((item) => ({
    messageId: item.messageId,
    imageUrl: `/api/media/${encodeURIComponent(item.messageId)}`,
  }));
};
