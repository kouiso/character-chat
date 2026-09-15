import { describe, expect, it } from "vitest";

import { MAX_RESPONSE_PLAIN_CHARS } from "../../../src/lib/quality-guard";
import { RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH, checkMaxLength } from "../../../src/lib/quality-guard";
import { RESPONSE_LENGTH_PRESETS, truncateOverlongFallback } from "../[[route]]";
import {
  applyRetryExhaustionFallback,
  clampInnerToBudget,
  getVeryLongMaxTokensForPhase,
  resolveResponseFloor,
} from "../lib/route-context";

import type { ScenePhase } from "../../../src/lib/scene-phase";

// 下限と上限は別ファイルにあり、片方だけ動かすと合格域が消える。
// 2026-07-26 実測: very_long の下限1300 に対し上限が1200 で、erotic/climax の
// たっぷり指定は何を書いても不合格やった。毎ターン品質リトライを4回焼き切って
// 70〜83秒かかる原因のひとつ。組み合わせを総当たりで固定して再発を止める。
const PHASES: ScenePhase[] = ["conversation", "intimate", "erotic", "climax", "afterglow"];
const LENGTHS = ["short", "medium", "long", "very_long"] as const;

// フロアは相手のターンの長さでも動く。合格域は一番きつい組み合わせ（一番長い
// ユーザー発言）で見る。ここを既定の0字で測ると、実際に効く上限との関係を見逃す。
const HIGH_ENERGY_USER_TURN_CHARS = 400;
const directiveFloor = (phase: ScenePhase, length: (typeof LENGTHS)[number]): number =>
  resolveResponseFloor({
    phase,
    responseLength: length,
    lastUserTurnChars: HIGH_ENERGY_USER_TURN_CHARS,
  }).minChars;

describe("応答長の合格域", () => {
  it.each(PHASES.flatMap((phase) => LENGTHS.map((length) => [phase, length] as const)))(
    "%s × %s に合格できる長さが存在する",
    (phase, length) => {
      // 下限より上限が小さいと、どんな出力も通らん。上限は段ごとに違うので、
      // 全体の上限やのうてその段の上限と比べる。
      expect(directiveFloor(phase, length)).toBeLessThan(
        RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH[length],
      );
    },
  );

  it("たっぷり指定の下限が上限を超えん", () => {
    for (const phase of ["erotic", "climax"] as const) {
      const min = directiveFloor(phase, "very_long");
      expect(min).toBeGreaterThan(0);
      expect(min).toBeLessThan(RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH.very_long);
    }
  });

  // 局長報告「文章量を変えても変わらん」の直接の否定。erotic/climax では
  // short と medium が Math.max(phaseFloor=600, preset) で同じ 600 に潰れとった。
  it.each(PHASES)("%s ではどの段も相異なるフロアになる", (phase) => {
    for (const energy of [0, 40, 400]) {
      const floors = LENGTHS.map(
        (length) =>
          resolveResponseFloor({ phase, responseLength: length, lastUserTurnChars: energy })
            .minChars,
      );
      expect(new Set(floors).size, `${phase} energy=${energy}: ${floors.join("/")}`).toBe(
        LENGTHS.length,
      );
      expect([...floors].sort((a, b) => a - b)).toEqual(floors);
    }
  });

  // 3 指標が同じ順で並ばんと、UI の 4 段は名前だけの段になる。
  it.each(PHASES)("%s では上限と max_tokens も段の順に並ぶ", (phase) => {
    const resolved = LENGTHS.map((length) =>
      resolveResponseFloor({ phase, responseLength: length, lastUserTurnChars: 40 }),
    );
    for (let i = 1; i < resolved.length; i += 1) {
      expect(resolved[i].maxChars).toBeGreaterThan(resolved[i - 1].maxChars);
      expect(resolved[i].maxTokens).toBeGreaterThan(resolved[i - 1].maxTokens);
      expect(resolved[i].minChars).toBeLessThan(resolved[i].maxChars);
    }
  });

  // "Match the user's energy" は CHAT_BASE_RULES に文言だけあって実装が無かった。
  it("相手のターンが長いほどフロアが上がる", () => {
    const at = (chars: number) =>
      resolveResponseFloor({
        phase: "conversation",
        responseLength: "medium",
        lastUserTurnChars: chars,
      }).minChars;
    expect(at(5)).toBeLessThan(at(50));
    expect(at(50)).toBeLessThan(at(300));
  });
});

