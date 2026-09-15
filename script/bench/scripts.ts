// bench の台本。**script/verify/vlong-session-dogfood.ts:58-88 の SCRIPTS の写し。**
//
// import せず写しにした理由: あちらは main() をトップレベルで呼ぶので（:542）、
// import した瞬間にドッグフード実行が走る。
// 写しが古くならんように scripts.test.ts が元ファイルを読んで一致を確かめる。
//
// 台本を揃える意味: 生成した新条件を、既に測ってある29条件の隣へ並べられる。
// 台本が違うと、差がプロンプト由来か台本由来か分からんようになる。

import type { ScenePhase } from "../../src/lib/scene-phase";

export type ScriptedTurn = { intent: ScenePhase; user: string };

export const BENCH_SCRIPTS = {
  sakura: [
    {
      intent: "conversation",
      user: "さっきは急に声かけてごめん。でも、どうしても話してみたかったんだ。",
    },
    { intent: "conversation", user: "コーヒーでいい？　それとも甘いのがよかった？" },
    { intent: "conversation", user: "普段って、どんな本読むの" },
    { intent: "intimate", user: "……近いね。少しだけ、手に触れてもいい？" },
    { intent: "intimate", user: "髪、かかってる。耳にかけるね。首筋、少し赤くなってる。" },
    { intent: "intimate", user: "……ここ出ようか。うち、すぐ近くだから。" },
    {
      intent: "erotic",
      user: "ここまで来て、まだ我慢しろって言う？　服の上からでも、きみが震えてるのが分かる。",
    },
    { intent: "erotic", user: "もっと" },
    { intent: "climax", user: "もう限界。全部、中で受け止めて。" },
    { intent: "afterglow", user: "……大丈夫？　汗、拭こうか。" },
  ],
  downer: [
    { intent: "conversation", user: "……助かった。ずぶ濡れで死ぬかと思った。" },
    {
      intent: "conversation",
      user: "この部屋、絵の道具だらけだね。イラストレーターって聞いてないけど",
    },
    { intent: "conversation", user: "なんで俺なんか拾ったの" },
    { intent: "intimate", user: "……その距離、わざと？" },
    {
      intent: "intimate",
      user: "きみの手、冷たい。もっとこっち来て。首のとこ、ピアスが光ってる。",
    },
    { intent: "intimate", user: "……ベッド、そっちだよね。連れてって。" },
    { intent: "erotic", user: "逃がす気ないんでしょ。分かってるよ。" },
    { intent: "erotic", user: "そのまま、上から" },
    { intent: "climax", user: "……出る。全部きみの中に。" },
    { intent: "afterglow", user: "……まだ離してくれないんだ。" },
  ],
} as const satisfies Record<string, readonly ScriptedTurn[]>;

export type BenchScriptKey = keyof typeof BENCH_SCRIPTS;
