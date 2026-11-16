// 顔の絵はすべて GET /api/characters/<id>/avatar 経由で配る。avatar 列の形
// （ファイル名・/avatars/ パス・旧アプリの R2 鍵）によらず、配ってよいかと実体の
// 探索はサーバ側の 1 か所（avatar.ts）で決める。
export const avatarUrl = (id: string, avatar: string | null | undefined): string | null =>
  avatar ? `/api/characters/${encodeURIComponent(id)}/avatar` : null;
