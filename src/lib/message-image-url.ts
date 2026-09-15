// DB に残る imageUrl が一時的な blob: や非許可ホストのままの場合、
// 永続的な imageKey から /api/image/r2/... を優先して返す。
// functions/api/[[route]].ts と同じ判定を使い、フロント/バックで同一の解決をする。
const R2_KEY_PATTERN = /^images\/[\da-f-]{36}\.(?:jpg|jpeg|png)$/i;

export const resolveStoredMessageImageUrl = (
  imageUrl: string | null | undefined,
  imageKey: string | null | undefined,
): string | null => {
  if (imageKey && R2_KEY_PATTERN.test(imageKey)) {
    return `/api/image/r2/${imageKey}`;
  }
  return imageUrl ?? null;
};
