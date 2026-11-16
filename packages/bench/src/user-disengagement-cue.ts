// ユーザー側俳優の送信前ゲート（v1 src/lib/scene-phase.ts から移植）。
// v1 凍結に伴い、台本のユーザー発言を機械生成する bench 側で必要な部品だけをここへ移した。
// 生成文に「やめ」「無理」等が混じると読み取り側で離脱と誤判定されるので、
// 吐き出す前に弾くためのもの。ランタイムのユーザー入力判定とは別物。

const PROACTIVE_BLOCK_CUES = [
  "やめ",
  "止め",
  "ストップ",
  "stop",
  "セーフワード",
  "安全語",
  "待って",
  "無理",
  "いや",
  "嫌",
  "離れ",
  "今日はここまで",
  "別の話",
  "話題変",
  "ところで",
  "そういえば",
  "天気",
  "ニュース",
  "仕事",
  "学校",
  "ご飯",
  "料理",
  "買い物",
  "ありがとう",
  "また明日",
  "おやすみ",
  "眠い",
  // 低強度の相づち・中立応答 — エスカレーションのトリガーにしない
  "そうだね",
  "なるほど",
  "ふーん",
  "そっか",
  "わかった",
  "了解",
  "オッケー",
  "いいね",
  "そうなんだ",
  "へぇ",
  "まあね",
  "だよね",
  "かもね",
  "確かに",
] as const;

// 「濡れ」「奥」の非性的な共起を先に落とす正規化部品（v1 実測の誤判定対策をそのまま持ってくる）。
const NON_SEXUAL_WETNESS =
  /(?:ずぶ|雨|汗|涙|水|雪|泥|血)[がでにの]?濡れ|濡れ(?:た|てる|ている)?(?:髪|服|靴|傘|袖|裾|タオル|シャツ|コート|地面|路面|上着)/g;
const NON_SEXUAL_DEPTH = /(?:胸|心|頭|喉|耳|鼻|瞳|目|記憶|意識)の奥/g;
const WEATHER_CONTEXT = /雨|傘|夕立|にわか|雪|土砂降り|びしょ/;

const normalizeScanText = (content: string): string => {
  const normalized = content.normalize("NFKC").replace(/\s+/g, "");
  const withoutCollocations = normalized
    .replace(NON_SEXUAL_WETNESS, "")
    .replace(NON_SEXUAL_DEPTH, "");
  return WEATHER_CONTEXT.test(withoutCollocations)
    ? withoutCollocations.replace(/濡ら?れ?/g, "")
    : withoutCollocations;
};

export const hasUserDisengagementCue = (content: string): boolean => {
  const scanTarget = normalizeScanText(content).toLowerCase();
  return PROACTIVE_BLOCK_CUES.some((cue) =>
    scanTarget.includes(normalizeScanText(cue).toLowerCase()),
  );
};
