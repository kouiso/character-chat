// RIT-98 週次網: 記憶試験の実行結果を初回の基準値と比べ、下回ったら非0終了で知らせる。
// 実行ログには pnpm や wrangler の行が混ざるので、行頭が { の行以降を JSON として拾う。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASELINE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../baseline/memory-weekly.json",
);

type Baseline = {
  recordedAt: string;
  recall: Record<string, number>;
  adversarial: { checks: string; sabotageCaught: string };
};

const extractJson = (text: string): unknown => {
  const start = text.search(/^{/m);
  if (start < 0) throw new Error("実行結果に JSON が見つかりません。");
  return JSON.parse(text.slice(start));
};

const ratio = (value: unknown, arm: string): number => {
  const ratioValue = (value as Record<string, { ratio?: number }>)[arm]?.ratio;
  if (typeof ratioValue !== "number" || !Number.isFinite(ratioValue))
    throw new Error(`実行結果に ${arm} アームの正答率がありません。`);
  return ratioValue;
};

const totals = (value: unknown, key: "checks" | "sabotageCaught"): string => {
  const text = (value as { totals?: Record<string, string> }).totals?.[key];
  if (typeof text !== "string") throw new Error(`実行結果に ${key} の件数がありません。`);
  return text;
};

export const compareBaseline = (
  baseline: Baseline,
  recallResult: unknown,
  adversarialResult: unknown,
): { ok: boolean; regressions: string[]; arms: Record<string, { base: number; now: number }> } => {
  const regressions: string[] = [];
  const arms: Record<string, { base: number; now: number }> = {};
  for (const [arm, base] of Object.entries(baseline.recall)) {
    const nowRatio = ratio(recallResult, arm);
    arms[arm] = { base, now: nowRatio };
    if (nowRatio < base) regressions.push(`recall:${arm} ${base} → ${nowRatio}`);
  }
  for (const key of ["checks", "sabotageCaught"] as const) {
    const nowCount = totals(adversarialResult, key);
    const base = baseline.adversarial[key];
    if (nowCount !== base) regressions.push(`adversarial:${key} ${base} → ${nowCount}`);
  }
  return { ok: regressions.length === 0, regressions, arms };
};

const readArg = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const recallPath = readArg(args, "--recall");
  const adversarialPath = readArg(args, "--adversarial");
  if (!recallPath || !adversarialPath) {
    console.error(
      "usage: compare-baseline --recall <file> --adversarial <file> [--baseline <file>]",
    );
    process.exit(2);
  }
  const baselinePath = readArg(args, "--baseline") ?? DEFAULT_BASELINE;
  const report = compareBaseline(
    JSON.parse(readFileSync(baselinePath, "utf8")),
    extractJson(readFileSync(recallPath, "utf8")),
    extractJson(readFileSync(adversarialPath, "utf8")),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}
