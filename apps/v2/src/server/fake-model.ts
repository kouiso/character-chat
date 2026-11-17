// V2_FAKE_MODEL=1 の固定応答モデル（返事と要約の両方が使う）。
// このファイルは手元の Node（script/summary-check.ts・試験）からも import されるので、
// cloudflare:workers に届く import（platform.ts 等）を持ち込まん。
import { FakeListChatModel } from "@langchain/core/utils/testing";

import type { ModelCandidate } from "@v2/engine";

// V2_FAKE_MODEL=1 の固定 XML（キー無しのこのコンテナで SSE の配線だけ検証する用）。
const FAKE_RESPONSE =
  "<response><action>小さく笑って、こちらへ一歩近づく。</action><dialogue>ねえ、こっち向いて。</dialogue><inner>ちょっとドキドキしてる。</inner></response>";

// 試験で塊が複数要る時（届きかけの待ち・止めた時の切り詰め）だけ差し替える口。
// APP_ENV=test 以外では効かせない（値が漏れても本番の応答は変わらん）。
// 値が "[" で始まる時は JSON の文字列配列として読み、連続するターンへ順に返す
// （FakeListChatModel の responses にそのまま渡る）。壊れた JSON は 1 本文として扱う。
export const fakeResponsesFromEnv = (env: { V2_FAKE_RESPONSE?: string }): string[] => {
  const raw = env.V2_FAKE_RESPONSE?.trim();
  if (!raw) return [FAKE_RESPONSE];
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed as string[];
      }
    } catch {
      // 単一本文として扱う
    }
  }
  return [raw];
};

export const fakeModelCandidates = (env: { V2_FAKE_RESPONSE?: string }): ModelCandidate[] => [
  {
    name: "fake",
    model: new FakeListChatModel({ responses: fakeResponsesFromEnv(env), sleep: 5 }),
  },
];
