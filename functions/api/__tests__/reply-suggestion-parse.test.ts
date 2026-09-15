import { describe, expect, it, vi } from "vitest";

import {
  REPLY_SUGGESTION_MAX_CHARS,
  REPLY_SUGGESTION_MAX_TOKENS,
  REPLY_SUGGESTION_MODEL,
  composeReplySuggestion,
  normalizeStageDirection,
  parseReplySuggestions,
  requestReplySuggestions,
  resolveSpeakerLabel,
  toReplySuggestionTurn,
  type ReplySuggestionContext,
} from "../lib/reply-suggestion";

const validation = { playerLabel: "太一", characterLatest: "……じゃあ、電気だけ消して" };

const modelJson = (replies: Array<{ act: unknown; line: unknown }>): string =>
  JSON.stringify({ replies });

const threeGoodReplies = [
  { act: "髪をすくう", line: "鈴さん、こっち向いて。もう待てない" },
  { act: "少し身を引く", line: "その顔、もう一回見せてからにしよう" },
  { act: "額を寄せる", line: "怖い？ いやならここで止めるよ" },
];

describe("返信候補の応答パース", () => {
  it("ト書きと台詞を「（ト書き）台詞」へ組み立てる", () => {
    const parsed = parseReplySuggestions(modelJson(threeGoodReplies), validation);

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toBe("（髪をすくう）鈴さん、こっち向いて。もう待てない");
  });

  it("コードフェンスで囲まれても読む", () => {
    // 実測(deepseek): response_format を指定しても ```json で囲んで返す回がある。
    const fenced = `\`\`\`json\n${modelJson(threeGoodReplies)}\n\`\`\``;
    expect(parseReplySuggestions(fenced, validation)).toHaveLength(3);
  });

  it("JSON でない・replies が無い応答は空で返す", () => {
    expect(parseReplySuggestions("候補を3つ出します:", validation)).toEqual([]);
    expect(parseReplySuggestions(JSON.stringify({ suggestions: ["a"] }), validation)).toEqual([]);
  });

  it("ト書きの括弧・句点はこちらで正規化する", () => {
    expect(normalizeStageDirection("（髪をすくう）")).toBe("髪をすくう");
    expect(normalizeStageDirection("  髪を すくう。 ")).toBe("髪を すくう");
    expect(composeReplySuggestion("髪をすくう", "こっち向いて")).toBe("（髪をすくう）こっち向いて");
  });

  it("台詞が複数行で返っても一行へ潰す", () => {
    const parsed = parseReplySuggestions(
      modelJson([
        { act: "髪をすくう", line: "鈴さん、こっち向いて。\nもう待てないんだ" },
        ...threeGoodReplies.slice(1),
      ]),
      validation,
    );

    expect(parsed[0]).toBe("（髪をすくう）鈴さん、こっち向いて。 もう待てないんだ");
  });

  it("ト書きが無い・台詞が空の候補は落とす", () => {
    const parsed = parseReplySuggestions(
      modelJson([
        { act: "", line: "鈴さん、こっち向いて。もう待てない" },
        { act: "髪をすくう", line: "   " },
        ...threeGoodReplies,
      ]),
      validation,
    );

    expect(parsed).toHaveLength(3);
    expect(parsed).not.toContain("（）鈴さん、こっち向いて。もう待てない");
  });

  // 20〜60字は頼む側の指定。判定は少し広く取る——62字を落として3件揃わん方が実害が大きい。
  it("長すぎる候補だけ落とす", () => {
    const tooLong = "あ".repeat(REPLY_SUGGESTION_MAX_CHARS + 1);
    const parsed = parseReplySuggestions(
      modelJson([{ act: "見つめる", line: tooLong }, ...threeGoodReplies]),
      validation,
    );

    expect(parsed).toHaveLength(3);
    expect(parsed.some((suggestion) => suggestion.includes(tooLong))).toBe(false);
  });

  it("同じ台詞の言い換えは1件だけ残す", () => {
    const parsed = parseReplySuggestions(
      modelJson([
        { act: "髪をすくう", line: "鈴さん、こっち向いて。もう待てない" },
        { act: "頬に触れる", line: "鈴さん、こっち向いて。顔が見たい" },
        ...threeGoodReplies.slice(1),
      ]),
      validation,
    );

    expect(parsed).toHaveLength(3);
    expect(parsed.filter((s) => s.includes("鈴さん、こっち向いて"))).toHaveLength(1);
  });
});

