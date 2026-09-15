import { describe, expect, it } from "vitest";

import { EROTIC_CHAT_MODEL } from "../../../src/lib/model";
import {
  LATE_TURN_REQUEST_BUDGET_MS,
  LONG_EROTIC_REQUEST_BUDGET_MS,
  resolveChatRouting,
  resolvePhaseAwareResponseLength,
  TOO_SHORT_VERBOSE_RETRY_MODEL,
  type ResponseLength,
  type ScenePhase,
} from "../lib/route-context";

// [[route]].ts の /chat が渡す requestedModel はクライアント指定 or デフォルト(qwen)。
// この抽出ではどのモデルが来ても資格判定に影響しないことを検証したいので、
// 「よくある指定」の代表として qwen 固定で組み立てる（別モデル指定の discard は個別テストで確認）。
const DEFAULT_REQUESTED_MODEL = "qwen/qwen-2.5-72b-instruct";

const PHASES: ScenePhase[] = ["conversation", "intimate", "erotic", "climax", "afterglow"];

// isLongResponse は resolveChatRouting の外側（[[route]].ts では resolvePhaseAwareResponseLength）で
// 決まる入力値。実際の呼び出しと同じ経路で導出し、テーブルのケース記述を phase/responseLength という
// ドメイン語彙のまま書けるようにする（resolveChatRouting 自体の内部ロジックはここでは検証しない）。
const buildInput = (phase: ScenePhase, responseLength: ResponseLength, isLateTurn: boolean) => {
  const { isLongResponse } = resolvePhaseAwareResponseLength(phase, responseLength, 50);
  return {
    isLongResponse,
    isVeryLongResponse: responseLength === "very_long",
    phase,
    isLateTurn,
    requestedModel: DEFAULT_REQUESTED_MODEL,
  };
};

type ExpectedRouting = {
  model: string;
  requestBudgetMs: number | undefined;
  fallbackLimit: number | undefined;
};

type Row = {
  phase: ScenePhase;
  responseLength: ResponseLength;
  isLateTurn: boolean;
  expected: ExpectedRouting;
};

// 実測値（2026-08-16, NODE_OPTIONS=--experimental-sqlite pnpm exec vitest run で resolveChatRouting を
// 直接叩いて確認した戻り値）。手で推測した値ではない。
const ROWS: Row[] = [
  // conversation/intimate/afterglow は isLongEroticPrimaryPath（erotic/climax限定）に該当せんため、
  // short/medium/long では late-turn の有無に関わらずリクエストモデル(qwen)をそのまま通す。
  // budget/fallbackLimit も未設定のまま(undefined)＝ requestQualityCheckedChat 側の既定値に委ねる。
  ...(["conversation", "intimate", "afterglow"] as const).flatMap((phase) =>
    (["short", "medium", "long"] as const).flatMap((responseLength) =>
      [false, true].map((isLateTurn) => ({
        phase,
        responseLength,
        isLateTurn,
        expected: {
          model: DEFAULT_REQUESTED_MODEL,
          requestBudgetMs: undefined,
          fallbackLimit: undefined,
        },
      })),
    ),
  ),
  // very_long は phase を問わず deepseek(EROTIC_CHAT_MODEL) 固定・budget 100s・fallbackLimit 0。
  // Cloudflare isolate の CPU/メモリ負荷を抑えるため2本並走のfirst-token raceを避ける設計。
  ...(["conversation", "intimate", "erotic", "climax", "afterglow"] as const).flatMap((phase) =>
    [false, true].map((isLateTurn) => ({
      phase,
      responseLength: "very_long" as const,
      isLateTurn,
      expected: {
        model: EROTIC_CHAT_MODEL,
        requestBudgetMs: LONG_EROTIC_REQUEST_BUDGET_MS,
        fallbackLimit: 0,
      },
    })),
  ),
  // erotic/climax の short/medium/long（very_long 以外）は isLongEroticPrimaryPath 該当。
  // 2026-08-18: euryale をプライマリから外して very_long と同じ deepseek へ揃えた。実測で
  // euryale が実際に答えた 10 ターンは可視文字の中央値 339 字・遅延の尾が 55.7s と 86.5s、
  // 同じ帯の deepseek は中央値 1006 字やった（doc/dogfood/matrix02-model-length.md）。
  // late-turn 後は budget だけ 55s へ縮める。fallbackLimit は帯ごと 0 で揃う。
  ...(["erotic", "climax"] as const).flatMap((phase) =>
    (["short", "medium", "long"] as const).flatMap((responseLength) => [
      {
        phase,
        responseLength,
        isLateTurn: false,
        expected: {
          model: EROTIC_CHAT_MODEL,
          requestBudgetMs: LONG_EROTIC_REQUEST_BUDGET_MS,
          fallbackLimit: 0,
        },
      },
      {
        phase,
        responseLength,
        isLateTurn: true,
        expected: {
          model: EROTIC_CHAT_MODEL,
          requestBudgetMs: LATE_TURN_REQUEST_BUDGET_MS,
          fallbackLimit: 0,
        },
      },
    ]),
  ),
];

