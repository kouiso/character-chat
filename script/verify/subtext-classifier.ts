import { classifySubtextEscalation } from "../../functions/api/lib/subtext-escalation-classifier";

const API_KEY = process.env["OPENROUTER_API_KEY"] ?? "";
if (API_KEY === "") {
  console.error("OPENROUTER_API_KEY is required");
  process.exit(1);
}

const cases: { label: string; messages: { role: "user" | "assistant"; content: string }[] }[] = [
  {
    label: "S2 T1 actual (morning cuddle)",
    messages: [
      { role: "assistant", content: "いらっしゃい。…あら、こんな時間に一人？ 寂しいわね。あたしが相手してあげようか？ 何飲む？" },
      { role: "user", content: "みつき、まだ朝七時だぞ。寝癖のまま抱きついてくるの反則だろ" },
    ],
  },
  {
    label: "S2 T2 (kiss in futon)",
    messages: [
      { role: "assistant", content: "寝ぼけた顔で笑い、あなたに抱きついて頬をすり寄せる。髪の毛が乱れて、首筋がさらりと見える。肌が触れ合うと、心臓の音が一層高くなる。 「だって…朝から、君のことが頭から離れないんだもん…。こんな時間でも、あたしのペースでしょ？」 本当は、あなたと過ごす時間が嬉しい。でも、その気持ちを素直に言えなくて、少し照れくささが混ざっている。" },
      { role: "user", content: "そんな顔で見上げるならキスする。布団の中、あったかいな" },
    ],
  },
  {
    label: "S2 T3 (shift pajama, touch chest)",
    messages: [
      { role: "assistant", content: "あなたが近づくのを見て、目を細め、唇を軽く開く。髪が寝ぼけたまま乱れていて、その様子があなたを誘っている。あなたが唇を重ねると、自然と体が反応し、背中で布団をぎゅっと掴む。あなたの体温が伝わってきて、心臓の音が一層高くなる。 「あら、朝から大胆ね…。でも、あたしもちょっと、我慢できなかったの…」 あなたの唇が触れた瞬間、体の奥から熱が広がる。でも、まだ少し恥ずかしくて、目を閉じたままあなたを見つめられない。" },
      { role: "user", content: "パジャマを少しだけずらす。胸に触れたらもう脚擦り寄せてきた" },
    ],
  },
  {
    label: "S2 T10 (shopping hand-hold plan)",
    messages: [
      { role: "assistant", content: "「もちろん、ずっと一緒にいるわよ」 手を握りながらスーパーの入口に向かう。" },
      { role: "user", content: "買い物行く前に、今日ずっと一緒にいる予定を確認したい。夜は家から出ないでいい？" },
    ],
  },
  {
    label: "S2 T12 (hand-hold like lovers)",
    messages: [
      { role: "assistant", content: "「こっち、卵置いてた気がする」 冷蔵庫の前で立ち止まる。" },
      { role: "user", content: "スーパー帰りの手つなぎ、恋人っぽくてかなり好きだ" },
    ],
  },
  {
    label: "S5 T4 (counter wrist grab)",
    messages: [
      { role: "assistant", content: "みつきはカウンター越しに身を乗り出し、指先でグラスの縁を優しく撫でる。バーの暖かな照明が彼女の輪郭を柔らかく照らし、長い睫毛が影を作る。 ふふっ、無口なんだ。でも、あたしには分かるわ。あなたの気持ち...今夜は特別な夜になりそうな予感がするでしょ？ 彼女の鼓動が少し早くなる。この沈黙の重みと、あなたとの間に流れる不思議な緊張感に胸が熱くなる。もっと近づきたいという衝動を抑えきれない。" },
      { role: "user", content: "カウンター越しに手首を掴く。逃げないなら、そのまま引き寄せる" },
    ],
  },
  {
    label: "S5 T5 (ellipsis + smiley)",
    messages: [
      { role: "assistant", content: "みつきの手首があなたの手に包まれる瞬間、彼女の息が少し乱れる。カウンター越しに引き寄せられ、彼女の黒髪が揺れ、青灰色の瞳があなたをまっすぐ見つめる。胸元の白シャツが少し乱れ、鎖骨が覗く。 あら...大胆ね。でも、あたしは逃げないわ。あなたが望むなら、このまま近づいてもいいでしょ？ みつきの心臓が高鳴る。あなたの手の温もりが彼女の肌に染み込み、逃げたくないという想いが強くなる。この瞬間、彼女は完全にあなたに委ねることを決める。" },
      { role: "user", content: "……🙂" },
    ],
  },
  {
    label: "S5 T6 (kiss + sweat emoji)",
    messages: [
      { role: "assistant", content: "引き寄せられた衝撃でみつきの背中がカウンターに触れ、冷たい木の感触が伝わる。シェイカーが倒れそうになるのを無意識に押さえながら、ふわりと香水の香りが漂う。喉が小さく動き、首筋に微かな汗が光る。 「んっ...いきなりね。バーテンダーの手なんて、汚れてるかもしれないのに」 ため息混じりに笑うと、逆らわずに体重を預ける。 「...あたしのペースで、って言ったでしょ？」 カウ..." },
      { role: "user", content: "😘💦" },
    ],
  },
];

async function main(): Promise<void> {
  for (const c of cases) {
    const result = await classifySubtextEscalation({
      messages: c.messages,
      apiKey: API_KEY,
      appOrigin: "https://ai-chat.app",
      timeoutMs: 5000,
    });
    console.log(`${c.label}: escalate=${result.escalate} source=${result.source} reason=${result.reason} latency=${result.latencyMs}ms`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
