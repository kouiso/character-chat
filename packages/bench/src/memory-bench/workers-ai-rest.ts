// Workers AI の REST 呼び出しを Ai["run"] の形に包む。
// 本番のバインディングは Cloudflare 内でしか作れんので、ベンチの real モードは
// ここから REST 経由で同じモデル（@cf/baai/bge-m3）を呼ぶ。
export type RestAiOptions = {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
};

export const createRestAi = (opts: RestAiOptions): Pick<Ai, "run"> => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const run = async (model: string, inputs: Record<string, unknown>): Promise<unknown> => {
    const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${model}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(inputs),
    });
    const json = (await response.json()) as {
      success?: boolean;
      result?: unknown;
      errors?: { message?: string }[];
    };
    if (!response.ok || json.success === false) {
      throw new Error(
        `workers-ai ${response.status}: ${json.errors?.[0]?.message ?? "request failed"}`,
      );
    }
    return json.result;
  };
  return { run: run as Pick<Ai, "run">["run"] };
};