describe("resolveChatRouting", () => {
  it.each(ROWS)(
    "phase=$phase responseLength=$responseLength isLateTurn=$isLateTurn",
    ({ phase, responseLength, isLateTurn, expected }) => {
      const result = resolveChatRouting(buildInput(phase, responseLength, isLateTurn));
      expect(result).toEqual(expected);
    },
  );

  it("40 通り（phase 5種 × responseLength 4種 × late-turn 有無）を総当たりしている", () => {
    expect(ROWS.length).toBe(5 * 4 * 2);
  });

  // very_long の固定を、上のテーブルと独立した形でも明示的に固定する。
  it.each(PHASES)("very_long は phase=%s でも EROTIC_CHAT_MODEL(deepseek) 固定", (phase) => {
    const result = resolveChatRouting(buildInput(phase, "very_long", false));
    expect(result.model).toBe(EROTIC_CHAT_MODEL);
  });

  it.each(PHASES)("very_long は phase=%s でも fallbackLimit=0 固定", (phase) => {
    const result = resolveChatRouting(buildInput(phase, "very_long", false));
    expect(result.fallbackLimit).toBe(0);
  });

  // very_long では isVeryLongResponse 分岐が最優先で評価されるため、リクエストで指定された
  // model（ここでは euryale を明示指定）が捨てられ、deepseek に上書きされる。
  it("very_long ではリクエスト指定モデルが捨てられ deepseek に上書きされる", () => {
    const result = resolveChatRouting({
      isLongResponse: true,
      isVeryLongResponse: true,
      phase: "erotic",
      isLateTurn: false,
      requestedModel: TOO_SHORT_VERBOSE_RETRY_MODEL,
    });
    expect(result.model).toBe(EROTIC_CHAT_MODEL);
    expect(result.model).not.toBe(TOO_SHORT_VERBOSE_RETRY_MODEL);
  });
});

// 抜き所は段に関係なく deepseek で書かせる。ここが isLongResponse で絞られとったせいで、
// 出荷既定(medium)の erotic/climax だけ qwen のまま走っとった。
// 実測 2026-08-19: qwen が答えた phase47〜49 の抜き所は可視 534〜946 字・前ターンの逐語 6.6〜42%、
// deepseek が答えた phase43 は 1141 字・0.9%。
describe("抜き所のモデルは段で変わらん", () => {
  for (const phase of ["erotic", "climax"] as const) {
    for (const responseLength of ["short", "medium", "long", "very_long"] as const) {
      it(`${phase} × ${responseLength} は deepseek で書く`, () => {
        expect(resolveChatRouting(buildInput(phase, responseLength, false)).model).toBe(
          EROTIC_CHAT_MODEL,
        );
      });
    }
  }

  it("モデルを明示指定した時は横取りせん", () => {
    const routing = resolveChatRouting({
      ...buildInput("erotic", "medium", false),
      requestedModel: "sao10k/l3.3-euryale-70b",
      forceRequestedModel: true,
    });
    expect(routing.model).toBe("sao10k/l3.3-euryale-70b");
  });
});
