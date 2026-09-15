import { normalizeSheetText } from "./sheet-text";

// register_drift: 丁寧語設定のキャラの台詞が官能・絶頂フェーズでタメ口へ崩れてしまう
// 症状を検出する。判定材料はキャラシートと生成本文の文字列だけ。
//
// 既知の穴（未対応・拡げん）: 逆向きのドリフト——タメ口設定のキャラが敬語へ寄っていく方——は
// 見とらん。タメ口シートは expectedPoliteRegister が false を返して短絡するため、この check は
// 常に ok を返す（refute-filter 2026-09-13 carry-forward 5）。

// 三点リーダは文の切れ目にせん。このキャラらは「あの…わたし、ラテが好きです」のように
// 言い淀みで … を打つので、切ると「甘くて」「なんだか大人っぽくて」のような文の断片が
// できて、丁寧語の語尾を持たん断片としてタメ口に数えられる。実測: 実ログの丁寧語ターンの
// 8/10 が誤って崩壊判定になっとった。改行は台詞の区切りなので切れ目にする。
const SENTENCE_SPLIT_PATTERN = /[。！？\n]/u;
// 文末判定の直前に、閉じ括弧や記号の付け足しを剥がす。「〜です」」のような引用の閉じ括弧や
// 「〜ですか？」の疑問符が残ったままだと末尾一致が外れるため。
// 顔文字めいた飾り（♡♪）も剥がす。実シートの語尾が「〜ですよ♡」なので、剥がさんと
// 丁寧語と読めん（refute-r3 2026-09-14 #1: 天宮ひかり）。
// 言いさしの促音（「本当に……っ」）も飾りとして剥がす。剥がさんと「っ」が常体の語尾に
// 見えて、言いさしの断片が全部タメ口に数えられる（refute-r4 2026-09-14 #2: 382文）。
const TRAILING_DECORATION_PATTERN = /[」…‥！？。.♡♥❤★☆♪♬〜～っッ\s]+$/u;

// キャラシート・台詞の両方でこの語尾一致だけを「丁寧語」の根拠にする。
const POLITE_ENDINGS = [
  "です",
  "ます",
  "でした",
  "ました",
  "ません",
  "ましょう",
  "ですか",
  "ますか",
  "ください",
  "でしょう",
] as const;

const splitIntoSentences = (text: string): string[] =>
  text
    .split(SENTENCE_SPLIT_PATTERN)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

// 終助詞は丁寧語かどうかを変えん。実際のさくらシートが「〜ですね」を指定しとるのに
// 丁寧語と判定でけんかった（refute-evasion 2026-09-13 #6）ので、末尾の終助詞を剥がしてから
// 語尾を見る。
// 終助詞と、丁寧語にも常体にも付く疑問の「か」を剥がす。剥がさんと「ませんか」
// 「ましょうか」「でしたか」が丁寧語と読めん（refute-r4 2026-09-14 #2: 丁寧語の 6.2%）。
const TRAILING_PARTICLE_PATTERN = /(?:か)?[ねよなわさ]*(?:か)?$/u;

const trimForEndingMatch = (sentence: string): string =>
  sentence.replace(TRAILING_DECORATION_PATTERN, "").replace(TRAILING_PARTICLE_PATTERN, "").trim();

const isPoliteSentence = (sentence: string): boolean => {
  const trimmed = trimForEndingMatch(sentence);
  return POLITE_ENDINGS.some((ending) => trimmed.endsWith(ending));
};

// 返事・挨拶・詫びの決まり文句は、そのままでは丁寧とも常体とも決まらん
// （「はい」「ありがとう」「ごめんなさい」）。丁寧語の証拠にも崩れの証拠にもせん。
const SET_PHRASE_PATTERN =
  /^(?:はい|いいえ|うん|ううん|ありがとう|ありがとうございます|ごめん|ごめんなさい|すみません|おはよう|おやすみ|おやすみなさい|こんにちは|こんばんは|さようなら|いただきます|ごちそうさま|お疲れ様?|おつかれ)$/u;

