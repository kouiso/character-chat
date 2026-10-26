import {
  composeContextPrompt,
  DEFAULT_CONTEXT_BUDGET,
  resolveContextBudget,
  selectRecentMessages,
} from "../src/context-window";

import type { HistoryMessage } from "../src/types";

const user = (content: string): HistoryMessage => ({ role: "user", content });
const assistant = (content: string): HistoryMessage => ({ role: "assistant", content });
const charsOf = (text: string): number => [...text].length;

describe("selectRecentMessages", () => {
  test("空履歴・空の最新発言を扱える", () => {
    expect(selectRecentMessages([], 1)).toEqual({
      messages: [],
      recentChars: 0,
      omittedMessages: 0,
      truncatedLatest: false,
    });
    expect(selectRecentMessages([user("")], 1)).toMatchObject({
      messages: [user("")],
      recentChars: 0,
      truncatedLatest: false,
    });
  });

  test("境界ちょうどなら古い順と役割を保って全件を残す", () => {
    const history = [user("おはよう"), assistant("こんにちは"), user("またね")];
    expect(selectRecentMessages(history, 12)).toEqual({
      messages: history,
      recentChars: 12,
      omittedMessages: 0,
      truncatedLatest: false,
    });
  });

  test("予算を一字超えると最古の一通を丸ごと外す", () => {
    const history = [user("おはよう"), assistant("こんにちは"), user("またね")];
    expect(selectRecentMessages(history, 11)).toEqual({
      messages: history.slice(1),
      recentChars: 8,
      omittedMessages: 1,
      truncatedLatest: false,
    });
  });

  test("途中の長文を飛び越えて古い会話を入れない", () => {
    const history = [user("昔"), assistant("あ".repeat(100)), user("今日")];
    expect(selectRecentMessages(history, 5)).toMatchObject({
      messages: [user("今日")],
      omittedMessages: 2,
    });
  });

  test("最新一通だけが長すぎる場合は末尾を残して切詰めを明示する", () => {
    const latest = user(`${"合成の一般会話。".repeat(100_000)}結論は明日。`);
    const history = [user("昨日"), assistant("了解"), latest];
    const result = selectRecentMessages(history, 7);
    expect(result).toEqual({
      messages: [user("。結論は明日。")],
      recentChars: 7,
      omittedMessages: 2,
      truncatedLatest: true,
    });
    expect(history[2]).toBe(latest);
    expect(latest.content.startsWith("合成の一般会話。")).toBe(true);
  });

  test.each([
    ["A😀𠮷Z", 3, "😀𠮷Z"],
    ["😀", 1, "😀"],
    ["e\u0301", 2, "e\u0301"],
    ["A\n日本語", 4, "\n日本語"],
    ["👩‍💻", 3, "👩‍💻"],
  ])("Unicode の字数とサロゲート対を保つ: %s / %i", (text, budget, expected) => {
    const result = selectRecentMessages([user(text)], budget);
    expect(result.messages[0]?.content).toBe(expected);
    expect(result.recentChars).toBe(charsOf(expected));
    expect(result.messages[0]?.content).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  test("入力の配列・メッセージを変更せず返却値とも共有しない", () => {
    const message = Object.freeze(user("こんにちは"));
    const input = Object.freeze([message]);
    const result = selectRecentMessages(input, 5);
    result.messages[0].content = "変更";
    expect(message.content).toBe("こんにちは");
  });

  test("合成の役割混在履歴で予算・最新入力・連続窓の不変条件を満たす", () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `${index}: ${"一般会話😀".repeat(index % 7)}`,
    }));
    for (const budget of [1, 2, 5, 17, 31, 100, 400, 1000]) {
      const result = selectRecentMessages(messages, budget);
      const actual = result.messages.reduce((sum, message) => sum + charsOf(message.content), 0);
      expect(actual).toBe(result.recentChars);
      expect(actual).toBeLessThanOrEqual(budget);
      expect(result.messages.at(-1)?.role).toBe(messages.at(-1)?.role);
      expect(messages.at(-1)?.content.endsWith(result.messages.at(-1)?.content ?? "")).toBe(true);
      if (!result.truncatedLatest)
        expect(result.messages).toEqual(messages.slice(result.omittedMessages));
    }
  });
});

describe("context layer budgets", () => {
  test("複数層がそれぞれ上限内で、総字数はその合計以内になる", () => {
    const prompt = composeContextPrompt(
      { system: "設定😀", messages: [user("昨日"), user("今日の話")], instruction: "続きを書く😀" },
      { systemChars: 3, recentChars: 4, instructionChars: 4 },
    );
    expect(prompt.system).toBe("設定😀");
    expect(prompt.messages).toEqual([user("今日の話"), user("を書く😀")]);
    expect(prompt.contextUsage).toEqual({
      systemChars: 3,
      recentChars: 4,
      instructionChars: 4,
      totalChars: 11,
      omittedMessages: 1,
      truncatedLatest: false,
      truncatedInstruction: true,
    });
  });

  test("追加指示がなくても、空指示があっても正しい利用量になる", () => {
    const base = { system: "", messages: [user("")] };
    const budget = { systemChars: 0, recentChars: 1, instructionChars: 1 };
    expect(composeContextPrompt(base, budget).messages).toEqual([user("")]);
    const prompt = composeContextPrompt({ ...base, instruction: "" }, budget);
    expect(prompt.messages).toEqual([user(""), user("")]);
    expect(prompt.contextUsage).toMatchObject({ totalChars: 0, truncatedInstruction: false });
  });

  test("system の人格・契約を黙って切らず予算不足を拒否する", () => {
    expect(() =>
      composeContextPrompt({ system: "設定", messages: [] }, { systemChars: 1 }),
    ).toThrow("System context exceeds its budget");
  });

  test("既定値を変更せず、層ごとの上書きを使う", () => {
    expect(resolveContextBudget({ recentChars: 3 })).toEqual({
      ...DEFAULT_CONTEXT_BUDGET,
      recentChars: 3,
    });
    expect(DEFAULT_CONTEXT_BUDGET.recentChars).toBe(8000);
  });

  test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "不正な窓予算を拒否する: %s",
    (budget) => {
      expect(() => selectRecentMessages([], budget)).toThrow(RangeError);
      expect(() => resolveContextBudget({ recentChars: budget })).toThrow(RangeError);
      expect(() => resolveContextBudget({ instructionChars: budget })).toThrow(RangeError);
    },
  );

  test("system の不正値と総上限の桁あふれを拒否する", () => {
    expect(() => resolveContextBudget({ systemChars: -1 })).toThrow(RangeError);
    expect(() => resolveContextBudget({ systemChars: Number.MAX_SAFE_INTEGER })).toThrow(
      RangeError,
    );
  });
});
