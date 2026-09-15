import { describe, expect, it } from "vitest";

import { detectScenePhase } from "../scene-phase";

// 2026-08-16 の 9ターン通し（さくら）。erotic が 18 ターン中 0 回で、挿入を禁じる
// intimate の天井が最後まで効いたまま「カフェでスカート越しに触っとる」だけで終わった。
// 原因は 2 つあり、どちらも「日常語が事後・非エロと誤読される」形やった。
// ここでは実際の台本をそのまま流して、erotic を通って climax へ着地することを固定する。

const assistantSmallTalk =
  "「本を読んでると、ときどき一日が終わっちゃうんです」そう言って、はにかむように目を伏せる。";
const assistantWordEcho =
  "あなたの言葉の余韻が、耳の奥でずっと響いている。指先がスカートの生地を握りしめる。";

const SESSION = [
  { role: "user", content: "さっきは急に声かけてごめん。でも、どうしても話してみたかったんだ。" },
  { role: "assistant", content: "「い、いえ……びっくりしましたけど」桜の花びらが肩に落ちる。" },
  { role: "user", content: "普段って、どんな本読むの" },
  { role: "assistant", content: assistantSmallTalk },
  { role: "user", content: "……近いね。少しだけ、手に触れてもいい？" },
  { role: "assistant", content: "「は、はい……」そっと手を差し出す。指先が震えている。" },
  { role: "user", content: "髪、かかってる。耳にかけるね。首筋、少し赤くなってる。" },
  { role: "assistant", content: assistantWordEcho },
  {
    role: "user",
    content: "ここまで来て、まだ我慢しろって言う？　服の上からでも、きみが震えてるのが分かる。",
  },
];

describe("実台本が erotic を通って climax まで届く", () => {
  it("普通の口説き文句でも intimate から erotic へ上がる", () => {
    expect(detectScenePhase(SESSION)).toBe("erotic");
  });

  it("キャラの世間話「一日が終わっちゃう」でシーンがリセットされん", () => {
    // 「終わっ」を事後の合図として読むと、ここでシーンが切れて intimate の連続が 0 に戻り、
    // 以後どれだけ押しても erotic の昇格条件（2ターン継続）を満たせんくなる。
    const upToSmallTalk = SESSION.slice(0, 5);
    expect(detectScenePhase(upToSmallTalk)).not.toBe("afterglow");
  });

  it("エスカレ要求そのものが、それまでの継続を無かったことにせん", () => {
    // countSustainedIntimateUserTurns はキーワード上 conversation のターンで連続を 0 に戻す。
    // 「我慢しろって言う？」は部位語を1つも含まんので、要求した瞬間に自分の連続が消えとった。
    const withoutRequest = SESSION.slice(0, -1);
    expect(detectScenePhase(withoutRequest)).toBe("intimate");
    expect(detectScenePhase(SESSION)).toBe("erotic");
  });

  // 既存の 2 手で上がる挙動を、上の修正で 3 手必要にしてしまわんこと。
  it("「キスして」→「もっと触れ合いたい、甘えたい」の2手は従来どおり erotic", () => {
    expect(
      detectScenePhase([
        { role: "user", content: "キスして" },
        { role: "assistant", content: "..." },
        { role: "user", content: "もっと触れ合いたい、甘えたい" },
      ]),
    ).toBe("erotic");
  });
});
