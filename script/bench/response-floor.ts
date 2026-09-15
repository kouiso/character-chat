// 「短すぎる」の床を、**本番と同じ式**で出す。
//
// 最初は phase だけの手製テーブル（conversation 120 / erotic 300 …）を使っとった。
// 本番 (functions/api/lib/route-context.ts:4418 resolveResponseFloor) は
// phase × 宣言された responseLength × 直前の user ターン長で決めとるので、
// very_long の erotic では床が 1312〜1500 になる。**手製の 300 は本番の 1/5** で、
// very_long 条件の「不足 0.0%」は物差しが緩かっただけやった。
//
// route-context を import せんのは、あれが D1 ハンドルと Hono を連れてくるから。
// 代わりに式を写して、response-floor.test.ts が本物と突き合わせる（ズレたら落ちる）。

import { RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH } from "../../src/lib/quality-guard";

import type { ScenePhase } from "../../src/lib/scene-phase";

export type ResponseLength = keyof typeof RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH;

/** route-context.ts:4394 */
const PHASE_FLOOR_BASE: Record<ScenePhase, number> = {
  conversation: 260,
  intimate: 450,
  afterglow: 520,
  erotic: 820,
  climax: 900,
};

/** route-context.ts:4403 */
const RESPONSE_LENGTH_BIAS: Record<ResponseLength, number> = {
  short: 0.7,
  medium: 1.0,
  long: 1.3,
  very_long: 1.6,
};

const RESPONSE_FLOOR_HARD_MIN = 180;
const RESPONSE_FLOOR_HARD_MAX = 1_500;
const FLOOR_CEILING_HEADROOM = 0.8;

/** route-context.ts:4412。相手のターンが長いほど床が上がる */
export const energyMultiplier = (lastUserTurnChars: number): number => {
  if (lastUserTurnChars <= 20) return 1.0;
  if (lastUserTurnChars <= 80) return 1.4;
  return 1.8;
};

export const resolveBenchResponseFloor = ({
  phase,
  responseLength,
  lastUserTurnChars,
}: {
  phase: ScenePhase;
  responseLength: ResponseLength;
  lastUserTurnChars: number;
}): number => {
  const maxChars = RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH[responseLength];
  const raw =
    PHASE_FLOOR_BASE[phase] *
    energyMultiplier(lastUserTurnChars) *
    RESPONSE_LENGTH_BIAS[responseLength];
  return Math.min(
    RESPONSE_FLOOR_HARD_MAX,
    Math.round(maxChars * FLOOR_CEILING_HEADROOM),
    Math.max(RESPONSE_FLOOR_HARD_MIN, Math.round(raw)),
  );
};

/**
 * 記録に無いものは既定側へ倒す。
 * - responseLength が記録されてへん run は "medium"（ハーネスの既定。
 *   vlong-session-dogfood.ts:125 の DEFAULT_RESPONSE_LENGTH）
 * - 直前の user ターン長は、bench:generate が書いた run なら記録がある（`# userChars`）。
 *   無い時だけ 0 = 係数 1.0 に倒す。**その分、記録済みコーパスは本番より甘く測っとる**
 */
export const benchFloorFor = (
  phase: ScenePhase,
  responseLength: string | null,
  lastUserTurnChars: number | null = null,
  lengthDirective = true,
): number | null =>
  // **長さの指示を送っとらん run に床は無い。**bench:generate は分量の指示を出さんのに、
  // summary へ書いた文字列が既定の medium へ倒れて、10ターン全部が「不足」になっとった。
  // 送ってへん契約と照らして不良を数えるのは、測定やのうて言いがかり
  // **知らん設定名は判定せん。**`verylong` のような打ち間違いを medium の床で測ると、
  // 群のラベルは別の条件のまま、不足率だけ medium の契約で出る。
  // 記録が**無い**（null）のと、記録が**読めん**のは別物
  // `in` は継承したプロパティ（`constructor` `toString`）も true にする。
  // 壊れた summary のその値が床の式へ入ると NaN になって、判定できてへんのに
  // 「不足やない」として分母に残る。**自分のキーだけ**を見る
  !lengthDirective ||
  (responseLength !== null && !Object.hasOwn(RESPONSE_LENGTH_BIAS, responseLength))
    ? null
    : resolveBenchResponseFloor({
        phase,
        responseLength: (responseLength ?? "medium") as ResponseLength,
        // 記録があるならそれを使う。無い（記録済みコーパス）時だけ 0＝係数1.0 の緩い側へ倒す
        lastUserTurnChars: lastUserTurnChars ?? 0,
      });
