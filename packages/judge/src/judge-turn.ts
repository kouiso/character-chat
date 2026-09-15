import { climaxMomentCheck, type ScenePhaseLike } from "./climax-moment-check";
import { emptyCheck } from "./empty-check";
import { forbiddenWordCheck } from "./forbidden-word-check";
import { nameIdentityCheck, type NameIdentityOptions } from "./name-identity-check";
import { reactionRepetitionCheck } from "./reaction-repetition-check";
import { registerCheck } from "./register-check";
import { stemRepetitionCheck } from "./stem-repetition-check";

// ターン単位の判定入口。6つの check は全て「1ターン分の本文」を見る前提の閾値
// （語幹5回・小道具4回・部位×反応3回・台詞3文）を持っとるのに、judgeChunk は
// <action>/<dialogue>/<inner> のブロック単位でしか呼べん。ブロックに割ると症状が
// 閾値に届かんまま消えるので、組み立て済みのターンへまとめて当てる入口を別に持つ
// （refute-evasion 2026-09-13 §0b）。
//
// NEVER ここを生成のリトライ経路へ繋がん。ターン単位で不合格を返すとターン全体の
// 再生成になり、絶頂ターンのように複数 check が同時に落ちる場面で再生成が止まらんくなる
// （同 §0b の regen storm）。再生成の方針は別の判断として立てる。ここは bench と
// ブラインド判定が「このターンに何が出とるか」を記録するための読み取り専用の入口。

export type JudgeTurnCheckName =
  | "empty-response"
  | "forbidden-word"
  | "stem-repetition"
  | "reaction-repetition"
  | "climax-moment"
  | "register"
  | "name-identity";

export type JudgeTurnFailure = {
  check: JudgeTurnCheckName;
  // 人が読んで所在が分かる証拠（ヒットした語・語幹・部位×反応クラス等）。
  evidence: string;
};

export type JudgeTurnResult = {
  ok: boolean;
  failures: JudgeTurnFailure[];
};

export type JudgeTurnOptions = {
  // name-identity だけは判定対象がユーザーの直前発言なので、呼び手が渡した時だけ走らせる。
  userText?: string;
  characterName?: string;
  nameIdentity?: NameIdentityOptions;
};

const responseFailures = (
  turnText: string,
  systemPrompt: string | undefined,
  phase: ScenePhaseLike,
): JudgeTurnFailure[] => {
  const forbidden = forbiddenWordCheck(turnText, systemPrompt);
  const stem = stemRepetitionCheck(turnText);
  const reaction = reactionRepetitionCheck(turnText);
  const climax = climaxMomentCheck(turnText, phase);
  const register = registerCheck(turnText, systemPrompt);
  const candidates: readonly (readonly [boolean, JudgeTurnFailure])[] = [
    [
      forbidden.ok,
      {
        check: "forbidden-word",
        evidence: `${forbidden.matchedWord ?? ""}（本文: ${forbidden.matched ?? ""}）`,
      },
    ],
    [stem.ok, { check: "stem-repetition", evidence: `${stem.category}: ${stem.stem}` }],
    [reaction.ok, { check: "reaction-repetition", evidence: reaction.repeatedKey ?? "" }],
    [climax.ok, { check: "climax-moment", evidence: "climaxの地の文に達する瞬間が無い" }],
    [register.ok, { check: "register", evidence: "丁寧語設定の台詞がタメ口へ崩れとる" }],
  ];
  return candidates.filter(([ok]) => !ok).map(([, failure]) => failure);
};

const nameIdentityFailures = (options: JudgeTurnOptions): JudgeTurnFailure[] => {
  const { userText, characterName } = options;
  if (userText === undefined) return [];
  // 黙って飛ばさん。userText を渡したのに characterName が無いのは呼び手の設定漏れで、
  // そのまま走らせると「name-identity を見た」と読める結果が返る（refute-r2 2026-09-14）。
  if (characterName === undefined || characterName.trim().length === 0) {
    throw new Error("judgeTurn: userText を渡す時は characterName も要る");
  }
  const result = nameIdentityCheck(userText, characterName, options.nameIdentity ?? {});
  if (!result.shouldRemind) return [];
  return [{ check: "name-identity", evidence: result.wrongName ?? "" }];
};

export const judgeTurn = (
  turnText: string,
  systemPrompt: string | undefined,
  phase: ScenePhaseLike,
  options: JudgeTurnOptions = {},
): JudgeTurnResult => {
  // 空のターンは「中身が無い」という1つの事実で、他の check の不合格は全部その言い換えに
  // なる。climax フェーズの空ターンを「絶頂の瞬間が書かれとらん」と報告しても直す先が
  // 分からんので、空は空として返す（refute-r2 2026-09-14 の判断待ち2件のうち1件）。
  if (!emptyCheck(turnText).ok) {
    return { ok: false, failures: [{ check: "empty-response", evidence: "本文が空" }] };
  }
  const failures = [
    ...responseFailures(turnText, systemPrompt, phase),
    ...nameIdentityFailures(options),
  ];
  return { ok: failures.length === 0, failures };
};
