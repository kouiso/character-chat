// script-run の打ち切り・締切・出力先の決め方。CLI 本体（script-run.ts）から切り出して
// vitest で単体に当てる（本体は wrangler を起こすので import が重い）。

// 1 キャラの生成合計がこれを超えたら次のターンへ進まん（CI の実モデルで無限に金を使わんため）。
export const MAX_TOTAL_GENERATION_MS = 15 * 60 * 1000;

// 1 ターンの締切。engine の既定（DEFAULT_TURN_TIMEOUT_MS）と同じ値やが、runner は残り予算との
// 小さい方を明示的に渡す（2026-09-04 v2 arm: 予算はターンの間でしか見とらんかったので、
// Sakura t6 が 1 ターンで 63 分使い、CI の 90 分がそこで尽きた）。
export const TURN_TIMEOUT_MS = 120_000;

// 同じ日に同じ arm・run を回し直した時に、前の run のファイルと混ざらんように runId を入れる
// （2026-09-04-v2-1 に CI 24313278 と 89426095 の 2 本が同居した）。
export const outputDirName = (parts: {
  date: string;
  arm: string;
  run: string;
  runId: string;
}): string => `${parts.date}-${parts.arm}-${parts.run}-${parts.runId}`;

// 今のターンに渡す締切。キャラの残り予算が 120 秒を切っとったら残り分だけ。
export const turnTimeoutMs = (
  totalGenerationMs: number,
  budgetMs = MAX_TOTAL_GENERATION_MS,
  perTurnMs = TURN_TIMEOUT_MS,
): number => Math.max(1, Math.min(perTurnMs, budgetMs - totalGenerationMs));

export type TurnEnding = "ok" | "chars" | "deadline";

// ターンが終わった後にキャラを打ち切るか。締切で切れたら即（モデルが同じ文を延々と繰り返す
// 状態で、次のターンも同じ 2 分を捨てる）。字数上限は 2 ターン続いたら（1 回は長めの本文の
// 範囲やが、2 回続くと max_tokens を無視して回っとる）。
export const stopReasonAfter = (endings: readonly TurnEnding[]): string | null => {
  const last = endings[endings.length - 1];
  if (last === "deadline") return `turn ended by the ${TURN_TIMEOUT_MS}ms deadline (deadline)`;
  const previous = endings[endings.length - 2];
  if (last === "chars" && previous === "chars") {
    return "two consecutive turns hit the streamed-char cap (chars, chars)";
  }
  return null;
};
