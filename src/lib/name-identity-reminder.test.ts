import { describe, expect, it } from "vitest";

import {
  buildNameIdentityReminder,
  buildNameIdentityReminderFromMessages,
  extractCharacterNameFromMessages,
  extractUserNameFromMessages,
  extractWrongNameFromUserText,
} from "./name-identity-reminder";

describe("extractWrongNameFromUserText", () => {
  it("detects a Japanese wrong name at the beginning", () => {
    expect(extractWrongNameFromUserText("つかさ、好きだよ", "Sakura")).toBe("つかさ");
  });

  it("detects an English wrong name at the end", () => {
    expect(extractWrongNameFromUserText("I love you, Tsukasa", "Sakura")).toBe("Tsukasa");
  });

  it("detects a Japanese wrong name at the end", () => {
    expect(extractWrongNameFromUserText("I love you, つかさ", "Sakura")).toBe("つかさ");
  });

  it("detects a wrong name after a greeting", () => {
    expect(extractWrongNameFromUserText("Hello みつき", "Sakura")).toBe("みつき");
  });

  it("returns null when the character name is used", () => {
    expect(extractWrongNameFromUserText("Sakura、好きだよ", "Sakura")).toBeNull();
  });

  it("returns null when a substring of the character name is used", () => {
    expect(extractWrongNameFromUserText("みつき、好きだよ", "月島みつき")).toBeNull();
  });

  it("returns null for common non-name words", () => {
    expect(extractWrongNameFromUserText("今日、好きだよ", "Sakura")).toBeNull();
  });

  it("returns null when an interjection precedes the sentence", () => {
    expect(extractWrongNameFromUserText("あー、なんて君は可愛いの", "Sakura")).toBeNull();
  });

  // 実測 2026-08-18 phase24 霜月鈴 t4: ユーザーが「……その距離、わざと？」と打っただけで
  // 地の文が「……わざと？私は霜月鈴だけど。」で始まった。CHAT_BASE_RULES の
  // [NAME IDENTITY — MANDATORY] が指定する訂正テンプレそのもので、名前は一度も出とらん。
  // パターンは「読点＋語＋？で終わる」やが、これは日本語の疑問文の大半の形。
  // 既存の真陽性（I love you, Tsukasa / つかさ、好きだよ）はどれも ？ で終わっとらん。
  it("末尾が疑問符の普通の質問を名前と読まん", () => {
    expect(extractWrongNameFromUserText("……その距離、わざと？", "霜月鈴")).toBeNull();
  });

  it("読点で区切った呼びかけの疑問は拾う", () => {
    expect(extractWrongNameFromUserText("ねえ、つかさ？", "霜月鈴")).toBe("つかさ");
  });

  it("returns null when 'kimi' is used as a pronoun in the middle", () => {
    expect(extractWrongNameFromUserText("君は可愛いね", "Sakura")).toBeNull();
  });
});

describe("buildNameIdentityReminder", () => {
  it("generates a reminder with the correct names", () => {
    const reminder = buildNameIdentityReminder("つかさ、好きだよ", "Sakura");
    expect(reminder).toContain("つかさ");
    expect(reminder).toContain("Sakura");
    expect(reminder).toContain("私はSakuraだけど");
  });

  it("returns null when no wrong name is detected", () => {
    expect(buildNameIdentityReminder("好きだよ", "Sakura")).toBeNull();
  });
});

describe("extractCharacterNameFromMessages", () => {
  it("extracts the character name from the system prompt", () => {
    const messages = [
      {
        role: "system" as const,
        content: "【キャラクター】\n名前: 月島みつき\n24歳のバーテンダー。",
      },
    ];
    expect(extractCharacterNameFromMessages(messages)).toBe("月島みつき");
  });

  it("returns undefined when no name is found", () => {
    expect(extractCharacterNameFromMessages([{ role: "user", content: "hello" }])).toBeUndefined();
  });
});

describe("extractUserNameFromMessages", () => {
  it("extracts the user name from the user info system message", () => {
    const messages = [
      {
        role: "system" as const,
        content: "【ユーザー情報】\nユーザー名: けんちゃん\n性格: 優しい",
      },
    ];
    expect(extractUserNameFromMessages(messages)).toBe("けんちゃん");
  });

  it("ignores unregistered user name markers", () => {
    const messages = [
      {
        role: "system" as const,
        content: "ユーザーの名前は登録されていない",
      },
    ];
    expect(extractUserNameFromMessages(messages)).toBeUndefined();
  });
});

describe("buildNameIdentityReminderFromMessages", () => {
  it("builds a reminder from the last user message and character name", () => {
    const messages = [
      {
        role: "system" as const,
        content: "【キャラクター】\n名前: 月島みつき\n24歳のバーテンダー。",
      },
      {
        role: "user" as const,
        content: "I love you, つかさ",
      },
    ];
    const reminder = buildNameIdentityReminderFromMessages(messages);
    expect(reminder).toContain("つかさ");
    expect(reminder).toContain("月島みつき");
  });

  it("returns null when the user uses the character name", () => {
    const messages = [
      {
        role: "system" as const,
        content: "【キャラクター】\n名前: 月島みつき\n24歳のバーテンダー。",
      },
      {
        role: "user" as const,
        content: "みつき、好きだよ",
      },
    ];
    expect(buildNameIdentityReminderFromMessages(messages)).toBeNull();
  });
});

describe("文頭の副詞・接続詞を誤った名前として拾わん", () => {
  // パターン 1 は「文頭の 2〜4 字＋読点」を無条件で名前候補にする。実測 2026-08-18 で
  // 台本 t7「そのまま、上から」が出荷既定で発火しとった。
  const adverbLeads = [
    "そのまま、上から",
    "やっぱり、こっち見て",
    "ちゃんと、見ててね",
    "さすがに、それは無理",
    "ふつうに、好きだよ",
    "ほんとに、好きだよ",
    "そろそろ、行こうか",
  ];

  for (const text of adverbLeads) {
    it(`「${text}」を名前として拾わん`, () => {
      expect(extractWrongNameFromUserText(text, "Sakura")).toBeNull();
    });
  }

  // パターン 3（読点＋末尾の語）は文頭の語を塞いでも後半を拾う。「もちろん、いいよ」は
  // 「いいよ」を名前として返す。deny-list では両端とも塞げんので、根治はキャラ名簿との
  // 照合（roster corroboration）が要る。ここは未解決として記録だけしとく。
  it("パターン 3 は未解決 — 文頭を塞いでも後半を拾う", () => {
    expect(extractWrongNameFromUserText("もちろん、いいよ", "Sakura")).toBe("いいよ");
  });

  it("本物の呼びかけは残す", () => {
    expect(extractWrongNameFromUserText("つかさ、好きだよ", "Sakura")).toBe("つかさ");
  });
});
