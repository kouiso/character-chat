#!/usr/bin/env tsx
// XML構造化出力の品質テスト（アダプター経由版）
// 実機ブラウザと同一のメッセージ配列を構築してAPIに送信する
// Usage: pnpm tsx script/test-xml-quality.ts [scenario] [turns]
//   scenario: A (tsukasa), B (mitsuki), C (azusa) — default: A
//   turns: number of turns to test — default: 3

import { buildMessagesForApi, buildRetryMessages } from "../src/lib/chat-message-adapter";
import { runQualityChecks } from "../src/lib/quality-guard";
import { detectScenePhase } from "../src/lib/scene-phase";
import { isXmlResponse, parseXmlResponse, stripXmlTags } from "../src/lib/xml-response-parser";
import { readChatSseResponse } from "./lib/read-chat-sse";

import type { ApiMessage } from "../src/lib/chat-message-adapter";
import type { QualityCheckResult } from "../src/lib/quality-guard";
import type { ScenePhase } from "../src/lib/scene-phase";

const BASE_URL = "http://localhost:8788";

// この検証スクリプト専用の撮り直し本数。本番の上限は getQualityRetryLimit(env, ...)
// （functions/api/lib/route-context.ts）が環境変数 MAX_QUALITY_RETRIES から決める。
const SCRIPT_MAX_QUALITY_RETRIES = 1;

interface Scenario {
  char: string;
  firstPerson: string;
  wrongFirstPersons: string[];
  messages: string[];
}

const SCENARIOS: Record<string, Scenario> = {
  A: {
    char: "鳴海つかさ",
    firstPerson: "あたし",
    wrongFirstPersons: ["私", "わたし", "僕", "俺"],
    messages: [
      "つかさ、まだ残ってたの？今日のプレゼン資料すごくよかったよ。報告書手伝うよ",
      "二人で飲みに行かない？つかさってさ、今の顔すごくかわいい",
      "つかさの顎を持ち上げてキスする …ずっとこうしたかった",
      "つかさのブラウスのボタンを外しながら首筋にキスする つかさ…もっと触りたい",
      "つかさ…入れるよ。ゆっくりいくから",
      "深く腰を動かしながら つかさの中、すごい…きつくて熱い",
      "もう限界…つかさの中に出していい？",
      "つかさの奥に全部出す …つかさ…好きだ。ずっと好きだった",
    ],
  },
  B: {
    char: "月島みつき",
    firstPerson: "あたし",
    wrongFirstPersons: ["私", "わたし", "僕", "俺"],
    messages: [
      "遅くまでやってるんだね。ウィスキー、ロックで。みつきさんはいつからバーテンダーやってるの？",
      "…綺麗な手だな。カクテル作る手つきがすごく好き。もう閉店？最後の一杯、一緒にどう？",
      "カウンター越しにみつきの手に触れる …冷たいな、この手。温めてあげたい",
      "みつきの首筋にそっと唇を寄せる …ここ、弱いんでしょ？",
      "みつきのベストを脱がせながら深くキスする みつき…奥の部屋、行こう",
      "みつき…入れるよ。ゆっくりみつきの中に入っていく",
      "みつきを抱き上げながら激しく腰を動かす みつき…中に出したい…いい？",
      "みつきの中に深く出す …みつき…最高だ。今夜は帰さないよ",
    ],
  },
  C: {
    char: "九条あずさ",
    firstPerson: "私",
    wrongFirstPersons: ["あたし", "僕", "俺"],
    messages: [
      "先生、今日の検査ちょっと緊張するんですけど…いつもこんなに近いんですか？",
      "先生の手、冷たくて気持ちいい…。あずさの白衣の袖を掴む もっと診てほしいです",
      "あずさの白衣を脱がせる …先生、白衣の下すごいね。もう先生じゃなくてあずさって呼んでいい？",
      "あずさを診察台に押し倒す 今度は俺が先生を検査する番だ",
      "あずさ…中に入れていい？ ゆっくりあずさの中に入る",
      "腰を動かしながら あずさ、締めつけてくる…奥まで当たってる",
      "もう…限界だ。あずさの中に出していい？",
      "あずさの奥に出す …あずさ…",
    ],
  },
};

// SSEストリームからテキストを収集する
const collectSseResponse = async (response: Response): Promise<string> =>
  (await readChatSseResponse(response.body!)).text;