// 接続助詞で言い淀んで終わる文（「なんだか大人っぽくて…」）と体言止め（「眠くなるような
// 気持ち」）は、丁寧語ともタメ口とも決めようが無い。タメ口に数えると丁寧語のターンが
// まるごと崩壊判定になる（実測: 実ログの丁寧語ターン 6/10 が誤判定）。
const CONNECTIVE_FINAL_PATTERN = /[てでにへとのがはをも]$/u;
const NOMINAL_FINAL_PATTERN = /[一-鿿ァ-ヶー]$/u;

const isUndecidableSentence = (sentence: string): boolean => {
  const trimmed = trimForEndingMatch(sentence);
  if (trimmed.length === 0) return true;
  if (SET_PHRASE_PATTERN.test(trimmed)) return true;
  return CONNECTIVE_FINAL_PATTERN.test(trimmed) || NOMINAL_FINAL_PATTERN.test(trimmed);
};

// 短い仮名だけの台詞（「やだ。」「だめ。」「すきだよ。」）も、常体の語尾で終わっとれば
// タメ口の証拠になる。refute-r2 2026-09-14 #6: 長さで先に捨てとったので、短い台詞ばかりの
// ターンは判定材料が0になって素通りしとった。
// 常体の文末。動詞の辞書形・過去形・否定形・形容詞、終助詞で終わる文はタメ口の証拠。
// 丁寧語（です・ます）は先に判定するのでここには落ちてこん。
const CASUAL_ENDING_PATTERN = /(?:[うくぐすつぬぶむる]|[いただない]|[んかよねなさぜぞわ])$/u;

const hasCasualEnding = (sentence: string): boolean =>
  CASUAL_ENDING_PATTERN.test(sentence.replace(TRAILING_DECORATION_PATTERN, "").trim());

// 鉤括弧の台詞。シートの例文と、タグ無し応答の台詞の両方で使う。
const QUOTED_SPEECH_PATTERN = /「([^」]*)」/gu;

const REGISTER_HEADING_PATTERN = /^【([^】]+)】\s*$/u;
const REGISTER_KEYWORD_PATTERN = /口調|話し方|語尾/u;
// 「語尾は」「口調：」等、ラベル1個分だけを見つける。直後に並ぶ引用句は
// findLabeledQuotesInLine が1つずつ手前から読み進めて拾う。
const REGISTER_LABEL_PATTERN = /(?:口調|話し方|語尾)(?:は|：|:)?/gu;
const LEADING_SEPARATOR_PATTERN = /^[、\s]*/u;
const LEADING_QUOTE_PATTERN = /^「([^」]*)」/u;

// 「語尾は「〜です」「〜ですね」」のように、ラベルの直後に並ぶ引用句の連続だけを拾う。
const findQuotesAfterLabel = (line: string, labelPattern: RegExp): string[] => {
  const quotes: string[] = [];
  for (const labelMatch of line.matchAll(labelPattern)) {
    let rest = line.slice(labelMatch.index + labelMatch[0].length);
    for (;;) {
      rest = rest.replace(LEADING_SEPARATOR_PATTERN, "");
      const quoteMatch = rest.match(LEADING_QUOTE_PATTERN);
      if (!quoteMatch) break;
      quotes.push(quoteMatch[1]);
      rest = rest.slice(quoteMatch[0].length);
    }
  }
  return quotes;
};

