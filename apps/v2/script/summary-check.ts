// RIT-72 要約の質の確かめ台（UR-1・UR-2 の実モデル確認。RIT-48 の部品の試験）。
// 使い方: pnpm --filter @v2/app exec tsx script/summary-check.ts --real-model
//   --real-model … OpenRouter 実モデル（V2_MODEL_CHAIN の鎖）。OPENROUTER_API_KEY が要る。
//   --fake       … 配線だけ確かめる固定応答モデル（実モデル呼ばない）。
// 手元の D1（packages/db/src/turn-store.test.ts と同じ作り。一時 store へ migration）
// に固定の 200 ターン台本を 1 ターンずつ入れ、その度に要約の係を 1 回回す。
// 記録する物: 正解表 10 件のうち最後の level 2 に残った数、要約に出た
// カタカナ語・数字のうち台本に無い物の一覧（作り話の候補）。鍵が無い時は実行せず「未確認」。
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createD1TurnStore, listActiveSummaries, loadCharacterName, type TurnEvent } from "@v2/db";

import { openLocalD1, type LocalD1 } from "../../../packages/db/src/test/local-d1";
import { fakeModelCandidates } from "../src/server/fake-model";
import {
  summarizeConversation,
  type SummaryDeps,
  type SummaryRunnerEnv,
  type SummaryStorage,
} from "../src/server/summary-runner";

import type { JudgeResult } from "@v2/judge";
import type { SceneLedger } from "@v2/prompt";

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/bench/fixture/summary-200-turns.json",
);
// モデル呼び出しの上限（完成の定義: level 1 が 18 回＋level 2 が 4 回＝22 回、上限 30）。
const MAX_MODEL_CALLS = 30;
// 正解表が最後の level 2 に残る件数の既定の目安（未決 3 の既定案）。
const PASS_THRESHOLD = 7;

const OK_JUDGE: JudgeResult = {
  ok: true,
  reasons: [],
  warnings: [],
  checks: {
    ngram: { ok: true, ratio: 0, matchedPhrases: [], exactRepeat: false },
    nearDuplicate: { ok: true, matches: [] },
    voice: { ok: true, endingsMismatch: false },
    format: { ok: true },
    empty: { ok: true },
  },
};

const LEDGER: SceneLedger = {
  phase: "conversation",
  location: null,
  time: null,
  present: [],
  clothing: {},
  position: null,
  lastEvents: [],
  items: {},
};

type FixtureTurn = { user: string; assistant: string };
type Fixture = {
  version: number;
  characterName: string;
  answers: { turn: number; marker: string; fact: string }[];
  turns: FixtureTurn[];
};

const makeTurn = (text: string): TurnEvent[] => [
  {
    type: "generation",
    generationId: crypto.randomUUID(),
    model: "summary-check",
    promptVersion: "v0001",
    systemPrompt: "system",
    request: [{ role: "user", content: "user" }],
    rawOutput: `<action>${text}</action>`,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    latencyMs: 1,
    status: "ok",
  },
  { type: "chunk", seq: 1, text, judge: OK_JUDGE, attempt: 1, preExtend: true },
];

const memoryStorage = (): SummaryStorage => {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key),
    put: async (key, value) => {
      map.set(key, value);
    },
  };
};

// 台本に出る言葉（作り話候補から除く母集団）。要約 1 本に現れる語だけが無い
// 語は、その要約の捏造か台本に無い言い換えの候補として挙げる。
const fixtureVocabulary = (fixture: Fixture): Set<string> => {
  const tokens = new Set<string>();
  const collect = (text: string) => {
    for (const match of text.matchAll(/[ァ-ヴー]{2,}|\d+/g)) tokens.add(match[0]);
  };
  for (const turn of fixture.turns) {
    collect(turn.user);
    collect(turn.assistant);
  }
  for (const answer of fixture.answers) {
    collect(answer.fact);
    collect(answer.marker);
  }
  return tokens;
};

type RunStats = {
  modelCalls: number;
  level1Calls: number;
  level2Calls: number;
  outcomes: Record<"idle" | "saved" | "aborted" | "failed" | "paused", number>;
};

