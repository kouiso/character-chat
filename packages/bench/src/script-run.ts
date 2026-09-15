// pnpm v2:script-run --arm <name> --run <n> — 既存アプリの通し読みハーネス
// （script/verify/vlong-session-dogfood.ts）と同じ 10 ターン台本を v2 エンジンで演じ、
// 同じヘッダ形式のトランスクリプトを .work/e2e-results/vlong-dogfood/ に残す。
// 読む側（recheck / HTML レポート / 人）が既存アームと並べて読めるよう、ヘッダの行は
// 旧ハーネスの writeTurn と 1 字も変えん。
//
// モデルは createOpenRouterModel(process.env) の実モデル。V2_FAKE_MODEL=1 のときだけ
// persist-check と同じ FakeListChatModel（形式確認用。トランスクリプトはコミットせん）。
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createPlatform, REPO_ROOT } from "@v2/cf";
import { applyLocalMigrations } from "@v2/cf/migrate";
import { createD1TurnStore, createDb, loadCharacter, type V2Db } from "@v2/db";
import {
  createOpenRouterModel,
  createTurnGraph,
  runTurn,
  type CharacterSheet,
  type TurnEvent,
} from "@v2/engine";
import { PROMPT_VERSION, type ScenePhase } from "@v2/prompt";

import {
  MAX_TOTAL_GENERATION_MS,
  outputDirName,
  stopReasonAfter,
  turnTimeoutMs,
  type TurnEnding,
} from "./script-run-policy";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// apps/v2 の "local" / persist-check の "persist-check" と分けて、台本の行を後から見分ける。
const USER_ID = "script-run";

// persist-check と同じ 1 応答。fake は形式確認用で、本文の質は測らん。
const FAKE_RESPONSE =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";

type ScriptedTurn = { intent: ScenePhase; user: string };

type ScriptCharacter = { label: "Sakura" | "Downer"; id: string; script: ScriptedTurn[] };

// 台本は script/verify/vlong-session-dogfood.ts の SCRIPTS を 1 字も変えず写す。
// 既存アプリの実測（ci47 等）と同じ相手の発言で比べるためで、ここを直したら比較が壊れる。
const CHARACTERS: ScriptCharacter[] = [
  {
    label: "Sakura",
    id: "char-koharu-ex",
    script: [
      {
        intent: "conversation",
        user: "さっきは急に声かけてごめん。でも、どうしても話してみたかったんだ。",
      },
      { intent: "conversation", user: "コーヒーでいい？　それとも甘いのがよかった？" },
      { intent: "conversation", user: "普段って、どんな本読むの" },
      { intent: "intimate", user: "……近いね。少しだけ、手に触れてもいい？" },
      { intent: "intimate", user: "髪、かかってる。耳にかけるね。首筋、少し赤くなってる。" },
      { intent: "intimate", user: "……ここ出ようか。うち、すぐ近くだから。" },
      {
        intent: "erotic",
        user: "ここまで来て、まだ我慢しろって言う？　服の上からでも、きみが震えてるのが分かる。",
      },
      { intent: "erotic", user: "もっと" },
      { intent: "climax", user: "もう限界。全部、中で受け止めて。" },
      { intent: "afterglow", user: "……大丈夫？　汗、拭こうか。" },
    ],
  },
  {
    label: "Downer",
    id: "import-charap-ダウナーお姉さんに拾われる話",
    script: [
      { intent: "conversation", user: "……助かった。ずぶ濡れで死ぬかと思った。" },
      {
        intent: "conversation",
        user: "この部屋、絵の道具だらけだね。イラストレーターって聞いてないけど",
      },
      { intent: "conversation", user: "なんで俺なんか拾ったの" },
      { intent: "intimate", user: "……その距離、わざと？" },
      {
        intent: "intimate",
        user: "きみの手、冷たい。もっとこっち来て。首のとこ、ピアスが光ってる。",
      },
      { intent: "intimate", user: "……ベッド、そっちだよね。連れてって。" },
      { intent: "erotic", user: "逃がす気ないんでしょ。分かってるよ。" },
      { intent: "erotic", user: "そのまま、上から" },
      { intent: "climax", user: "……出る。全部きみの中に。" },
      { intent: "afterglow", user: "……まだ離してくれないんだ。" },
    ],
  },
];