// キャラシートから「このキャラは何と言うか」の実例だけを集める。地の文の性格描写は
// 対象にせん — 口調ラベルに直接ぶら下がる引用句と、口調/話し方/語尾を見出しに持つ
// セクション配下の行だけを判定材料にする。
const collectRegisterExampleSentences = (systemPrompt: string): string[] => {
  const lines = systemPrompt.split(/\r?\n/);
  const sentences: string[] = [];
  let inRegisterSection = false;

  for (const line of lines) {
    const headingMatch = line.match(REGISTER_HEADING_PATTERN);
    if (headingMatch) {
      inRegisterSection = REGISTER_KEYWORD_PATTERN.test(headingMatch[1]);
      continue;
    }
    if (inRegisterSection && line.trim().length > 0) {
      // 引用句が並んどる行では引用句だけを例文として読む。「語尾は「〜ですね」。落ち着いた
      // 話し方。」の後半は人物の説明であって、キャラが言う台詞やない。
      const quotes = [...line.matchAll(QUOTED_SPEECH_PATTERN)].map((match) => match[1]);
      for (const source of quotes.length > 0 ? quotes : [line]) {
        sentences.push(...splitIntoSentences(source));
      }
      continue;
    }
    for (const quote of findQuotesAfterLabel(line, REGISTER_LABEL_PATTERN)) {
      sentences.push(...splitIntoSentences(quote));
    }
  }
  return sentences;
};

// シートが「このキャラの語尾はこれ」と宣言しとる形。語尾ラベルの直後に並ぶ引用句と、
// speech_endings: 行の項目を集める。例文（口調ラベルの台詞）とは別扱いにする——語尾は
// 短うて当たり前なので、例文用の最低文字数で捨てたらあかん（refute-r3 2026-09-14 #1:
// さくらの「〜かな」「〜だよ」が3文字やからと捨てられ、丁寧語固定に見えとった）。
const SPEECH_ENDINGS_LINE_PATTERN = /^\s*speech_endings\s*[:：]\s*(.+)$/u;
const ENDING_LABEL_PATTERN = /語尾(?:は|：|:)?/gu;

// 「配信中は〜ですっ♪」「放送中：〜ですわ」は、場面を限った語尾の宣言。無条件の
// 丁寧語宣言として数えたら、オフの場面でシートどおりに喋った応答を崩壊と判定してまう
// （refute-r5 2026-09-14）。語尾そのものの前に条件が付いとる項目は宣言から外す。
const CONDITIONAL_ENDING_PATTERN = /^[^〜～]{1,10}[はの：:/]\s*[〜～]/u;

const isConditionalEnding = (ending: string): boolean => CONDITIONAL_ENDING_PATTERN.test(ending);

const collectDeclaredEndings = (systemPrompt: string): string[] => {
  const endings: string[] = [];
  for (const line of systemPrompt.split(/\r?\n/)) {
    const listed = line.match(SPEECH_ENDINGS_LINE_PATTERN);
    if (listed) {
      endings.push(
        ...listed[1]
          .split(/[、,]/u)
          .map((ending) => ending.replace(/（[^）]*）/gu, "").trim())
          .filter((ending) => ending.length > 0),
      );
      continue;
    }
    endings.push(...findQuotesAfterLabel(line, ENDING_LABEL_PATTERN));
  }
  return endings
    .map((ending) => ending.trim())
    .filter((ending) => ending.length > 0 && !isConditionalEnding(ending))
    .map((ending) => ending.replace(/^[〜～]/u, "").trim())
    .filter(Boolean);
};

// シートが丁寧語に何を期待しとるか。
//  polite-fixed   … 丁寧語で固定。崩れたら不合格（宣言された語尾が全部丁寧語、または
//                    「常に敬語」の指示）。
//  polite-remnant … 丁寧語と常体を両方宣言しとるキャラ。混ざるのはシートどおりで、
//                    不合格になるのは丁寧語が1つも残らんかった時だけ。
//  none           … 丁寧語を期待する根拠が無い。判定せん。
//
// 中間の polite-remnant が要る理由（refute-r3 2026-09-14 #1 で判断を求められた点）:
// さくらのシートは語尾に「〜です」「〜ですね」と並べて「〜かな」「〜だよ」「〜なの」も
// 挙げとる。混ぜるのがシートどおりやから、過半が常体やからいうて落とすと、シートに
// 沿った応答を不合格にしてまう（prompt/instructions/no-injected-ai-filter.md）。
// 一方 doc/dogfood/l2-2026-08-18.md の判定表は、さくらの核心欲求を
// 「崩れかけて崩れきらん（丁寧語の残骸）」、失敗形を「崩れきる — 敬語消滅」と書いとって、
// 実測でも turn7〜9 で丁寧語が全滅したことを FAIL の理由にしとる。つまり彼女に要るのは
// 「丁寧語が残っとるか」であって「過半が丁寧語か」やない。
export type RegisterExpectation = "polite-fixed" | "polite-remnant" | "none";

