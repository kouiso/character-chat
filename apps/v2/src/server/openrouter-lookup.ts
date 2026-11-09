// OpenRouter の生成 API から実行先（provider）を引く。SSE chunk には provider が載らんので
// 生成 id で stats を引き直す（RIT-100: 返事を作ったモデルと実行先を毎回記録する）。

// https://openrouter.ai/api/v1/generation?id=gen-... → data.provider_name
type GenerationStats = { data?: { provider_name?: string; provider_display_name?: string } };

export type ProviderLookupEnv = {
  OPENROUTER_API_KEY?: string;
  V2_OPENROUTER_BASE_URL?: string;
};

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

// lookup 失敗は null を返すだけにして返事自体は潰さん（呼び出し側が "unknown" で記録する）。
export const createProviderLookup =
  (env: ProviderLookupEnv) =>
  async (upstreamId: string): Promise<string | null> => {
    if (!env.OPENROUTER_API_KEY || !upstreamId) return null;
    const base = env.V2_OPENROUTER_BASE_URL || DEFAULT_BASE_URL;
    const res = await fetch(`${base}/generation?id=${encodeURIComponent(upstreamId)}`, {
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
    });
    if (!res.ok) return null;
    const body: GenerationStats = await res.json();
    return body.data?.provider_name ?? body.data?.provider_display_name ?? null;
  };

// 応答 id（gen-…）から実行先を引く共通処理。id が無い・lookup が無い・失敗でもターンは潰さず
// provider = "unknown" か NULL で記録して後から監査できるようにする。
export const resolveProvider = async (
  id: unknown,
  lookup?: (upstreamId: string) => Promise<string | null>,
): Promise<{ provider: string | null; upstreamId: string | null }> => {
  const upstreamId = typeof id === "string" && id.startsWith("gen-") ? id : null;
  if (!upstreamId) return { provider: null, upstreamId: null };
  const provider = (await lookup?.(upstreamId).catch(() => null)) ?? "unknown";
  return { provider, upstreamId };
};

// /generation の索引は生成完了から ~10s 遅れる（2026-11-09 実測 404→200 が 13s）。
// 即時の解決に失敗した分を waitUntil 系の裏仕事から引き直すための再試行。
// 既定 6 回 x 3s = 先頭から ~15s まで粘り、最後まで引けんければ null（記録は unknown のまま残る）。
export const retryProviderLookup = async (
  lookup: (upstreamId: string) => Promise<string | null>,
  upstreamId: string,
  opts: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<string | null> => {
  const attempts = opts.attempts ?? 6;
  const delayMs = opts.delayMs ?? 3000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    const provider = await lookup(upstreamId).catch(() => null);
    if (provider) return provider;
    if (i + 1 < attempts) await sleep(delayMs);
  }
  return null;
};