interface TurnResult {
  turn: number;
  phase: ScenePhase;
  passed: boolean;
  failedCheck: string | null;
  isXml: boolean;
  plainLen: number;
  totalElapsed: number;
  attempts: number;
  hasSections: { action: boolean; dialogue: boolean; inner: boolean } | null;
}

interface CharacterInfo {
  name: string;
  systemPrompt: string;
  greeting?: string;
}

const fetchCharacter = async (scenario: Scenario): Promise<CharacterInfo> => {
  const charsRes = await fetch(`${BASE_URL}/api/characters`);
  const { characters } = (await charsRes.json()) as { characters: CharacterInfo[] };
  const char = characters.find((c) => c.name === scenario.char);
  if (!char) {
    console.error(
      `Character "${scenario.char}" not found. Available:`,
      characters.map((c) => c.name),
    );
    process.exit(1);
  }
  return char;
};

interface RetryLoopResult {
  responseText: string;
  qualityResult: QualityCheckResult;
  totalElapsed: number;
  attempts: number;
}

const runRetryLoop = async (
  apiMessages: ApiMessage[],
  model: string,
  scenario: Scenario,
  prevAssistantResponse: string,
  phase: ScenePhase,
): Promise<RetryLoopResult | null> => {
  let attempt = 0;
  let responseText = "";
  let qualityResult: QualityCheckResult = { passed: false, failedCheck: "not-tested" };
  let totalElapsed = 0;
  let currentMessages: ApiMessage[] = apiMessages;
  const maxRetries = SCRIPT_MAX_QUALITY_RETRIES;

  while (attempt <= maxRetries) {
    const startTime = Date.now();
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: currentMessages, model }),
    });

    if (!res.ok) {
      console.error(`API error: ${res.status} ${await res.text()}`);
      return null;
    }

    responseText = await collectSseResponse(res);
    totalElapsed += Date.now() - startTime;

    qualityResult = runQualityChecks(responseText, {
      phase,
      prevAssistantResponse,
      firstPerson: scenario.firstPerson,
      wrongFirstPersons: scenario.wrongFirstPersons,
    });

    if (qualityResult.passed || attempt >= maxRetries) break;

    // リトライ: アダプター経由で統一されたリトライメッセージを構築
    console.info(`  retry ${attempt + 1}: ${qualityResult.failedCheck}`);
    currentMessages = buildRetryMessages(apiMessages, responseText, {
      firstPerson: scenario.firstPerson,
      prevAssistantResponse,
    });
    attempt++;
  }

  return { responseText, qualityResult, totalElapsed, attempts: attempt + 1 };
};

const logTurnResponse = (
  responseText: string,
  totalElapsed: number,
  plainLen: number,
  isXml: boolean,
  attempts: number,
  qualityPassed: boolean,
  failedCheck: string | undefined,
): void => {
  console.info(
    `RESPONSE (${totalElapsed}ms, ${plainLen}chars, xml=${isXml}, attempts=${attempts}):`,
  );
  const parsed = parseXmlResponse(responseText);
  if (parsed) {
    console.info(`  <action> ${parsed.action.slice(0, 100)}...`);
    console.info(`  <dialogue> ${parsed.dialogue.slice(0, 100)}...`);
    console.info(`  <inner> ${parsed.inner.slice(0, 100)}...`);
  } else {
    console.info(`  RAW: ${responseText.slice(0, 150)}...`);
  }
  console.info(`QUALITY: ${qualityPassed ? "✓ PASS" : `✗ FAIL (${failedCheck})`}`);
  console.info();
};

const buildTurnResult = (
  turnIndex: number,
  phase: ScenePhase,
  retryResult: RetryLoopResult,
): TurnResult => {
  const parsed = parseXmlResponse(retryResult.responseText);
  const isXml = isXmlResponse(retryResult.responseText);
  const plainLen = (parsed ? stripXmlTags(retryResult.responseText) : retryResult.responseText)
    .length;

  return {
    turn: turnIndex + 1,
    phase,
    passed: retryResult.qualityResult.passed,
    failedCheck: retryResult.qualityResult.failedCheck ?? null,
    isXml,
    plainLen,
    totalElapsed: retryResult.totalElapsed,
    attempts: retryResult.attempts,
    hasSections: parsed
      ? {
          action: parsed.action.length > 0,
          dialogue: parsed.dialogue.length > 0,
          inner: parsed.inner.length > 0,
        }
      : null,
  };
};