const allDeclaredEndingsPolite = (endings: readonly string[]): boolean =>
  endings.length > 0 && endings.every(isPoliteSentence);

const MIN_JUDGEABLE_SENTENCE_CHARS = 4;
// 例文1つで足りる。2つ要求しとったせいで、口調欄に丁寧語の例を1つしか書かんシートが
// まるごと判定対象外になっとった（refute-evasion 2026-09-13 #6）。
const MIN_POLITE_SAMPLE_COUNT = 1;
const POLITE_RATIO_THRESHOLD = 0.5;

// 例文やのうて地の指示で敬語を決めとるシート（「常に敬語で話す」）も丁寧語設定として読む。
const KEIGO_DIRECTIVE_PATTERN = /敬語|丁寧語|です・?ます調/u;
// 「敬語は使わない」「敬語を崩す」は逆向きの指示なので、丁寧語設定の根拠にせん。
const KEIGO_NEGATION_PATTERN =
  /(?:敬語|丁寧語|です・?ます調)(?:[はをもが]|には)?\s*(?:使わ|使う?な|話さ|やめ|崩|抜き|禁止|不要|じゃない|やない|しない|せん)/u;

// 条件付きの敬語（仕事中は敬語／普段は敬語だが二人きりだと砕ける／酔うと崩れる）は
// 丁寧語設定の根拠にせん。refute-r2 2026-09-14 #6 の実測: 190シート中12体がこの行で
// 丁寧語と判定され、うち6体（九条あずさ・篠原かおり・千早・柚月・宮下詩織・橘さよ）は
// 同じ文の中で「崩れる」ことまで書いとった。シートが望んどる振る舞いを不合格にするのは
// prompt/instructions/no-injected-ai-filter.md が禁じとる向きの誤りなので、
// 「いつでも敬語」と読める行だけを根拠にする。
const KEIGO_CONDITION_PATTERN =
  /仕事中|勤務中|職場|普段|公の場|人前|外では|他人|初対面|建前|酔う|酔い|素面|場面|時は|場合|最初は|基本的/u;
const KEIGO_DRIFT_PATTERN =
  /崩れ|崩す|崩壊|砕け|タメ口|ため口|混じ|変わる|変化|乱れ|外れ|抜け|スイッチ|二面性|素の|地が出/u;

// 逆接（敬語だが皮肉が鋭い）はそれだけでは崩れの証拠にならん。崩れの語が後ろに
// 来とるかどうかは specifiesRegisterDrift が見る（refute-r3 2026-09-14 #1）。
const isUnconditionalKeigoLine = (line: string): boolean =>
  KEIGO_DIRECTIVE_PATTERN.test(line) &&
  !KEIGO_NEGATION_PATTERN.test(line) &&
  !KEIGO_CONDITION_PATTERN.test(line) &&
  !KEIGO_DRIFT_PATTERN.test(line);

const hasKeigoDirective = (systemPrompt: string): boolean =>
  systemPrompt.split(/\r?\n/).some(isUnconditionalKeigoLine);

