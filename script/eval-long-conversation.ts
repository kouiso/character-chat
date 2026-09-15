import { readFile, writeFile } from "node:fs/promises";

import {
  evaluateLongConversation,
  type LongConversationEvalTurn,
} from "../src/lib/long-conversation-eval";
import { runNonAdultLongConversation } from "./e2e/nonadult-long-conversation";

const inputPath = process.argv[2];
const liveNonAdult = process.argv.includes("--live-nonadult");
const outputArgument = process.argv.find((argument) => argument.startsWith("--out="));
const outputPath = outputArgument?.slice("--out=".length);

let result: unknown;

if (liveNonAdult) {
  const email = process.env.EMAIL;
  if (!email) {
    throw new Error("EMAIL is required for --live-nonadult");
  }

  result = await runNonAdultLongConversation({
    baseUrl: process.env.BASE ?? "https://adult-ai-chat.pages.dev",
    email,
    authToken: process.env.AUTH_TOKEN,
    basicAuthUser: process.env.BASIC_AUTH_USER,
    basicAuthPass: process.env.BASIC_AUTH_PASS,
    characterId: process.env.CHARACTER_ID,
    onTurn: (turn) => {
      process.stderr.write(
        `turn ${turn.turn}/30 completed in ${turn.latencyMs}ms (${turn.assistantChars} chars)\n`,
      );
    },
  });
} else {
  if (!inputPath || inputPath.startsWith("--")) {
    throw new Error(
      "usage: pnpm eval:long-conversation <turns.json> | --live-nonadult [--out=<path>]",
    );
  }

  const parsed: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(parsed) || parsed.length < 30) {
    throw new Error("evaluation requires at least 30 turns");
  }

  const turns: LongConversationEvalTurn[] = parsed.map((turn, index) => {
    if (
      typeof turn !== "object" ||
      turn === null ||
      !("assistant" in turn) ||
      !("latencyMs" in turn) ||
      typeof turn.assistant !== "string" ||
      typeof turn.latencyMs !== "number" ||
      !Number.isFinite(turn.latencyMs) ||
      turn.latencyMs < 0
    ) {
      throw new Error(`invalid turn at index ${index}`);
    }
    return { assistant: turn.assistant, latencyMs: turn.latencyMs };
  });

  result = evaluateLongConversation(turns);
}

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized, "utf8");
process.stdout.write(serialized);

if (
  liveNonAdult &&
  typeof result === "object" &&
  result !== null &&
  "passed" in result &&
  result.passed === false
) {
  process.exitCode = 2;
}
