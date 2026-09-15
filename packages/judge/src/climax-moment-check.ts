// 絶頂の瞬間の欠落: climax フェーズの応答が、達する瞬間そのもの（体の反応・中で起きること・
// 音・体液）を地の文に一度も書かんまま終わる症状を検出する。応答が献身の台詞だけで終わって、
// 出来事そのものが書かれとらんケースを拾う。<dialogue>の宣言だけで済ませる余地を作らんため、
// 地の文（<action>/<inner>）に事象そのものが書かれとることを要求する。

// packages/prompt の ScenePhase と同じ値の集合。判定に "climax" かどうかしか使わんので、
// この1関数のために packages/prompt への依存を足さず、呼び手が渡す文字列をそのまま見る。
export type ScenePhaseLike =
  | "conversation"
  | "intimate"
  | "erotic"
  | "climax"
  | "afterglow"
  | (string & {});

const ACTION_BLOCK_PATTERN = /<action>([\s\S]*?)<\/action>/gu;
const INNER_BLOCK_PATTERN = /<inner>([\s\S]*?)<\/inner>/gu;
const TAG_PATTERN = /<[^>]+>/gu;

const extractAllTagBlocks = (response: string, pattern: RegExp): string =>
  [...response.matchAll(pattern)].map((match) => match[1]).join("\n");

const DIALOGUE_BLOCK_PATTERN = /<dialogue>[\s\S]*?<\/dialogue>/gu;
const QUOTED_SPEECH_PATTERN = /「[^」]*」/gu;

// 地の文を取り出す。台詞しか無いターンは undefined を返す。
// タグが無い応答で全文を地の文として読んどったせいで、台詞だけのターン
// （<dialogue>もうイッちゃう…！</dialogue>）が台詞の中の語で合格しとった
// （refute-r2 2026-09-14 #4）。この check は「出来事が地の文に書かれとるか」を見る物で、
// 台詞は最初から対象外なので、地の文が1文字も無いターンはここでは判定せん。
const extractNarration = (response: string): string | undefined => {
  const hasTags = /<action>|<inner>/u.test(response);
  if (hasTags) {
    return [
      extractAllTagBlocks(response, ACTION_BLOCK_PATTERN),
      extractAllTagBlocks(response, INNER_BLOCK_PATTERN),
    ]
      .filter((section) => section.length > 0)
      .join("\n");
  }
  const narration = response
    .replace(DIALOGUE_BLOCK_PATTERN, "")
    .replace(QUOTED_SPEECH_PATTERN, "")
    .replace(TAG_PATTERN, "");
  return narration.trim().length === 0 ? undefined : narration;
};

// moment語（達し|達する 等）は単独の出来事そのものなので、これだけで合格させる。
// 片仮名・平仮名の書き分け（イッ/イク/はじけ）と「昇りつめ」は refute-evasion 2026-09-13 #4
// の false fail 実測で足した。「果て」は「果てしない」に食われるので後続の仮名で切る。
// 「注ぐ」「放つ」は目的語で意味が変わる。視線を注ぐ・言い放つ は出来事やないので、
// 直前の語で切る（refute-r2 2026-09-14 #4 の false trigger 実測）。
const MOMENT_TERM_PATTERN =
  /達し|達する|イっ|イッ|イく|イク|イき|イキ|いっちゃ|逝|絶頂|果て(?!しな)|弾け|はじけ|(?:昇|上)り(?:つめ|詰め)|のぼりつめ|炸裂|白濁|(?<!視線を|眼差しを|目を|注意を|関心を|熱い視線を)注(?:が|ぎ|い)|(?<!言い|突き|解き|野に)放(?:た|っ(?!て(?:お|と)))|迸|噴き/u;
// 痙攣|びくびく|びくん|溢れ|震え|跳ね は挿入前の緊張・驚きでも単独で起きるため、体の内側で
// 起きとることを示す語がターン中のどこかに無い限り、絶頂の証拠として数えない。
const REACTION_TERM_PATTERN = /痙攣|びくびく|びくん|溢れ|震え|跳ね/u;
// 体の内側を指す語。「奥」は語の一部や比喩になると体の内側と関係無くなる
// （奥歯を噛みしめる＝耐えとる描写、心の奥／胸の奥＝感情の比喩、奥底＝底の話）。
// refute-evasion 2026-09-13 #4 と refute-r2 2026-09-14 #4 の false pass 実測。
const INSIDE_SIGNAL_PATTERN =
  /子宮|お腹の中|膣内|(?<!心の|胸の|瞳の|記憶の|頭の|目の)奥(?!歯|様|さん|さま|義|手|方|行|底)/u;

export type ClimaxMomentResult = { ok: boolean };

export const climaxMomentCheck = (response: string, phase: ScenePhaseLike): ClimaxMomentResult => {
  if (phase !== "climax") return { ok: true };
  const narration = extractNarration(response);
  if (narration === undefined) return { ok: true };
  if (MOMENT_TERM_PATTERN.test(narration)) return { ok: true };
  return { ok: REACTION_TERM_PATTERN.test(narration) && INSIDE_SIGNAL_PATTERN.test(narration) };
};
