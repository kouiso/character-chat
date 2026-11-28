// V2_FAKE_MODEL=1 の固定応答モデル（返事と要約の両方が使う）。
// このファイルは手元の Node（script/summary-check.ts・試験）からも import されるので、
// cloudflare:workers に届く import（platform.ts 等）を持ち込まん。
import { FakeListChatModel } from "@langchain/core/utils/testing";

import type { ModelCandidate } from "./graph";

// V2_FAKE_MODEL=1 の固定 XML（キー無しのこのコンテナで SSE の配線だけ検証する用）。
// モデルはターンごとに組み直す（engine.ts の startTurn）ので、1 本だけやと毎ターン同じ返事になり、
// 2 ターン目は前のターンとの反復として全部の塊が落ちる。ターン番号で 1 本を選ぶ。
// 判定は直前の HISTORY_TURNS_FOR_REPETITION ターン分と比べるので、本数はそれより多くする。
// 一人称・二人称の代名詞は入れん（キャラのシートの一人称と食い違うと voice で落ちる）。
export const FAKE_RESPONSES = [
  "<response><action>小さく笑って、こちらへ一歩近づく。</action><dialogue>ねえ、こっち向いて。</dialogue><inner>ちょっとドキドキしてる。</inner></response>",
  "<response><action>窓辺の椅子を引いて、隣に腰を下ろす。</action><dialogue>今日は風が気持ちいいね。</dialogue><inner>話の続きが楽しみ。</inner></response>",
  "<response><action>棚から古い地図を取り出して、机に広げる。</action><dialogue>この道を通れば近いよ。</dialogue><inner>うまく伝わったかな。</inner></response>",
  "<response><action>湯気の立つ紅茶を二つ、そっと差し出す。</action><dialogue>冷めないうちにどうぞ。</dialogue><inner>香りが部屋に広がっていく。</inner></response>",
  "<response><action>指先で髪を耳にかけ、首をかしげる。</action><dialogue>それって、どういう意味？</dialogue><inner>答えを聞くのが少し怖い。</inner></response>",
  "<response><action>立ち上がって伸びをし、壁の時計を見上げる。</action><dialogue>もうこんな時間なんだ。</dialogue><inner>まだ帰りたくない気分。</inner></response>",
  "<response><action>鞄から小さな包みを出して、手のひらに載せる。</action><dialogue>これ、よかったら受け取って。</dialogue><inner>喜んでくれるといいな。</inner></response>",
];

// 1 始まりのターン番号から既定の返事を選ぶ。番号が無い呼び手（要約係）と壊れた値は 1 ターン目の返事。
// 1 ターンに持たせるのは 1 本だけ。2 本持たせると書き足しが次のターンの返事を先に使い、
// 次のターンでその返事が反復として落ちる。
const defaultResponseForTurn = (turn: number | undefined): string => {
  const index = turn !== undefined && Number.isInteger(turn) && turn >= 1 ? turn - 1 : 0;
  return FAKE_RESPONSES[index % FAKE_RESPONSES.length];
};

// 試験で塊が複数要る時（届きかけの待ち・止めた時の切り詰め）だけ差し替える口。
// APP_ENV=test 以外では効かせない（値が漏れても本番の応答は変わらん）。
// 値が "[" で始まる時は JSON の文字列配列として読み、1 ターンの中で続く呼び出し
// （生成・書き足し・書き直し）へ順に返す（FakeListChatModel の responses にそのまま渡る）。
// モデルはターンごとに組み直すので、ターンを跨いでは先頭から返し直す。壊れた JSON は 1 本文として扱う。
export const fakeResponsesFromEnv = (
  env: { V2_FAKE_RESPONSE?: string },
  turn?: number,
): string[] => {
  const raw = env.V2_FAKE_RESPONSE?.trim();
  if (!raw) return [defaultResponseForTurn(turn)];
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

export const fakeModelCandidates = (
  env: { V2_FAKE_RESPONSE?: string },
  turn?: number,
): ModelCandidate[] => [
  {
    name: "fake",
    model: new FakeListChatModel({ responses: fakeResponsesFromEnv(env, turn), sleep: 5 }),
  },
];
