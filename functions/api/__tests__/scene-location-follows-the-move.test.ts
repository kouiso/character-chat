// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolveSceneLocation } from "../lib/route-context";

// 実測 phase41（Sakura t6〜t10）: 相手が「ここ出ようか。うち、すぐ近くだから」と言うた後も
// 4 ターン、シート由来の「カフェ」が場所として配られ続けた。結果、公共の店内のまま
// 性行為が書かれ、t8 では本人が「あの……ここ、カフェですよ……？」と言うとる。
//
// 同じ台本の Downer は t6 が「……ベッド、そっちだよね」で、こちらは語がパターンに在るので
// 拾えて場所が動いた。差はキャラやのうて、相手が場所の名前を口に出したかどうかやった。
//
// シートの場所は初期位置。移動を口にした後は無効になる。錨が無いより、
// 誤った場所を断言する方が悪い。

const user = (content: string) => ({ role: "user" as const, content });
const sheet = {
  role: "system" as const,
  content: "桜庭さくら。大学生。桜並木のカフェで声をかけられた。",
};

describe("場所の錨は移動に追従する", () => {
  it("相手が場所を言えば、それを使う", () => {
    expect(resolveSceneLocation([sheet, user("ベッド、そっちだよね。連れてって。")])).toBe(
      "ベッド",
    );
  });

  it("相手が場所を一度も言わんなら、シートの初期位置を使う", () => {
    expect(resolveSceneLocation([sheet, user("普段って、どんな本読むの")])).toBe("カフェ");
  });

  // ここが phase41 の欠陥そのもの。
  it("場所の名前を言わずに移動しても、初期位置へ戻さん", () => {
    expect(
      resolveSceneLocation([sheet, user("普段って、どんな本読むの"), user("……ここ出ようか。")]),
    ).not.toBe("カフェ");
  });

  it("「うち」も場所として拾う", () => {
    expect(resolveSceneLocation([sheet, user("……ここ出ようか。うち、すぐ近くだから。")])).toBe(
      "うち",
    );
  });
});
