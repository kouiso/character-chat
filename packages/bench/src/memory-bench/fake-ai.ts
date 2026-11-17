// 決定論の偽埋め込み。文字の 2 文字組を 1024 次元へハッシュして長さ 1 に正規化する。
// 鍵もネットワークも要らんので CI で回せる。実際の検索順位は本物の埋め込みと違うが、
// 「検索→順位づけ→注入」という本番の経路そのものは同じコードで通る（RIT-99）。
export const FAKE_EMBEDDING_MODEL = "fake-bigram-1024";

const DIMENSIONS = 1024;

const hash32 = (text: string): number => {
  let h = 0x811c9dc5;
  for (const char of text) {
    h ^= char.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

export const fakeEmbedding = (text: string): number[] => {
  const values = Array.from({ length: DIMENSIONS }, () => 0);
  for (let i = 0; i + 1 < text.length; i += 1) {
    values[hash32(text.slice(i, i + 2)) % DIMENSIONS] += 1;
  }
  const norm = Math.hypot(...values) || 1;
  return values.map((value) => value / norm);
};

export const createFakeAi = (): Pick<Ai, "run"> => {
  const run = async (_model: string, inputs: { text?: string[] }): Promise<unknown> => ({
    data: (inputs?.text ?? []).map((text) => fakeEmbedding(text)),
  });
  return { run: run as Pick<Ai, "run">["run"] };
};