// 打ち切り経路が下限を割らんこと。比率の和を足すだけでは、1つの節に偏った応答が
// 割り込むのを捕まえられんかった（2026-07-26 敵対レビュー2巡目）。実際に関数へ
// 通して、出てきた文字数を数える。
const plainLength = (xml: string): number => xml.replace(/<[^>]+>/g, "").replace(/…/g, "").length;

describe("打ち切り後の長さ", () => {
  const highestFloor = Math.max(
    ...PHASES.flatMap((phase) => LENGTHS.map((length) => directiveFloor(phase, length))),
  );
  const cases: ReadonlyArray<readonly [string, string, string, string]> = [
    ["台詞に偏る", "あ".repeat(30), "い".repeat(2_250), "う".repeat(30)],
    ["地の文に偏る", "あ".repeat(2_400), "い".repeat(20), "う".repeat(20)],
    ["心の声に偏る", "あ".repeat(20), "い".repeat(20), "う".repeat(2_600)],
    ["三等分", "あ".repeat(1_000), "い".repeat(1_000), "う".repeat(1_000)],
  ];

  it.each(cases)("%s 応答を切り詰めても一番高い下限を割らん", (_name, action, dialogue, inner) => {
    const truncated = truncateOverlongFallback(
      `<response><action>${action}</action><dialogue>${dialogue}</dialogue><inner>${inner}</inner></response>`,
    );
    expect(plainLength(truncated)).toBeGreaterThan(highestFloor);
    expect(plainLength(truncated)).toBeLessThanOrEqual(MAX_RESPONSE_PLAIN_CHARS);
  });

  it("上限に収まっとる応答はそのまま返す", () => {
    const source = `<response><action>${"あ".repeat(100)}</action><dialogue>${"い".repeat(
      100,
    )}</dialogue><inner>${"う".repeat(100)}</inner></response>`;
    expect(truncateOverlongFallback(source)).toBe(source);
  });

  it("XMLが壊れとる応答も上限までで止める", () => {
    const truncated = truncateOverlongFallback("あ".repeat(5_000));
    expect(truncated.length).toBe(MAX_RESPONSE_PLAIN_CHARS);
  });

  // 合否側は節を選ばず素の文字数で測る。切り詰め側が action/dialogue/inner しか
  // 数えんかったため、scene に寄った応答が上限超過のまま素通りしとった。
  it("scene に寄った応答も上限まで切り詰める", () => {
    const short = RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH.short;
    const source = `<response><scene>${"さ".repeat(1_000)}</scene><action>${"あ".repeat(
      200,
    )}</action><dialogue>${"い".repeat(200)}</dialogue><inner>${"う".repeat(
      100,
    )}</inner></response>`;
    expect(plainLength(source)).toBeGreaterThan(short);

    const truncated = truncateOverlongFallback(source, short);

    expect(plainLength(truncated)).toBeLessThanOrEqual(short);
    // 数えた節を出力から落とすと、切り詰めやのうて本文の削除になる。
    expect(truncated).toContain("<scene>");
  });

  it("narration も数えたうえで残す", () => {
    const short = RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH.short;
    const source = `<response><action>${"あ".repeat(200)}</action><dialogue>${"い".repeat(
      200,
    )}</dialogue><inner>${"う".repeat(100)}</inner><narration>${"な".repeat(
      1_000,
    )}</narration></response>`;

    const truncated = truncateOverlongFallback(source, short);

    expect(plainLength(truncated)).toBeLessThanOrEqual(short);
    expect(truncated).toContain("<narration>");
  });

  it("短い指定の上限を渡すとその値まで切り詰める", () => {
    const short = RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH.short;
    const truncated = truncateOverlongFallback(
      `<response><action>${"あ".repeat(30)}</action><dialogue>${"い".repeat(
        2_250,
      )}</dialogue><inner>${"う".repeat(30)}</inner></response>`,
      short,
    );
    expect(plainLength(truncated)).toBeLessThanOrEqual(short);
  });
});

