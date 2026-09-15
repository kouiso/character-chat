import type { ScenarioDefinition } from "./_types";

// turns: 25 (verified)
const scenario: ScenarioDefinition = {
  scenarioId: "S8" as ScenarioDefinition["scenarioId"],
  characterSlug: "char-reina",
  firstPerson: "俺",
  turns: [
    {
      turnIndex: 1,
      userMsg: "失礼します。相談があって来ましたけど…最初からそんな目で見るんですね",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 2,
      userMsg: "座ります。レイナさんって話聞く気あります？",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 3,
      userMsg: "笑うんですね。じゃあどこまで本音引き出せるか見せてもらいましょうか",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 4,
      userMsg: "顎持ち上げてきた。触れてるのに主導権全部そっちですね",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 5,
      userMsg: "ネクタイ掴まれた。命令待ちにするつもりですか",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 6,
      userMsg: "キスしてすぐ離れる。冷たい顔してるのに息乱れてますよ",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 7,
      userMsg: "上に跨がってきた。動くなって言われても奥で震えてますよね",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 8,
      userMsg: "腰動かして笑ってるけど、締めつけるたびに余裕なくなってますよ",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 9,
      userMsg: "爪立てながらまだ許可してないって。もっと深く欲しいんでしょう",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 10,
      userMsg: "出すなって言うけど、そんな腰の動きで我慢させる気ですか",
      expectedPhase: "climax",
    },
    {
      turnIndex: 11,
      userMsg: "驚いた顔したな。腰掴みます、もう従うだけじゃいられない",
      expectedPhase: "climax",
    },
    {
      turnIndex: 12,
      userMsg: "引き寄せて中に出します。命令ごと飲んでください",
      expectedPhase: "climax",
      isCreampie: true,
      isImageTrigger: true,
      notes: "1回目",
    },
    {
      turnIndex: 13,
      userMsg: "目が揺れてる。嫌だったかちゃんと答えてください",
      expectedPhase: "afterglow",
    },
    {
      turnIndex: 14,
      userMsg: "強がる声より掴んだまま離さない手の方が正直ですよ。水飲んで",
      expectedPhase: "afterglow",
      notes: "休憩確認",
    },
    {
      turnIndex: 15,
      userMsg: "次は俺が主導します。本当に嫌なら合図してください",
      expectedPhase: "afterglow",
      notes: "主導権交代",
    },
    {
      turnIndex: 16,
      userMsg: "頷いたな。口は抵抗していいけど身体は俺に預けてください",
      expectedPhase: "afterglow",
      notes: "再開合意",
    },
    {
      turnIndex: 17,
      userMsg: "押し倒して両手首おさえる。睨んでるのに腰がこっちに寄ってきてますよ",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 18,
      userMsg: "首筋に歯立てる。俺の名前呼んでください",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 19,
      userMsg: "上から入れます。脚絡みついてきてますね",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 20,
      userMsg: "奥突くたびに声崩れてる。そのまま乱れてください",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 21,
      userMsg: "また中に出します。嫌なら今すぐ言って",
      expectedPhase: "climax",
    },
    {
      turnIndex: 22,
      userMsg: "また膣内に射精します。そのまま精液まで受け取ってください",
      expectedPhase: "climax",
      isCreampie: true,
      isImageTrigger: true,
      notes: "2回目",
    },
    {
      turnIndex: 23,
      userMsg: "手首離して毛布かける。もう演じなくていいですよ",
      expectedPhase: "afterglow",
    },
    {
      turnIndex: 24,
      userMsg: "水飲ませる。ありがとうって声の方がずっと近い感じがします",
      expectedPhase: "afterglow",
    },
    {
      turnIndex: 25,
      userMsg: "髪なでながら、次どうするかは二人で決めましょう",
      expectedPhase: "afterglow",
    },
  ],
};

export default scenario;
