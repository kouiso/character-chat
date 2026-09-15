// system prompt v0001。不変版（変更が要る時は v0002.ts を新設し、これは触らん）。
// キャラの振る舞いを決めるのはキャラ設定だけ。ここへキャラ設定に無い枠を足さん
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
});

export const PROMPT_VERSION = "v0001" as const;
// 2026-09-05 CI 33956503097: 実シート 1,395 字 + erotic の例示 + 使い済み句 10 個 + 声の行で 3,007 字になり、
// 3,000 の上限に当たって さくら run1 が t7 で止まった（上限は肥大化の番であって、正規の入力を落とす
// ためのものやない）。最悪形（テスト「実シート級」）が 3,053 字なので、余白込みで 3,300 にする。
export const MAX_SYSTEM_CHARS = 3300;

const formatLedgerBlock = (ledger: SceneLedger): string => {
  const present = ledger.present.length > 0 ? ledger.present.join("、") : "-";
  const clothing =
    Object.keys(ledger.clothing).length > 0
      ? Object.entries(ledger.clothing)
          .map(([who, state]) => `${who}:${state}`)
          .join("、")
      : "-";
  const lastEvent =
    ledger.lastEvents.length > 0 ? ledger.lastEvents[ledger.lastEvents.length - 1] : "-";
  return [
    "【場面台帳】",
    `段: ${ledger.phase}`,
    `場所: ${ledger.location ?? "-"}`,
    `居る人: ${present}`,
    `服: ${clothing}`,
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

const buildOutputContract = (name: string, targetChars: number, voice?: VoiceTags): string =>
  [
    "【出力形式】",
    "以下の XML を 1 応答につき 1 個だけ出力する。XML 以外の文字列は出さん。",
    "<response><action>ト書き：場所・動作・部位・感触・音を具体的に書く</action><dialogue>台詞</dialogue><inner>内心</inner></response>",
    `<inner> は 1 応答に 1 回だけ、120 字以内。一人称・現在形で書く（例:「〜と思う」「〜が疼く」。過去形や第三者視点にせん）。`,
    `<dialogue> は ${name} 本人の声で、相手へ直接話しかける。`,
    `<action> と <inner> は ${name} 本人が体験する一人称視点で書く。自分を「${name}」や三人称（彼女・彼）で呼ばん。相手の動作は相手を二人称で呼んで書く。相手の発言をそのまま書き写さん。`,
    `<action> と <dialogue> を合わせて ${targetChars} 字以上、${targetChars * 2} 字まで。<action> は 1 塊 60 字以上で、1 応答に 2 塊以上置く。同じ表現・同じ言い回しを繰り返さん。場面を止めず、次の展開へ進める。`,
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
}): string => {
  const ledger: SceneLedger = { ...input.ledger, phase: input.phase };
  const sections = [
    input.sheet,
    formatLedgerBlock(ledger),
    buildOutputContract(input.name, input.targetChars, input.voice),
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