// 台本を 1 ターンずつ保存し、その度に要約の係を 1 回回す。モデル呼び出しは
// 係が実際にモデルを呼び始める度に数える（保存できた行数ではなく試行回数。
// 失敗した呼び出しも料金が掛かるので行の増分では過少になる）。
const seedAndRun = async (
  fixture: Fixture,
  local: LocalD1,
  input: {
    userId: string;
    characterId: string;
    conversationId: string;
    storage: SummaryStorage;
    signal: AbortSignal;
  },
  env: SummaryRunnerEnv,
  deps: Pick<SummaryDeps, "models">,
): Promise<RunStats> => {
  const store = createD1TurnStore(local.db, {
    userId: input.userId,
    characterId: input.characterId,
    promptVersion: "v0001",
  });
  const stats: RunStats = {
    modelCalls: 0,
    level1Calls: 0,
    level2Calls: 0,
    outcomes: { idle: 0, saved: 0, aborted: 0, failed: 0, paused: 0 },
  };
  // 上限は数える前に確かめる。拒否した分は呼び出し回数に入れず、30 回目の
  // 呼び出しは普通に通して、31 回目が要る時だけ止める。
  const cap = { hit: false };
  const counting: Pick<SummaryDeps, "models" | "onModelCall"> = {
    ...deps,
    onModelCall: () => {
      if (stats.modelCalls >= MAX_MODEL_CALLS) {
        cap.hit = true;
        throw new Error(`モデル呼び出しが上限 ${MAX_MODEL_CALLS} 回に達した`);
      }
      stats.modelCalls += 1;
    },
  };
  for (let index = 0; index < fixture.turns.length; index += 1) {
    const turn = fixture.turns[index];
    await store.saveTurn({
      conversationId: input.conversationId,
      turn: index + 1,
      userText: turn.user,
      events: makeTurn(turn.assistant),
      ledger: LEDGER,
    });
    await runSummaryOnce(local, input, env, counting, stats, cap);
    if ((index + 1) % 40 === 0) {
      console.log(`…turn ${index + 1}/200 済（modelCalls=${stats.modelCalls}）`);
    }
  }
  return stats;
};

// 要約の係を 1 回回し、出来上がった行で level 別の回数だけ数える。
const runSummaryOnce = async (
  local: LocalD1,
  input: Parameters<typeof summarizeConversation>[1],
  env: SummaryRunnerEnv,
  deps: Pick<SummaryDeps, "models" | "onModelCall">,
  stats: RunStats,
  cap: { hit: boolean },
): Promise<void> => {
  const before = new Set(
    (await listActiveSummaries(local.db, input.conversationId)).map((row) => row.id),
  );
  const outcome = await summarizeConversation(env, input, { db: local.db, ...deps });
  stats.outcomes[outcome] += 1;
  const after = await listActiveSummaries(local.db, input.conversationId);
  for (const added of after.filter((row) => !before.has(row.id))) {
    if (added.level === 1) stats.level1Calls += 1;
    else stats.level2Calls += 1;
  }
  // 係が上限拒否を要約失敗として飲み込んでも、台の側では上限到達で止める。
  if (cap.hit) {
    throw new Error(`モデル呼び出しが上限 ${MAX_MODEL_CALLS} 回に達した`);
  }
};

type ActiveSummary = Awaited<ReturnType<typeof listActiveSummaries>>[number];

const rangeLabel = (row: ActiveSummary): string => `${row.fromTurn}-${row.toTurn}`;

// 完成の定義の正常系: level 1 が連続した 10 ターン幅で 18 本、level 2 が
// from_turn=1 の 40 ターン幅で 4 本できる。
const checkStructure = (
  level1: ActiveSummary[],
  level2: ActiveSummary[],
): { level1Contiguous: boolean; level2Ok: boolean } => ({
  level1Contiguous:
    level1.length === 18 &&
    level1.every((row, i) => row.fromTurn === i * 10 + 1 && row.toTurn === (i + 1) * 10),
  level2Ok:
    level2.length === 4 &&
    level2.every((row, i) => row.fromTurn === 1 && row.toTurn === (i + 1) * 40),
});

// 要約に出るが台本に無いカタカナ語・数字（作り話の候補）。
const collectFabrications = (active: ActiveSummary[], vocabulary: Set<string>): Set<string> => {
  const fabrications = new Set<string>();
  for (const summary of active) {
    for (const match of summary.text.matchAll(/[ァ-ヴー]{2,}|\d+/g)) {
      if (!vocabulary.has(match[0])) fabrications.add(match[0]);
    }
  }
  return fabrications;
};

const printAnswerTable = (fixture: Fixture, last2: ActiveSummary | undefined): number => {
  let survived = 0;
  for (const answer of fixture.answers) {
    const kept = last2?.text.includes(answer.marker) ?? false;
    if (kept) survived += 1;
    console.log(
      `  ${kept ? "残" : "落"} turn${answer.turn} ${answer.fact}（marker: ${answer.marker}）`,
    );
  }
  return survived;
};

