/**
 * matrix アームの実測 json から、UI の 4 段が実際に 4 段になっとるかを表にする。
 *
 * 手で python を書いて数えると毎回違う数え方になる（2026-08-18 に実際に中央値を
 * 2 回間違えた）。数え方をここへ固定して、アームが変わっても同じ物差しで比べる。
 *
 *   pnpm exec tsx script/verify/matrix-report.ts <アームのディレクトリ> [...]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export type MatrixCell = {
  character: string;
  phase: string;
  responseLength: string;
  energy: string;
  visibleChars: number;
  latencyMs: number;
  servedModel: string;
  error: string | null;
};

const FILE_PATTERN =
  /^(?<character>[^-]+)-(?<index>\d+)-matrix-(?<phase>[a-z]+)-(?<length>short|medium|long|very_long)-(?<energy>short|long)-/;

export const LENGTH_ORDER = ["short", "medium", "long", "very_long"] as const;

/** ファイル名から (キャラ, 番号) → 段・段の熱量 を引く。json 側にこの 3 つが無い。 */
export const indexCellsByFilename = (files: string[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const file of files) {
    const groups = FILE_PATTERN.exec(basename(file))?.groups;
    if (!groups) continue;
    map.set(`${groups.character}#${Number(groups.index)}`, [
      groups.phase,
      groups.length,
      groups.energy,
    ]);
  }
  return map;
};

export const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // 偶数個は 2 つの平均。ここを片側だけ取ると n=2 の比較が嘘になる。
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

export const isStrictlyIncreasing = (values: (number | undefined)[]): boolean =>
  values.every((value) => value !== undefined) &&
  values.every((value, i) => i === 0 || (value ?? 0) > (values[i - 1] ?? 0));

export const readArm = (dir: string): MatrixCell[] => {
  const files = readdirSync(dir);
  const summary = files.find((f) => f.startsWith("summary-matrix-") && f.endsWith(".json"));
  if (!summary) throw new Error(`no matrix summary in ${dir}`);
  const byIndex = indexCellsByFilename(files);
  const parsed: unknown = JSON.parse(readFileSync(resolve(dir, summary), "utf8"));
  const results = (parsed as { results: { character: string; records: Record<string, never>[] }[] })
    .results;
  const cells: MatrixCell[] = [];
  for (const group of results) {
    for (const record of group.records) {
      const raw = record as unknown as {
        index: number;
        visibleChars: number;
        latencyMs: number;
        servedModel: string | null;
        error: string | null;
      };
      const dims = byIndex.get(`${group.character}#${raw.index}`);
      if (!dims) continue;
      cells.push({
        character: group.character,
        phase: dims[0],
        responseLength: dims[1],
        energy: dims[2],
        visibleChars: raw.visibleChars,
        latencyMs: raw.latencyMs,
        servedModel: raw.servedModel ?? "(none)",
        error: raw.error,
      });
    }
  }
  return cells;
};

const report = (dir: string): void => {
  const cells = readArm(dir);
  console.log(`\n===== ${basename(dir)} (${cells.length} セル) =====`);

  const byModel = new Map<string, number[]>();
  for (const cell of cells) {
    byModel.set(cell.servedModel, [...(byModel.get(cell.servedModel) ?? []), cell.visibleChars]);
  }
  console.log("\n-- 実際に答えたモデル --");
  console.log("model                      n  median   min   max  <300");
  for (const [model, values] of [...byModel].sort()) {
    const short = values.filter((v) => v < 300).length;
    console.log(
      `${model.split("/").pop()?.padEnd(24)} ${String(values.length).padStart(3)} ` +
        `${String(median(values)).padStart(7)} ${String(Math.min(...values)).padStart(5)} ` +
        `${String(Math.max(...values)).padStart(5)} ${String(short).padStart(5)}`,
    );
  }

  console.log("\n-- 段ごとの分布（1 セル 1 標本では揺れが大きすぎるので、段でまとめて見る） --");
  console.log("length        n  median   p25   p75   min   max");
  for (const length of LENGTH_ORDER) {
    const values = cells.filter((c) => c.responseLength === length).map((c) => c.visibleChars);
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const at = (ratio: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
    console.log(
      `${length.padEnd(11)} ${String(values.length).padStart(3)} ${String(median(values)).padStart(7)} ` +
        `${String(at(0.25)).padStart(5)} ${String(at(0.75)).padStart(5)} ` +
        `${String(sorted[0]).padStart(5)} ${String(sorted[sorted.length - 1]).padStart(5)}`,
    );
  }
  const tierMedians = LENGTH_ORDER.map((length) =>
    median(cells.filter((c) => c.responseLength === length).map((c) => c.visibleChars)),
  );
  console.log(
    `段の中央値が狭義単調か: ${isStrictlyIncreasing(tierMedians) ? "OK" : "NG"} [${tierMedians.join(", ")}]`,
  );

  console.log("\n-- 4 段が 4 段になっとるか（行ごと・1 標本） --");
  const rows: string[] = [];
  let monotonic = 0;
  let total = 0;
  const characters = [...new Set(cells.map((c) => c.character))];
  const phases = [...new Set(cells.map((c) => c.phase))];
  for (const character of characters) {
    for (const phase of phases) {
      for (const energy of ["short", "long"]) {
        const values = LENGTH_ORDER.map(
          (length) =>
            cells.find(
              (c) =>
                c.character === character &&
                c.phase === phase &&
                c.energy === energy &&
                c.responseLength === length,
            )?.visibleChars,
        );
        if (values.every((v) => v === undefined)) continue;
        total += 1;
        const ok = isStrictlyIncreasing(values);
        if (ok) monotonic += 1;
        rows.push(
          `${ok ? "OK" : "NG"} ${character.padEnd(7)} ${phase.padEnd(12)} ${energy.padEnd(5)} ` +
            `[${values.map((v) => String(v ?? "-").padStart(5)).join(",")}]`,
        );
      }
    }
  }
  console.log(rows.join("\n"));
  console.log(`\n狭義単調な行: ${monotonic}/${total}`);

  const failures = cells.filter((c) => c.error);
  console.log(`\n-- エラー ${failures.length} 件 --`);
  for (const cell of failures) {
    console.log(
      `  ${cell.character} ${cell.phase}/${cell.responseLength}/${cell.energy} ` +
        `visible=${cell.visibleChars} ${cell.latencyMs}ms ${cell.error}`,
    );
  }

  const latencies = cells.map((c) => c.latencyMs);
  console.log(
    `\n-- 遅延 -- median ${median(latencies)}ms  max ${Math.max(...latencies)}ms  ` +
      `70秒超 ${latencies.filter((l) => l > 70_000).length} 件`,
  );
};

const isMain = process.argv[1]?.endsWith("matrix-report.ts");
if (isMain) {
  const dirs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (dirs.length === 0) {
    console.error("usage: tsx script/verify/matrix-report.ts <arm-dir> [...]");
    process.exit(1);
  }
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.error(`missing: ${dir}`);
      process.exit(1);
    }
    report(dir);
  }
}