// ここが崩れると機能そのものが逆になる（自分の返信のはずが、彼女の台詞の続きが出る）。
// モデルが assistant の続きを書いた時はほぼ必ず話者ラベルが付くので、そこで切る。
describe("候補は彼女の台詞やのうてプレイヤーの発言", () => {
  it("キャラ名のラベルが付いた候補は落とす", () => {
    const parsed = parseReplySuggestions(
      modelJson([
        { act: "耳まで赤くする", line: "霜月鈴: ……そんなに見ないで" },
        ...threeGoodReplies,
      ]),
      validation,
    );

    expect(parsed).toHaveLength(3);
    expect(parsed.some((suggestion) => suggestion.includes("そんなに見ないで"))).toBe(false);
  });

  it("assistant ラベルが付いた候補も落とす", () => {
    const parsed = parseReplySuggestions(
      modelJson([{ act: "頬を染める", line: "assistant: 電気、消したよ" }, ...threeGoodReplies]),
      validation,
    );

    expect(parsed.some((suggestion) => suggestion.includes("電気、消したよ"))).toBe(false);
  });

  it("プレイヤー側のラベルはラベルだけ剥がして採用する", () => {
    const parsed = parseReplySuggestions(
      modelJson([
        { act: "髪をすくう", line: "太一: 鈴さん、こっち向いて" },
        ...threeGoodReplies.slice(1),
      ]),
      validation,
    );

    expect(parsed[0]).toBe("（髪をすくう）鈴さん、こっち向いて");
  });

  it("呼び名が無いときの一般的な自称ラベルも剥がす", () => {
    expect(resolveSpeakerLabel("あなた: こっち向いて", "あなた")).toEqual({
      line: "こっち向いて",
      speaker: "player",
    });
    expect(resolveSpeakerLabel("user: こっち向いて", "あなた").speaker).toBe("player");
    expect(resolveSpeakerLabel("霜月鈴: そんなに見ないで", "あなた").speaker).toBe("other");
    expect(resolveSpeakerLabel("こっち向いて", "あなた").speaker).toBe("none");
  });

  it("ト書きの中のコロンは話者ラベルと読まん", () => {
    const parsed = parseReplySuggestions(
      modelJson([
        { act: "髪をすくう", line: "（小声で）鈴さん: って呼ぶの、まだ慣れんな" },
        ...threeGoodReplies.slice(1),
      ]),
      validation,
    );

    expect(parsed[0]).toContain("鈴さん: って呼ぶの");
  });

  // 彼女の直前の発言をそのまま返してくる形。ラベルは付かんが、これも彼女の声。
  it("彼女の直前の発言を写した候補は落とす", () => {
    const parsed = parseReplySuggestions(
      modelJson([{ act: "俯く", line: "じゃあ、電気だけ消して" }, ...threeGoodReplies]),
      validation,
    );

    expect(parsed.some((suggestion) => suggestion.includes("電気だけ消して"))).toBe(false);
  });
});

describe("返信候補のモデル呼び出し", () => {
  const context: ReplySuggestionContext = {
    characterName: "霜月鈴",
    characterSheet: "【人物】霜月鈴。年上の同僚。",
    persona: { name: "太一" },
    scenePhase: "erotic",
    turns: [
      { role: "user", content: "鈴さん、もう我慢できない" },
      {
        role: "assistant",
        content: "<response><dialogue>……じゃあ、電気だけ消して</dialogue></response>",
      },
    ],
  };

  const okResponse = (): Response =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: modelJson(threeGoodReplies) } }] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  it("モデル呼び出しは1回だけで、上限トークンも小さいまま", async () => {
    // 入力欄の横で待たせる UI なので、退避連鎖で複数モデルを回す形にはせん。
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse());

    const suggestions = await requestReplySuggestions({
      apiKey: "key",
      appOrigin: "https://example.test",
      context,
      fetchImpl,
    });

    expect(suggestions).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.model).toBe(REPLY_SUGGESTION_MODEL);
    expect(body.max_tokens).toBe(REPLY_SUGGESTION_MAX_TOKENS);
    expect(body.stream).toBe(false);
  });

  it("上流がエラーでも例外にせず空で返す", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("upstream down", { status: 503 }),
    );

    await expect(
      requestReplySuggestions({
        apiKey: "key",
        appOrigin: "https://example.test",
        context,
        fetchImpl,
      }),
    ).resolves.toEqual([]);
  });

  it("彼女の直前の発言はモデル応答の検証側へも渡っとる", async () => {
    // 検証コンテキストを組み直す経路なので、ここが抜けると写し返しの検出が死ぬ。
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: modelJson([
                    { act: "俯く", line: "じゃあ、電気だけ消して" },
                    ...threeGoodReplies,
                  ]),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const suggestions = await requestReplySuggestions({
      apiKey: "key",
      appOrigin: "https://example.test",
      context,
      fetchImpl,
    });

    expect(suggestions.some((suggestion) => suggestion.includes("電気だけ消して"))).toBe(false);
  });
});

describe("履歴行の取り込み", () => {
  it("user/assistant 以外の行は落とす", () => {
    expect(toReplySuggestionTurn({ role: "system", content: "指示" })).toBeNull();
    expect(toReplySuggestionTurn({ role: "user", content: "やあ" })).toEqual({
      role: "user",
      content: "やあ",
    });
  });
});
