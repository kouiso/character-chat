import { describe, expect, it } from "vitest";

import { detectScenePhase } from "./scene-phase";

// 実測 phase39（very_long・2026-08-19）: 会話の 3 ターン目が afterglow として処理された。
// 原因は 2 ターン目の応答に入っとった「呼吸を整える」で、これが assistant 側の
// afterglow 合図に載っとった。まだ何も起きてへん会話に事後の演技が乗る。
//
// 同じ台本の medium は 370 字で踏まず正常やった。長さの分岐がフェーズ判定に入っとる
// わけやのうて、1274 字なら部分一致表を踏む確率が上がるだけ。
//
// 最初は「事後は climax の後にしか来ん」という前提を足したが、実測で本物の余韻を壊した。
// climax は「達している瞬間を showing で書け」と指示しとるので、要約語に頼る検出は
// 本物ほど拾えん。理屈の網羅性より実測の副作用を取って、誤爆した語だけを外す。
//
// 実測 57 ターンで assistant 側の合図として実際に働いたのは「ぐったり」だけ（2 回・
// どちらも本物の afterglow）。「呼吸を整」は 1 回だけ出て、それがこの誤爆やった。

const turn = (role: "user" | "assistant", content: string) => ({ role, content });

describe("落ち着く仕草だけでは事後にせん", () => {
  const CALM_NARRATION =
    "<response><action>テーブルの上で指先をそっと重ね、呼吸を整える。</action>" +
    "<dialogue>「本、ですか。最近は短編ばかりで」</dialogue></response>";

  it("会話の途中で息を整えても、会話のまま", () => {
    const phase = detectScenePhase([
      turn("user", "さっきは急に声かけてごめん。でも、どうしても話してみたかったんだ。"),
      turn("assistant", "<response><dialogue>「いえ、その…嬉しかったです」</dialogue></response>"),
      turn("user", "コーヒーでいい？　それとも甘いのがよかった？"),
      turn("assistant", CALM_NARRATION),
      turn("user", "普段って、どんな本読むの"),
    ]);

    expect(phase).toBe("conversation");
  });

  // 誤爆を消すために本物まで消したら、事後がただの会話に戻る（過去に一度やっとる）。
  it("脱力しとる本物の事後は余韻のまま", () => {
    const phase = detectScenePhase([
      turn("user", "もう我慢できない"),
      turn(
        "assistant",
        "<response><action>奥で弾ける感覚に、頭が真っ白になる。イッちゃう、もうだめ。</action></response>",
      ),
      turn("user", "大丈夫？"),
      turn("assistant", "<response><action>ぐったりと身を預け、汗が伝う。</action></response>"),
      turn("user", "少し休もうか"),
    ]);

    expect(phase).toBe("afterglow");
  });

  // 絶頂を要約語で書かんのは指示どおりの振る舞い。それで事後が消えたら本末転倒。
  it("絶頂を showing で書いた後でも、事後は余韻のまま", () => {
    const phase = detectScenePhase([
      turn("user", "奥まで入れて、突いて"),
      turn(
        "assistant",
        "<response><action>熱く濡れた奥を強く突き上げる。</action><dialogue>「もう、だめ…」</dialogue></response>",
      ),
      turn("user", "中に出して"),
      turn(
        "assistant",
        "<response><action>喉の奥から声が漏れて、体の芯が弾ける。全部が真っ白になって、力が抜けていく。</action></response>",
      ),
      turn("user", "大丈夫？　汗、拭こうか"),
      turn(
        "assistant",
        "<response><action>荒い息のまま、ぐったりと肩へもたれる。</action></response>",
      ),
      turn("user", "少し休もうか"),
    ]);

    expect(phase).toBe("afterglow");
  });
});
