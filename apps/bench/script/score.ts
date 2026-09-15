/* eslint-disable no-console -- ベンチの出力そのもの。数字を標準出力に出すのがこの台の役目や */
import { DEFAULT_LOG, type TurnRecord } from "../src/lib/bench.ts";
import { parseArgs } from "../src/lib/config.ts";
import { formatScore, groupRuns, scoreRun } from "../src/lib/score.ts";
import { readJsonl } from "../src/lib/store.ts";

// GET /score の中身。JSONL を読んで run ごとに機械7軸を並べるだけ。
const args = parseArgs(process.argv.slice(2));
const records = readJsonl<TurnRecord>(args.log ?? DEFAULT_LOG);
const groups = groupRuns(records);
if (groups.size === 0) {
  console.log("記録が無い。先に script/run.ts を回して。");
  process.exit(0);
}
for (const [, rows] of groups) {
  if (args.run && rows[0]?.runId !== args.run) continue;
  console.log(formatScore(scoreRun(rows)));
  console.log("");
}
