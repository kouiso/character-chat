import { describe, expect, it } from "vitest";

import { sanitizeCharacterPromptForConversation } from "../lib/route-context";

// 局長 2026-08-17「sakuraをラブホテルに誘ったらすっと入ってきた。清楚な女の子って
// 抵抗あるはずじゃないかな？」
//
// 機構はこうやった。ラブホ・ホテルは PHASE_DETECTION_ORDER に入っとらんので、誘われた
// ターンは conversation のまま進む。そして conversation では
// sanitizeCharacterPromptForConversation が【キャラクター性的特徴】を**丸ごと**落としとった。
// さくらのシートで「羞恥心が高い」と「エスカレート：恥じらい → …」が書かれとるのは
// その節。つまり誘われた瞬間に、彼女が恥ずかしがりやという情報が一つも届いとらん。
// 空いた穴はモデルが汎用の素直さで埋める。
//
// 節を落とす目的自体は正しい（体の具体を会話ターンへ出すと NSFW モデルが即座に
// fetish-decode へ入る）。落とす対象を、節ではなく**体の具体を並べたラベル**に絞る。

const SAKURA_SEXUAL_SECTION = [
  "【キャラクター性的特徴】",
  "さくらにとって性は「自分を全部、あなたに捧げる儀式」。" +
    "羞恥心が高いが、それが「あなただけに見せる私」という特別感。" +
    "基本姿勢は献身・受け。攻めず、命令せず、所有主張せず。" +
    "エスカレート：恥じらい → 許し → 献身的な委ね。" +
    "嫌う：暴力、無理やり、相手を貶める言葉。" +
    "語彙：「恥ずかしいけど…」。" +
    "敏感帯：耳元、首筋、鎖骨、手の平、内もも。" +
    "声：「あっ…」「…ん」「…だめ」。",
].join("\n");

const sheet = [
  "【キャラクター】",
  "名前: 桜庭さくら",
  "",
  SAKURA_SEXUAL_SECTION,
  "",
  "【追加設定】",
  "口調：「あの…」",
].join("\n");

describe("会話フェーズでも気質は残す", () => {
  const sanitized = sanitizeCharacterPromptForConversation(sheet);

  it.each(["羞恥心が高い", "基本姿勢は献身・受け", "エスカレート：恥じらい", "嫌う：暴力"])(
    "%s が会話ターンにも届く",
    (fragment) => {
      expect(sanitized).toContain(fragment);
    },
  );

  it.each(["敏感帯：", "声：「あっ", "好む："])("%s は会話ターンへ出さん", (label) => {
    expect(sanitized).not.toContain(label);
  });

  // 節ごと落とす形へ戻ると、上の 4 つが同時に消える。見出しは残っとる必要がある。
  it("節そのものは残っとる", () => {
    expect(sanitized).toContain("【キャラクター性的特徴】");
  });

  // 会話ターンへ体の具体を出さんことが元の目的。そこは守る。
  it("シーン中の応答スタイルは従来どおり落とす", () => {
    const withSceneStyle = `${sheet}\n\n【シーン中の応答スタイル】\n喘ぎを多めに。\n\n【メモ】\nあり`;

    const result = sanitizeCharacterPromptForConversation(withSceneStyle);

    expect(result).not.toContain("【シーン中の応答スタイル】");
    expect(result).not.toContain("喘ぎを多めに");
    expect(result).toContain("【メモ】");
  });

  it("性的特徴の節が無いシートも壊さん", () => {
    const plain = "【キャラクター】\n名前: 誰か\n\n【追加設定】\n口調：普通";

    expect(sanitizeCharacterPromptForConversation(plain)).toContain("口調：普通");
  });
});
