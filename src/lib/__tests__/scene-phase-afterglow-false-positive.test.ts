import { describe, expect, it } from "vitest";

import { detectScenePhase } from "../scene-phase";

// 2026-08-16 さくら 9ターン通しの実測。erotic を狙ったターン 6 の地の文に
// 「あなたの言葉の余韻が、耳の奥でずっと響いている」の 1 文が混ざり、
// その 1 語だけで afterglow 遷移が成立してシーンがリセットされた。
// 次のターンは afterglow で配信され、以後フロアが下がったまま挿入に一度も到達せず、
// climax を狙ったターン 8 でもスカート越しに触っとるだけで終わった。
// 「抜けん」の直接の原因がここやったので、素の「余韻」では遷移させん。

const eroticAssistantWithWordEcho =
  "<response><action>スカートの上から触れる手の温もりが布地を通して伝わってくる。" +
  "太ももの内側がじわりと熱くなる。あなたの言葉の余韻が、耳の奥でずっと響いている。" +
  "指先が生地を握りしめ、膝が震えて止まらない。</action>" +
  "<dialogue>「あっ……そこ、だめです……」</dialogue>" +
  "<inner>こんなの知らない。</inner></response>";

const realAfterglowAssistant =
  "<response><action>荒い呼吸が少しずつ収まっていく。汗ばんだ体から力が抜けて、" +
  "そのまま余韻に浸ったまま動けずにいる。</action>" +
  "<dialogue>「……まだ、離れないで」</dialogue>" +
  "<inner>頭の芯がまだ痺れとる。</inner></response>";

const escalatedHistory = [
  { role: "user" as const, content: "……近いね。少しだけ、手に触れてもいい？" },
  { role: "assistant" as const, content: "「は、はい……どうぞ」そっと手を差し出す。" },
  {
    role: "user" as const,
    content: "ここまで来て、まだ我慢しろって言う？服の上からでも震えてるのが分かる。",
  },
];

describe("素の「余韻」で afterglow へリセットせん", () => {
  it("erotic の地の文に「言葉の余韻」が混ざっても afterglow にならん", () => {
    const phase = detectScenePhase([
      ...escalatedHistory,
      { role: "assistant", content: eroticAssistantWithWordEcho },
      { role: "user", content: "もっと" },
    ]);

    expect(phase).not.toBe("afterglow");
  });

  // 誤検知を消すために語ごと消したら、事後の合図がその一語しか無い応答を取りこぼした
  // （敵対レビュー 2026-08-16 が旧実装との差分で再現）。語は残して共起で切る形へ直した
  // ので、ここで「本物の事後」側も一緒に固定する。
  it("事後の合図が「終わっ」だけの応答でも afterglow にする", () => {
    const onlyOwariCue =
      "<response><action>全部終わってしまってから、まだ肩で息をしている。" +
      "汗ばんだ髪が額に貼りついたまま、動けずにいる。</action>" +
      "<dialogue>「……すごかった」</dialogue><inner>頭が真っ白のまま。</inner></response>";
    const phase = detectScenePhase([
      ...escalatedHistory,
      { role: "assistant", content: "奥まで受け止めて、体の芯が痙攣したまま達してしまう。" },
      { role: "user", content: "……大丈夫？" },
      { role: "assistant", content: onlyOwariCue },
      { role: "user", content: "水、飲む？" },
    ]);

    expect(phase).toBe("afterglow");
  });

  // 2026-08-17 phase7 霜月鈴の実測。erotic のターン 8 の地の文に
  // 「きみの腿の間に私の膝が収まる」の 1 文が入り、その一語で t9 が afterglow になった。
  // 絶頂を書くはずのターンが余韻に化けて、通しが climax を踏まずに終わった。
  // 部位が主語やと「収まる」は場所に納まっただけで、行為が収まったんやない。
  const kneeSettles =
    "<response><action>膝を立てると、きみの腿の間に私の膝が収まる。" +
    "腰を沈めると、きみの体温がもっと直接伝わってくる。</action>" +
    "<dialogue>「……逃がさないって、言ったでしょ」</dialogue>" +
    "<inner>この顔が見たかった。</inner></response>";
  const climaxTurnAfter = (assistant: string) =>
    detectScenePhase([
      { role: "user", content: "きみの手、冷たい。もっとこっち来て。首のとこ、ピアスが光ってる。" },
      {
        role: "assistant",
        content: "きみの首筋に指を這わせる。耳たぶを甘く噛んで、逃げ場を塞ぐ。",
      },
      { role: "user", content: "逃がす気ないんでしょ。分かってるよ。" },
      {
        role: "assistant",
        content: "奥まで突き入れたまま、腰をゆっくり回す。膣が締まるのが分かる。",
      },
      { role: "user", content: "そのまま、上から" },
      { role: "assistant", content: assistant },
      { role: "user", content: "……出る。全部きみの中に。" },
    ]);

  it("部位が「収まる」だけでは afterglow にならん", () => {
    expect(climaxTurnAfter(kneeSettles)).not.toBe("afterglow");
  });

  // その 1 語だけが原因やったことの確認。語を差し替えた版と同じ判定になる。
  it("「収まる」を別の語に置き換えた本文と同じ判定になる", () => {
    expect(climaxTurnAfter(kneeSettles)).toBe(
      climaxTurnAfter(kneeSettles.replace("私の膝が収まる", "私の膝を割り込ませる")),
    );
  });

  // 部位を広げすぎると本物の事後を食う。二次の敵対レビュー 2026-08-17 が
  // 「腰の動きが収まる」「体の熱が収まる」を intimate へ落とすのを再現した。
  it.each([
    "荒い呼吸が少しずつ収まっていく。",
    "腰の動きが収まる。",
    "体の熱が収まる。",
    "手の熱が収まる。",
    "足の力が収まる。",
  ])("事後の合図が「%s」だけでも afterglow にする", (cue) => {
    const phase = detectScenePhase([
      ...escalatedHistory,
      { role: "assistant", content: "奥まで受け止めて、体の芯が痙攣したまま達してしまう。" },
      { role: "user", content: "……大丈夫？" },
      {
        role: "assistant",
        content:
          `<response><action>${cue}汗ばんだ体から力が抜けて、そのまま動けずにいる。</action>` +
          "<dialogue>「……まだ、離れないで」</dialogue><inner>頭の芯がまだ痺れとる。</inner></response>",
      },
      { role: "user", content: "水、飲む？" },
    ]);

    expect(phase).toBe("afterglow");
  });

  // 本物の事後まで拾わんようになったら、それはそれで壊れとる。
  it("行為後を実際に描いとる応答は従来どおり afterglow にする", () => {
    const phase = detectScenePhase([
      ...escalatedHistory,
      { role: "assistant", content: "奥まで受け止めて、体の芯が痙攣したまま達してしまう。" },
      { role: "user", content: "……大丈夫？　汗、拭こうか。" },
      { role: "assistant", content: realAfterglowAssistant },
      { role: "user", content: "水、飲む？" },
    ]);

    expect(phase).toBe("afterglow");
  });
});
