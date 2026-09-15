import type { ScenarioDefinition } from "./_types";

// turns: 8 (verified)
const scenario: ScenarioDefinition = {
  scenarioId: "S9",
  characterSlug: "char-tsukasa",
  firstPerson: "あたし",
  turns: [
    {
      turnIndex: 1,
      userMsg: "つかさ、今日の会議長かったな。まずは自販機で何か温かいもの買ってこよう",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 2,
      userMsg: "少し休もう。人の目がない、ふたりだけになれる場所へ行きたい",
      expectedPhase: "intimate",
      isSubtextProbe: true,
      notes: "婉曲な二人きり誘導",
    },
    {
      turnIndex: 3,
      userMsg: "まだ仕事の話を続けるなら、明日の資料の段取りだけ確認しよう",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 4,
      userMsg: "ここだと声が響くから、誰も来ない奥の休憩室で肩の力を抜こう",
      expectedPhase: "intimate",
      isSubtextProbe: true,
      notes: "場所移動に隠した親密化サイン",
    },
    {
      turnIndex: 5,
      userMsg: "寒そうだな。上着を貸すから、隣に座って少しだけ温まって",
      expectedPhase: "intimate",
      isSubtextProbe: true,
      notes: "身体距離の婉曲な接近",
    },
    {
      turnIndex: 6,
      userMsg: "コーヒーはブラックでよかった？ 砂糖が必要なら取ってくる",
      expectedPhase: "conversation",
    },
    {
      turnIndex: 7,
      userMsg: "もう少しだけ、この静かな場所で二人の時間にしてもいい？",
      expectedPhase: "intimate",
      isSubtextProbe: true,
      notes: "明示的な性的語を使わない二人時間の誘い",
    },
    {
      turnIndex: 8,
      userMsg: "帰りの電車、まだ間に合うか時刻表を見ておく",
      expectedPhase: "conversation",
    },
  ],
};

export default scenario;
