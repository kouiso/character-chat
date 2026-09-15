// 2026-07-08 の拒否漏れを恒久的に再現・測定するための headless replay driver。
// 使い方: OUT_DIR=.work/e2e-results/replay-YYYYMMDD pnpm exec tsx script/e2e/replay-chat.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { hardRefusalDetect } from "../../functions/api/lib/refusal-detect";
import { getDefaultModelForPhase } from "../../src/lib/model";
import { describeChatSseFailure, readChatSseResponse } from "../lib/read-chat-sse";
import s1MidnightMeeting from "./scenario/s1-midnight-meeting";
import s6RinkaLab from "./scenario/s6-rinka-lab";
import s7SayaRain from "./scenario/s7-saya-rain";
import s8ReinaReversal from "./scenario/s8-reina-reversal";
import type { ScenarioDefinition } from "./scenario/_types";
import type { Phase } from "./types";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ReplayTurnRecord = {
  turn: number;
  phase: Phase;
  serverPhase?: Phase | null;
  userMsg: string;
  assistant: string;
  ttfbMs: number | null;
  totalMs: number | null;
  servedModel: string | null;
  refusal: boolean;
  nearDuplicate: boolean;
  exactDuplicate: boolean;
  error: string | null;
};

const SCENARIOS: Record<string, ScenarioDefinition> = {
  "s1-midnight-meeting": s1MidnightMeeting,
  "s6-rinka-lab": s6RinkaLab,
  "s7-saya-rain": s7SayaRain,
  "s8-reina-reversal": s8ReinaReversal,
};

const BASE = process.env.BASE ?? "http://127.0.0.1:8788";
const EMAIL = process.env.EMAIL ?? "sukererion@gmail.com";
const DEFAULT_SCENARIOS =
  "s1-midnight-meeting,s6-rinka-lab,s7-saya-rain,s8-reina-reversal";
const requestedScenarioNames = (process.env.SCENARIOS ?? DEFAULT_SCENARIOS)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const OUT_DIR = process.env.OUT_DIR;

if (!OUT_DIR) {
  throw new Error("OUT_DIR is required");
}

mkdirSync(OUT_DIR, { recursive: true });

const normalizeForDuplicate = (text: string): string =>
  text
    .replace(/<[^>]+>/g, "")
    .replaceAll(/[\s。、！？「」『』…\n]/g, "")
    .toLowerCase();

const ngrams = (text: string, n: number): Set<string> => {
  const result = new Set<string>();
  for (let i = 0; i <= text.length - n; i += 1) {
    result.add(text.slice(i, i + n));
  }
  return result;
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
};

const duplicateFlags = (
  assistant: string,
  previousAssistant: string | null,
): { nearDuplicate: boolean; exactDuplicate: boolean } => {
  if (!previousAssistant) return { nearDuplicate: false, exactDuplicate: false };
  const current = normalizeForDuplicate(assistant);
  const previous = normalizeForDuplicate(previousAssistant);
  const exactDuplicate = current.length > 0 && current === previous;
  const nearDuplicate =
    current.length >= 15 &&
    previous.length >= 15 &&
    jaccard(ngrams(current, 4), ngrams(previous, 4)) >= 0.5;
  return { nearDuplicate, exactDuplicate };
};

const duplicateFlagsAgainstAny = (
  assistant: string,
  priors: string[],
): { nearDuplicate: boolean; exactDuplicate: boolean } => {
  let nearDuplicate = false;
  let exactDuplicate = false;
  for (const prior of priors) {
    const flags = duplicateFlags(assistant, prior);
    nearDuplicate ||= flags.nearDuplicate;
    exactDuplicate ||= flags.exactDuplicate;
    if (nearDuplicate && exactDuplicate) break;
  }
  return { nearDuplicate, exactDuplicate };
};

const isPhase = (value: string | null): value is Phase =>
  ["conversation", "intimate", "erotic", "climax", "afterglow"].includes(value ?? "");