const printReport = (
  fixture: Fixture,
  active: ActiveSummary[],
  stats: RunStats,
  modelLabel: string,
  startedAt: number,
): void => {
  const level1 = active.filter((row) => row.level === 1).sort((a, b) => a.fromTurn - b.fromTurn);
  const level2 = active.filter((row) => row.level === 2).sort((a, b) => a.toTurn - b.toTurn);
  const last2 = level2.at(-1);
  const { level1Contiguous, level2Ok } = checkStructure(level1, level2);
  // あらすじの塊: 最終要約（level 2 の最新＋それ以降の level 1）が 2,500 字以内。
  const blockChars =
    (last2?.text.length ?? 0) +
    level1
      .filter((row) => row.toTurn > (last2?.toTurn ?? 0))
      .reduce((total, row) => total + row.text.length + 2, 0);
  const fabrications = collectFabrications(active, fixtureVocabulary(fixture));
  console.log("=== summary-check 結果 ===");
  console.log(
    `モデル: ${modelLabel} / ` +
      `モデル呼び出し ${stats.modelCalls} 回（level1=${stats.level1Calls}, level2=${stats.level2Calls}, 上限 ${MAX_MODEL_CALLS}）`,
  );
  console.log(
    `outcomes: saved=${stats.outcomes.saved} idle=${stats.outcomes.idle} failed=${stats.outcomes.failed} ` +
      `aborted=${stats.outcomes.aborted} paused=${stats.outcomes.paused}`,
  );
  console.log(
    `level 1: ${level1.length} 本 ${level1.map(rangeLabel).join(",")}` +
      ` / 連続構造=${level1Contiguous ? "OK" : "NG"}`,
  );
  console.log(
    `level 2: ${level2.length} 本 ${level2.map(rangeLabel).join(",")}` +
      ` / 構造=${level2Ok ? "OK" : "NG"}`,
  );
  console.log(`あらすじの塊（最新 level2＋後続 level1）: ${blockChars} 字（上限 2,500 字）`);
  console.log(`--- 最後の level 2（turn ${last2 ? rangeLabel(last2) : "なし"}）---`);
  console.log(last2?.text ?? "(なし)");
  console.log("--- 正解表 10 件の残り ---");
  const survived = printAnswerTable(fixture, last2);
  console.log(
    `残った数: ${survived}/10（既定の目安 ${PASS_THRESHOLD} 件以上 → ` +
      `${survived >= PASS_THRESHOLD ? "合格" : "未達"}）`,
  );
  console.log(`--- 作り話の候補（要約に出るが台本に無いカタカナ語・数字）---`);
  console.log(fabrications.size > 0 ? [...fabrications].sort().join(", ") : "(なし)");
  console.log(`経過: ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`);
};

// seed 済み character を 1 件借りる（turn-store.test.ts と同じ作り方）。
const pickCharacter = async (local: LocalD1): Promise<string> => {
  const { results: characters } = await local.d1
    .prepare("SELECT id FROM character ORDER BY display_order, created_at")
    .all<{ id: string }>();
  for (const row of characters ?? []) {
    if ((await loadCharacterName(local.db, row.id)) !== null) return row.id;
  }
  throw new Error("ローカル D1 に読める character が無い");
};

const printUnverified = (reason: string): void => {
  console.log(reason);
  console.log("結論: 未確認（実モデルでの実行が要る）");
};

const main = async (): Promise<void> => {
  const args = new Set(process.argv.slice(2));
  const realModel = args.has("--real-model");
  const fakeModel = args.has("--fake");
  if (!realModel && !fakeModel) {
    printUnverified(
      [
        "要約の質の確かめ台（RIT-72）。",
        "  --real-model … 実モデル（OPENROUTER_API_KEY 必要。V2_MODEL_CHAIN の鎖）",
        "  --fake       … 配線だけ確かめる固定応答モデル",
      ].join("\n"),
    );
    return;
  }
  const env: SummaryRunnerEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    V2_MODEL_CHAIN: process.env.V2_MODEL_CHAIN,
    V2_OPENROUTER_BASE_URL: process.env.V2_OPENROUTER_BASE_URL,
  };
  const deps: Pick<SummaryDeps, "models"> = {};
  if (fakeModel) {
    deps.models = fakeModelCandidates({ V2_FAKE_RESPONSE: "あらすじの要約文" });
  } else if (!env.OPENROUTER_API_KEY) {
    printUnverified("OPENROUTER_API_KEY が無いので実行しません。");
    return;
  }
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
  if (fixture.turns.length !== 200) throw new Error("台本が 200 ターンではない");
  const persistRoot = mkdtempSync(path.join(tmpdir(), "summary-check-"));
  const startedAt = Date.now();
  let local: LocalD1 | undefined;
  try {
    local = await openLocalD1({ persistRoot });
    const characterId = await pickCharacter(local);
    const input = {
      userId: "summary-check",
      characterId,
      conversationId: `summary-check-${crypto.randomUUID()}`,
      storage: memoryStorage(),
      signal: new AbortController().signal,
    };
    const stats = await seedAndRun(fixture, local, input, env, deps);
    const active = await listActiveSummaries(local.db, input.conversationId);
    printReport(
      fixture,
      active,
      stats,
      realModel ? "実モデル（V2_MODEL_CHAIN）" : "fake",
      startedAt,
    );
  } finally {
    await local?.dispose();
    rmSync(persistRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error("summary-check 失敗:", error);
  process.exitCode = 1;
});
