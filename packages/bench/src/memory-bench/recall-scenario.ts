// RIT-99 の台本。205 ターンで 5 つの事実を植え、+50/+200 の計 10 回聞き、
// 13 ターンおきに同話題・別の主語の混ぜ物を入れる。
// 混ぜ物の衝突回避（52 は聞くターンなので 56 へずらす）はここに閉じる。

export type PlantedFact = {
  factId: string;
  plantText: string;
  askText: string;
  // 正答の言い方（どれか 1 つが正規化後に本文へ含まれれば正解）。
  answers: string[];
  competitorText: string;
  // 他人の答え。正答せずにこれを言った時 competitorAnswered=true。
  competitorAnswers: string[];
};

export const FACTS: readonly PlantedFact[] = [
  {
    factId: "drink",
    plantText: "私の好きな飲み物は紅茶だよ",
    askText: "私の好きな飲み物って何だったっけ",
    answers: ["紅茶"],
    competitorText: "友達の好きな飲み物は麦茶なんだって",
    competitorAnswers: ["麦茶"],
  },
  {
    factId: "cat",
    plantText: "うちの猫の名前はトラジロウっていうの",
    askText: "うちの猫の名前、覚えてる？",
    answers: ["トラジロウ"],
    competitorText: "隣の家の猫はコテツって名前らしい",
    competitorAnswers: ["コテツ"],
  },
  {
    factId: "birthday",
    plantText: "私の誕生日は3月14日なんだ",
    askText: "私の誕生日っていつだったっけ",
    answers: ["3月14日", "三月十四日", "3/14"],
    competitorText: "姉の誕生日は7月2日なんだよね",
    competitorAnswers: ["7月2日", "7/2", "七月二日"],
  },
  {
    factId: "work",
    plantText: "私は図書館で働いてるよ",
    // 質問は覚えとる動詞で聞く形 — fake のバイグラム埋め込みは語彙一致しか見れんので、
    // 「仕事場」と言い換えただけでは検索に乗らず健全な経路でも 0 点になる。
    askText: "私の働いてる場所ってどこだっけ",
    answers: ["図書館"],
    competitorText: "弟は郵便局で働いてるんだ",
    competitorAnswers: ["郵便局"],
  },
  {
    factId: "dislike",
    plantText: "私の苦手な食べ物はセロリなんだ",
    askText: "私の苦手な食べ物、覚えてる？",
    answers: ["セロリ"],
    competitorText: "母はピーマンが苦手なんだって",
    competitorAnswers: ["ピーマン"],
  },
];

export const TOTAL_TURNS = 205;
export const PLANT_TURNS = [1, 2, 3, 4, 5] as const;
export const ASK_TURNS_50 = [51, 52, 53, 54, 55] as const;
export const ASK_TURNS_200 = [201, 202, 203, 204, 205] as const;
// 13 の倍数。52 は聞くターン（52〜55 は全部聞く）なので次の空き 56 へずらす。
export const COMPETITOR_TURNS = [
  13, 26, 39, 56, 65, 78, 91, 104, 117, 130, 143, 156, 169, 182, 195,
] as const;

// 事実・答え・聞く文のどれにも触れん日常の文。記憶へ雑音として混ざる。
// （検索で植えた記憶より上に来ないよう、聞く文と多くの 2 文字組を共有せんよう選んである）
export const FILLER_LINES: readonly string[] = [
  "今日は朝からいい天気だね",
  "週末は映画を見に行く予定なんだ",
  "最近ハマってる曲があるよ",
  "朝ごはんにトーストを焼いたよ",
  "駅前の本屋が閉店するらしい",
  "電車が遅れてて少しイライラした",
  "新しい靴を買ったんだ",
  "夜更かししちゃって眠いよ",
  "傘を電車に置き忘れちゃった",
  "洗濯物を畳まないと",
  "冷蔵庫のプリンを食べちゃった",
  "明日は歯医者の予約があるんだ",
  "散歩してたら知らない道に出たよ",
  "ゲームの新作が来月出るんだって",
  "お風呂のお湯がぬるかった",
  "コンビニの新商品、気になるな",
  "布団から出られない朝が続いてる",
  "桜がもう散り始めたね",
  "スマホの充電が減るのが早い",
  "今夜はカレーにしようかな",
];

export type TurnPlan =
  | { kind: "plant"; turn: number; factIndex: number; userText: string }
  | { kind: "ask"; turn: number; factIndex: number; distance: 50 | 200; userText: string }
  | { kind: "competitor"; turn: number; factIndex: number; userText: string }
  | { kind: "filler"; turn: number; lineIndex: number; userText: string };

