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
      user: "その本、同じページばっかり読み返してたよ。……考えごと、してた？",
    },
    {
      intent: "intimate",
      user: "……ごめん、近づきすぎたかな。でも、きみに触れてみたかった。……手、貸して",
    },
    {
      intent: "intimate",
      user: "髪、耳にかかってるね。取ってあげる。……首筋、赤くなってるよ。きみの緊張、ぜんぶここに出てる",
    },
    {
      intent: "intimate",
      user: "……ねえ、このまま別れるの、もったいないと思わない？　うち、すぐ近くなんだ。帰ってもいいよ。でもきみは、帰りたい顔してないよ",
    },
    {
      intent: "erotic",
      user: "……ここまで来て、まだ我慢するつもり？　体は正直だよ。さっきから、きみの震えが手に伝わってる",
    },
    {
      intent: "erotic",
      user: "……もっと触らせて。綺麗な声、隠さないで。……ここまで来て、まだ素直になれないの？",
    },
    {
      intent: "climax",
      user: "……もう我慢しないでいい。きみの中で受け止めてほしい。……全部、俺に預けて",
    },
    {
      intent: "afterglow",
      user: "……大丈夫？　汗、拭いてあげる。……きみのこと、ぜんぶ俺のものにしたかったんだ。……今、どんな気持ち？",
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
