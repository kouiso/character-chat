/* eslint-disable no-console -- ベンチの出力そのもの。数字を標準出力に出すのがこの台の役目や */
import { runScenario } from "../src/lib/bench.ts";
import { defaultConfig, parseArgs, runId } from "../src/lib/config.ts";
import { loadReplayScenario, listReplayCandidates } from "../src/lib/scenario.ts";
import { formatScore, scoreRun } from "../src/lib/score.ts";

// P2: 同じシナリオを N ターン自動で回す。尻すぼみの再現はここで初めて可能になる。
const args = parseArgs(process.argv.slice(2));
if (args.list === "1") {
  for (const c of listReplayCandidates()) console.log(c);
  process.exit(0);
}
const conversationId = args.conversation ?? "a032de1c-1e7c-4fb1-9ea0-6ade327df01d";
const turns = Number(args.turns ?? 20);
const scenario = loadReplayScenario(conversationId);
const id = runId(args.tag ?? "run");

console.log(
  `[${id}] ${scenario.characterName} / ${scenario.id} / ${turns}ターン / model=${args.model ?? process.env.BENCH_MODEL ?? "既定"}`,
);
const records = await runScenario({
  config: defaultConfig(scenario.characterPrompt, {
    model: args.model ?? undefined,
    responseLength: args.length ? Number(args.length) : undefined,
    maxTokens: args.maxTokens ? Number(args.maxTokens) : undefined,
    useXmlEnvelope: args.xml === "1",
    stripTags: args.strip === "1",
  }),
  scenarioId: scenario.id,
  greeting: scenario.greeting,
  userTurns: scenario.userTurns,
  turns,
  runId: id,
  onTurn: (r) =>
    console.log(
      `  t${String(r.turnIndex).padStart(2, "0")} ${String(r.metric.charCount).padStart(4)}字 ${String(r.latencyMs).padStart(6)}ms finish=${r.finishReason ?? "-"}${r.ok ? "" : ` ERR ${r.httpStatus}`}`,
    ),
});
console.log("");
console.log(formatScore(scoreRun(records)));
