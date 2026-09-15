/* eslint-disable no-console -- ベンチの出力そのもの。数字を標準出力に出すのがこの台の役目や */
import { createServer } from "node:http";

import { DEFAULT_LOG, runScenario, runTurn, type TurnRecord } from "./lib/bench.ts";
import { defaultConfig, runId } from "./lib/config.ts";
import { recordEndOfRun, recordUtterance, summarizeFeedback } from "./lib/feedback.ts";
import { loadReplayScenario } from "./lib/scenario.ts";
import { groupRuns, scoreRun } from "./lib/score.ts";
import { readJsonl } from "./lib/store.ts";

import type { ChatMessage } from "./lib/openrouter.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

// UI は無い。エンドポイントは3つだけ。Hono は入れとらん —
// apps/bench は pnpm workspace の外に置くと決めたので、依存ゼロの node:http で同じ3つを出す。

const PORT = Number(process.env.BENCH_PORT ?? 8791);

type TurnBody = {
  conversation?: string;
  text?: string;
  history?: ChatMessage[];
  model?: string;
  responseLength?: number;
  maxTokens?: number;
  useXmlEnvelope?: boolean;
  stripTags?: boolean;
};

type RunBody = TurnBody & { turns?: number; tag?: string };

const DEFAULT_CONVERSATION = "a032de1c-1e7c-4fb1-9ea0-6ade327df01d";

function overrides(body: TurnBody) {
  return {
    model: body.model,
    responseLength: body.responseLength,
    maxTokens: body.maxTokens,
    useXmlEnvelope: body.useXmlEnvelope ?? false,
    stripTags: body.stripTags ?? false,
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

type Send = (status: number, payload: unknown) => void;

async function handleTurn(req: IncomingMessage, send: Send): Promise<void> {
  const body = (await readBody(req)) as TurnBody;
  const scenario = loadReplayScenario(body.conversation ?? DEFAULT_CONVERSATION);
  const history =
    body.history ??
    (scenario.greeting ? [{ role: "assistant" as const, content: scenario.greeting }] : []);
  const record = await runTurn({
    config: defaultConfig(scenario.characterPrompt, overrides(body)),
    history,
    userText: body.text ?? scenario.userTurns[0],
    runId: runId("turn"),
    scenarioId: scenario.id,
    turnIndex: history.filter((m) => m.role === "assistant").length,
  });
  send(record.ok ? 200 : 502, record);
}

async function handleRun(req: IncomingMessage, send: Send): Promise<void> {
  const body = (await readBody(req)) as RunBody;
  const scenario = loadReplayScenario(body.conversation ?? DEFAULT_CONVERSATION);
  const id = runId(body.tag ?? "run");
  const records = await runScenario({
    config: defaultConfig(scenario.characterPrompt, overrides(body)),
    scenarioId: scenario.id,
    greeting: scenario.greeting,
    userTurns: scenario.userTurns,
    turns: body.turns ?? 20,
    runId: id,
  });
  send(200, { runId: id, score: scoreRun(records), records });
}

function handleScore(url: URL, send: Send): void {
  const wanted = url.searchParams.get("run");
  const groups = groupRuns(readJsonl<TurnRecord>(DEFAULT_LOG));
  const scores = [...groups.values()]
    .filter((rows) => !wanted || rows[0]?.runId === wanted)
    .map(scoreRun);
  send(200, { runs: scores.length, scores });
}

async function handleFeedback(req: IncomingMessage, send: Send): Promise<void> {
  // P5 の口。会話の終わりに1回、良かった発話に任意👍。ここに正解データが貯まる
  const body = (await readBody(req)) as {
    runId?: string;
    turnIndex?: number;
    came?: boolean;
    wouldContinue?: boolean;
    vote?: "up" | "down";
    note?: string;
  };
  if (!body.runId) {
    send(400, { error: "runId が要る" });
    return;
  }
  const record =
    body.turnIndex === undefined
      ? recordEndOfRun({
          runId: body.runId,
          came: body.came === true,
          wouldContinue: body.wouldContinue === true,
          note: body.note,
        })
      : recordUtterance({
          runId: body.runId,
          turnIndex: body.turnIndex,
          vote: body.vote === "down" ? "down" : "up",
          note: body.note,
        });
  send(200, record);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send: Send = (status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload, null, 2));
  };
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const key = `${req.method} ${url.pathname}`;
    if (key === "POST /turn") return await handleTurn(req, send);
    if (key === "POST /run") return await handleRun(req, send);
    if (key === "GET /score") return handleScore(url, send);
    if (key === "POST /feedback") return await handleFeedback(req, send);
    if (key === "GET /feedback") return send(200, summarizeFeedback());
    return send(404, {
      error: "POST /turn, POST /run, GET /score, POST|GET /feedback",
    });
  } catch (e) {
    return send(500, { error: e instanceof Error ? e.message : String(e) });
  }
}

const server = createServer((req, res) => {
  void route(req, res);
});

server.listen(PORT, () => console.log(`bench listening on :${PORT}`));
