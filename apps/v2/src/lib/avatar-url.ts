// 顔の絵はすべて GET /api/characters/<id>/avatar 経由で配る。avatar 列の形
// （ファイル名・/avatars/ パス・旧アプリの R2 鍵）によらず、配ってよいかと実体の
// 探索はサーバ側の 1 か所（avatar.ts）で決める。
// 配信は max-age つきでキャッシュされるので、差し替えた直後に古い顔が残らんよう、
// avatar 値から作った版を query に付ける（サーバは query を見ない）。
const versionOf = (avatar: string): string => {
  let hash = 5381;
  for (let index = 0; index < avatar.length; index += 1) {
    hash = ((hash * 33) ^ avatar.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
};

export const avatarUrl = (id: string, avatar: string | null | undefined): string | null =>
  avatar ? `/api/characters/${encodeURIComponent(id)}/avatar?v=${versionOf(avatar)}` : null;
