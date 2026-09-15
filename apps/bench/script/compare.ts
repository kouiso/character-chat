/* eslint-disable no-console -- ベンチの出力そのもの。数字を標準出力に出すのがこの台の役目や */
import { runScenario, type TurnRecord } from "../src/lib/bench.ts";
import { defaultConfig, parseArgs, runId } from "../src/lib/config.ts";
import { loadReplayScenario } from "../src/lib/scenario.ts";
import { formatScore, scoreRun, type Score } from "../src/lib/score.ts";

// P4: 同一シナリオ・同一プロンプトで条件だけ変えて並べる。
// ここでは機械7軸しか見ん。主観の「抜けたか」は P5 の人間1軸に持ち越す。

type Condition = {
  label: string;
  model?: string;
  responseLength?: number;
  maxTokens?: number;
  useXmlEnvelope?: boolean;
  stripTags?: boolean;
  frequencyPenalty?: number;
  presencePenalty?: number;
  temperature?: number;
};

const args = parseArgs(process.argv.slice(2));
const turns = Number(args.turns ?? 8);
const conversationId = args.conversation ?? "a032de1c-1e7c-4fb1-9ea0-6ade327df01d";
const scenario = loadReplayScenario(conversationId);

const conditions: Condition[] = args.conditions
  ? (JSON.parse(args.conditions) as Condition[])
  : [
      { label: "len200", responseLength: 200 },
      { label: "len400", responseLength: 400 },
      { label: "len800", responseLength: 800 },
    ];

const results: Array<{ label: string; score: Score; records: TurnRecord[] }> = [];
for (const c of conditions) {
  const id = runId(`p4-${c.label}`);
  process.stderr.write(`[${id}] ${c.label} を ${turns} ターン回す\n`);
  const records = await runScenario({
    config: defaultConfig(scenario.characterPrompt, {
      model: c.model,
      responseLength: c.responseLength,
      maxTokens: c.maxTokens,
      frequencyPenalty: c.frequencyPenalty,
      presencePenalty: c.presencePenalty,
      temperature: c.temperature,
      useXmlEnvelope: c.useXmlEnvelope ?? false,
      stripTags: c.stripTags ?? false,
    }),
    scenarioId: scenario.id,
    greeting: scenario.greeting,
    userTurns: scenario.userTurns,
    turns,
    runId: id,
  });
  results.push({ label: c.label, score: scoreRun(records), records });
}

const num = (v: number | null, d = 0) => (v === null ? "-" : v.toFixed(d));
const rows = [
  [
    "条件",
    "モデル",
    "空",
    "median字",
    "指定比",
    "前半→後半",
    "反復p90",
    "AI臭",
    "拒否",
    "タグ漏れ",
    "エスカレ",
    "総latency中央",
  ],
  ...results.map(({ label, score: s }) => [
    label,
    s.model,
    `${s.emptyCount}/${s.turns}`,
    num(s.medianChars),
    num(s.medianLengthRatio, 2),
    `${num(s.firstHalfMedian)}→${num(s.secondHalfMedian)}`,
    num(s.repetitionP90, 3),
    String(s.aiSmellHits),
    String(s.metaRefusalHits),
    `${s.tagLeakMessages}/${s.turns}`,
    num(s.escalationSlope, 3),
    `${num(s.latencyMedianMs)}ms`,
  ]),
];
const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => [...r[i]].length)));
for (const r of rows) console.log(r.map((cell, i) => cell.padEnd(widths[i])).join("  "));
console.log("");
for (const { score } of results) console.log(formatScore(score), "\n");
