// 永続化の失敗のうち、「サーバに届いていないと断定できない」ものを見分ける。
//
// 中断・タイムアウト・接続断はクライアント側の観測が途切れただけで、サーバは
// 応答を返す前に INSERT を終えている可能性がある。これを「保存されなかった」と
// 扱って未送達へ戻すと、再送で新しい id の行が増えて D1 が二重化する。
// 逆にロールバックへ進むと、実際には保存済みの行を消してしまう。
// どちらも避けるため、曖昧な失敗では D1 に触らない。
//
// HTTP のエラー応答（4xx / 5xx）は応答が返ってきている＝結果が確定しているので、
// 従来どおりロールバックしてよい。

const AMBIGUOUS_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);

const AMBIGUOUS_MESSAGE_PATTERNS = [
  /abort/i,
  /timed? ?out/i,
  /failed to fetch/i,
  /network ?error/i,
  /load failed/i,
  /connection (reset|closed)/i,
  /socket hang up/i,
];

export const isAmbiguousPersistError = (error: unknown): boolean => {
  if (error instanceof DOMException && AMBIGUOUS_ERROR_NAMES.has(error.name)) {
    return true;
  }
  if (error instanceof Error) {
    if (AMBIGUOUS_ERROR_NAMES.has(error.name)) return true;
    return AMBIGUOUS_MESSAGE_PATTERNS.some((pattern) => pattern.test(error.message));
  }
  return false;
};
