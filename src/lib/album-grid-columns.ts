// 同一セクション内のタイルを空セル無く敷き詰めるため、最適な列数を返す。
// 最大 3 列、かつ最終行の空きを最小化する。
export const albumGridColumns = (count: number): number => {
  if (count <= 1) return 1;
  if (count >= 2 && count <= 3) return count;

  const remainder3 = count % 3;
  const remainder2 = count % 2;

  const empties3 = remainder3 === 0 ? 0 : 3 - remainder3;
  const empties2 = remainder2 === 0 ? 0 : 2 - remainder2;

  if (empties3 === 0) return 3;
  if (empties2 === 0) return 2;
  // どちらも空きが出るなら、少ない方。同数なら幅を有効活用できる 3 列を維持する。
  return empties3 <= empties2 ? 3 : 2;
};
