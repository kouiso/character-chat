/* eslint-disable no-console -- ベンチの出力そのもの。数字を標準出力に出すのがこの台の役目や */
import { parseArgs } from "../src/lib/config.ts";
import { recordEndOfRun, recordUtterance, summarizeFeedback } from "../src/lib/feedback.ts";

// P5 の CLI。押す先は「会話の終わりに1回」に絞ってある。任意👍はおまけ。
const args = parseArgs(process.argv.slice(2));

if (args.summary === "1" || Object.keys(args).length === 0) {
  console.log(summarizeFeedback());
  process.exit(0);
}
if (!args.run) {
  console.error("--run=<runId> が要る。script/score.ts で runId を確かめて。");
  process.exit(1);
}
if (args.turn !== undefined) {
  const r = recordUtterance({
    runId: args.run,
    turnIndex: Number(args.turn),
    vote: args.vote === "down" ? "down" : "up",
    note: args.note,
  });
  console.log("記録した:", r);
} else {
  const r = recordEndOfRun({
    runId: args.run,
    came: args.came === "1",
    wouldContinue: args.continue === "1",
    note: args.note,
  });
  console.log("記録した:", r);
}
