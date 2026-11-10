// avatar カラムは基本ファイル名（"char-akane.jpg"）だが、まれに "/avatars/x.png" の
// パス形が混ざる。どちらでも /avatars/ の静的配信へ解決する。
export const avatarUrl = (avatar: string | null | undefined): string | null => {
  if (!avatar) return null;
  const file = avatar.replace(/^\/+avatars\//, "").replace(/^\/+/, "");
  return file ? `/avatars/${encodeURIComponent(file)}` : null;
};
