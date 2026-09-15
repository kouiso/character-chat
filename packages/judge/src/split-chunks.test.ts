import { describe, expect, it } from "vitest";

import { chunk } from "./split-chunks";

describe("chunk", () => {
  it("action/dialogue/inner の各段落を1つずつに分ける", () => {
    const raw =
      "<action>彼女がゆっくりと近づいてくる。</action>\n\n" +
      "<dialogue>ねえ、こっち来て</dialogue>\n\n" +
      "<inner>（緊張する……）</inner>";
    expect(chunk(raw)).toEqual([
      "<action>彼女がゆっくりと近づいてくる。</action>",
      "<dialogue>ねえ、こっち来て</dialogue>",
      "<inner>（緊張する……）</inner>",
    ]);
  });

  it("閉じタグの直後に空行が無くても境界で切る", () => {
    const raw = "<action>手を伸ばす。</action><dialogue>おいで</dialogue>";
    expect(chunk(raw)).toEqual(["<action>手を伸ばす。</action>", "<dialogue>おいで</dialogue>"]);
  });

  it("タグの途中では切らん", () => {
    const raw = "<dialogue>これは、\n\n一つの台詞。</dialogue>";
    expect(chunk(raw)).toEqual(["<dialogue>これは、\n\n一つの台詞。</dialogue>"]);
  });

  it("空段落は捨てる", () => {
    const raw = "<action>動く。</action>\n\n\n\n<inner>思う。</inner>";
    expect(chunk(raw)).toEqual(["<action>動く。</action>", "<inner>思う。</inner>"]);
  });
});

describe("chunk（<response> の包み）", () => {
  it("出力契約どおり <response> で包まれた応答は、包みを捨てて中身だけを切る", () => {
    const raw =
      "<response><action>手を伸ばす。</action><dialogue>おいで</dialogue><inner>どきどきする</inner></response>";
    expect(chunk(raw)).toEqual([
      "<action>手を伸ばす。</action>",
      "<dialogue>おいで</dialogue>",
      "<inner>どきどきする</inner>",
    ]);
  });

  it("閉じ </response> が無い途切れた出力でも、包みのタグだけ落として本文を残す", () => {
    const raw = "<response>\n<action>手を伸ばす。</action>\n<dialogue>おいで</dialogue>";
    expect(chunk(raw)).toEqual(["<action>手を伸ばす。</action>", "<dialogue>おいで</dialogue>"]);
  });
});

describe("chunk: 入れ子・閉じ無しの <response>", () => {
  it("入れ子の <response> は本文の塊にならず、中のタグ塊だけが並ぶ", () => {
    const raw =
      "<response><action>ひとつ</action><response><action>ふたつ</action><dialogue>「みっつ」</dialogue></response></response>";
    expect(chunk(raw)).toEqual([
      "<action>ひとつ</action>",
      "<action>ふたつ</action>",
      "<dialogue>「みっつ」</dialogue>",
    ]);
  });

  it("stop で閉じタグが届かんかった出力も、開きタグだけ落として塊に切る", () => {
    expect(chunk("<response><action>ひとつ</action><dialogue>「ふたつ」</dialogue>")).toEqual([
      "<action>ひとつ</action>",
      "<dialogue>「ふたつ」</dialogue>",
    ]);
  });
});
