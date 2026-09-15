// pnpm v2:persist-check — 会話がプロセス再起動をまたいで D1（v2_*）に残ることの証明。
// 引数なしで起動すると自分自身を 2 回、別プロセスとして spawn する:
//   step 1: fake model で turn 1 を送って終了（conversationId を stdout に出す）
//   step 2: 同じ conversationId で turn 2 を送り、D1 store の load で history が 4 件になることを assert
// step 2 の冒頭で load が history 2 件を返すことも assert する（= step 1 の保存が別プロセスから読める）。
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createPlatform } from "@v2/cf";
import { applyLocalMigrations } from "@v2/cf/migrate";
import { createD1TurnStore, createDb, loadCharacters, type V2Db } from "@v2/db";
import { createTurnGraph, runTurn, type CharacterSheet, type TurnEvent } from "@v2/engine";
import { PROMPT_VERSION } from "@v2/prompt";

// apps/v2 の LOCAL_USER_ID（"local"）と分けて、確認用の行を後から見分けられるようにする。
const USER_ID = "persist-check";

const FAKE_RESPONSE =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";

type StepResult = {
  step: 1 | 2;
  conversationId: string;
  characterId: string;
  historyBefore: number;
  historyAfter: number;
  turnAfter: number;
  doneTurn: number | null;
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`persist-check: ${message}`);
};

const readArg = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

// zod を通る最初の character を使う（FK character_id が要るので実在の行が必要）。
const pickCharacter = async (db: V2Db, explicitId: string | undefined): Promise<CharacterSheet> => {
  const { ok } = await loadCharacters(db);
  const character = explicitId ? ok.find((sheet) => sheet.id === explicitId) : ok[0];
  if (!character) {
    throw new Error(
      `persist-check: zod を通る character がローカル D1 に無い${explicitId ? `（--character ${explicitId}）` : ""}（pnpm db:migrate:local && pnpm db:seed）`,
    );
  }
  return character;
};

export const runStep = async (step: 1 | 2, args: string[]): Promise<StepResult> => {
  const conversationId = readArg(args, "--conversation") ?? crypto.randomUUID();
  assert(
    step === 1 || readArg(args, "--conversation") !== undefined,
    "step 2 には --conversation が要る",
  );

  applyLocalMigrations();
  const { env, dispose } = await createPlatform();
  try {
    const db = createDb(env.DB);
    const character = await pickCharacter(db, readArg(args, "--character"));
    const store = createD1TurnStore(db, {
      userId: USER_ID,
      characterId: character.id,
      promptVersion: PROMPT_VERSION,
    });

    const before = await store.load(conversationId);
    const expectedBefore = step === 1 ? 0 : 2;
    assert(
      before.history.length === expectedBefore,
      `step ${step} 開始時の history が ${before.history.length} 件（期待 ${expectedBefore}）`,
    );

    const graph = createTurnGraph({
      model: new FakeListChatModel({ responses: [FAKE_RESPONSE] }),
      store,
    });
    let doneTurn: number | null = null;
    const events: TurnEvent[] = [];
    for await (const event of runTurn(
      graph,
      { conversationId, userText: `persist-check turn ${step}`, character },
      conversationId,
    )) {
      events.push(event);
      if (event.type === "done") doneTurn = event.turn;
    }
    assert(doneTurn === step, `done.turn が ${doneTurn}（期待 ${step}）`);
    assert(
      events.filter((event) => event.type === "chunk").length === 3,
      "chunk が 3 件流れてへん",
    );

    const after = await store.load(conversationId);
    const expectedAfter = step * 2;
    assert(
      after.history.length === expectedAfter,
      `step ${step} 終了時の history が ${after.history.length} 件（期待 ${expectedAfter}）`,
    );
    assert(after.turn === step + 1, `load().turn が ${after.turn}（期待 ${step + 1}）`);
    assert(
      after.history[expectedAfter - 2]?.content === `persist-check turn ${step}`,
      "直前の user 発話が history に無い",
    );

    return {
      step,
      conversationId,
      characterId: character.id,
      historyBefore: before.history.length,
      historyAfter: after.history.length,
      turnAfter: after.turn,
      doneTurn,
    };
  } finally {
    await dispose();
  }
};

const SELF = fileURLToPath(import.meta.url);

// 別プロセスで step を走らせ、stdout 最終行の JSON を結果として受け取る。
// `node --import tsx` は cwd（packages/bench）から tsx を解決する。
const spawnStep = (args: string[]): StepResult => {
  const stdout = execFileSync(process.execPath, ["--import", "tsx", SELF, ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  const lastLine = stdout.trim().split("\n").at(-1) ?? "";
  return JSON.parse(lastLine) as StepResult;
};

const main = async (args: string[]): Promise<void> => {
  const step = readArg(args, "--step");
  if (step === "1" || step === "2") {
    console.log(JSON.stringify(await runStep(step === "1" ? 1 : 2, args)));
    return;
  }
  const passthrough = readArg(args, "--character")
    ? ["--character", readArg(args, "--character") ?? ""]
    : [];
  const first = spawnStep(["--step", "1", ...passthrough]);
  const second = spawnStep(["--step", "2", "--conversation", first.conversationId, ...passthrough]);
  console.log(JSON.stringify({ ok: true, first, second }, null, 2));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}
