// @vitest-environment node
import { describe, expect, it } from "vitest";

import { runQualityChecks } from "../../../src/lib/quality-guard";
import { buildServerQualityContext, extractForbiddenWords } from "../lib/route-context";

// checkNoForbiddenCharacterWords を足しただけでは届かん。context を組む側が
// シートから語を拾って渡さんと、本番では一度も発火せん（body-wall で踏んだ穴）。
// ここは実経路——system プロンプト → buildServerQualityContext → runQualityChecks——を通す。

const SHEET = [
  "name: さくら",
  "first_person: わたし",
  "address: あなた",
  "speech_endings: です、ます",
  "verbal_tics: あの……",
  "forbidden_words: あんた、お前、僕、俺、あたし、気持ちいい、快感",
].join("\n");

const messages = [
  { role: "system" as const, content: SHEET },
  { role: "user" as const, content: "つづきを聞かせて" },
];

describe("シートの forbidden_words が検査まで届く", () => {
  it("語を配列として取り出せる", () => {
    expect(extractForbiddenWords(SHEET)).toContain("快感");
    expect(extractForbiddenWords("name: さくら")).toEqual([]);
  });

  it("context へ載る", () => {
    expect(buildServerQualityContext(messages, "climax").forbiddenWords).toContain("気持ちいい");
  });

  it("地の文で踏んだら runQualityChecks が落とす", () => {
    const context = buildServerQualityContext(messages, "climax");
    const response =
      "<response><action>子宮の奥で火花が散るような快感が走る。</action><dialogue>「あ、あの……っ」</dialogue><inner>こわい</inner></response>";

    const result = runQualityChecks(response, context);

    expect((result.failures ?? []).map((failure) => failure.failedCheck)).toContain(
      "forbidden-character-word",
    );
  });

  it("シートに forbidden_words が無いキャラは今までどおり", () => {
    const context = buildServerQualityContext(
      [{ role: "system", content: "name: 誰か" }, messages[1]],
      "climax",
    );
    const response =
      "<response><action>快感が走る。</action><dialogue>「気持ちいい」</dialogue><inner>あ</inner></response>";

    expect(
      (runQualityChecks(response, context).failures ?? []).map((failure) => failure.failedCheck),
    ).not.toContain("forbidden-character-word");
  });
});

// 検出関数を足しただけでは本番に届かん。checks 列から 1 行消しても 3,500 本のテストが
// 全部緑のままやった（敵対レビュー 2026-08-19）。body-wall で踏んだのと同じ穴なので、
// repeated-block-lead も実経路で固定する。
describe("同じ書き出しの検出が checks 列へ繋がっとる", () => {
  it("runQualityChecks が repeated-block-lead を報告する", () => {
    const context = buildServerQualityContext(messages, "erotic");
    const response =
      "<response>" +
      ["背中を", "背中に", "背中へ", "背中の"]
        .map((lead, i) => `<action>${lead}なぞる${"あ".repeat(i + 1)}。</action>`)
        .join("")
        .replace(/背中[にのへ]/g, "背中を") +
      "<dialogue>「ん」</dialogue><inner>みじかい</inner></response>";

    const result = runQualityChecks(response, context);

    expect((result.failures ?? []).map((failure) => failure.failedCheck)).toContain(
      "repeated-block-lead",
    );
  });
});

// シートの forbidden_words は自由記述の欄で、語のリストである保証が無い。実在する値を
// 全キャラ（190 体）から引いて確かめた: 語のリストは 2 体だけで、残りは文体の説明や
// 「（なし、…）」という自由文やった。部分一致で当てるのは literal な語だけに絞る。
describe("extractForbiddenWords が自由記述を語として拾わん", () => {
  it("1 文字は取らん（別のチェックが見とるうえ、無関係な語の一部に当たる）", () => {
    const words = extractForbiddenWords("forbidden_words: あんた、お前、僕、俺、あたし、快感");
    expect(words).toContain("あんた");
    expect(words).toContain("快感");
    expect(words).not.toContain("僕");
    expect(words).not.toContain("俺");
  });

  // 文体の説明（「丁寧すぎる敬語」）は語と見分けが付かん。落とせんが literal に
  // 一致せんので実害が無い。落とすのは「誤検出を起こす形」だけに絞る。
  it("文体の説明は残るが、本文へ当たらんので害が無い", () => {
    const words = extractForbiddenWords(
      "forbidden_words: 清楚系少女のハイテンション台詞、丁寧すぎる敬語、恋愛少女めいた台詞",
    );
    const body =
      "<response><action>指先が鎖骨をなぞる。</action><dialogue>「あの…です」</dialogue><inner>こわい</inner></response>";
    expect(words.some((word) => body.includes(word))).toBe(false);
  });

  it("「（なし、…）」の自由文は取らん", () => {
    expect(
      extractForbiddenWords(
        "forbidden_words: （なし、キャラの世界観から外れる清楚敬語・少女台詞だけ自然に避ける）",
      ),
    ).toEqual([]);
  });

  it("実在するもう 1 体の語は全部残る", () => {
    expect(
      extractForbiddenWords("forbidden_words: きゃー、うれしい♡、大好き、頑張ります！"),
    ).toEqual(["きゃー", "うれしい♡", "大好き", "頑張ります！"]);
  });
});