const readChatStream = async (
  response: Response,
  startedAt: number,
): Promise<Pick<ReplayTurnRecord, "assistant" | "ttfbMs" | "totalMs" | "servedModel" | "serverPhase">> => {
  if (!response.body) {
    throw new Error("response body is empty");
  }

  let ttfbMs: number | null = null;
  const sse = await readChatSseResponse(response.body, {
    onDelta: () => {
      ttfbMs ??= Date.now() - startedAt;
    },
  });

  // 中継開始後の失敗は HTTP 200 で届く。途中で切れた本文を返答として履歴へ積むと
  // 以降のターンが壊れた文脈で走る。
  const failure = describeChatSseFailure(sse);
  if (failure) {
    throw new Error(`chat stream did not complete (${failure})`);
  }

  const serverPhaseHeader = response.headers.get("x-scene-phase");
  return {
    assistant: sse.text,
    ttfbMs,
    totalMs: Date.now() - startedAt,
    servedModel: sse.servedModel,
    serverPhase: isPhase(serverPhaseHeader) ? serverPhaseHeader : null,
  };
};

const postTurn = async (
  history: ChatMessage[],
  characterSlug: string,
  phase: Phase,
): Promise<Pick<ReplayTurnRecord, "assistant" | "ttfbMs" | "totalMs" | "servedModel" | "serverPhase">> => {
  const startedAt = Date.now();
  const model = getDefaultModelForPhase(phase);
  const response = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "CF-Access-Authenticated-User-Email": EMAIL,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: history,
      characterId: characterSlug,
      scenePhase: phase,
      model,
      responseLength: "medium",
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
  }

  return readChatStream(response, startedAt);
};

const runTurn = async (
  history: ChatMessage[],
  characterSlug: string,
  turn: number,
  phase: Phase,
): Promise<Omit<ReplayTurnRecord, "turn" | "phase" | "userMsg" | "refusal" | "nearDuplicate" | "exactDuplicate">> => {
  try {
    return { ...(await postTurn(history, characterSlug, phase)), error: null };
  } catch (firstError) {
    await sleep(3_000);
    try {
      return { ...(await postTurn(history, characterSlug, phase)), error: null };
    } catch (secondError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      const secondMessage =
        secondError instanceof Error ? secondError.message : String(secondError);
      return {
        assistant: "",
        ttfbMs: null,
        totalMs: null,
        servedModel: null,
        error: `T${turn} retry failed: ${firstMessage} / ${secondMessage}`,
      };
    }
  }
};

const runScenario = async (scenarioName: string, scenario: ScenarioDefinition): Promise<void> => {
  const startedAt = new Date().toISOString();
  const history: ChatMessage[] = [];
  const results: ReplayTurnRecord[] = [];
  const priorAssistants: string[] = [];

  for (const turn of scenario.turns) {
    const phase = turn.expectedPhase;
    history.push({ role: "user", content: turn.userMsg });
    const response = await runTurn(
      history,
      turn.characterSlug ?? scenario.characterSlug,
      turn.turnIndex,
      phase,
    );
    const refusal = response.error === null && hardRefusalDetect(response.assistant);
    const { nearDuplicate, exactDuplicate } =
      response.error === null
        ? duplicateFlagsAgainstAny(response.assistant, priorAssistants)
        : { nearDuplicate: false, exactDuplicate: false };
    const record: ReplayTurnRecord = {
      turn: turn.turnIndex,
      phase,
      userMsg: turn.userMsg,
      assistant: response.assistant,
      ttfbMs: response.ttfbMs,
      totalMs: response.totalMs,
      servedModel: response.servedModel,
      serverPhase: response.serverPhase,
      refusal,
      nearDuplicate,
      exactDuplicate,
      error: response.error,
    };

    results.push(record);
    if (response.error === null) {
      history.push({ role: "assistant", content: response.assistant });
      priorAssistants.push(response.assistant);
    } else {
      // 失敗ターンの user を履歴から戻す。history に残すと次ターンで
      // user が連続してしまい、以降の会話が実際の対話と乖離する。
      history.pop();
    }
    while (history.length > 40) history.shift();

    console.log(
      `T${turn.turnIndex} [${phase}] ttfb=${record.ttfbMs ?? "null"}ms total=${
        record.totalMs ?? "null"
      }ms model=${record.servedModel ?? "null"} len=${record.assistant.length} refusal=${refusal}`,
    );
  }

  writeFileSync(
    join(OUT_DIR, `${scenarioName}.json`),
    JSON.stringify(
      { scenario: scenarioName, characterSlug: scenario.characterSlug, startedAt, results },
      null,
      2,
    ),
  );
};

for (const scenarioName of requestedScenarioNames) {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioName}`);
  }
  await runScenario(scenarioName, scenario);
}

console.log("ALL_DONE");
