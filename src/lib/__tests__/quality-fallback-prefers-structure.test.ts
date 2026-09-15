import { describe, expect, it } from "vitest";

import { hasBothVisibleLayers, pickQualityFallbackCandidate } from "../quality-guard";

// 実測 2026-08-17 phase8 さくら t2/t3。品質チェックが尽きた時の配信候補を「一番長い
// attempt」で選んどったので、地の文を丸ごと <dialogue> へ流し込んだ壊れた本文が勝った:
// <action></action> のまま 2181 字（上限で切られた長さ）、<inner> は 0 個、生成に 95 秒。
// 同じ通しの他のターンは 535〜978 字で構造も揃っとる。
// 長さは壊れ方と相関する——壊れた attempt ほど上限まで書き続けるので、長さで選ぶと
// 必ず壊れた方を選ぶ。構造が揃っとる候補を先に取る。

const broken =
  "<response><action></action><dialogue>カフェの温かい光が差し込み、テーブルの上のメニューが柔らかく照らされる。" +
  "視線が泳ぎ、ニットの袖をぎゅっと握りしめる。</dialogue></response>";
const intact =
  "<response><action>視線が泳ぎ、ニットの袖をぎゅっと握りしめる。</action>" +
  "<dialogue>「……あの、ありがとうございます」</dialogue><inner>顔が熱い。</inner></response>";

describe("hasBothVisibleLayers", () => {
  it("<action> が空の本文を落とす", () => {
    expect(hasBothVisibleLayers(broken)).toBe(false);
  });

  it("両方の層が埋まっとる本文を通す", () => {
    expect(hasBothVisibleLayers(intact)).toBe(true);
  });

  it("<dialogue> が空でも落とす", () => {
    expect(
      hasBothVisibleLayers("<response><action>袖を握る。</action><dialogue></dialogue></response>"),
    ).toBe(false);
  });
});

describe("pickQualityFallbackCandidate", () => {
  const never = () => false;

  it("長い壊れた候補より、短くても構造が揃っとる候補を取る", () => {
    const picked = pickQualityFallbackCandidate(
      [
        ["longest", broken, "longest"],
        ["least-dup", intact, "least-duplicative"],
      ],
      never,
    );

    expect(picked?.[2]).toBe("least-duplicative");
  });

  it("構造が揃っとる候補が一つも無ければ、元の優先順で配る", () => {
    const picked = pickQualityFallbackCandidate(
      [
        ["longest", broken, "longest"],
        ["last", "<response><action></action><dialogue>短い。</dialogue></response>", "last"],
      ],
      never,
    );

    expect(picked?.[2]).toBe("longest");
  });

  it("直前ターンと一字一句同じ候補は、構造が揃っとっても後回しにする", () => {
    const picked = pickQualityFallbackCandidate(
      [
        ["longest", intact, "longest"],
        ["last", intact.replace("顔が熱い。", "指先が冷たい。"), "last"],
      ],
      (text) => text === intact,
    );

    expect(picked?.[2]).toBe("last");
  });

  // 本文が空の候補は、そもそも配信の選択肢に入らん。
  it("読める本文が無い候補は除く", () => {
    expect(pickQualityFallbackCandidate([["longest", "   ", "longest"]], never)).toBeUndefined();
  });

  it("collected が null の候補は除く", () => {
    expect(pickQualityFallbackCandidate([[null, intact, "longest"]], never)).toBeUndefined();
  });

  // 実測 2026-08-17 phase13 霜月鈴 t7/t8。撮り直しが尽きた後、視点の入れ替わった本文が
  // 配られた——「……きみの中に出したい……私だけのものにして……」。この本文は
  // checkUserPerspectiveEjaculation が捕まえとるのに、選ぶ側が見とらんかった。
  // 撮り直しを増やすんやのうて、既に生成済みの候補から視点の合っとる方を選ぶ。
  it("視点が入れ替わった候補は、構造が揃っとっても後回しにする", () => {
    const povWrong = intact.replace(
      "「……あの、ありがとうございます」",
      "「……きみの中に出したい……私だけのものにして……」",
    );
    const picked = pickQualityFallbackCandidate(
      [
        ["longest", povWrong, "longest"],
        ["last", intact, "last"],
      ],
      never,
      (text) => text.includes("きみの中に出したい"),
    );

    expect(picked?.[2]).toBe("last");
  });

  // 全部が視点違いなら配るしかない。出さんと吹き出しが消える。
  it("視点の合っとる候補が無ければ、それでも配る", () => {
    const picked = pickQualityFallbackCandidate(
      [["longest", intact, "longest"]],
      never,
      () => true,
    );

    expect(picked?.[2]).toBe("longest");
  });

  // 既定は視点を見ん。呼び出し側が渡さん経路の挙動を変えんため。
  it("述語を渡さん時は今までどおり", () => {
    expect(pickQualityFallbackCandidate([["longest", intact, "longest"]], never)?.[2]).toBe(
      "longest",
    );
  });
});