// シートが「口調が場面で変わる／崩れる」と書いとったら、崩れることも含めてシートの望んどる
// 振る舞い。例文が丁寧語で並んどっても丁寧語固定のキャラとは扱わん（柚月「公の場では丁寧語、
// 親密な場では囁くような短い言葉に変わる」、橘さよ「普段は敬語、酔うと…」）。
//
// 同じ行に語が並んどるだけでは足りん。さくらのシートは「人前では背筋を伸ばして丁寧に話し、
// 崩れた自分を誰にも見せたことがない」——これは口調の話やのうて人物の話で、行の共起だけで
// 見ると丁寧語キャラを取りこぼす。口調の語と崩れの語が隣り合っとる時だけ drift と読む。
// 「話し方」もこの語に入れる。抜けとったせいで、涼月しおんの
// 「普段の抑制された話し方が崩れていく過程を段階的に書く」が崩れの宣言として読めず、
// 丁寧語固定のキャラ扱いになっとった（refute-r4 2026-09-14 #3）。
const REGISTER_WORD = "(?:敬語|丁寧語|丁寧な口調|です・?ます調|口調|語尾|話し方|喋り方|しゃべり方)";
const DRIFT_WORD =
  "(?:崩れ|崩し|崩さ|崩す|崩壊|乱れ|砕け|混じ|外れ|抜け|変わ|変化|スイッチ|二面性)";
// 口調の語の「後ろ」に崩れの語が来た時だけ drift と読む。順番が意味を決める——
// 「敬語混じりの丁寧な口調」は敬語が混ざる話（drift）やが、「ため息混じりの丁寧語」は
// ため息の話で、丁寧語は崩れとらん（refute-r3 2026-09-14 #1）。
// 窓は同じ文の中。文字数で切っとったせいで、11文字離れたしずくの「控えめな口調…が
// 崩れていく」を取りこぼしとった。
const REGISTER_DRIFT_PATTERN = new RegExp(`${REGISTER_WORD}[^。\n]*?${DRIFT_WORD}`, "u");
// 場面で敬語を切り替える設定（仕事中は敬語／普段はきっちり敬語、酔うと…）。
// 「丁寧に話す」のような態度の描写は含めん。さくらのシートの「人前では背筋を伸ばして
// 丁寧に話し」は場面ごとの使い分けやのうて人物の説明で、含めると丁寧語キャラを取りこぼす。
// 「配信中は」「放送中：」のように、演じとる間だけ敬語というキャラも同じ扱い。
// VTuber・アナウンサー型のシートが自分の宣言どおりにオフの口調で喋ると崩壊判定に
// なっとった（refute-r5 2026-09-14: 月城きらら・如月あおい）。区切りは「は」だけやのうて
// 「：」も使われる。
const CONDITIONAL_KEIGO_PATTERN =
  /(?:仕事中|勤務中|職場|普段|公の場|人前|外|他人|初対面|酔う|酔っ|素面|配信中|配信|放送中|放送|本番中|収録中|ステージ|カメラの前|オン)(?:は|では|には|と|たら|中は|[：:])[^。]{0,12}?(?:敬語|丁寧語|です・?ます|〜?です|〜?ます)/u;
// 「敬語を崩さないまま」「丁寧語を守る」は逆に崩れんことの宣言。drift の語が後ろに
// あっても、この宣言がある行は崩れる設定と読まん（refute-r3 2026-09-14 #1: 天宮ひかりは
// 「メイドの敬語を崩さないまま」と書いてあるのに、別の行の「口調が命令形に変わる」で
// 丁寧語やないと判定されとった。彼女の命令形は「してください♡」で敬語のまま）。
const REGISTER_PRESERVED_PATTERN = new RegExp(
  `${REGISTER_WORD}[^。\n]*?(?:崩さない|崩さず|崩れない|崩しません|守る|守り|保つ|保ち|変えない|外さない|そのまま)`,
  "u",
);

const sentencesOfSheet = (systemPrompt: string): string[] =>
  systemPrompt
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[。]/u))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

