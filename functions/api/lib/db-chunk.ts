// D1/SQLite の prepared statement bound parameter 上限を避けるため、inArray を chunk 化するヘルパー。
// D1 では SQL 文あたり 100 を超える host parameter があると "too many SQL variables" になる。
// inArray 以外の eq/and 条件も parameter を消費するため、安全マージンを持たせる。
export const D1_HOST_PARAM_LIMIT = 100;

export const chunkIds = <T>(ids: readonly T[], size = D1_HOST_PARAM_LIMIT - 8): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
};

// select 系を chunk 化して結果を flatten して返す。
export const selectInChunks = async <R>(
  ids: readonly string[],
  query: (chunk: readonly string[]) => Promise<R[]>,
): Promise<R[]> => {
  if (ids.length === 0) return [];
  const chunks = chunkIds(ids);
  const results = await Promise.all(chunks.map(query));
  return results.flat();
};

// update 系を chunk 化して実行する。
export const updateInChunks = async (
  ids: readonly string[],
  execute: (chunk: readonly string[]) => Promise<unknown>,
): Promise<void> => {
  if (ids.length === 0) return;
  const chunks = chunkIds(ids);
  await Promise.all(chunks.map(execute));
};