// 上限を2200へ上げた時、short / medium まで2200字を許してしもうた
// （2026-07-26 敵対レビュー2巡目）。頼んだ長さごとに上限を分ける。
describe("依頼した長さごとの上限", () => {
  it("4段の上限が狭義単調に並ぶ", () => {
    const ceilings = LENGTHS.map((length) => RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH[length]);
    expect(ceilings).toEqual([900, 1_200, 1_500, 2_200]);
  });

  // long の上限に MAX_RESPONSE_PLAIN_CHARS を置くと、checkMaxLength の既定値(:696)と
  // safeMaxResponseChars のフォールバックまで一緒に動く。段の値はリテラルで持つ。
  it("long の上限が全体の上限定数と別物になっとる", () => {
    expect(RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH.long).not.toBe(MAX_RESPONSE_PLAIN_CHARS);
    expect(MAX_RESPONSE_PLAIN_CHARS).toBe(2_200);
  });

  it.each(["short", "medium"] as const)("%s の上限が preset の下限を下回らん", (length) => {
    expect(RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH[length]).toBeGreaterThan(
      RESPONSE_LENGTH_PRESETS[length].minChars,
    );
  });

  // 定数を読み比べるだけでは、上限が実際に効いとるかは分からん。判定器へ通す。
  it("1500字の返事は short 指定で落ち、very_long 指定では通る", () => {
    const body = "静".repeat(1_500);
    expect(checkMaxLength(body, RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH.short)).toBe(false);
    expect(checkMaxLength(body, RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH.very_long)).toBe(true);
  });

  it("上限を渡さんかった場合は従来どおり全体の上限を使う", () => {
    expect(checkMaxLength("あ".repeat(MAX_RESPONSE_PLAIN_CHARS), undefined)).toBe(true);
    expect(checkMaxLength("あ".repeat(MAX_RESPONSE_PLAIN_CHARS + 1), undefined)).toBe(false);
  });
});

// #1423: very_long の max_tokens を Cloudflare wall-clock / safe cap 内で引き上げ、
// 1300 visible chars フロアを 1 発または短い continuation で安定して超える。
describe("very_long の token 天井", () => {
  it.each([
    ["conversation", 2304],
    ["afterglow", 2304],
    ["intimate", 2800],
    ["erotic", 2800],
    ["climax", 2800],
  ] as const)("%s の very_long は %d token", (phase, expected) => {
    expect(getVeryLongMaxTokensForPhase(phase)).toBe(expected);
  });
});

// <inner> は UI 非表示だがトークンを消費する。very_long で inner が長すぎると
// <action>/<dialogue> の余裕を奪って 503/途中切れを招くため、120字以内に抑える。
describe("clampInnerToBudget", () => {
  it("<inner> が 120字を超える場合、句読点で切って 120字以内に収める", () => {
    const action = "aaaa";
    const inner = "a".repeat(100) + "。" + "b".repeat(40);
    const source = `<response><action>${action}</action><dialogue>bbb</dialogue><inner>${inner}</inner></response>`;
    const clamped = clampInnerToBudget(source);
    const parsed = clamped.match(/<inner>([\S\s]*?)<\/inner>/);
    expect(parsed).toBeTruthy();
    expect(parsed?.[1].length).toBeLessThanOrEqual(120);
  });

  it("<inner> が 40字以下ならそのまま", () => {
    const source =
      "<response><action>短い</action><dialogue>bbb</dialogue><inner>三十字以内の心の声。</inner></response>";
    expect(clampInnerToBudget(source)).toBe(source);
  });

  // 実測: <inner> が 6 ブロック・計 318 字の応答が 120 字上限のまま配信された。
  // parseXmlResponse は全ブロックを連結して返すのに、置換が非グローバルで
  // 1 個目しか直っとらんかった。<inner> は可視文字数に入らんので、残った分は
  // フロアに寄与せずトークンだけ食う重りになる。
  it("<inner> が複数ブロックあっても全体で 120字以内に収める", () => {
    const source =
      "<response><action>a</action><dialogue>b</dialogue>" +
      Array.from({ length: 6 }, (_, i) => `<inner>${"あ".repeat(53)}${i}。</inner>`).join("") +
      "</response>";
    const clamped = clampInnerToBudget(source);
    const blocks = [...clamped.matchAll(/<inner\b[^>]*>([\S\s]*?)<\/inner>/gi)];
    expect(blocks.length, "<inner> は 1 ブロックに畳む").toBe(1);
    expect(blocks[0][1].length).toBeLessThanOrEqual(120);
  });

  it("<inner> が短くても複数あれば 1 ブロックに畳む", () => {
    const source =
      "<response><action>a</action><dialogue>b</dialogue>" +
      "<inner>ひとつめ。</inner><inner>ふたつめ。</inner></response>";
    const clamped = clampInnerToBudget(source);
    expect([...clamped.matchAll(/<inner\b/gi)].length).toBe(1);
  });

  it("<inner> に句読点が無ければ limit 直前で切る", () => {
    const inner = "a".repeat(150);
    const source = `<response><action>短い</action><dialogue>bbb</dialogue><inner>${inner}</inner></response>`;
    const clamped = clampInnerToBudget(source);
    const parsed = clamped.match(/<inner>([\S\s]*?)<\/inner>/);
    expect(parsed?.[1].length).toBeLessThanOrEqual(120);
  });
});