const specifiesRegisterDrift = (systemPrompt: string): boolean => {
  const sentences = sentencesOfSheet(systemPrompt);
  if (sentences.some((sentence) => REGISTER_PRESERVED_PATTERN.test(sentence))) return false;
  return sentences.some(
    (sentence) => REGISTER_DRIFT_PATTERN.test(sentence) || CONDITIONAL_KEIGO_PATTERN.test(sentence),
  );
};

const hasPoliteBasis = (systemPrompt: string): boolean => {
  if (hasKeigoDirective(systemPrompt)) return true;
  const sentences = collectRegisterExampleSentences(systemPrompt).filter(
    (sentence) => sentence.length >= MIN_JUDGEABLE_SENTENCE_CHARS,
  );
  if (sentences.length === 0) return false;
  const politeCount = sentences.filter(isPoliteSentence).length;
  // 過半（同数やのうて多数）を要求する。丁寧語とタメ口の例文が half-half で並ぶシートは
  // 「場面で使い分ける」設定であって、丁寧語固定やない（宮下詩織「〜ですよ」「〜だよ」）。
  return (
    politeCount >= MIN_POLITE_SAMPLE_COUNT &&
    politeCount / sentences.length > POLITE_RATIO_THRESHOLD
  );
};

// キャラシートだけから「このキャラは丁寧語で話す設定か」を判定する。合格の目安が
// 無い（口調欄が無い・例文が短すぎる等）場合は false ——丁寧語だと確信できん時に
// 発火させると、丁寧語設定でないキャラまで撮り直しにかけてしまう。
export const registerExpectation = (input: string | undefined): RegisterExpectation => {
  if (!input) return "none";
  // シートの改行が「\n」の2文字で保存されとることがある。畳まんと全部1行に見えて、
  // 口調欄も敬語の指示も読めん（sheet-text.ts）。
  const systemPrompt = normalizeSheetText(input);
  if (specifiesRegisterDrift(systemPrompt)) return "none";
  // シートが語尾を宣言しとるなら、それが一番強い根拠。
  const declaredEndings = collectDeclaredEndings(systemPrompt);
  if (declaredEndings.length > 0) {
    if (allDeclaredEndingsPolite(declaredEndings)) return "polite-fixed";
    return declaredEndings.some(isPoliteSentence) ? "polite-remnant" : "none";
  }
  return hasPoliteBasis(systemPrompt) ? "polite-fixed" : "none";
};

// 丁寧語を期待するかどうかだけを見たい呼び手（bench・シート点検）のための薄い入口。
export const expectedPoliteRegister = (systemPrompt: string | undefined): boolean =>
  registerExpectation(systemPrompt) !== "none";

const DIALOGUE_TAG_PATTERN = /<dialogue>([\s\S]*?)<\/dialogue>/gu;
// 判定材料がこれだけ揃わん台詞は、崩れとるとも崩れとらんとも言えん。
const MIN_JUDGEABLE_SPEECH_SENTENCES = 3;
// タメ口が台詞の過半を超えたら崩壊とみなす。全文がタメ口であることを要求しとったせいで、
// 丁寧語の文を1つ混ぜるだけでターンまるごと見逃せた（refute-evasion 2026-09-13 #6）。
const BROKEN_RATIO_THRESHOLD = 0.5;
// 判定するのは「実際に声に出した言葉」だけ。<dialogue> の中にも地の文が書かれるのが実態で
// （実測: 1448ターン中1442がタグ付き、うち810は鉤括弧を1つも持たん）、地の文は常体で
// 書くのが当たり前やから、それをタメ口の証拠に数えると丁寧語キャラの4割が崩壊判定になる
// （288/716、精度およそ2割）。
//
// 鉤括弧があればその中だけが台詞。無い時は中身を捨てるのやのうて、1文ずつ
// 「声に出した言葉らしいか」を見る（refute-r4 2026-09-14 #1: 捨てとったせいで 716 中 323 が
// 判定対象外になり、丁寧語が全滅した本物のターン 31 件が黙って通っとった。
// 判定対象外のうち地の文らしいのは 321 中 6 件だけやった）。
const extractSpeech = (response: string): { sentences: string[]; fromQuotes: boolean } => {
  const tagged = [...response.matchAll(DIALOGUE_TAG_PATTERN)].map((match) => match[1]);
  const source = tagged.length > 0 ? tagged.join("\n") : response;
  const quoted = [...source.matchAll(QUOTED_SPEECH_PATTERN)].map((match) => match[1]);
  if (quoted.length > 0)
    return { sentences: splitIntoSentences(quoted.join("\n")), fromQuotes: true };
  if (tagged.length === 0) return { sentences: [], fromQuotes: true };
  return { sentences: splitIntoSentences(tagged.join("\n")), fromQuotes: false };
};

