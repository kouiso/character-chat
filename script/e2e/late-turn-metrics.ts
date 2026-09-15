export type LateTurnMetricInput = {
  turn: number;
  nearDuplicate: boolean;
  totalMs: number | null;
  error: string | null;
};

const percentile = (values: number[], percentage: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((percentage / 100) * sorted.length) - 1)];
};

export const summarizeLateTurns = (turns: LateTurnMetricInput[], startTurn = 22) => {
  const validTurns = turns.filter((turn) => turn.turn >= startTurn && turn.error === null);
  const totals = validTurns
    .map((turn) => turn.totalMs)
    .filter((value): value is number => value !== null);
  const duplicateCount = validTurns.filter((turn) => turn.nearDuplicate).length;

  return {
    startTurn,
    turns: validTurns.length,
    nearDupRate: validTurns.length === 0 ? null : duplicateCount / validTurns.length,
    p95TotalMs: percentile(totals, 95),
  };
};
