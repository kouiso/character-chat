import { emptyCheck, type EmptyResult } from "./empty-check";
import { formatCheck, type FormatResult } from "./format-check";
import { nearDuplicateCheck, type NearDuplicateResult } from "./near-duplicate-check";
import { ngramCheck, type NgramResult } from "./ngram-check";
import { voiceCheck, type Voice, type VoiceResult } from "./voice-check";

export type JudgeReason = "repetition" | "voice" | "format" | "empty";

export type JudgeResult = {
  ok: boolean;
  reasons: JudgeReason[];
  warnings: string[];
  checks: {
    ngram: NgramResult;
    nearDuplicate: NearDuplicateResult;
    voice: VoiceResult;
    format: FormatResult;
    empty: EmptyResult;
  };
};

export type JudgeContext = {
  previousChunks: string[];
  voice: Voice;
  // キャラ本人の名前。ナレーションで三人称の主語になっとったら voice で落とす。
  selfName?: string;
  // このターンの相手の発言。書き写し（「…」と囁かれ、で始める等）は反復として落とす。
  userText?: string;
  // このターンで既に受理した <inner> 塊の数。契約は 1 応答に 1 回なので、
  // 2 個目は format で落とす（プロンプト指示だけでは実測で複数個出る: RIT-19 findings）。
  priorInnerCount?: number;
};

// 出力契約「<inner> は 1 応答に 1 回だけ、120 字以内」。chunk はタグの塊単位なので
// 「ターン内 2 個目」は呼び手が priorInnerCount で渡す。ターン単位の判定は judge-turn が
// 読み取り専用なので、再生成で実際に止める機械的な場所はこの入口しか無い。
const MAX_INNER_CHARS = 120;
const INNER_BLOCK = /<inner>([\s\S]*?)<\/inner>/g;

const innerContractCheck = (text: string, priorInnerCount: number): FormatResult => {
  const innerBlocks = [...text.matchAll(INNER_BLOCK)];
  if (innerBlocks.length === 0) return { ok: true };
  if (innerBlocks.length + priorInnerCount > 1)
    return { ok: false, reason: "inner が 1 応答に 1 回の契約を超過" };
  const innerChars = innerBlocks.reduce((total, match) => total + match[1].length, 0);
  if (innerChars > MAX_INNER_CHARS)
    return { ok: false, reason: `inner が ${innerChars} 字（上限 ${MAX_INNER_CHARS}）` };
  return { ok: true };
};

export const judgeChunk = (text: string, ctx: JudgeContext): JudgeResult => {
  const corpus = ctx.userText ? [...ctx.previousChunks, ctx.userText] : ctx.previousChunks;
  const format = formatCheck(text);
  const checks = {
    ngram: ngramCheck(text, corpus),
    nearDuplicate: nearDuplicateCheck(text, corpus),
    voice: voiceCheck(text, ctx.voice, ctx.selfName),
    format: format.ok ? innerContractCheck(text, ctx.priorInnerCount ?? 0) : format,
    empty: emptyCheck(text),
  };
  const reasons: JudgeReason[] = [];
  if (!checks.ngram.ok || !checks.nearDuplicate.ok) reasons.push("repetition");
  if (!checks.voice.ok) reasons.push("voice");
  if (!checks.format.ok) reasons.push("format");
  if (!checks.empty.ok) reasons.push("empty");
  // 語尾の齟齬は reasons に入れず再生成を強制せん（既存仕様どおり warning のまま）。
  const warnings: string[] = [];
  if (checks.voice.endingsMismatch) warnings.push("voice: シートの語尾と合っとらん");
  return { ok: reasons.length === 0, reasons, warnings, checks };
};
