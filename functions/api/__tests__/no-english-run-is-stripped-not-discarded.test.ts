import { describe, expect, it } from "vitest";

import { countUiVisibleChars, runQualityChecks } from "../../../src/lib/quality-guard";
import { stripXmlTags } from "../../../src/lib/xml-response-parser";
import {
  passesEveryDemotingCheck,
  preferNextAttemptForFloor,
  repairEnglishOnlyDemotion,
} from "../lib/route-context";

// issue #1495 §6-1 の漏斗（doc/dogfood/vlong-2026-08-20.md §28）: 5 アームで抜き所 31 セルのうち
// 23 本が続き書きの合流まで到達し、その 23 本は 1 本残らずフロアを超えとった。
// なのに配信できたのは 19 本で、落ちた 4 本は合流後の降格チェック（no-english /
// wrong-first-person）で捨てられとる。
//
// no-english で捨てるのは損が大きすぎる。続き書きが混ぜたラテン文字連は数語で、
// 捨てられる本文は 900 字を超えとって、代わりに配られるのは 500 字前後の attempt 0 や。
// 数語のために 400 字を捨てとる。
//
// だから「免除する」やのうて「剥がしてから測る」。免除だけ足すと欠陥をそのまま配ることに
// なるが、剥がしてから測るなら配る本文にラテン文字は残らん。
// 剥がして中身が消えてまう本文は元のまま返して、今までどおり降格させる。

const EROTIC_CONTEXT = { phase: "erotic" as const, longResponseMinChars: 820 };

// 実際の合流本文と同じ形。ラテン文字連は 1 つだけで、他の降格チェックには当たらん。
const MERGED_WITH_LATIN_RUN = `<response>
<action>汗ばんだ内腿へ手のひらを滑らせると、しっとりした肌が指の腹に吸いつく。</action>
<dialogue>…そこ、だめ。声、出ちゃう。</dialogue>
<action>奥へ指を沈めると、粘つく音が耳の裏で跳ね、腰が跳ねて背中が反る。 Suddenly her breath caught.</action>
<dialogue>ん、っ…もっと、奥まで来て。</dialogue>
<inner>こんな顔、誰にも見せたことがない。</inner>
</response>`;

describe("no-english 単独の降格は、捨てるやのうて剥がす", () => {
  it("前提: この本文は no-english で落ちて、他の降格チェックには当たらん", () => {
    const failures = runQualityChecks(MERGED_WITH_LATIN_RUN, EROTIC_CONTEXT).failures ?? [];
    const names = failures.map((failure) => failure.failedCheck);
    expect(names).toContain("no-english");
    expect(passesEveryDemotingCheck(MERGED_WITH_LATIN_RUN, EROTIC_CONTEXT)).toBe(false);
  });

  it("ラテン文字連を剥がした本文は降格チェックを通る", () => {
    const repaired = repairEnglishOnlyDemotion(MERGED_WITH_LATIN_RUN, EROTIC_CONTEXT);

    expect(repaired).not.toBe(MERGED_WITH_LATIN_RUN);
    // タグ名自体はラテン文字なので、checkNoEnglish と同じく地の文で見る。
    expect(stripXmlTags(repaired)).not.toMatch(/[A-Za-z]{3,}/);
    expect(passesEveryDemotingCheck(repaired, EROTIC_CONTEXT)).toBe(true);
  });

  it("剥がしても日本語の中身は減らさん", () => {
    const repaired = repairEnglishOnlyDemotion(MERGED_WITH_LATIN_RUN, EROTIC_CONTEXT);

    expect(repaired).toContain("汗ばんだ内腿へ手のひらを滑らせると");
    expect(repaired).toContain("もっと、奥まで来て");
    expect(repaired).toContain("こんな顔、誰にも見せたことがない");
    // 剥がした分（英文 1 つ）以上に減っとらんこと。
    expect(countUiVisibleChars(repaired)).toBeGreaterThan(
      countUiVisibleChars(MERGED_WITH_LATIN_RUN) - 40,
    );
  });

  it("登録名がローマ字の時は、その名前は残す", () => {
    const withName = MERGED_WITH_LATIN_RUN.replace("…そこ、だめ。", "Kosuke…そこ、だめ。");
    const repaired = repairEnglishOnlyDemotion(withName, {
      ...EROTIC_CONTEXT,
      userName: "Kosuke",
    });

    expect(repaired).toContain("Kosuke");
    expect(repaired).not.toContain("Suddenly");
  });

  it("no-english 以外でも落ちとる本文は触らん（剥がして誤魔化さん）", () => {
    // 三人称の小説調は剥がしても直らん。こういう本文は今までどおり降格させる。
    const alsoThirdPerson = `<response>
<action>彼女は汗ばんだ内腿へ手を滑らせた。彼女は身を捩った。彼女は目を閉じた。 Suddenly her breath caught.</action>
<dialogue>…そこ、だめ。</dialogue>
<inner>こんな顔、誰にも見せたことがない。</inner>
</response>`;
    expect(repairEnglishOnlyDemotion(alsoThirdPerson, EROTIC_CONTEXT)).toBe(alsoThirdPerson);
  });

  it("剥がすと中身が消えるブロックがある本文は元のまま返す", () => {
    const englishOnlyBlock = `<response>
<action>汗ばんだ内腿へ手のひらを滑らせると、しっとりした肌が指の腹に吸いつく。</action>
<action>Suddenly her breath caught and she trembled.</action>
<dialogue>…そこ、だめ。声、出ちゃう。</dialogue>
<inner>こんな顔、誰にも見せたことがない。</inner>
</response>`;
    expect(repairEnglishOnlyDemotion(englishOnlyBlock, EROTIC_CONTEXT)).toBe(englishOnlyBlock);
  });

  it("剥がした後は、フロアを超えた合流本文が短い試行に勝つ", () => {
    // これが実害そのもの。剥がす前は nextReadable=false で 950 字が 500 字に負けとった。
    const args = {
      nextDistinct: 900,
      currentDistinct: 480,
      nextVisible: 950,
      currentVisible: 500,
      minChars: 820,
      currentReadable: true,
      isVeryLongResponse: false,
    };
    expect(
      preferNextAttemptForFloor({
        ...args,
        nextReadable: passesEveryDemotingCheck(MERGED_WITH_LATIN_RUN, EROTIC_CONTEXT),
      }),
    ).toBe(false);
    expect(
      preferNextAttemptForFloor({
        ...args,
        nextReadable: passesEveryDemotingCheck(
          repairEnglishOnlyDemotion(MERGED_WITH_LATIN_RUN, EROTIC_CONTEXT),
          EROTIC_CONTEXT,
        ),
      }),
    ).toBe(true);
  });

  it("そもそも落ちとらん本文は素通しする", () => {
    const clean = `<response>
<action>汗ばんだ内腿へ手のひらを滑らせると、しっとりした肌が指の腹に吸いつく。</action>
<dialogue>…そこ、だめ。声、出ちゃう。</dialogue>
<inner>こんな顔、誰にも見せたことがない。</inner>
</response>`;
    expect(repairEnglishOnlyDemotion(clean, EROTIC_CONTEXT)).toBe(clean);
  });
});