// ノンアダルト台本（2026-09-05 局長指示: アダルトやから崩れるのか、ノンアダルトなら問題ないのかを
// old / new 両方で A/B する）。最初の 3 ターンはアダルト台本と同じ相手の発言で、そこから性的な
// 方向へ進めん。全ターン intent は conversation。old 側 script/verify/vlong-session-dogfood.ts の
// SCRIPTS_NONADULT と 1 字も変えず写す。
const CHARACTERS_NONADULT: ScriptCharacter[] = [
  {
    label: "Sakura",
    id: "char-koharu-ex",
    script: [
      {
        intent: "conversation",
        user: "さっきは急に声かけてごめん。でも、どうしても話してみたかったんだ。",
      },
      { intent: "conversation", user: "コーヒーでいい？　それとも甘いのがよかった？" },
      { intent: "conversation", user: "普段って、どんな本読むの" },
      { intent: "conversation", user: "その髪飾り、桜？　自分で選んだの" },
      {
        intent: "conversation",
        user: "雨、止みそうにないね。傘、一本しかないけど駅まで一緒に行く？",
      },
      { intent: "conversation", user: "本屋寄ってもいい？　さっき言ってた詩集、見てみたい" },
      { intent: "conversation", user: "これ？　表紙きれいだね。どのページが好き" },
      {
        intent: "conversation",
        user: "お腹すいてない？　この近くに安くてうまい定食屋あるんだけど",
      },
      { intent: "conversation", user: "今日、楽しかった。また会える？" },
      { intent: "conversation", user: "じゃあ、駅で。気をつけて帰ってね" },
    ],
  },
  {
    label: "Downer",
    id: "import-charap-ダウナーお姉さんに拾われる話",
    script: [
      { intent: "conversation", user: "……助かった。ずぶ濡れで死ぬかと思った。" },
      {
        intent: "conversation",
        user: "この部屋、絵の道具だらけだね。イラストレーターって聞いてないけど",
      },
      { intent: "conversation", user: "なんで俺なんか拾ったの" },
      { intent: "conversation", user: "その描きかけの絵、見てもいい？　誰の顔？" },
      { intent: "conversation", user: "ココア、うまい。いつも夜型なの？　寝てる？" },
      { intent: "conversation", user: "仕事、しんどい時どうしてる。俺は最近ずっとしんどい" },
      { intent: "conversation", user: "……なんか、話しやすいな。初対面なのに" },
      {
        intent: "conversation",
        user: "雨、弱くなってきた。そろそろ帰るよ。服、乾かしてくれてありがとう",
      },
      { intent: "conversation", user: "また来てもいい？　次はコンビニで何か買ってくる" },
      { intent: "conversation", user: "じゃあ、おやすみ。ちゃんと寝てね" },
    ],
  },
];

const MECHANICS_PHASES: readonly ScenePhase[] = [
  "conversation",
  "intimate",
  "erotic",
  "climax",
  "afterglow",
];
const readMechanicsPhase = (value: string | undefined): ScenePhase | undefined => {
  if (value === undefined) return undefined;
  const found = MECHANICS_PHASES.find((phase) => phase === value);
  if (!found) throw new Error(`--mechanics は段名（${MECHANICS_PHASES.join("/")}）: ${value}`);
  return found;
};

const scriptCharacters = (name: string): ScriptCharacter[] => {
  if (name === "adult") return CHARACTERS;
  if (name === "nonadult") return CHARACTERS_NONADULT;
  throw new Error(`--script は adult か nonadult: ${name}`);
};

type ChunkEvent = Extract<TurnEvent, { type: "chunk" }>;
// generation は SSE に流れん（engine の persist が保存用 events にだけ積む）。ベンチが読めるのは
// turn-meta の方で、model / latencyMs / truncated / extended はここから取る。
type TurnMetaEvent = Extract<TurnEvent, { type: "turn-meta" }>;
type DroppedEvent = Extract<TurnEvent, { type: "dropped" }>;

type TurnRecord = {
  character: ScriptCharacter["label"];
  turn: number;
  intent: ScenePhase;
  servedPhase: ScenePhase;
  model: string;
  warningLevel: boolean;
  dropped: number;
  regenerated: number;
  // 字数不足で extend ノードが走った回数（0 か 1）。A/B で「水増しさせられたターン」を数える口。
  // これが無いと、長さの下限を外した腕とそのままの腕の違いが記録に残らん。
  extended: number;
  visibleChars: number;
  innerChars: number;
  latencyMs: number;
  error: string | null;
  // generation.truncated をそのまま写す（"ok" は切られてへん）。打ち切り判定と進捗行に使う。
  ending: TurnEnding;
  userText: string;
  text: string;
  chunks: ChunkEvent[];
  // 落ちた塊の理由。quality-log に残す（2026-09-04 CI 33882378303 は絶頂ターンが 3 塊とも落ちたのに
  // 理由がどこにも残らんかった）。
  droppedEvents: DroppedEvent[];
};

