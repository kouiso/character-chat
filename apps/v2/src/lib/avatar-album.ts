// 顔に選べる画像の一覧: アルバムの画像のうち、この子との会話で届いた物だけ。
export type AvatarCandidate = { messageId: string; imageUrl: string };

export const listAvatarCandidates = async (characterId: string): Promise<AvatarCandidate[]> => {
  // 会話・フォームの単体テストが cloudflare:workers を引き込まんよう、呼ぶ時まで読まない。
  const { listAlbum } = await import("../server/album");
  const items = await listAlbum();
  return items
    .filter((item) => item.kind === "image" && item.characterId === characterId)
    .map((item) => ({ messageId: item.id, imageUrl: item.mediaUrl }));
};
