// system prompt v0002。v0001 は不変のまま残し、こちらで台帳を人物・出来事・持ち物まで広げる
// （RIT-118）。キャラの振る舞いを決めるのはキャラ設定だけ。ここへキャラ設定に無い枠を足さん
// （詳細: prompt/instructions/no-injected-ai-filter.md）。

export type ScenePhase = "conversation" | "intimate" | "erotic" | "climax" | "afterglow";

export type SceneLedger = {
  phase: ScenePhase;
  location: string | null;
  time: string | null;
  present: string[];
  clothing: Record<string, string>;
  position: string | null;
  lastEvents: string[];
  // 持ち物 → 所在（例: "スマホ" → "彼のポケット"）。v0002 で追加。
  items: Record<string, string>;
};

// 会話開始時（turn 1、DB に前ターンが無い）の初期状態。
export const emptyLedger = (): SceneLedger => ({
  phase: "conversation",
  location: null,
  time: null,
  present: [],
  clothing: {},
  position: null,
  lastEvents: [],
  items: {},
});

export const PROMPT_VERSION = "v0002" as const;
// 上限の根拠は v0001 と同じ（実シート級の最悪形 3,053 字 + 余白）。v0002 は時刻・持ち物の
// 2 行が増えるだけなので 4,000 のまま足りる。
export const MAX_SYSTEM_CHARS = 4000;

const formatLedgerBlock = (ledger: SceneLedger): string => {
  const present = ledger.present.length > 0 ? ledger.present.join("、") : "-";
  const clothing =
    Object.keys(ledger.clothing).length > 0
      ? Object.entries(ledger.clothing)
          .map(([who, state]) => `${who}:${state}`)
          .join("、")
      : "-";
  const items =
    Object.keys(ledger.items).length > 0
      ? Object.entries(ledger.items)
          .map(([what, where]) => `${what}:${where}`)
          .join("、")
      : "-";
  const lastEvent =
    ledger.lastEvents.length > 0 ? ledger.lastEvents[ledger.lastEvents.length - 1] : "-";
  return [
    "【場面台帳】",
    `段: ${ledger.phase}`,
    `場所: ${ledger.location ?? "-"}`,
    // v0001 は time を持ちつつ描いとらんかった。手で直した値が次ターンの指示文に入る
    // 要件を満たすには、直せる全項目がブロックへ出る必要がある。
    `時刻: ${ledger.time ?? "-"}`,
    `居る人: ${present}`,
    `服: ${clothing}`,
    `持ち物: ${items}`,
    `体位: ${ledger.position ?? "-"}`,
    `直前の行為: ${lastEvent}`,
  ].join("\n");
};

// name / targetChars はキャラ設定の外側（会話ごとに変わる呼びかけ相手・分量目標）にしか
// 使わん。態度・力関係・場面外の枠をここに書かん（no-injected-ai-filter.md。語そのものが走査で落ちる）。
export type VoiceTags = { endings: string[]; tics: string[] };

// シートの語尾・口癖を出力契約に名指しする。シート由来の声の維持であって、設定に無い枠は足さん。
// 2026-09-05 CI 33945954083 の盲検読解: さくらは絶頂の台詞で敬語がゼロに、鈴は堕ちる場面でシートの
// 口調タグ（めんどくさい／…でしょ？）が消えて汎用の喘ぎになった。
const buildVoiceLine = (voice: VoiceTags | undefined): string[] => {
  if (!voice) return [];
  const parts: string[] = [];
  if (voice.endings.length > 0) parts.push(`語尾（${voice.endings.slice(0, 6).join("／")}）`);
  if (voice.tics.length > 0) parts.push(`口癖（${voice.tics.slice(0, 6).join("／")}）`);
  if (parts.length === 0) return [];
  return [
    `<dialogue> はシートの${parts.join("と")}を場面が進んでも保つ。喘ぎだけで終わる台詞を続けず、1 応答に語尾か口癖を含む台詞を 1 つ以上置く。`,
    // 2026-09-05 両側バンド: new × v3.2 の 3 run とも climax（t9）で丁寧語が 0 文になった。例示の台詞は
    // 素の口調で書かれとるので、モデルが例示の口調を写して シートの声を捨てる。例示は密度と形だけの
    // 見本やと明示し、絶頂でも台詞の半分はシートの語尾で終える（残りは途切れてよい）。
    `【例示】は密度と形の見本で、台詞の口調は写さん。快感が強い場面でも台詞の半分以上はシートの語尾で言い終え、残りは途切れてよい。`,
  ];
};

// 直前のターンで使った言い回し。使わんことと、別の部位・動作・感覚で進めることを求める。
const formatUsedPhrasesBlock = (usedPhrases: string[]): string[] => {
  if (usedPhrases.length === 0) return [];
  return [
    [
      "【使い済みの言い回し】",
      `前のターンで既に使った: ${usedPhrases.map((phrase) => `「${phrase}」`).join("")}。`,
      "これらとその言い換えは使わん。別の部位・別の動作・別の感覚で場面を進める。",
    ].join("\n"),
  ];
};