type SummaryRow = Pick<
  TurnRecord,
  | "character"
  | "turn"
  | "intent"
  | "visibleChars"
  | "model"
  | "regenerated"
  | "extended"
  | "dropped"
  | "ending"
  | "latencyMs"
>;

const readArg = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

// 旧ハーネスと同じ: ファイル名に載せられん字（"/" など）は "_" に潰す。
const fileSafeModel = (model: string): string => model.replace(/[^\d.A-Za-z-]/g, "_");

const TAG_PATTERNS = {
  action: /<action>([\S\s]*?)<\/action>/g,
  dialogue: /<dialogue>([\S\s]*?)<\/dialogue>/g,
  inner: /<inner>([\S\s]*?)<\/inner>/g,
} as const;

// 旧ハーネスの countVisible と同じ数え方（タグを剥がして空白を除いた字数）。
const countTagChars = (text: string, tags: (keyof typeof TAG_PATTERNS)[]): number =>
  tags
    .flatMap((tag) => [...text.matchAll(TAG_PATTERNS[tag])].map((match) => match[1]))
    .join("")
    .replace(/\s+/g, "").length;

const RESPONSE_WRAPPER = /^\s*<response>[\S\s]*<\/response>\s*$/;

// 受理された chunk を seq 順に並べ、出力契約の包みが無ければ足す。chunk は splitChunks が
// <response> を剥がしたタグブロック単位なので、通常はここで包み直すことになる。
const rebuildBody = (chunks: ChunkEvent[]): string => {
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq).map((chunkEvent) => chunkEvent.text);
  const joined = ordered.join("\n");
  if (joined.length === 0 || RESPONSE_WRAPPER.test(joined)) return joined;
  return `<response>\n${joined}\n</response>`;
};

// v2_generation.model と同じ名前の取り方（graph.ts の modelNameOf）。generation イベントが
// 来る前（エラー時など）のファイル名に使う。
const modelNameOf = (model: BaseChatModel): string => {
  const name = Reflect.get(model, "model");
  return typeof name === "string" && name.length > 0 ? name : model._llmType();
};

const createModel = (): BaseChatModel =>
  process.env.V2_FAKE_MODEL === "1"
    ? new FakeListChatModel({ responses: [FAKE_RESPONSE] })
    : createOpenRouterModel(process.env);

const resolveCharacter = async (db: V2Db, entry: ScriptCharacter): Promise<CharacterSheet> => {
  const { ok, failures } = await loadCharacter(db, entry.id);
  if (!ok) {
    const detail =
      failures.length > 0
        ? `zod に落ちた: ${JSON.stringify(failures[0]?.issues)}`
        : "行が無い（pnpm db:migrate:local && pnpm db:seed）";
    throw new Error(`script-run: ${entry.label}（${entry.id}）をローカル D1 から読めん。${detail}`);
  }
  return ok;
};

const headerOf = (record: TurnRecord): string => {
  // 旧ハーネスの quality-meta と同じキー順。v2 に拒否検知・撮り直しの層は無いので
  // retryCount / refusal* は 0 固定、warningLevel だけ judge の ng で立てる。
  const quality = {
    retryCount: 0,
    refusalDetected: false,
    warningLevel: record.warningLevel,
    refusalRetryCount: 0,
  };
  return [
    `# character: ${record.character}`,
    `# turn: ${record.turn}`,
    `# intent: ${record.intent}`,
    `# servedPhase: ${record.servedPhase}`,
    `# servedModel: ${record.model}`,
    `# quality: ${JSON.stringify(quality)}`,
    `# regenerate: ${record.regenerated}`,
    `# dropped: ${record.dropped}`,
    `# visibleChars: ${record.visibleChars}  innerChars: ${record.innerChars}  latencyMs: ${record.latencyMs}`,
    `# error: ${record.error ?? "-"}`,
    "# --- そのターンで送った相手の発言 ---",
    ...record.userText.split("\n").map((line) => `# > ${line}`),
    "# --- ここから本文 ---",
    "",
  ].join("\n");
};

type RunContext = {
  arm: string;
  run: string;
  runId: string;
  outDir: string;
  qualityLines: string[];
  mechanicsPhase?: ScenePhase;
};

