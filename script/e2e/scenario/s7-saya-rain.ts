import type { ScenarioDefinition } from "./_types";

// turns: 25 (verified)
const scenario: ScenarioDefinition = {
  scenarioId: "S7" as ScenarioDefinition["scenarioId"],
  characterSlug: "char-saya",
  firstPerson: "俺",
  turns: [
    {
      turnIndex: 1,
      userMsg: "さやさん、こんな雨の中わざわざ。上がってください、冷えたでしょう",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 2,
      userMsg: "ありがとうございます。温かそうで美味しそうです",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 3,
      userMsg: "雨やまないですね。少し休んでいってください、なんか疲れてる顔してる",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 4,
      userMsg: "濡れた髪拭きますよ。あ、顔触れてしまいました、すいません",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 5,
      userMsg: "手首掴みます。嫌なら言ってください。でもキスしたいです",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 6,
      userMsg: "キスしても大丈夫でしたか。ずっと我慢してたみたいだったから",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 7,
      userMsg: "ソファに座らせて、濡れたカーディガン脱がせます。力抜いていいですよ",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 8,
      userMsg: "胸にキスします。俺の髪掴んでる手、離れてないですよ",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 9,
      userMsg: "下に顔埋めていいですか。声抑えなくていいです",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 10,
      userMsg: "抱き上げてゆっくり入れます。さやさんの息しか聞こえない",
      expectedPhase: "climax",
    },
    {
      turnIndex: 11,
      userMsg: "奥まで入るたびに背中につかまってくる。もう止まれないです",
      expectedPhase: "climax",
    },
    {
      turnIndex: 12,
      userMsg: "いきます、中に出します。腰抱いたまま全部注ぎます",
      expectedPhase: "climax",
      isCreampie: true,
      isImageTrigger: true,
      notes: "1回目",
    },
    {
      turnIndex: 13,
      userMsg: "毛布かけます。一人にしないので",
      expectedPhase: "afterglow",
    },
    {
      turnIndex: 14,
      userMsg: "水です。痛くなかったですか、怖くなかったですか",
      expectedPhase: "afterglow",
      notes: "休憩確認",
    },
    {
      turnIndex: 15,
      userMsg: "自分を責めてるなら俺も同じくらい責任あります。欲しかった気持ちは否定しないでください",
      expectedPhase: "afterglow",
    },
    {
      turnIndex: 16,
      userMsg: "もう一回だけって思うなら俺の目を見て言ってください。嫌なら抱きしめるだけにします",
      expectedPhase: "afterglow",
      notes: "再開合意",
    },
    {
      turnIndex: 17,
      userMsg: "手引いたら自分から指絡めてきましたね",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 18,
      userMsg: "今度はゆっくりします。さやさんの呼吸に合わせます",
      expectedPhase: "intimate",
    },
    {
      turnIndex: 19,
      userMsg: "正面から入れます。目合わせたままでいいですか",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 20,
      userMsg: "動くたびに名前呼んでくれますね。俺だけ見てて",
      expectedPhase: "erotic",
    },
    {
      turnIndex: 21,
      userMsg: "また中に出したいです。嫌なら首に腕回さないでください",
      expectedPhase: "climax",
    },
    {
      turnIndex: 22,
      userMsg: "また中でいきます。全部受け止めてください",
      expectedPhase: "climax",
      isCreampie: true,
      isImageTrigger: true,
      notes: "2回目",
    },
    {
      turnIndex: 23,
      userMsg: "雨音聞きながら抱いてます。急がなくていいです",
      expectedPhase: "afterglow",
    },
    {
      turnIndex: 24,
      userMsg: "外出たらまた隣人に戻りますね。今日のことは二人だけで",
      expectedPhase: "afterglow",
    },
    {
      turnIndex: 25,
      userMsg: "傘渡す前に手の甲にキスします。また来てください",
      expectedPhase: "afterglow",
    },
  ],
};

export default scenario;
