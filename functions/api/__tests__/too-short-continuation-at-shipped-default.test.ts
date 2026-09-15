import { describe, expect, it } from "vitest";

import { buildQualityAttemptMessages } from "../lib/route-context";

const previousResponse = `<response><action>${"雨の匂いが部屋に残っとる。".repeat(30)}</action></response>`;

describe("出荷既定(medium)の too_short リトライ", () => {
  // 実測 2026-08-18 phase20〜25: erotic/climax の 13/13 がフロア 960 に対して中央値 600 で
  // 配信されとった。続き書きが very_long 限定で、medium は毎回ゼロから撮り直しやったのが原因。
  it("フロアを強制しとる段では続き書きへ入る", () => {
    const messages = buildQualityAttemptMessages(
      [{ role: "user", content: "続けて" }],
      1,
      previousResponse,
      "long-response-too-short",
      "too_short",
      { phase: "erotic", longResponseMinChars: 960 },
      false,
      1200,
    );

    expect(messages.at(-2)?.role).toBe("assistant");
    expect(messages.at(-1)?.content).toContain("最低960字");
  });

  it("続き書きの目標がその長さ設定の天井を超えん", () => {
    const messages = buildQualityAttemptMessages(
      [{ role: "user", content: "続けて" }],
      1,
      previousResponse,
      "long-response-too-short",
      "too_short",
      { phase: "erotic", longResponseMinChars: 960 },
      false,
      1200,
    );

    // minChars + 400 = 1360 は medium の天井 1200 を超える。超えた値を目標に出すと
    // 続きを書かせた結果が max-length-exceeded で落ちる。
    expect(messages.at(-1)?.content).toContain("最低1200字");
    expect(messages.at(-1)?.content).not.toContain("最低1360字");
  });

  // runQualityChecks は同じターンの失敗を全部 failures に集める(#1470)が、主カテゴリとして
  // 返すのは優先度が先頭の 1 件だけで、long-response-too-short は配列の後方に居る。
  // climax は射精描写のチェックが実際に生きる唯一の段なので「短い＋人称でも落ちる」が
  // 構造的に起きやすく、その時だけ主カテゴリが too_short から外れて続き書きが不発になり、
  // ゼロから撮り直して同じ帯で止まる。phase66 の climax は 438/900・524/900 で、同じアームの
  // erotic は 1098〜1158 やった。
  it("主カテゴリが長さ以外でも、同じターンに長さの失敗が在れば続き書きへ入る", () => {
    const messages = buildQualityAttemptMessages(
      [{ role: "user", content: "続けて" }],
      1,
      previousResponse,
      "user-perspective-ejaculation",
      "pov_wrong",
      { phase: "climax", longResponseMinChars: 900 },
      false,
      1200,
      [
        { failedCheck: "user-perspective-ejaculation", category: "pov_wrong" },
        { failedCheck: "long-response-too-short", category: "too_short" },
      ],
    );

    expect(messages.at(-2)?.role).toBe("assistant");
    expect(messages.at(-1)?.content).toContain("最低900字");
  });

  // 長さの失敗がどこにも無い時まで続き書きへ流すと、人称や破損を長さで直そうとして
  // 撮り直しの 1 枠を無駄にする。
  it("長さの失敗がゼロなら続き書きへ入らん", () => {
    const messages = buildQualityAttemptMessages(
      [{ role: "user", content: "続けて" }],
      1,
      previousResponse,
      "user-perspective-ejaculation",
      "pov_wrong",
      { phase: "climax", longResponseMinChars: 900 },
      false,
      1200,
      [{ failedCheck: "user-perspective-ejaculation", category: "pov_wrong" }],
    );

    expect(messages.at(-2)?.role).not.toBe("assistant");
  });

  it("フロアを強制しとらん段では従来どおりヒントだけを足す", () => {
    const messages = buildQualityAttemptMessages(
      [{ role: "user", content: "続けて" }],
      1,
      previousResponse,
      "long-response-too-short",
      "too_short",
      { phase: "conversation" },
      false,
    );

    expect(messages.at(-2)?.role).not.toBe("assistant");
  });
});