const buildApiErrorResult = (
  turnIndex: number,
  phase: ScenePhase,
  attempts: number,
): TurnResult => ({
  turn: turnIndex + 1,
  phase,
  passed: false,
  failedCheck: "api-error",
  isXml: false,
  plainLen: 0,
  totalElapsed: 0,
  attempts,
  hasSections: null,
});

const printSummary = (results: TurnResult[], turns: number): void => {
  console.info(`\n${"=".repeat(60)}`);
  console.info("SUMMARY");
  console.info(`${"=".repeat(60)}`);
  const passCount = results.filter((r) => r.passed).length;
  const xmlCount = results.filter((r) => r.isXml).length;
  console.info(`Pass: ${passCount}/${turns}`);
  console.info(`XML format: ${xmlCount}/${turns}`);
  for (const r of results) {
    const status = r.passed ? "✓" : "✗";
    console.info(
      `  T${r.turn} [${r.phase}] ${status} ${r.failedCheck ?? ""} (${r.plainLen}chars, ${r.totalElapsed}ms, xml=${r.isXml}, attempts=${r.attempts})`,
    );
  }

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.info(`\nFailed checks: ${failures.map((f) => f.failedCheck).join(", ")}`);
  }

  process.exit(passCount === turns ? 0 : 1);
};

interface ConversationState {
  rawHistory: { role: "user" | "assistant" | "system"; content: string; isStreaming?: boolean }[];
  prevAssistantResponse: string;
}

const updateConversationState = (state: ConversationState, responseText: string): void => {
  state.rawHistory.push({ role: "assistant", content: responseText });
  const parsed = parseXmlResponse(responseText);
  state.prevAssistantResponse = parsed ? stripXmlTags(responseText) : responseText;
};

const runTurn = async (
  t: number,
  scenario: Scenario,
  char: CharacterInfo,
  model: string,
  state: ConversationState,
): Promise<TurnResult> => {
  const userMsg = scenario.messages[t];
  state.rawHistory.push({ role: "user", content: userMsg });

  const apiMessages = buildMessagesForApi(state.rawHistory, char.systemPrompt, scenario.char);
  const phase = detectScenePhase(apiMessages);

  console.info(`--- Turn ${t + 1} (phase: ${phase}) ---`);
  console.info(`USER: ${userMsg.slice(0, 60)}...`);

  const retryResult = await runRetryLoop(
    apiMessages,
    model,
    scenario,
    state.prevAssistantResponse,
    phase,
  );

  if (!retryResult) return buildApiErrorResult(t, phase, 1);

  const turnResult = buildTurnResult(t, phase, retryResult);
  logTurnResponse(
    retryResult.responseText,
    retryResult.totalElapsed,
    turnResult.plainLen,
    turnResult.isXml,
    retryResult.attempts,
    retryResult.qualityResult.passed,
    retryResult.qualityResult.failedCheck,
  );

  updateConversationState(state, retryResult.responseText);
  return turnResult;
};

const main = async () => {
  const scenarioKey = (process.argv[2] ?? "A").toUpperCase();
  const maxTurns = parseInt(process.argv[3] ?? "3", 10);
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioKey}. Use A, B, or C.`);
    process.exit(1);
  }

  const model = process.env.MODEL ?? "sao10k/l3.3-euryale-70b";
  console.info(`\n${"=".repeat(60)}`);
  console.info(`Scenario ${scenarioKey}: ${scenario.char} (${maxTurns} turns)`);
  console.info(`MODEL: ${model}`);
  console.info(`ADAPTER: buildMessagesForApi (same as browser)`);
  console.info(`${"=".repeat(60)}\n`);

  const char = await fetchCharacter(scenario);

  const state: ConversationState = {
    rawHistory: [],
    prevAssistantResponse: char.greeting ?? "",
  };

  // greetingがあれば最初のassistantメッセージとして追加
  if (char.greeting) {
    state.rawHistory.push({ role: "assistant", content: char.greeting });
  }

  const results: TurnResult[] = [];
  const turns = Math.min(maxTurns, scenario.messages.length);

  for (let t = 0; t < turns; t++) {
    const result = await runTurn(t, scenario, char, model, state);
    results.push(result);
  }

  printSummary(results, turns);
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