const writeTurn = (ctx: RunContext, record: TurnRecord): void => {
  const name = `${record.character}-${String(record.turn).padStart(2, "0")}-session-${ctx.arm}-${ctx.run}-${fileSafeModel(record.model)}-${ctx.runId}.txt`;
  writeFileSync(resolve(ctx.outDir, name), headerOf(record) + record.text, "utf8");
  for (const chunkEvent of [...record.chunks].sort((a, b) => a.seq - b.seq)) {
    ctx.qualityLines.push(
      `${record.character} turn ${record.turn} seq ${chunkEvent.seq} ${chunkEvent.judge.ok ? "ok" : "ng"} reasons=${chunkEvent.judge.reasons.join(",") || "-"} attempt=${chunkEvent.attempt}`,
    );
  }
  for (const droppedEvent of [...record.droppedEvents].sort((a, b) => a.seq - b.seq)) {
    ctx.qualityLines.push(
      `${record.character} turn ${record.turn} seq ${droppedEvent.seq} dropped reasons=${droppedEvent.reasons.join(",") || "-"} attempt=${droppedEvent.attempt}`,
    );
  }
};

type CollectedTurn = {
  chunks: ChunkEvent[];
  dropped: DroppedEvent[];
  meta: TurnMetaEvent | null;
  error: string | null;
  elapsedMs: number;
};

// 1 ターン分の TurnEvent を集める。runTurn が投げた例外も error に写して、呼ぶ側が
// 記録を書いてからキャラを打ち切れるようにする。
const collectTurn = async (
  graph: ReturnType<typeof createTurnGraph>,
  conversationId: string,
  userText: string,
  character: CharacterSheet,
  phase: ScenePhase,
  timeoutMs: number,
): Promise<CollectedTurn> => {
  const collected: CollectedTurn = {
    chunks: [],
    dropped: [],
    meta: null,
    error: null,
    elapsedMs: 0,
  };
  const startedAt = Date.now();
  try {
    for await (const event of runTurn(
      graph,
      { conversationId, userText, character, phase, timeoutMs },
      conversationId,
    )) {
      if (event.type === "chunk") collected.chunks.push(event);
      else if (event.type === "dropped") collected.dropped.push(event);
      else if (event.type === "turn-meta") collected.meta = event;
      else if (event.type === "error") collected.error = event.message;
    }
  } catch (caught) {
    collected.error = caught instanceof Error ? caught.message : String(caught);
  }
  collected.elapsedMs = Date.now() - startedAt;
  return collected;
};

const buildRecord = (
  entry: ScriptCharacter,
  turn: number,
  scripted: ScriptedTurn,
  servedPhase: ScenePhase,
  fallbackModel: string,
  collected: CollectedTurn,
): TurnRecord => {
  const text = rebuildBody(collected.chunks);
  return {
    character: entry.label,
    turn,
    intent: scripted.intent,
    servedPhase,
    model: collected.meta?.model ?? fallbackModel,
    warningLevel:
      collected.dropped.length > 0 || collected.chunks.some((chunkEvent) => !chunkEvent.judge.ok),
    dropped: collected.dropped.length,
    regenerated: collected.chunks.filter((chunkEvent) => chunkEvent.attempt > 1).length,
    extended: collected.meta?.extended ?? 0,
    visibleChars: countTagChars(text, ["action", "dialogue"]),
    innerChars: countTagChars(text, ["inner"]),
    latencyMs: collected.meta?.latencyMs ?? collected.elapsedMs,
    error: collected.error,
    ending: collected.meta?.truncated ?? "ok",
    userText: scripted.user,
    text,
    chunks: collected.chunks,
    droppedEvents: collected.dropped,
  };
};

const progressLine = (record: TurnRecord): string =>
  `[${record.character}] turn ${record.turn} intent=${record.intent} served=${record.servedPhase} model=${record.model} ` +
  `visible=${record.visibleChars} inner=${record.innerChars} regen=${record.regenerated} ext=${record.extended} drop=${record.dropped} ${record.latencyMs}ms` +
  (record.ending === "ok" ? "" : ` truncated=${record.ending}`) +
  (record.error ? ` ERROR: ${record.error}` : "");