describe("閉じタグの無い <inner>", () => {
  // 実測 2026-08-17 phase7 さくら t2: 応答が「<inner>…（閉じん）<action>…」の形で来て、
  // parseXmlResponse は中身を取り出せるのに、上限を掛ける置換だけが </inner> を要求しとった。
  // 193 字の inner が上限 120 を素通りした。inner は可視文字数に入らんので、
  // 素通りするとフロアに寄与せんまま <action>/<dialogue> の余裕だけを食う。
  const innerLength = (text: string) =>
    (text.match(/<inner\b[^>]*>([\S\s]*?)(?:<\/inner\s*>|(?=<)|$)/i)?.[1] ?? "").trim().length;

  const longInner =
    "初めてのカフェデートで、こんな風に飲み物を選び合えるなんて。あなたの好みを知りたくて、胸がきゅんとなる。" +
    "同じカップを分け合えたらどんなに幸せだろう。でもそんなこと言ったら変に思われるかしら。もっと知りたい。" +
    "ずっと一緒にいたい。こんな気持ちになるのは初めてで、自分でもどうしていいか分からない。";

  it("閉じタグが無くても上限が掛かる", () => {
    const text = `<response><inner>${longInner}<action>髪飾りを直す。</action><dialogue>「ふふ」</dialogue></response>`;
    expect(innerLength(text)).toBeGreaterThan(120);
    expect(innerLength(clampInnerToBudget(text))).toBeLessThanOrEqual(120);
  });

  it("閉じタグを補って、後ろの節を巻き込まん", () => {
    const text = `<response><inner>${longInner}<action>髪飾りを直す。</action><dialogue>「ふふ」</dialogue></response>`;
    const clamped = clampInnerToBudget(text);
    expect(clamped).toContain("</inner>");
    expect(clamped).toContain("<action>髪飾りを直す。</action>");
    expect(clamped).toContain("<dialogue>「ふふ」</dialogue>");
  });

  it("閉じタグがある場合は今までどおり", () => {
    const text = `<response><action>髪飾りを直す。</action><dialogue>「ふふ」</dialogue><inner>${longInner}</inner></response>`;
    expect(innerLength(clampInnerToBudget(text))).toBeLessThanOrEqual(120);
  });
});

// <inner> の畳み込みは very_long でだけ走っとった（`maxChars === ...very_long` で判定）。
// 実測(2026-08-18 phase19, 出荷既定の medium): <inner> が 1 応答に 6 ブロック、
// 合計 332 字。inner はどの段でも可視文字数に入らんので、複数あると純粋な重りになる。
// 3 層表示(D9)は inner を独立の層として描くので、6 個並ぶと画面もうるさい。
describe("<inner> の畳み込みは長さの段に依らん", () => {
  const sixInner = `<response>${Array.from(
    { length: 6 },
    (_, i) => `<action>a${i}</action><dialogue>d${i}</dialogue><inner>${"内".repeat(60)}</inner>`,
  ).join("")}</response>`;

  it.each([900, 1_200, 1_500, 2_200])("上限 %s でも 1 ブロック 120 字以内に畳む", (maxChars) => {
    const repaired = applyRetryExhaustionFallback(sixInner, undefined, maxChars);
    const blocks = [...repaired.matchAll(/<inner\b[^>]*>([\S\s]*?)<\/inner>/gi)];
    expect(blocks).toHaveLength(1);
    expect(blocks[0][1].length).toBeLessThanOrEqual(120);
  });
});
