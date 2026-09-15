import { findCrossTurnRepetitionMatch, findNearDuplicateMatch } from "./quality-guard";

export type LongConversationEvalTurn = {
  assistant: string;
  latencyMs: number;
};

export type LongConversationEvalResult = {
  turnCount: number;
  repetitionLoopOccurrences: number;
  repeatedTurnIndexes: number[];
  p95LatencyMs: number;
};

const percentile = (values: number[], quantile: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
};

export const evaluateLongConversation = (
  turns: LongConversationEvalTurn[],
): LongConversationEvalResult => {
  const previous: string[] = [];
  const repeatedTurnIndexes: number[] = [];

  turns.forEach((turn, index) => {
    const nearDuplicate = findNearDuplicateMatch(turn.assistant, previous);
    const phraseLoop = findCrossTurnRepetitionMatch(turn.assistant, undefined, previous);
    if (nearDuplicate.isDuplicate || phraseLoop.isDuplicate) repeatedTurnIndexes.push(index + 1);
    previous.push(turn.assistant);
  });

  return {
    turnCount: turns.length,
    repetitionLoopOccurrences: repeatedTurnIndexes.length,
    repeatedTurnIndexes,
    p95LatencyMs: percentile(
      turns.map((turn) => turn.latencyMs),
      0.95,
    ),
  };
};
