/* eslint-disable no-console -- ベンチの出力そのもの。数字を標準出力に出すのがこの台の役目や */
import { runScenario } from "../src/lib/bench.ts";
import { defaultConfig, parseArgs, runId } from "../src/lib/config.ts";
import { probeFirstToken } from "../src/lib/openrouter.ts";
import { buildMessages } from "../src/lib/prompt.ts";
import { loadReplayScenario } from "../src/lib/scenario.ts";
import { scoreRun } from "../src/lib/score.ts";

// P3: 死因の容疑者を狙い撃ちで再現する。
//   容疑者A: first-token 8秒打ち切り (functions/api/[[route]].ts:460)
//   容疑者B: max_tokens の枯渇 (402 での引き下げ = 同 L1960 parseAffordableMaxTokens)
//   容疑者C: XML パーサの剥がし損ね
const args = parseArgs(process.argv.slice(2));
const scenario = loadReplayScenario(args.conversation ?? "a032de1c-1e7c-4fb1-9ea0-6ade327df01d");
const which = args.suspect ?? "all";
const FIRST_TOKEN_TIMEOUT_MS = 8_000; // 既存実装の値

// 空返信の原因を握り潰さん。ここが分からんと撃てん
function reportProbeFailure(
  index: number,
  probe: { httpStatus: number; error: string | null },
): number {
  console.log(`    失敗 #${index}: HTTP ${probe.httpStatus} ${probe.error}`);
  return 1;
}

async function probeModel(
  model: string,
  samples: number,
  realHistory: ChatMessage[],
): Promise<{ failures: number; max: string; over: number }> {
  const times: number[] = [];
  let failures = 0;
  for (let i = 0; i < samples; i += 1) {
    const config = defaultConfig(scenario.characterPrompt, { model });
    const probe = await probeFirstToken({
      model,
      messages: buildMessages(config, [
        { role: "assistant", content: scenario.greeting },
        {
          role: "user",
          content: scenario.userTurns[i % scenario.userTurns.length],
        },
        ...realHistory,
      ]),
      maxTokens: config.maxTokens,
    });
    if (probe.firstTokenMs === null) failures += reportProbeFailure(i, probe);
    else times.push(probe.firstTokenMs);
  }
  return {
    failures,
    max: times.length > 0 ? Math.max(...times).toFixed(0) : "-",
    over: times.filter((t) => t > FIRST_TOKEN_TIMEOUT_MS).length,
  };
}

if (which === "all" || which === "first-token") {
  const models = (
    args.models ?? "deepseek/deepseek-chat,qwen/qwen-2.5-72b-instruct,sao10k/l3.3-euryale-70b"
  ).split(",");
  const samples = Number(args.samples ?? 3);
  console.log(`## 容疑者A: first-token ${FIRST_TOKEN_TIMEOUT_MS}ms 打ち切り`);
  for (const model of models) {
    const result = await probeModel(model, samples, realHistory);
    console.log(
      `  ${model}: n=${samples} 失敗${result.failures} 最遅${result.max}ms 8秒超え${result.over}件`,
    );
  }
  console.log("");
}

if (which === "all" || which === "max-tokens") {
  console.log("## 容疑者B: max_tokens の枯渇");
  for (const maxTokens of [64, 128, 512, 3072]) {
    const records = await runScenario({
      config: defaultConfig(scenario.characterPrompt, { maxTokens }),
      scenarioId: scenario.id,
      greeting: scenario.greeting,
      userTurns: scenario.userTurns,
      turns: Number(args.turns ?? 4),
      runId: runId(`p3-mt${maxTokens}`),
    });
    const s = scoreRun(records);
    console.log(
      `  max_tokens=${String(maxTokens).padStart(4)}  median ${s.medianChars ?? "-"}字  空 ${s.emptyCount}/${s.turns}  打ち切り(finish=length) ${s.truncatedByMaxTokens}/${s.turns}`,
    );
  }
  console.log("");
}

if (which === "all" || which === "tag-leak") {
  console.log("## 容疑者C: XML の剥がし損ね");
  for (const [label, xml, strip] of [
    ["タグ要求せず", false, false],
    ["タグ要求・剥がさず", true, false],
    ["タグ要求・剥がす", true, true],
  ] as const) {
    const records = await runScenario({
      config: defaultConfig(scenario.characterPrompt, {
        useXmlEnvelope: xml,
        stripTags: strip,
      }),
      scenarioId: scenario.id,
      greeting: scenario.greeting,
      userTurns: scenario.userTurns,
      turns: Number(args.turns ?? 4),
      runId: runId(`p3-tag`),
    });
    const s = scoreRun(records);
    console.log(
      `  ${label.padEnd(20, "　")}  タグ漏れ ${s.tagLeakMessages}/${s.turns}  median ${s.medianChars ?? "-"}字`,
    );
  }
}
