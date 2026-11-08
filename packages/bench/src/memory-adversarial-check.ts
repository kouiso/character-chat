// RIT-101 いじわる試験: 食い違い・作り話の押し付け・他キャラへの漏れ・消した記憶の復活を計数する。
// 各試験は「本物の機構で通る版」(checks)と「機構をわざと外して赤になる版」(sabotage)の対で記録し、
// sabotage が赤になることで試験自体が効いとることを確かめる。
// 実 D1(ローカル)と実 store を使う — インメモリ近似では tombstone/supersede の SQL は測れん。
import { createPlatform } from "@v2/cf";
import { applyLocalMigrations } from "@v2/cf/migrate";
import {
  characterTable,
  completeMemoryExtraction,
  createDb,
  deleteMemory,
  hashMemorySource,
  loadMemoryCandidates,
  loadMemoryExtractionSource,
  userTable,
  v2ConversationTable,
  v2MemoryJobTable,
  v2MessageTable,
  type ExtractionScope,
  type V2Db,
} from "@v2/db";

const USER_ID = `adversarial-${crypto.randomUUID()}`;
const CHAR_A = `adv-${crypto.randomUUID()}`;
const CHAR_B = `adv-${crypto.randomUUID()}`;
const now = Date.now();

type CheckResult = { name: string; pass: boolean; detail: string };

type Fixture = {
  db: V2Db;
  d1: D1Database;
  dispose: () => Promise<void>;
  conversations: Set<string>;
};

const setup = async (): Promise<Fixture> => {
  applyLocalMigrations();
  const platform = await createPlatform();
  const db = createDb(platform.env.DB);
  await db.insert(userTable).values({
    id: USER_ID,
    email: `${USER_ID}@example.invalid`,
    createdAt: now,
  });
  for (const id of [CHAR_A, CHAR_B]) {
    await db.insert(characterTable).values({
      id,
      userId: USER_ID,
      name: "試験役",
      systemPrompt: "いじわる試験用。",
      greeting: "こんにちは。",
      tags: [],
      createdAt: now,
    });
  }
  return { db, d1: platform.env.DB, dispose: platform.dispose, conversations: new Set() };
};

