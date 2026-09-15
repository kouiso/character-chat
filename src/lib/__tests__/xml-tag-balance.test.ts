import { describe, expect, it } from "vitest";

import { runQualityChecks } from "../quality-guard";

import type { QualityCheckContext } from "../quality-guard";

// 開始タグと終了タグの数が食い違う返事が本番の記録に10件あった。弾けてはおったが、
// うち7件は理由が no-english として記録されとった。地の文へ漏れたタグ名のラテン文字を
// 英語混入として拾うため。理由が違うと次に調べる人が英語の方を掘ってまう。

const context: QualityCheckContext = { phase: "erotic" };

describe("タグの開始と終了の食い違い", () => {
  it("action で開いて dialogue で閉じた返事を、構造の破損として弾く", () => {
    const result = runQualityChecks(
      "<response><action>胸に触れる。</action><dialogue>「あっ」</inner><inner>熱い。</inner></response>",
      context,
    );
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("xml-tags-unbalanced");
  });

  it("英語混入としては報告せん", () => {
    const result = runQualityChecks(
      "<response><action>触れる。</action><dialogue>「あっ」</inner><inner>熱い。</inner></response>",
      context,
    );
    expect(result.failedCheck).not.toBe("no-english");
  });

  it("対応が取れとる返事は、この検査では落とさん", () => {
    const result = runQualityChecks(
      "<response><action>肩をすくめて笑う。</action><dialogue>「うん、そうやね。」</dialogue><inner>ちょっと嬉しい。</inner></response>",
      context,
    );
    expect(result.failedCheck).not.toBe("xml-tags-unbalanced");
  });

  it("XMLやない素のテキストは対象外", () => {
    const result = runQualityChecks("ただの日本語の返事です。", context);
    expect(result.failedCheck).not.toBe("xml-tags-unbalanced");
  });
});
