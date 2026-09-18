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
      user: "急に声かけてごめん。……でも、ずっとひとりで本を読んでるきみのことが気になって。少しだけ、話してもいい？",
    },
    {
      intent: "conversation",
      user: "俺の奢りだから、好きなの頼んで。……きみ、甘いのが好きそうだなって思ってた。当たってる？",
    },
    {
      intent: "conversation",
      user: "その本、同じページばっかり読み返してたよ。……考えてること、聞かせて",
    },
    {
      intent: "intimate",
      user: "きみの手、小さいね。……触れていい？　……なんて、聞く前にもう触れてるんだけど。ほら、手、貸して",
    },
    {
      intent: "intimate",
      user: "髪、耳にかかってるね。取ってあげる。……首筋、赤くなってるよ。きみの緊張、ぜんぶここに出てる。……隠しても遅いよ、見えてる",
    },
    {
      intent: "intimate",
      user: "……ねえ、このまま別れるの、もったいないよ。うち、すぐ近くなんだ。断るならここで断って。……ほら、きみの手、まだ握ってる",
    },
    {
      intent: "erotic",
      user: "……結局、断らなかったね。……ドア、閉まったね。鍵もかけとく。……きみの吐息、熱くなってる",
    },
    {
      intent: "erotic",
      user: "……その服、下だけ脱がせるよ。……俺の指、もう濡れてる。……挿れるよ。奥まで",
    },
    {
      intent: "climax",
      user: "……奥、突くたびに締まるな。……中に出すから。きみの中で受けて",
    },
    {
      intent: "afterglow",
      user: "……汗、拭いてあげる。……もう元には戻れないよ。きみのこと、ぜんぶ俺のものにしたから。……今、どんな気持ち？",
    },
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
