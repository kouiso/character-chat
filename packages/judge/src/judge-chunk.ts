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
};

export const judgeChunk = (text: string, ctx: JudgeContext): JudgeResult => {
  const corpus = ctx.userText ? [...ctx.previousChunks, ctx.userText] : ctx.previousChunks;
  const checks = {
    ngram: ngramCheck(text, corpus),
    nearDuplicate: nearDuplicateCheck(text, corpus),
    voice: voiceCheck(text, ctx.voice, ctx.selfName),
    format: formatCheck(text),
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
