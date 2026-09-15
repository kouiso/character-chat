import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REPLY_SUGGESTION_COUNT,
  REPLY_SUGGESTION_SYSTEM_PROMPT,
  buildReplySuggestionPrompt,
  formatReplySuggestionHistory,
  latestCharacterUtterance,
  resolvePlayerLabel,
  type ReplySuggestionContext,
} from "../lib/reply-suggestion";

const ROOT = path.resolve(__dirname, "../../..");
const readSource = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");

const context: ReplySuggestionContext = {
  characterName: "霜月鈴",
  characterSheet: "【人物】霜月鈴。年上の同僚。二人きりだと甘えたがる。",
  persona: { name: "太一", gender: "男性", personality: "口が下手だが押しは強い" },
  scenePhase: "erotic",
  turns: [
    { role: "user", content: "鈴さん、もう我慢できない" },
    {
      role: "assistant",
      content:
        "<response><action>耳まで赤くして、シャツの裾を握る</action><dialogue>……じゃあ、電気だけ消して</dialogue></response>",
    },
  ],
  greeting: "お疲れさま。まだ残ってたの？",
};

const userOf = (input: ReplySuggestionContext): string =>
  buildReplySuggestionPrompt(input).find((message) => message.role === "user")?.content ?? "";

// この機能が一番間違えるのは「誰の声で書くか」。頼み方が『次の返信を作れ』だけやと、
// モデルは assistant の続き＝彼女の台詞を書く。話者をプロンプトの両側（指示と履歴ラベル）で
// 固定しとることを、ここで動かせん形にしておく。
describe("返信候補のプロンプトはプレイヤーの声を指定する", () => {
  it("作るのはプレイヤー側の発言だと言うとる", () => {
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("プレイヤーが次に送る発言の候補");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("プレイヤーの声で書き");
  });

  it("相手キャラの台詞を書くことを禁じとる", () => {
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("相手キャラの台詞・内心・地の文は書かん");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("相手の返事を先に書くのも");
  });

  it("台詞は相手へ向けた二人称だと指定しとる", () => {
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("相手へ向けた二人称");
  });

  // 履歴を user:/assistant: のまま渡すと、モデルはラベルの続きを埋める形で書く。
  // 実際の呼び名を話者ラベルに使うと、どちら側の声かが一行ごとに効く。
  it("履歴の話者ラベルが実際の呼び名で、user/assistant が残っとらん", () => {
    const history = formatReplySuggestionHistory(context.turns, "霜月鈴", "太一");

    expect(history).toContain("太一: 鈴さん、もう我慢できない");
    expect(history).toContain("霜月鈴: ");
    expect(history).not.toContain("assistant:");
    expect(history).not.toContain("user:");
  });

  it("最後の一手は誰から誰へ送るのかを名前で書いとる", () => {
    expect(userOf(context)).toContain(
      `次に 太一 が 霜月鈴 へ送る発言の候補を ${REPLY_SUGGESTION_COUNT} 件作れ`,
    );
    expect(userOf(context)).toContain("霜月鈴 の側の発言は書くな");
  });

  it("キャラシートを「プレイヤーの設定ではない」と明示して渡す", () => {
    // シートだけ渡すと、モデルはシートの人物として書く。誰の設定かを一行で切る。
    expect(userOf(context)).toContain("プレイヤーの設定ではない");
    expect(userOf(context)).toContain("年上の同僚");
  });

  it("呼び名が無ければ二人称のプレースホルダへ落ちる", () => {
    expect(resolvePlayerLabel(null)).toBe("あなた");
    expect(resolvePlayerLabel({ name: "  " })).toBe("あなた");
    expect(resolvePlayerLabel({ name: "太一" })).toBe("太一");
  });
});

describe("返信候補のプロンプトが渡す場面", () => {
  it("assistant の保存本文の XML タグを平文へ潰す", () => {
    // タグごと渡すと候補にも <dialogue> が混ざる。履歴も直前発言も平文で渡す。
    const history = formatReplySuggestionHistory(context.turns, "霜月鈴", "太一");
    expect(history).not.toContain("<dialogue>");
    expect(history).toContain("……じゃあ、電気だけ消して");
    expect(latestCharacterUtterance(context)).toContain("電気だけ消して");
  });

  it("キャラの発言がまだ無ければ第一声を直前の発言として渡す", () => {
    const opening: ReplySuggestionContext = { ...context, turns: [] };
    expect(latestCharacterUtterance(opening)).toBe("お疲れさま。まだ残ってたの？");
    expect(userOf(opening)).toContain("まだやりとりは無い");
  });

  it("場面の段階を渡す", () => {
    expect(userOf(context)).toContain("場面の段階: erotic");
    expect(userOf({ ...context, scenePhase: null })).toContain("場面の段階: 未指定");
  });

  it("エロ場面では候補もそのまま具体的に書けと言うとる", () => {
    // ここが消えると、エロ段階でも候補だけが急に「そっと見つめる」に丸まる。
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("場面がエロなら候補もそのまま具体的に書く");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("直接的な語を避けて言い換えん");
  });

  // 3件が同じことの言い換えやと、選ぶ意味が無い。狙いの種類はこちらで決め打たず、
  // 場面から選ばせる（決め打つと、どの場面でも同じ3枠しか出てこん）。
  it("狙いを散らせと言い、種類は場面から選ばせる", () => {
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("狙いを散らす");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("場面を見て自分で選ぶ");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("など");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("同じ内容の言い換えを並べたら失敗");
  });

  it("ト書き＋一行台詞の形と字数を指定しとる", () => {
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("短い動作");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("一行の台詞");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("20〜60文字");
  });
});

// prompt/instructions/no-injected-ai-filter.md は恒久ルール。候補生成は新しい
// プロンプト組み立て経路なので、ここが枠を足す穴になっとらんことを固定する。
describe("返信候補がキャラ設定に無い枠を足さん", () => {
  const source = readSource("functions/api/lib/reply-suggestion.ts");

  it.each(["合意", "同意", "セーフワード", "境界", "配慮", "倫理"])(
    "%s の枠をプロンプトへ足さん",
    (word) => {
      expect(source).not.toContain(word);
    },
  );

  it("特定の台詞を禁止語として並べん", () => {
    for (const line of ["待って", "ダメ", "やめて", "止めて"]) {
      expect(source).not.toContain(line);
    }
  });

  it("拒否・回避を避ける指示は残す（枠を外す側なので落とさん）", () => {
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("ぼかした言い方・話題そらし");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("18歳未満を登場させん");
  });
});

describe("返信候補の経路が本番へ配線されとる", () => {
  const route = readSource("functions/api/[[route]].ts");

  it("エンドポイントが登録されとる", () => {
    expect(route).toContain('.post("/reply-suggestions"');
    expect(route).toContain('from "./lib/reply-suggestion"');
  });

  it("レート制限とコスト計上を同じ type 名で通す", () => {
    // 名前が食い違うと COST_ESTIMATES の既定 1 に落ちて、予約と返却の額もずれる。
    expect(route).toContain(
      'enforceRateLimit(c, drizzle(c.env.DB), userEmail, "reply-suggestions")',
    );
    expect(route).toContain('logUsage(database, userId, "reply-suggestions"');
    expect(readSource("functions/api/lib/route-context.ts")).toContain('"reply-suggestions": 1');
  });
});