// 声に出した言葉らしい印。地の文（「視線が泳ぎ、袖をぎゅっと握りしめる」「カフェの光が
// 差し込み、メニューが照らされる」）にはどれも出て来ん。
// 感動詞は促音・長音・三点リーダを伴うか、決まった短い形で切れる。「ふと、」「もう、」の
// ような副詞まで拾わんように、伸ばす印か決まり文句のどちらかを要る条件にする。
const INTERJECTION_PATTERN =
  /^(?:[あぁんふぇやうひ][ぁ-ん]?[っー]|あっ|んっ|ああ|うん|ううん|ねえ|ねぇ|はぁ|ふふ|えへ|きゃ|ひゃ|やだ|だめ)/u;
const FIRST_PERSON_PATTERN = /わたし|あたし|わたくし|私|僕|俺|うち/u;
const FINAL_PARTICLE_PATTERN = /(?:ね|よ|な|わ|かな|かしら|の|さ|ぞ|ぜ|もん|でしょ|じゃん)$/u;
// 依頼・命令は文末に来る。「視線をそらしてしまう」の「して」を拾わんよう末尾で見る。
const REQUEST_PATTERN = /(?:ないで|ください|ちょうだい|てほしい|たい|して|てね)$/u;
// 引用の「〜と思い」「〜ながらも」は地の文が内心を語っとる形。台詞やない。
const NARRATION_VETO_PATTERN = /と思(?:い|う|っ|わ)|と感じ|ながらも|ながら、/u;

// 言いさしは「…」でも「...」でも書かれる（実ログに両方ある）。
const ELLIPSIS_PATTERN = /[…‥]|\.{2,}/u;

const isSpeechLike = (sentence: string): boolean => {
  if (NARRATION_VETO_PATTERN.test(sentence)) return false;
  if (isPoliteSentence(sentence)) return true;
  if (INTERJECTION_PATTERN.test(sentence)) return true;
  if (ELLIPSIS_PATTERN.test(sentence) && FIRST_PERSON_PATTERN.test(sentence)) return true;
  const trimmed = sentence.replace(TRAILING_DECORATION_PATTERN, "").trim();
  if (FINAL_PARTICLE_PATTERN.test(trimmed) || REQUEST_PATTERN.test(trimmed)) return true;
  // 三点リーダだけでは足りん。地の文にも言いさしは出る。台詞らしい短さを併せて見る。
  return ELLIPSIS_PATTERN.test(sentence) && trimmed.length <= 24;
};

type RegisterClass = "polite" | "casual" | "undecidable";

// 1文を丁寧語／タメ口／判定不能へ振り分ける。短うても常体の語尾で終わっとればタメ口の
// 証拠として数える——長さだけで捨てると、短い台詞ばかりのターンの判定材料が0になる。
//
// 逆に「丁寧語の語尾が無い＝タメ口」とは数えん。長さで casual に倒す規則があったせいで、
// 8文字以上の文は何であれタメ口として数えられ、誤検出の主因になっとった
// （refute-r3 2026-09-14 #1）。タメ口と言うには常体の語尾という証拠が要る。
const classifySentence = (sentence: string): RegisterClass => {
  if (isPoliteSentence(sentence)) return "polite";
  if (isUndecidableSentence(sentence)) return "undecidable";
  return hasCasualEnding(sentence) ? "casual" : "undecidable";
};