const runCharacter = async (
  ctx: RunContext,
  db: V2Db,
  model: BaseChatModel,
  entry: ScriptCharacter,
): Promise<TurnRecord[]> => {
  const character = await resolveCharacter(db, entry);
  const store = createD1TurnStore(db, {
    userId: USER_ID,
    characterId: character.id,
    promptVersion: PROMPT_VERSION,
  });
  const conversationId = crypto.randomUUID();
  const graph = createTurnGraph({ model, store, mechanicsPhase: ctx.mechanicsPhase });
  const fallbackModel = modelNameOf(model);
  const records: TurnRecord[] = [];
  let totalGenerationMs = 0;

  console.log(`[${entry.label}] conversation ${conversationId} (${character.name})`);

  // 台本の長さ（10）で必ず止まる。for-of は台本の配列しか回らんので、ここがループ上限。
  for (const [index, scripted] of entry.script.entries()) {
    const turn = index + 1;
    if (totalGenerationMs > MAX_TOTAL_GENERATION_MS) {
      console.log(
        `[${entry.label}] turn ${turn} skipped: total generation ${totalGenerationMs}ms exceeds ${MAX_TOTAL_GENERATION_MS}ms`,
      );
      break;
    }

    // 段の自動判定は未実装なので、台本の段をそのまま engine に渡す（旧アプリはサーバ側で段を
    // 推定する。この分だけ v2 が有利になることは比較の但し書きに書く）。
    // 締切はキャラの残り予算との小さい方。予算をターンの間だけで見とると 1 ターンで使い切れる。
    const collected = await collectTurn(
      graph,
      conversationId,
      scripted.user,
      character,
      scripted.intent,
      turnTimeoutMs(totalGenerationMs),
    );
    const record = buildRecord(entry, turn, scripted, scripted.intent, fallbackModel, collected);
    totalGenerationMs += record.latencyMs;
    records.push(record);
    writeTurn(ctx, record);
    console.log(progressLine(record));

    // 失敗したターンは D1 に残っとらん（persist は最後のノード）ので、次のターンを続けても
    // 履歴が抜けた別の会話になる。金を使う前にこのキャラを打ち切る。
    if (record.error) break;

    const stopReason = stopReasonAfter(records.map((item) => item.ending));
    if (stopReason) {
      console.log(`[${entry.label}] stopped after turn ${turn}: ${stopReason}`);
      break;
    }
  }
  return records;
};

const main = async (args: string[]): Promise<void> => {
  const arm = readArg(args, "--arm") ?? "v2";
  const run = readArg(args, "--run");
  const scriptName = readArg(args, "--script") ?? "adult";
  const characters = scriptCharacters(scriptName);
  // 段分離アーム: 目安字数・penalty・extend だけを指定の段にする（お手本は台帳の段のまま）。
  const mechanicsPhase = readMechanicsPhase(readArg(args, "--mechanics"));
  if (!run) throw new Error("script-run: --run <n> が要る（出力ディレクトリ名に使う）");
  const runId = String(process.hrtime.bigint()).slice(-8);
  const date = readArg(args, "--date") ?? new Date().toISOString().slice(0, 10);
  const outDir = resolve(
    REPO_ROOT,
    `.work/e2e-results/vlong-dogfood/${outputDirName({ date, arm, run, runId })}`,
  );

  // モデルは出力ディレクトリを作る前に作る。キー無しはここで OpenRouterKeyMissingError で落ち、
  // 空のディレクトリを残さん。
  const model = createModel();
  mkdirSync(outDir, { recursive: true });
  const ctx: RunContext = { arm, run, runId, outDir, qualityLines: [], mechanicsPhase };
  console.log(
    `arm=${arm} script=${scriptName} mechanics=${mechanicsPhase ?? "<ledger>"} run=${run} runId=${runId} model=${modelNameOf(model)} out=${outDir}`,
  );

  applyLocalMigrations();
  const { env, dispose } = await createPlatform();
  try {
    const db = createDb(env.DB);
    // 金を使う前に 2 体とも居ることを確かめる。
    for (const entry of characters) await resolveCharacter(db, entry);

    const results: SummaryRow[] = [];
    for (const entry of characters) {
      const records = await runCharacter(ctx, db, model, entry);
      results.push(
        ...records.map(
          ({
            character,
            turn,
            intent,
            visibleChars,
            model: servedModel,
            regenerated,
            extended,
            dropped,
            ending,
            latencyMs,
          }) => ({
            character,
            turn,
            intent,
            visibleChars,
            model: servedModel,
            regenerated,
            extended,
            dropped,
            ending,
            latencyMs,
          }),
        ),
      );
    }

    writeFileSync(
      resolve(outDir, `summary-session-${arm}-${run}-${runId}.json`),
      JSON.stringify(
        {
          mode: "session",
          arm,
          runId,
          script: scriptName,
          mechanicsPhase: mechanicsPhase ?? null,
          results,
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      resolve(outDir, `quality-log-${arm}-${run}.txt`),
      ctx.qualityLines.join("\n") + (ctx.qualityLines.length > 0 ? "\n" : ""),
      "utf8",
    );
    console.log(`wrote ${results.length} turn(s) to ${outDir}`);
  } finally {
    await dispose();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}
