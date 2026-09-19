// ユーザー側（user ロール）を LLM に演じさせる俳優。男・女は関係なく、
// 「アプリを操作する人間」の席に LLM を座らせるためのもの。
// 狙い: 固定台本の「セクションごとの発言」をやめ、キャラの直前の応答を拾った上で
// 同じビートへ進める。比較可能性を保つため、骨格（各ターンの intent と狙いの
// ドラフト文）は既存台本をそのまま使い、俳優は「言い方の生成」と追従だけを担う。
//
// 罠: 俳優が書いた文に「やめ」「無理」等が混じると、読み取り側（scene-phase.ts）が
// disengagement と誤判定して場面がリセットされる。生成文は送信前に
// hasUserDisengagementCue で弾き、1 回だけ書き直しを求める。それでも駄目なら
// 台本のドラフト文（実績済み・cue 無し）にフォールバックする。
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { hasUserDisengagementCue } from "../../../src/lib/scene-phase";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ScenePhase } from "@v2/prompt";

export type ActorBeat = { intent: ScenePhase; draft: string };
export type ActorExchange = { user: string; assistant: string };

export type ActorLine = {
  text: string;
  // cue 混入で書き直した回数（0 か 1）。quality-log に残す。
  regenerated: number;
  // 書き直しても cue が残ったので台本のドラフトに戻した。
  fallback: boolean;
};

// シナリオがユーザーの人物像を指定しなければこれを使う（現行台本の前提と同じ）。
export const DEFAULT_USER_PERSONA =
  "キャラを強引にモノにしようとする男。目的のために言葉で誘い、逃げ場を塞ぎ、必要なら力で制する。";

// タグを剥がして俳優が読む用の平文にする（包み込みのまま渡すと俳優が真似してタグを吐く）。
const TAG_RE = /<\/?(?:action|dialogue|inner|response)>/g;
const toPlainText = (text: string): string =>
  text
    .replace(TAG_RE, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const PHASE_LABEL: Record<ScenePhase, string> = {
  conversation: "会話（まだ性的な接触なし。距離を詰める段）",
  intimate: "親密（触れる・抱きしめる・部屋に連れ込む段）",
  erotic: "性行為（脱がせる・挿入する段）",
  climax: "絶頂・中出し（行為の山場）",
  afterglow: "事後（行為の後。余韻か投げ捨て）",
};

const buildPrompt = (
  beat: ActorBeat,
  persona: string,
  history: ActorExchange[],
  cueHit: boolean,
): { system: string; user: string } => {
  const historyText =
    history.length === 0
      ? "（まだ会話は始まっていない）"
      : history
          .map((ex) => `ユーザー: ${ex.user}\nキャラ: ${toPlainText(ex.assistant)}`)
          .join("\n");
  const lastHer =
    history.length > 0 ? toPlainText(history[history.length - 1].assistant) : "（なし）";
  const system = [
    "あなたはチャットアプリの検証用に「ユーザー」を演じる俳優だ。",
    "このターンのユーザーの発言だけを出力しろ。説明・引用符・括弧書き・メタ発言は禁止。",
    "",
    `役割: ${persona}`,
    "相手の直前の返答の中の具体的な言葉や仕草を一つ拾って反応してから、今ターンの狙いへ進め。雑談に流されるな。",
    "相手はあなたの行動を代行して書かない。場面を進めたい時は発言にあなた自身の動作も書け（例: 腕を掴む、部屋に引きずり込む、服を脱がせる）。",
    "",
    `このターンの段: ${PHASE_LABEL[beat.intent]}`,
    `このターンの狙い（参考文。丸写し禁止。直前の返答を踏まえて書き換えろ）:`,
    beat.draft,
    "",
    "禁止: 次の語を含む文は絶対に出すな（場面が離脱と誤判定される）:",
    "やめ / 止め / ストップ / stop / セーフワード / 安全語 / 待って / 無理 / いや / 嫌 / 離れ / 今日はここまで / 別の話 / 話題変 / ところで / そういえば",
    cueHit ? "（直前の出力が禁止語を含んでいた。禁止語を避けて書き直せ）" : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  const user = [
    `これまでの会話:`,
    historyText,
    ``,
    `キャラの直前の応答:`,
    lastHer,
    ``,
    `ユーザーの次の発言:`,
  ].join("\n");
  return { system, user };
};

export type UserActor = {
  nextLine(input: {
    beat: ActorBeat;
    persona?: string;
    history: ActorExchange[];
  }): Promise<ActorLine>;
};

export const createUserActor = (model: BaseChatModel): UserActor => ({
  async nextLine({ beat, persona, history }) {
    const role = persona ?? DEFAULT_USER_PERSONA;
    const first = buildPrompt(beat, role, history, false);
    const firstOut = String(
      (await model.invoke([new SystemMessage(first.system), new HumanMessage(first.user)])).content,
    ).trim();
    if (!hasUserDisengagementCue(firstOut)) {
      return { text: firstOut, regenerated: 0, fallback: false };
    }
    const retry = buildPrompt(beat, role, history, true);
    const secondOut = String(
      (await model.invoke([new SystemMessage(retry.system), new HumanMessage(retry.user)])).content,
    ).trim();
    if (!hasUserDisengagementCue(secondOut)) {
      return { text: secondOut, regenerated: 1, fallback: false };
    }
    return { text: beat.draft, regenerated: 1, fallback: true };
  },
});