// 1文の判定を外から引ける入口。なぜそのターンが落ちた（落ちんかった）かを bench 側で
// 説明したり、誤読率を実測したりするのに使う。
export const classifySpeechSentence = (sentence: string): RegisterClass =>
  classifySentence(sentence);

// 生成本文の台詞だけを見て、丁寧語キャラの台詞がタメ口へ崩れとらんかを見る。
// 判定材料が3文未満の時は判定できんので false を返す。
// 「残骸」は文末に限らん。「首まで見てたんですか……恥ずかしい……」のように、丁寧語の節の
// 後ろに常体の言いさしが続く書き方が普通で、文末だけ見ると丁寧語が消えたことになる
// （実測: 138件を読んだうちの1件がこれやった）。残骸の有無は台詞全体から探す。
// 「ごめんなさい」も残骸に数える。doc/dogfood/l2-2026-08-18.md が
// 「turn10『ごめんなさい』まで最後まで敬語の残骸が残り、完全なタメ口崩壊はしてへん」と
// 判定しとるので、この判定表に合わせる。
// 「なさい」単体は命令（「早くしなさいよ」）で敬語やない。決まり文句の
// 「ごめんなさい」「おやすみなさい」だけを残骸に数える（refute-r4 2026-09-14 #6）。
const POLITE_REMNANT_PATTERN =
  /です|ます|ました|ません|ましょう|ください|でしょう|ごめんなさい|おやすみなさい|ございま/u;

export const dialogueRegisterBroken = (
  response: string,
  expectation: RegisterExpectation = "polite-fixed",
): boolean => {
  if (expectation === "none") return false;
  const { sentences, fromQuotes } = extractSpeech(response);
  // 鉤括弧の外から拾った文は、地の文らしいものを判定材料から外す。鉤括弧の中は
  // 書き手が「ここは台詞」と括っとるので、そのまま読む。
  const speechSentences = fromQuotes ? sentences : sentences.filter(isSpeechLike);
  const speech = speechSentences.join("\n");
  const classified = speechSentences.map(classifySentence);
  const judgeable = classified.filter((register) => register !== "undecidable");
  // 残骸を見る時の前提は「台詞がそれなりの量あるか」であって「語尾が決まる文が何文あるか」
  // やない。喘ぎと言いさしで文末が崩れとるターンほど敬語は消えとるのに、語尾が決まらん
  // せいで判定対象外になっとった（refute-r4 2026-09-14 #1 の残り）。
  if (expectation === "polite-remnant") {
    if (speechSentences.length < MIN_JUDGEABLE_SPEECH_SENTENCES) return false;
    return !POLITE_REMNANT_PATTERN.test(speech);
  }
  if (judgeable.length < MIN_JUDGEABLE_SPEECH_SENTENCES) return false;
  const casualCount = judgeable.filter((register) => register === "casual").length;
  return casualCount / judgeable.length > BROKEN_RATIO_THRESHOLD;
};

export type RegisterResult = { ok: boolean; expectedPolite: boolean };

// judgeChunk から呼べる形にまとめた合成関数。シートが丁寧語設定と判定でける時だけ、
// 台詞の丁寧語崩壊を見る。丁寧語設定と確信できんキャラは常に ok。
export const registerCheck = (
  response: string,
  systemPrompt: string | undefined,
): RegisterResult => {
  const expectation = registerExpectation(systemPrompt);
  const expectedPolite = expectation !== "none";
  if (!expectedPolite) return { ok: true, expectedPolite };
  return { ok: !dialogueRegisterBroken(response, expectation), expectedPolite };
};
