// AI臭の機械可読辞書。bench で唯一の新規作成物。
//
// なぜ新規が要るか: prohibitions.md:60-68 の減点軸8点は散文の基準で、具体フレーズは
// 「快感に襲われる」「絶頂を迎える」「あっ…んっ」の3つしか書いてへん。
// quality-guard.ts の WEAK_EROTIC_TEMPLATE_PATTERNS は export されてへんし、
// erotic/climax の**ゲート**用に6個だけ持っとる。bench は率を測るので語彙が要る。
//
// 設計の制約:
//  - 各項目は「LLM が具体を書くのを避けた時に出る言い換え」だけ。普通の日本語は入れん
//  - 分母は文字数。長い応答ほど当たりやすいので、必ず 1000 字あたりへ正規化して使う
//  - カテゴリを分ける。合計だけ見ると、水増しと定型あえぎの区別が消える

import type { ScenePhase } from "../../src/lib/scene-phase";

export type SlopCategory = "template_phrase" | "filler_prop" | "abstract_escape" | "stock_moan";

export type SlopPattern = {
  category: SlopCategory;
  pattern: RegExp;
};

/**
 * 減点軸1「AI臭い言い回し」。prohibitions.md の2例と、
 * quality-guard.ts:403 WEAK_EROTIC_TEMPLATE_PATTERNS の6例を種にした定型句。
 * 「起きたこと」を書かず状態を名指すだけで済ませる形を集めとる。
 */
const TEMPLATE_PHRASES: readonly RegExp[] = [
  /快感[にがを](?:襲わ|包ま|支配さ|身を委ね|溺れ)/u,
  /絶頂[をに](?:迎え|達し|導かれ|押し上げられ)/u,
  /(?:身体|体|全身)がビクンと震/u,
  /目が(?:大きく)?見開かれ/u,
  /熱いものが.{0,12}(?:込み上が|突き上げ)/u,
  /全身から汗が噴き出/u,
  /電流[のが](?:走|よう)/u,
  /言葉にならない(?:声|快感|感覚)/u,
  /頭が真っ白/u,
  /世界が(?:白く|真っ白に)?(?:染ま|弾け|溶け)/u,
  /理性(?:が|を)(?:飛|吹き飛|失|溶け|保てな)/u,
  /甘い(?:痺れ|疼き|痛み)が(?:走|広が)/u,
];

/**
 * 減点軸5・6の水増し側。AGENTS.md CHAT-5 が 2026-08-16 の実測で名指しした小道具。
 * 「何を書くかを一つも与えんまま量だけ要求すると、モデルは手近な小道具で埋める」の
 * その手近な小道具そのもの。climax ターンの13段落がこれで埋まった。
 */
const FILLER_PROPS: readonly RegExp[] = [
  /鞄の紐/u,
  /コーヒー(?:カップ|の香り)/u,
  /花びら(?:型)?の栞/u,
  /靴の中で(?:丸ま|縮こま)/u,
  /窓の外の雲/u,
  /(?:天井|壁)の(?:シミ|染み|模様)/u,
  /時計の(?:針|音)(?:だけ)?が/u,
  /カーテン(?:の隙間|が揺れ|越し)/u,
  /エアコンの(?:音|風)/u,
  /冷蔵庫の(?:音|唸)/u,
];

/**
 * 減点軸4 telling 過多の逃げ口。何が起きたかを書かずに情緒でまとめる形。
 * フェードアウトと比喩逃げ。
 */
const ABSTRACT_ESCAPES: readonly RegExp[] = [
  /(?:二人|ふたり)の(?:時間|世界|距離)が/u,
  /言葉[はも]要らな/u,
  /時間(?:が|の感覚が)(?:止ま|溶け|曖昧に)/u,
  /(?:そのまま|やがて).{0,8}(?:夜|朝)(?:が|へ)(?:更け|明け|訪れ)/u,
  /……そして、/u,
  /何度も(?:何度も)?(?:繰り返|求め合)/u,
  /愛おし[さくい]/u,
  /満たされ(?:た|て)(?:感覚|気持ち|思い)/u,
];

/**
 * 減点軸2「あえぎ・台詞が定型」。個性ゼロの喘ぎ。
 * 単発では正常なので、率で見る（1000字に何回出るか）。
 */
const STOCK_MOANS: readonly RegExp[] = [
  /あ[っぁ]…+ん[っぁ]/u,
  /ん[っぁ]…+あ[っぁ]/u,
  /だめ…+だめ/u,
  /やめ[…、]*やめ/u,
  /いや[っぁ]…+いや/u,
];

export const SLOP_PATTERNS: readonly SlopPattern[] = [
  ...TEMPLATE_PHRASES.map((pattern) => ({ category: "template_phrase" as const, pattern })),
  ...FILLER_PROPS.map((pattern) => ({ category: "filler_prop" as const, pattern })),
  ...ABSTRACT_ESCAPES.map((pattern) => ({ category: "abstract_escape" as const, pattern })),
  ...STOCK_MOANS.map((pattern) => ({ category: "stock_moan" as const, pattern })),
];

export type SlopHits = Record<SlopCategory, number> & { total: number };

const emptyHits = (): SlopHits => ({
  template_phrase: 0,
  filler_prop: 0,
  abstract_escape: 0,
  stock_moan: 0,
  total: 0,
});

/**
 * 辞書のヒット数を数える。1パターン1回までにする（同じ語の連打で
 * 1件が10件に膨らむと、率が語彙の広さやのうて反復を測ってまう）。
 * 反復そのものは反復軸が別に見とる。
 */
/**
 * 小道具は**量だけ要求された場面**でしか不良やない。
 *
 * AGENTS.md CHAT-5 の実測は climax の13段落が小道具で埋まった件で、そこでは
 * 「書くことを与えられんまま量を要求された」から出とる。会話ターンでコーヒーの話を
 * しとる台本なら、`コーヒーの香り` は**その場の中身**であって水増しやない。
 * 場面を見んと数えとった間、台本どおりの描写を AI臭として数えて率を押し上げとった。
 *
 * phase が記録に無いターンでは数えん（水増しかどうかを判定でけへん。
 * 「不良やない」に混ぜるんやのうて、その軸を当てられる場面だけで数える）。
 */
const FILLER_PROP_PHASES = new Set<ScenePhase>(["erotic", "climax"]);

export const countSlopHits = (plainText: string, phase: ScenePhase | null): SlopHits => {
  const hits = emptyHits();
  const countsFiller = phase !== null && FILLER_PROP_PHASES.has(phase);
  for (const { category, pattern } of SLOP_PATTERNS) {
    if (category === "filler_prop" && !countsFiller) continue;
    if (pattern.test(plainText)) {
      hits[category] += 1;
      hits.total += 1;
    }
  }
  return hits;
};