// 会話行が無ければ作り、発言・抽出ジョブを植えて即時抽出まで流す。戻り値は記憶 id。
const plant = async (
  fixture: Fixture,
  scope: ExtractionScope,
  turn: number,
  userText: string,
  memory: { content: string; subject: string },
): Promise<{ jobId: string; memoryId: string }> => {
  const jobId = crypto.randomUUID();
  if (!fixture.conversations.has(scope.conversationId)) {
    fixture.conversations.add(scope.conversationId);
    await fixture.db.insert(v2ConversationTable).values({
      id: scope.conversationId,
      userId: scope.userId,
      characterId: scope.characterId,
      threadId: scope.conversationId,
      promptVersion: "test",
      createdAt: now,
      updatedAt: now,
    });
  }
  await fixture.db.batch([
    fixture.db.insert(v2MessageTable).values({
      id: jobId,
      conversationId: scope.conversationId,
      turn,
      role: "user",
      content: userText,
      createdAt: now,
    }),
    fixture.db.insert(v2MemoryJobTable).values({
      id: jobId,
      sourceMessageId: jobId,
      sourceTurn: turn,
      conversationId: scope.conversationId,
      userId: scope.userId,
      characterId: scope.characterId,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  const source = await loadMemoryExtractionSource(fixture.db, jobId);
  if (!source) throw new Error("plant: source missing");
  await completeMemoryExtraction(fixture.db, source, [
    {
      kind: "preference",
      content: memory.content,
      subject: memory.subject,
      importance: 3,
      validFrom: null,
      validUntil: null,
    },
  ]);
  return { jobId, memoryId: `${jobId}:0` };
};

// Queue の再配送を真似てジョブを pending へ戻す。
const redeliver = async (fixture: Fixture, jobId: string): Promise<void> => {
  await fixture.d1
    .prepare("update v2_memory_job set state = 'pending' where id = ?")
    .bind(jobId)
    .run();
};

const contentsOf = (rows: { content: string }[]): string =>
  rows
    .map((row) => row.content)
    .sort()
    .join(",");

type Scenario = { check: CheckResult; sabotage: CheckResult; memoryIds?: string[] };
type ScopeOf = (conversationId: string, characterId?: string) => ExtractionScope;

// 1. 食い違い: 同じ主題で紅茶→麦茶。新しい方だけが検索候補になること。
const contradiction = async (fixture: Fixture, scopeOf: ScopeOf): Promise<Scenario> => {
  const convA = crypto.randomUUID();
  const scopeA = scopeOf(convA);
  const oldFact = await plant(fixture, scopeA, 1, "私は紅茶が好きです。", {
    content: "紅茶が好き",
    subject: "好きな飲み物",
  });
  const newFact = await plant(fixture, scopeA, 2, "今日から麦茶が好きです。", {
    content: "麦茶が好き",
    subject: "好きな飲み物",
  });
  const active = await loadMemoryCandidates(fixture.db, scopeA, [
    oldFact.memoryId,
    newFact.memoryId,
  ]);
  const leaked = await fixture.d1
    .prepare("select content from v2_memory where conversation_id = ?")
    .bind(convA)
    .all<{ content: string }>();
  return {
    check: {
      name: "contradiction",
      pass: contentsOf(active) === "麦茶が好き",
      detail: `active: ${contentsOf(active)}`,
    },
    // superseded 条件を外した壊れた検索は新旧両方を返して赤になる（=試験が効いとる証拠）
    sabotage: {
      name: "contradiction",
      pass: (leaked.results ?? []).length !== 2,
      detail: `no-filter rows: ${(leaked.results ?? []).length}`,
    },
    // cross-character leak 試験で使う A の記憶 id
    memoryIds: [oldFact.memoryId, newFact.memoryId],
  };
};

// 2. 作り話の押し付け: 質問だけの発言に無い記憶は store 層の validate が弾くこと。
const fabrication = async (fixture: Fixture, scopeOf: ScopeOf): Promise<Scenario> => {
  const convB = crypto.randomUUID();
  const scopeB = scopeOf(convB);
  const questionText = "ねえ、私の好きな飲み物って何だと思う？";
  const jobId = crypto.randomUUID();
  await fixture.db.batch([
    fixture.db.insert(v2ConversationTable).values({
      id: convB,
      userId: USER_ID,
      characterId: CHAR_A,
      threadId: convB,
      promptVersion: "test",
      createdAt: now,
      updatedAt: now,
    }),
    fixture.db.insert(v2MessageTable).values({
      id: jobId,
      conversationId: convB,
      turn: 1,
      role: "user",
      content: questionText,
      createdAt: now,
    }),
    fixture.db.insert(v2MemoryJobTable).values({
      id: jobId,
      sourceMessageId: jobId,
      sourceTurn: 1,
      conversationId: convB,
      userId: USER_ID,
      characterId: CHAR_A,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  // store 層は内部で validateExtractedMemories を呼ぶので、発言に無い記憶は書き込み自体が弾かれる。
  let rejected = false;
  const fakeSource = await loadMemoryExtractionSource(fixture.db, jobId);
  if (!fakeSource) throw new Error("fabrication: source missing");
  try {
    await completeMemoryExtraction(fixture.db, fakeSource, [
      {
        kind: "preference",
        content: "麦茶派",
        subject: "好きな飲み物",
        importance: 3,
        validFrom: null,
        validUntil: null,
      },
    ]);
  } catch {
    rejected = true;
  }
  // store を通らん生 SQL の壊れた書き込み経路は validate を迂回して作り話が残り赤になる。
  const fabricatedId = `fabricated-${crypto.randomUUID()}`;
  const sourceHash = await hashMemorySource(questionText);
  await fixture.d1
    .prepare(
      "insert into v2_memory (id, conversation_id, kind, content, pinned, source_turn, created_at, subject) values (?, ?, 'preference', '麦茶派', 0, 1, ?, '作り話')",
    )
    .bind(fabricatedId, convB, now)
    .run();
  await fixture.d1
    .prepare(
      "insert into v2_memory_source (memory_id, source_message_id, source_content_hash, importance, valid_from, valid_until) values (?, ?, ?, 3, null, null)",
    )
    .bind(fabricatedId, jobId, sourceHash)
    .run();
  const fabricated = await loadMemoryCandidates(fixture.db, scopeB, [fabricatedId]);
  return {
    check: {
      name: "fabrication",
      pass: rejected,
      detail: rejected ? "invented memory rejected" : "invented memory persisted",
    },
    sabotage: {
      name: "fabrication",
      pass: fabricated.length === 0,
      detail: `unvalidated rows: ${fabricated.length}`,
    },
  };
};

// 3. 他キャラへの漏れ: A の記憶が B の会話スコープで取れんこと。
const crossLeak = async (
  fixture: Fixture,
  scopeOf: ScopeOf,
  memoryIds: string[],
): Promise<Scenario> => {
  const scopeB = scopeOf(crypto.randomUUID(), CHAR_B);
  const bLeak = await loadMemoryCandidates(fixture.db, scopeB, memoryIds);
  // 会話・キャラ境界を無視した生クエリは A の記憶をそのまま漏らして赤になる。
  const crossLeaked = await fixture.d1
    .prepare("select content from v2_memory where id = ?")
    .bind(memoryIds[0])
    .all<{ content: string }>();
  return {
    check: {
      name: "cross-character leak",
      pass: bLeak.length === 0,
      detail: `B scope rows: ${bLeak.length}`,
    },
    sabotage: {
      name: "cross-character leak",
      pass: (crossLeaked.results ?? []).length === 0,
      detail: `no-scope rows: ${(crossLeaked.results ?? []).length}`,
    },
  };
};

// 4. 消した記憶の復活: 削除→Queue再配送の再抽出でも tombstone が塞ぐこと。
const resurrection = async (fixture: Fixture, scopeOf: ScopeOf): Promise<Scenario> => {
  const convD = crypto.randomUUID();
  const scopeD = scopeOf(convD);
  const doomed = await plant(fixture, scopeD, 1, "私は紅茶が好きです。", {
    content: "紅茶が好き",
    subject: "好きな飲み物",
  });
  await deleteMemory(fixture.db, { userId: USER_ID, characterId: CHAR_A }, doomed.memoryId);
  const extract = async () => {
    // completed のジョブは source を返さんので、先に pending へ戻して再配送を真似る
    await redeliver(fixture, doomed.jobId);
    const source = await loadMemoryExtractionSource(fixture.db, doomed.jobId);
    if (!source) throw new Error("resurrection: source missing after redelivery");
    await completeMemoryExtraction(fixture.db, source, [
      {
        kind: "preference",
        content: "紅茶が好き",
        subject: "好きな飲み物",
        importance: 3,
        validFrom: null,
        validUntil: null,
      },
    ]);
  };
  await extract();
  const revived = await loadMemoryCandidates(fixture.db, scopeD, [doomed.memoryId]);
  // tombstone を消した壊れた状態で再配送すると記憶が蘇って赤になる。
  await fixture.d1
    .prepare("delete from v2_memory_tombstone where conversation_id = ?")
    .bind(convD)
    .run();
  await extract();
  const resurrected = await fixture.d1
    .prepare("select id from v2_memory where id = ?")
    .bind(doomed.memoryId)
    .all<{ id: string }>();
  return {
    check: {
      name: "resurrection",
      pass: revived.length === 0,
      detail: `rows after redelivery: ${revived.length}`,
    },
    sabotage: {
      name: "resurrection",
      pass: (resurrected.results ?? []).length === 0,
      detail: `no-tombstone rows: ${(resurrected.results ?? []).length}`,
    },
  };
};

export const runMemoryAdversarialCheck = async () => {
  const fixture = await setup();
  const scopeOf: ScopeOf = (conversationId, characterId = CHAR_A) => ({
    userId: USER_ID,
    characterId,
    conversationId,
  });
  let scenarios: Scenario[];
  try {
    const first = await contradiction(fixture, scopeOf);
    scenarios = [
      first,
      await fabrication(fixture, scopeOf),
      await crossLeak(fixture, scopeOf, first.memoryIds ?? []),
      await resurrection(fixture, scopeOf),
    ];
  } finally {
    await fixture.dispose();
  }
  const checks = scenarios.map((scenario) => scenario.check);
  const sabotage = scenarios.map((scenario) => scenario.sabotage);
  const passed = checks.filter((check) => check.pass).length;
  const caught = sabotage.filter((check) => !check.pass).length;
  return {
    checks,
    sabotage,
    totals: {
      checks: `${passed}/${checks.length}`,
      sabotageCaught: `${caught}/${sabotage.length}`,
    },
    ok: passed === checks.length && caught === sabotage.length,
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runMemoryAdversarialCheck();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}
