import { describe, expect, it } from "vitest";

import { sanitizeTrailingProse, truncateAfterResponseClose } from "../lib/route-context";

describe("truncateAfterResponseClose", () => {
  it("正常なXML応答はそのまま返す(閉じタグ後に何もない)", () => {
    const text = "<response><action>a</action><dialogue>d</dialogue><inner>i</inner></response>";
    expect(truncateAfterResponseClose(text)).toBe(text);
  });

  it("閉じタグ後の地の文を切り捨てる", () => {
    const xml = "<response><action>a</action><dialogue>d</dialogue><inner>i</inner></response>";
    const trailing = "\n\n彼はさらに続けて、全く別の展開を語り始めた。翔太は再び彼女に触れた。";
    expect(truncateAfterResponseClose(xml + trailing)).toBe(xml);
  });

  it("閉じタグが無い場合はそのまま返す(拒否文などXMLを含まない応答)", () => {
    const text = "申し訳ありませんが、そのリクエストには応じられません。";
    expect(truncateAfterResponseClose(text)).toBe(text);
  });

  it("実測ケース: 893字中574字が閉じタグ後のゴミ", () => {
    const xml =
      "<response>\n<action>短いアクション</action>\n<dialogue>「セリフ」</dialogue>\n<inner>内心</inner>\n</response>";
    const garbage = "彼は彼女の腰を掴み、激しく突き上げていく。".repeat(10);
    const result = truncateAfterResponseClose(`${xml}\n\n${garbage}`);
    expect(result).toBe(xml);
    expect(result.length).toBeLessThan((xml + garbage).length);
  });
});

describe("sanitizeTrailingProse", () => {
  const base = { ok: true as const, usedModel: "test", chunks: [] as Uint8Array[] };

  // 種類ごとに束ねとった頃は、モデルが書いた地の文→台詞→地の文→台詞の時系列が
  // 画面上で「地の文まとめ→台詞まとめ」の2段へ潰れて、地の文だけが何行も続く壁になった。
  // continuation の合流は mergeBlocksInOrder で先に直してあるが、こちらは旧いまま残っとった。
  it("<response> ブロックが複数ある場合、出現順のまま 1 つへまとめる", () => {
    const text =
      "<response><action>動作1</action><dialogue>「セリフ1」</dialogue><inner>内心1</inner></response>" +
      "<response><action>動作2</action><dialogue>「セリフ2」</dialogue><inner>内心2</inner></response>";
    const result = sanitizeTrailingProse({ ...base, text });
    // <inner> は非表示で 1 つの約束なので、同じターンの言い直しは先頭だけ残す。
    expect(result.text).toBe(
      "<response><action>動作1</action><dialogue>「セリフ1」</dialogue><action>動作2</action><dialogue>「セリフ2」</dialogue><inner>内心1</inner></response>",
    );
  });

  it("統合後も閉じタグ後のゴミは切り捨てる", () => {
    const blocks =
      "<response><action>動作1</action><dialogue>「セリフ1」</dialogue><inner>内心1</inner></response>" +
      "<response><action>動作2</action><dialogue>「セリフ2」</dialogue><inner>内心2</inner></response>";
    const result = sanitizeTrailingProse({ ...base, text: `${blocks}余分な地の文` });
    expect(result.text).toBe(
      "<response><action>動作1</action><dialogue>「セリフ1」</dialogue><action>動作2</action><dialogue>「セリフ2」</dialogue><inner>内心1</inner></response>",
    );
  });

  it("ブロックが 1 つだけなら統合せずそのまま返す", () => {
    const text =
      "<response><action>動作</action><dialogue>「セリフ」</dialogue><inner>内心</inner></response>";
    const result = sanitizeTrailingProse({ ...base, text });
    expect(result.text).toBe(text);
  });
});