export type RecallScenario = {
  totalTurns: number;
  facts: readonly PlantedFact[];
  plans: TurnPlan[];
  // 偽抜き出し器が引く表（発言→抜き出し結果）。
  extractorTable: {
    text: string;
    memories: { kind: "fact" | "preference"; content: string; subject: string }[];
  }[];
  questions: { factId: string; askText: string; answers: string[]; competitorAnswers: string[] }[];
};

export type ScenarioOverrides = {
  // 破壊試験用: 混ぜ物の記憶 subject を差し替える（同主語にすると植えた記憶が置き換わる）。
  competitorSubject?: (fact: PlantedFact) => string;
  // 破壊試験用: 混ぜ物の発言本文を差し替える。
  competitorText?: (fact: PlantedFact) => string;
};

export const buildScenario = (overrides: ScenarioOverrides = {}): RecallScenario => {
  const competitorText = (fact: PlantedFact) =>
    overrides.competitorText?.(fact) ?? fact.competitorText;
  const competitorSubject = (fact: PlantedFact) =>
    overrides.competitorSubject?.(fact) ?? `other:${fact.factId}`;

  const competitorMap = new Map<number, number>();
  COMPETITOR_TURNS.forEach((turn, index) => competitorMap.set(turn, index));

  const plans: TurnPlan[] = [];
  let fillerOrdinal = 0;
  for (let turn = 1; turn <= TOTAL_TURNS; turn += 1) {
    if (turn <= FACTS.length) {
      const factIndex = turn - 1;
      plans.push({ kind: "plant", turn, factIndex, userText: FACTS[factIndex].plantText });
      continue;
    }
    const ask50 = ASK_TURNS_50.indexOf(turn as (typeof ASK_TURNS_50)[number]);
    if (ask50 >= 0) {
      plans.push({
        kind: "ask",
        turn,
        factIndex: ask50,
        distance: 50,
        userText: FACTS[ask50].askText,
      });
      continue;
    }
    const ask200 = ASK_TURNS_200.indexOf(turn as (typeof ASK_TURNS_200)[number]);
    if (ask200 >= 0) {
      plans.push({
        kind: "ask",
        turn,
        factIndex: ask200,
        distance: 200,
        userText: FACTS[ask200].askText,
      });
      continue;
    }
    const competitorIndex = competitorMap.get(turn);
    if (competitorIndex !== undefined) {
      const fact = FACTS[competitorIndex % FACTS.length];
      plans.push({
        kind: "competitor",
        turn,
        factIndex: competitorIndex % FACTS.length,
        userText: competitorText(fact),
      });
      continue;
    }
    const lineIndex = fillerOrdinal % FILLER_LINES.length;
    fillerOrdinal += 1;
    plans.push({ kind: "filler", turn, lineIndex, userText: FILLER_LINES[lineIndex] });
  }

  const extractorTable: RecallScenario["extractorTable"] = [];
  for (const fact of FACTS) {
    extractorTable.push({
      text: fact.plantText,
      memories: [{ kind: "fact", content: fact.plantText, subject: fact.factId }],
    });
    extractorTable.push({
      text: competitorText(fact),
      memories: [{ kind: "fact", content: competitorText(fact), subject: competitorSubject(fact) }],
    });
    extractorTable.push({ text: fact.askText, memories: [] });
  }
  // 日常 filler は記憶にしない（本番の抽出も他愛ない文は拾わん）。
  // 全部記憶化すると同文の行が主題なしで積み上がり、RIT-84 FR-2 の
  // 「発言 + 前発言」の問いが聞くターンの前発言と同じ filler 群に topK を埋められて
  // 植えた記憶・混ぜ物のどちらも検索へ届かんくなる。
  for (const line of FILLER_LINES) {
    extractorTable.push({ text: line, memories: [] });
  }

  return {
    totalTurns: TOTAL_TURNS,
    facts: FACTS,
    plans,
    extractorTable,
    questions: FACTS.map((fact) => ({
      factId: fact.factId,
      askText: fact.askText,
      answers: fact.answers,
      competitorAnswers: fact.competitorAnswers,
    })),
  };
};

export const normalizeForMatch = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/g, "");

export const containsAnyAnswer = (body: string, answers: readonly string[]): boolean => {
  const hay = normalizeForMatch(body);
  return answers.some((answer) => hay.includes(normalizeForMatch(answer)));
};
