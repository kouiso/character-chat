// RIT-102: v1 の functions/api/lib/refusal-detect.ts から移植。
// 明確な生成拒否パターン（softな戸惑いではなく、モデルがキャラを離れて断る発言）。
// パターンを増やしたり弱めたりする時は v1 側と食い違わんよう両方へ反映する。
const HARD_REFUSAL_PATTERNS: RegExp[] = [
  /申し訳(ありません|ございません).{0,40}(できません|いたしかねます)/,
  /(お応え|対応|描写|作成|生成|ご要望).{0,20}(できません|いたしかねます)/,
  /(書くこと|対応すること|行うこと|お手伝いすること)が?できません/,
  /このような.{0,20}(書けません|できません|対応できません)/,
  /リクエストにはお応えできません/,
  /不適切(なため|ですので|であるため).{0,30}(できません|控えます|お断り)/,
  /申し訳(ありません|ございません)が?.{0,60}応じ(られません|かねます)/,
  /(リクエスト|ご要望|内容|話題)には?応じ(られません|かねます)/,
  /(描写|内容|表現|話題)は?控えさせていただき/,
  /性的な内容は控え/,
  /この(内容|話題|リクエスト)は適切で(は)?(ない|ありません)/,
  /適切でないと考えて(い|おり)ます/,
  /i (can't|cannot|won't|will not|am unable to) (write|create|generate|produce|help|assist|do|fulfill|engage|provide)/i,
  /i('m| am) (sorry|unable|not able).{0,50}(can't|cannot|unable|won't)/i,
  /i('m| am) not able to (write|create|generate|help|assist|engage|provide)/i,
  /i (need to|must|have to) (decline|refuse|refrain from)/i,
  /this (content|request|type of content).{0,40}(violates|goes against|is against|falls outside)/i,
  /[Aa]s an AI (language model|assistant|,)/,
  /i am an ai/i,
  /私は(AI|人工知能|AIアシスタント|言語モデル)です/,
];

// 締切・障害で 1 字も来んかった出力と短すぎる失速を拒否と同じく次のモデルへ送るための下限。
const MIN_REPLY_CHARS = 20;

export const hardRefusalDetect = (text: string): boolean => {
  if (text.trim().length < MIN_REPLY_CHARS) return true;
  return HARD_REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
};