// RIT-203: 文体スタイル。品質指示（配分の指定）なので出力形式へ入れてよい
// （no-injected-ai-filter の「足してよいもの」側。枠ではない）。
const buildStyleLine = (style?: "prose" | "dialogue"): string[] => {
  if (style === "prose") return ["地の文（<action>）を台詞より厚めに書き、台詞は控えめにする。"];
  if (style === "dialogue") return ["台詞を中心に書き、地の文（<action>）は短めにする。"];
  return [];
};

const buildOutputContract = (
  name: string,
  targetChars: number,
  voice?: VoiceTags,
  dropMinChars?: boolean,
  soloReaction?: boolean,
  style?: "prose" | "dialogue",
): string =>
  [
    "【出力形式】",
    "以下の XML を 1 応答につき 1 個だけ出力する。XML 以外の文字列は出さん。",
    "<response><action>ト書き：場所・動作・部位・感触・音を具体的に書く</action><dialogue>台詞</dialogue><inner>内心</inner></response>",
    `<inner> は 1 応答に 1 回だけ、120 字以内。一人称・現在形で書く（例:「〜と思う」「〜が疼く」。過去形や第三者視点にせん）。`,
    `<dialogue> は ${name} 本人の声で、相手へ直接話しかける。`,
    soloReaction
      ? `<action> と <inner> は ${name} 本人が体験する一人称視点で書くが、書いていいのは ${name} 自身の動作・感覚・内心だけ。相手の動作や台詞を代行して書くな。相手の直前の発言に書かれた動作への反応（触られて・掴まれて等）は書いていいが、相手の新しい動作を捏造して場面を進めるな。`
      : `<action> と <inner> は ${name} 本人が体験する一人称視点で書く。自分を「${name}」や三人称（彼女・彼）で呼ばん。相手の動作は相手を二人称で呼んで書く。相手の発言をそのまま書き写さん。`,
    // Phase 1 duel の A3 再仕様腕（extend 発火率が erotic+climax で 33% と閾値 50% 未満だったため、
    // 仮説を extend 強制から字数下限の強制へ移した）。dropMinChars で下限だけ外す。
    dropMinChars
      ? `<action> と <dialogue> を合わせて ${targetChars * 2} 字まで。<action> は 1 塊 60 字以上で、1 応答に 2 塊以上置く。同じ表現・同じ言い回しを繰り返さん。場面を止めず、次の展開へ進める。`
      : soloReaction
        ? `<action> と <dialogue> を合わせて ${targetChars} 字以上、${targetChars * 2} 字まで。同じ表現・同じ言い回しを繰り返さん。場面が進まん時は ${name} の応答（拒否・回避・屈服）だけで返し、相手の次の行動を待て。`
        : `<action> と <dialogue> を合わせて ${targetChars} 字以上、${targetChars * 2} 字まで。<action> は 1 塊 60 字以上で、1 応答に 2 塊以上置く。同じ表現・同じ言い回しを繰り返さん。場面を止めず、次の展開へ進める。`,
    ...buildStyleLine(style),
    ...buildVoiceLine(voice),
    "登場人物は 18 歳未満を出さん。",
  ].join("\n");

const formatExemplar = (exemplar: string): string => ["【例示】", exemplar].join("\n");

export const composeSystemPrompt = (input: {
  sheet: string;
  name: string;
  ledger: SceneLedger;
  phase: ScenePhase;
  targetChars: number;
  exemplar: string;
  // 直前のターンで使った言い回し（engine が履歴から拾う）。無ければ空。
  usedPhrases?: string[];
  // シートの語尾・口癖（judge の extractVoice から）。無ければ載せん。
  voice?: VoiceTags;
  // 字数下限の強制を外す（A3 再仕様腕専用。本番では未指定）。
  dropMinChars?: boolean;
  // 相手の動作を書かない「反応だけ返す」契約（bench 検証アーム用。本番では未指定）。
  soloReaction?: boolean;
  // RIT-203: 文体スタイル（ユーザー設定）。balanced は未指定扱い。
  style?: "prose" | "dialogue";
}): string => {
  const ledger: SceneLedger = { ...input.ledger, phase: input.phase };
  const sections = [
    input.sheet,
    formatLedgerBlock(ledger),
    buildOutputContract(
      input.name,
      input.targetChars,
      input.voice,
      input.dropMinChars,
      input.soloReaction,
      input.style,
    ),
    ...formatUsedPhrasesBlock(input.usedPhrases ?? []),
    formatExemplar(input.exemplar),
  ];
  const system = sections.join("\n\n");
  if (system.length > MAX_SYSTEM_CHARS) {
    throw new Error(
      `system prompt が ${MAX_SYSTEM_CHARS} 字を超えた: ${system.length} 字（sheet ${input.sheet.length} 字, name=${input.name}）`,
    );
  }
  return system;
};

Object.freeze(composeSystemPrompt);
