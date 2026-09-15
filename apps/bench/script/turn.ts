/* eslint-disable no-console -- ベンチの出力そのもの。数字を標準出力に出すのがこの台の役目や */
import { runTurn } from "../src/lib/bench.ts";
import { defaultConfig, parseArgs, runId } from "../src/lib/config.ts";
import { loadReplayScenario } from "../src/lib/scenario.ts";

// P1: 会話を1ターンだけ進める。プロンプト組み立て＋履歴が入っとることを確かめる最小の口。
const args = parseArgs(process.argv.slice(2));
const conversationId = args.conversation ?? "a032de1c-1e7c-4fb1-9ea0-6ade327df01d";
const scenario = loadReplayScenario(conversationId);
const userText = args.text ?? scenario.userTurns[0];

const record = await runTurn({
  config: defaultConfig(scenario.characterPrompt, {
    model: args.model ?? undefined,
    responseLength: args.length ? Number(args.length) : undefined,
    maxTokens: args.maxTokens ? Number(args.maxTokens) : undefined,
    useXmlEnvelope: args.xml === "1",
    stripTags: args.strip === "1",
  }),
  history: scenario.greeting ? [{ role: "assistant", content: scenario.greeting }] : [],
  userText,
  runId: runId("turn"),
  scenarioId: scenario.id,
  turnIndex: 0,
});

console.log(
  `キャラ: ${scenario.characterName}  モデル: ${record.model} (served: ${record.servedModel})`,
);
console.log(`user> ${userText}`);
console.log(`assistant> ${record.reply || "(空)"}`);
console.log(
  `[${record.metric.charCount}字 / 指定${record.responseLength}字 latency=${record.latencyMs}ms finish=${record.finishReason} tok=${record.completionTokens} tag漏れ=${record.metric.leakedTags.length} AI臭=${record.metric.aiSmellHits.length}]`,
);
if (!record.ok) console.error(`失敗: HTTP ${record.httpStatus} ${record.error}`);
