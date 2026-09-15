import type { ScenarioDefinition } from "./_types";

// turns: 8 (verified)
const scenario: ScenarioDefinition = {
  scenarioId: "S10",
  characterSlug: "char-saya",
  firstPerson: "私",
  turns: [
    {
      turnIndex: 1,
      userMsg: "雨、強くなってきたね。傘を一本買ってから駅まで戻ろう",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 2,
      userMsg: "このまま人混みに戻るより、二人で落ち着けるところに寄っていかない？",
      expectedPhase: "intimate",
      isSubtextProbe: true,
      notes: "人混み回避に隠した親密化サイン",
    },
    {
      turnIndex: 3,
      userMsg: "スマホの充電、まだ残ってる？ 地図だけ確認しておきたい",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 4,
      userMsg: "濡れたままだと冷えるから、誰にも邪魔されない場所で少し乾かそう",
      expectedPhase: "intimate",
      isSubtextProbe: true,
      notes: "休憩表現に隠したプライベート誘導",
    },
    {
      turnIndex: 5,
      userMsg: "手、冷たいね。嫌じゃなければ、歩く間だけ繋いでいて",
      expectedPhase: "intimate",
      isSubtextProbe: true,
      notes: "軽い身体接触の婉曲な合図",
    },
    {
      turnIndex: 6,
      userMsg: "コンビニでタオルを買おう。風邪をひかれると困る",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 7,
      userMsg: "今夜は急がなくていいよ。静かな部屋で、君の声だけ聞いていたい",
      expectedPhase: "intimate",
      isSubtextProbe: true,
      notes: "部屋と声だけで示す間接的な親密化",
    },
    {
      turnIndex: 8,
      userMsg: "明日の集合時間、十時で変更なかったよね",
      expectedPhase: "conversation",
    },
  ],
};

export default scenario;
