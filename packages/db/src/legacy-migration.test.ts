// RIT-77 の台帳つき取り込みの結合試験。手元の D1 に旧表を種まき、計画と書き込みの
// 件数・要確認の符号・台帳の行を確かめる。v2 conversation list の試験は従来どおり末尾に残す。
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { conversationTable } from "../../../src/schema/conversation";
import { messageTable } from "../../../src/schema/message";
import { userTable } from "../../../src/schema/user";

import {
  LegacyPlanChangedError,
  listConversations,
  migrateLegacyConversations,
  verifyLegacyConversations,
} from "./legacy-migration";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import {
  createD1TurnStore,
  ensureConversationVersion,
  readDisplayHistory,
  readOwnedImageKey,
} from "./turn-store";
import {
  v2ChunkTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2LegacyImportTable,
  v2MessageTable,
} from "./v2-schema";

const TARGET = "local";

const cleanup = async (local: LocalD1, owners: string[], conversationIds: string[]) => {
  const messageIds = local.db
    .select({ id: v2MessageTable.id })
    .from(v2MessageTable)
    .where(inArray(v2MessageTable.conversationId, conversationIds));
  await local.db.delete(v2ChunkTable).where(inArray(v2ChunkTable.messageId, messageIds));
  await local.db
    .delete(v2MessageTable)
    .where(inArray(v2MessageTable.conversationId, conversationIds));
  await local.db
    .delete(v2LedgerTable)
    .where(inArray(v2LedgerTable.conversationId, conversationIds));
  await local.db
    .delete(v2LegacyImportTable)
    .where(inArray(v2LegacyImportTable.conversationId, conversationIds));
  await local.db
    .delete(v2GenerationTable)
    .where(inArray(v2GenerationTable.conversationId, conversationIds));
  await local.db
    .delete(v2ConversationTable)
    .where(inArray(v2ConversationTable.id, conversationIds));
  await local.db.delete(messageTable).where(inArray(messageTable.conversationId, conversationIds));
  await local.db.delete(conversationTable).where(inArray(conversationTable.id, conversationIds));
  await local.db.delete(userTable).where(inArray(userTable.id, owners));
};

type SeedMessage = {
  role?: "user" | "assistant" | "system";
  content?: string;
  imageKey?: string;
  userId?: string;
  characterId?: string;
};

type SeedResult = {
  owner: string;
  conversationId: string;
  options: { sourceUserId: string; targetUserId: string };
};

const seedMessages = async (
  local: LocalD1,
  characterId: string,
  owner: string,
  conversationId: string,
  messages: SeedMessage[],
): Promise<void> => {
  for (const [index, message] of messages.entries()) {
    await local.db.insert(messageTable).values({
      id: `${conversationId}-m${index}`,
      conversationId,
      userId: message.userId ?? owner,
      characterId: message.characterId ?? characterId,
      role: message.role ?? (index % 2 === 0 ? "user" : "assistant"),
      content: message.content ?? `発言 ${index + 1}`,
      createdAt: index + 1,
      imageKey: message.imageKey ?? null,
    });
  }
};

const seedOne = async (
  local: LocalD1,
  characterId: string,
  owners: string[],
  conversationIds: string[],
  suffix: string,
  messages: SeedMessage[],
  conversationOverrides: { characterId?: string; updatedAt?: number; owner?: string } = {},
): Promise<SeedResult> => {
  const owner = conversationOverrides.owner ?? `migration-test-${crypto.randomUUID()}`;
  owners.push(owner);
  const conversationId = `${owner}-${suffix}`;
  conversationIds.push(conversationId);
  if (conversationOverrides.owner === undefined) {
    await local.db
      .insert(userTable)
      .values({ id: owner, email: `${owner}@example.invalid`, createdAt: 1 });
  }
  await local.db.insert(conversationTable).values({
    id: conversationId,
    userId: owner,
    characterId: conversationOverrides.characterId ?? characterId,
    title: "旧会話",
    createdAt: 1,
    updatedAt: conversationOverrides.updatedAt ?? 4,
  });
  await seedMessages(local, characterId, owner, conversationId, messages);
  return { owner, conversationId, options: { sourceUserId: owner, targetUserId: TARGET } };
};

const ledgerRows = async (local: LocalD1, conversationId: string) =>
  local.db
    .select()
    .from(v2LegacyImportTable)
    .where(eq(v2LegacyImportTable.conversationId, conversationId));

describe("legacy migration（台帳つき取り込み）", () => {
  let local: LocalD1;
  let characterId: string;
  const owners: string[] = [];
  const conversationIds: string[] = [];

  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    characterId = character.id;
  });
  afterAll(async () => {
    await cleanup(local, owners, conversationIds);
    await local.dispose();
  });

  it("初回は会話・発言・台帳を写し、2回目は書く物が 0 になる", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [
        { role: "assistant", content: "挨拶" },
        { role: "user", content: "呼びかけ" },
        { role: "assistant", content: "返事" },
        { role: "assistant", content: "連続した返事", imageKey: "kept.png" },
        { role: "system", content: "旧アプリの指示" },
      ],
    );
    const first = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(first).toMatchObject({
      conversations: 1,
      messages: 4,
      insertedConversations: 1,
      insertedMessages: 4,
      skippedSystemMessages: 1,
      failures: [],
      nextCursor: null,
    });
    // 台帳: 会話 1 + 発言 4。番号は system を除いて 1 から通し。
    const rows = await ledgerRows(local, conversationId);
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.legacyTable === "conversation")).toHaveLength(1);
    const stored = await local.db
      .select()
      .from(v2MessageTable)
      .where(eq(v2MessageTable.conversationId, conversationId));
    expect(stored.map((row) => row.turn).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(stored.find((row) => row.turn === 4)?.imageKey).toBe("kept.png");

    const second = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(second).toMatchObject({
      insertedConversations: 0,
      insertedMessages: 0,
      updatedConversations: 0,
      backfilledLedgerRows: 0,
      backfilledImageKeys: 0,
      failures: [],
    });
    const verify = await verifyLegacyConversations(local.db, options);
    expect(verify.items[0]).toMatchObject({ conversationId, status: "match", matchedMessages: 4 });
    expect(verify.imageRefs).toEqual({ source: 1, v2: 1 });
  });

  it("途中で止めても会話単位で確定し、再開で残りだけを書く", async () => {
    const first = await seedOne(local, characterId, owners, conversationIds, "a", [
      { role: "assistant" },
      { role: "user" },
    ]);
    const second = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "b",
      [{ role: "user" }, { role: "assistant" }],
      { owner: first.owner },
    );
    const options = { sourceUserId: first.owner, targetUserId: TARGET };
    await expect(
      migrateLegacyConversations(local.db, {
        ...options,
        apply: true,
        afterConversation: (done) => {
          if (done === 1) throw new Error("interrupted");
        },
      }),
    ).rejects.toThrow("interrupted");
    // 1 会話目は確定済み（-a < -b なので -a が先）。
    expect(await ledgerRows(local, first.conversationId)).toHaveLength(3);
    expect(await ledgerRows(local, second.conversationId)).toHaveLength(0);
    const resumed = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(resumed).toMatchObject({ insertedConversations: 1, insertedMessages: 2, failures: [] });
  });

  it("移行元の本文・役・日時・番号が変わった旧発言は source_changed で飛ばす", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }, { role: "assistant" }],
    );
    await migrateLegacyConversations(local.db, { ...options, apply: true });
    await local.db
      .update(messageTable)
      .set({ content: "後で書き換えた" })
      .where(eq(messageTable.id, `${conversationId}-m0`));
    const result = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(result.failures).toEqual([{ conversationId, code: "source_changed" }]);
    const [unchanged] = await local.db
      .select()
      .from(v2MessageTable)
      .where(eq(v2MessageTable.id, `${conversationId}-m0`));
    expect(unchanged.content).toBe("発言 1");
  });

  it("旧発言の利用者・キャラが会話と違えば source_owner_mismatch", async () => {
    const intruder = `intruder-${crypto.randomUUID()}`;
    owners.push(intruder);
    await local.db
      .insert(userTable)
      .values({ id: intruder, email: `${intruder}@example.invalid`, createdAt: 1 });
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }, { role: "assistant", userId: intruder }],
    );
    const dry = await migrateLegacyConversations(local.db, options);
    expect(dry.failures).toEqual([{ conversationId, code: "source_owner_mismatch" }]);
    const applied = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(applied.insertedConversations).toBe(0);
    expect(await ledgerRows(local, conversationId)).toHaveLength(0);
  });

  it("v2 に別物の会話が在れば destination_conflict で飛ばす", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }],
    );
    // 別アプリが先に同じ id で書いた会話（prompt_version が違う）。
    await local.db.insert(v2ConversationTable).values({
      id: conversationId,
      userId: TARGET,
      characterId,
      threadId: conversationId,
      promptVersion: "v2-native",
      createdAt: 1,
      updatedAt: 1,
    });
    const result = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(result.failures).toEqual([{ conversationId, code: "destination_conflict" }]);
    expect(result.insertedConversations).toBe(0);
  });

  it("v2 で消した会話は台帳の行だけ残して戻さない", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }, { role: "assistant" }],
    );
    await migrateLegacyConversations(local.db, { ...options, apply: true });
    await local.db.delete(v2MessageTable).where(eq(v2MessageTable.conversationId, conversationId));
    await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, conversationId));
    const result = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(result).toMatchObject({
      skippedDeletedConversations: 1,
      skippedDeletedMessages: 2,
      insertedConversations: 0,
      failures: [],
    });
    expect(
      await local.db
        .select()
        .from(v2ConversationTable)
        .where(eq(v2ConversationTable.id, conversationId)),
    ).toHaveLength(0);
    const verify = await verifyLegacyConversations(local.db, options);
    expect(verify.items[0]?.status).toBe("deleted_in_v2");
  });

  it("v2 で消した発言は台帳で見分けて挿し直さない", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }, { role: "assistant" }, { role: "user" }],
    );
    await migrateLegacyConversations(local.db, { ...options, apply: true });
    await local.db.delete(v2MessageTable).where(eq(v2MessageTable.id, `${conversationId}-m1`));
    const result = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(result).toMatchObject({
      skippedDeletedMessages: 1,
      insertedMessages: 0,
      failures: [],
    });
    expect(
      await local.db
        .select()
        .from(v2MessageTable)
        .where(eq(v2MessageTable.id, `${conversationId}-m1`)),
    ).toHaveLength(0);
    // verify でも match（消した発言は一致の条件に含まれん）。
    const verify = await verifyLegacyConversations(local.db, options);
    expect(verify.items[0]).toMatchObject({ status: "match", deletedMessagesInV2: 1 });
  });

  it("v2 で続けた後の旧発言は skippedAfterV2Continue に数えて書かない", async () => {
    const { conversationId, options, owner } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }, { role: "assistant" }],
    );
    await migrateLegacyConversations(local.db, { ...options, apply: true });
    // v2 で続きを書く（saveTurn と同じく v2_ledger に番号を残す）。
    await local.db.insert(v2MessageTable).values({
      id: `${conversationId}-v2new`,
      conversationId,
      turn: 3,
      role: "assistant",
      content: "v2 の返事",
      createdAt: 10,
    });
    await local.db.insert(v2LedgerTable).values({
      conversationId,
      turn: 3,
      ledgerJson: "{}",
      createdAt: 10,
    });
    // 旧アプリ側にも新しい発言が来た（v2 の続きより古い番号は来ない想定だが、時差で来る）。
    await local.db.insert(messageTable).values({
      id: `${conversationId}-late`,
      conversationId,
      userId: owner,
      characterId,
      role: "assistant",
      content: "旧で追加",
      createdAt: 3,
    });
    const result = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(result).toMatchObject({ skippedAfterV2Continue: 1, insertedMessages: 0, failures: [] });
    // 再実行しても台帳を書かないので同じく数える。
    const again = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(again.skippedAfterV2Continue).toBe(1);
    const verify = await verifyLegacyConversations(local.db, options);
    expect(verify.items[0]).toMatchObject({ status: "match", skippedAfterV2Continue: 1 });
  });

  it("旧から消えて v2 に残る発言は source_deleted で要確認にする", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }, { role: "assistant" }, { role: "user" }],
    );
    await migrateLegacyConversations(local.db, { ...options, apply: true });
    await local.db.delete(messageTable).where(eq(messageTable.id, `${conversationId}-m2`));
    const result = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(result.failures).toEqual([{ conversationId, code: "source_deleted" }]);
    // v2 側の行はそのまま残る。
    const rows = await local.db
      .select()
      .from(v2MessageTable)
      .where(eq(v2MessageTable.conversationId, conversationId));
    expect(rows).toHaveLength(3);
    const verify = await verifyLegacyConversations(local.db, options);
    expect(verify.items[0]).toMatchObject({ status: "mismatch", code: "source_deleted" });
  });

  it("旧会話ごと消えた行は source_conversation_deleted、由来が不明なら source_owner_unknown", async () => {
    const mine = await seedOne(local, characterId, owners, conversationIds, "gone", [
      { role: "user" },
    ]);
    const orphan = await seedOne(local, characterId, owners, conversationIds, "orphan", [
      { role: "user" },
    ]);
    const options = { sourceUserId: mine.owner, targetUserId: TARGET };
    await migrateLegacyConversations(local.db, { ...options, apply: true });
    // orphan は旧のまま移行してから legacy_source_user_id と台帳を消して由来不明にする。
    await migrateLegacyConversations(local.db, {
      sourceUserId: orphan.owner,
      targetUserId: TARGET,
      apply: true,
    });
    await local.db
      .update(v2ConversationTable)
      .set({ legacySourceUserId: null })
      .where(eq(v2ConversationTable.id, orphan.conversationId));
    await local.db
      .delete(v2LegacyImportTable)
      .where(eq(v2LegacyImportTable.conversationId, orphan.conversationId));
    // どちらも旧表から消す。
    for (const id of [mine.conversationId, orphan.conversationId]) {
      await local.db.delete(messageTable).where(eq(messageTable.conversationId, id));
      await local.db.delete(conversationTable).where(eq(conversationTable.id, id));
    }
    const result = await migrateLegacyConversations(local.db, options);
    expect(result.failures).toHaveLength(2);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        { conversationId: mine.conversationId, code: "source_conversation_deleted" },
        { conversationId: orphan.conversationId, code: "source_owner_unknown" },
      ]),
    );
    // 欠落の報告は後続のページ頭スキャンに残るので、確かめたら掃除する。
    for (const id of [mine.conversationId, orphan.conversationId]) {
      await local.db.delete(v2MessageTable).where(eq(v2MessageTable.conversationId, id));
      await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, id));
    }
  });

  it("apply の expected と計画が違えば LegacyPlanChangedError で何も書かない", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }, { role: "assistant" }],
    );
    const planned = await migrateLegacyConversations(local.db, options);
    await expect(
      migrateLegacyConversations(local.db, {
        ...options,
        apply: true,
        expected: {
          insertedConversations: planned.insertedConversations,
          insertedMessages: planned.insertedMessages + 1,
        },
      }),
    ).rejects.toThrow(LegacyPlanChangedError);
    expect(await ledgerRows(local, conversationId)).toHaveLength(0);
    expect(
      await local.db
        .select()
        .from(v2MessageTable)
        .where(eq(v2MessageTable.conversationId, conversationId)),
    ).toHaveLength(0);
    await expect(
      migrateLegacyConversations(local.db, {
        ...options,
        apply: true,
        expected: {
          insertedConversations: planned.insertedConversations,
          insertedMessages: planned.insertedMessages,
        },
      }),
    ).resolves.toMatchObject({ insertedConversations: 1 });
  });

  it("limit と cursor でページを切り、1 ページ目だけ行丸ごと削除の報告を入れる", async () => {
    const owner = `page-${crypto.randomUUID()}`;
    owners.push(owner);
    await local.db
      .insert(userTable)
      .values({ id: owner, email: `${owner}@e.invalid`, createdAt: 1 });
    for (const suffix of ["a", "b", "c"]) {
      const conversationId = `${owner}-${suffix}`;
      conversationIds.push(conversationId);
      await local.db.insert(conversationTable).values({
        id: conversationId,
        userId: owner,
        characterId,
        title: "t",
        createdAt: 1,
        updatedAt: 1,
      });
      await local.db.insert(messageTable).values({
        id: `${conversationId}-m0`,
        conversationId,
        userId: owner,
        characterId,
        role: "user",
        content: "x",
        createdAt: 1,
      });
    }
    const page1 = await migrateLegacyConversations(local.db, {
      sourceUserId: owner,
      targetUserId: TARGET,
      apply: true,
      limit: 2,
    });
    expect(page1).toMatchObject({ conversations: 2, insertedConversations: 2 });
    expect(page1.nextCursor).toBe(`${owner}-b`);
    const page2 = await migrateLegacyConversations(local.db, {
      sourceUserId: owner,
      targetUserId: TARGET,
      apply: true,
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2).toMatchObject({ conversations: 1, insertedConversations: 1, nextCursor: null });
    // cursor ありのページは v2 にだけ在る会話を数えん。
    const stray = `${owner}-zz-stray`;
    conversationIds.push(stray);
    await local.db.insert(v2ConversationTable).values({
      id: stray,
      userId: TARGET,
      legacySourceUserId: owner,
      characterId,
      threadId: stray,
      promptVersion: "legacy-import-v1",
      createdAt: 1,
      updatedAt: 1,
    });
    const page3 = await migrateLegacyConversations(local.db, {
      sourceUserId: owner,
      targetUserId: TARGET,
      limit: 2,
      cursor: `${owner}-a`,
    });
    expect(page3.failures).toEqual([]);
    const page0 = await migrateLegacyConversations(local.db, {
      sourceUserId: owner,
      targetUserId: TARGET,
      limit: 2,
    });
    expect(page0.failures).toEqual([
      { conversationId: stray, code: "source_conversation_deleted" },
    ]);
    await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, stray));
  });

  it("題名の更新と legacy_source_user_id の補完は updatedConversations で数える", async () => {
    const { conversationId, options, owner } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }],
      { updatedAt: 4 },
    );
    await migrateLegacyConversations(local.db, { ...options, apply: true });
    await local.db
      .update(conversationTable)
      .set({ title: "後で付けた題", updatedAt: 9 })
      .where(eq(conversationTable.id, conversationId));
    const result = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(result.updatedConversations).toBe(1);
    const [stored] = await local.db
      .select()
      .from(v2ConversationTable)
      .where(eq(v2ConversationTable.id, conversationId));
    expect(stored.title).toBe("後で付けた題");
    expect(stored.updatedAt).toBe(9);
    expect(stored.legacySourceUserId).toBe(owner);
  });

  it("image_key が v2 で空なら取り込み直しで埋める", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "assistant", imageKey: "backfill.png" }],
    );
    await migrateLegacyConversations(local.db, { ...options, apply: true });
    await local.db
      .update(v2MessageTable)
      .set({ imageKey: null })
      .where(eq(v2MessageTable.id, `${conversationId}-m0`));
    const result = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(result.backfilledImageKeys).toBe(1);
    const [stored] = await local.db
      .select()
      .from(v2MessageTable)
      .where(eq(v2MessageTable.id, `${conversationId}-m0`));
    expect(stored.imageKey).toBe("backfill.png");
  });

  it("台帳の無い頃に移した会話は台帳を埋め、v2 が作り直した番号は v2_ledger で飲む", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [{ role: "user" }, { role: "assistant" }, { role: "user" }, { role: "assistant" }],
    );
    // 旧版（台帳なし）で移した状態を作る: v2 会話 + m0/m2 のみ。
    // m1 は「v2 で消した」、m3 は v2 が番号 4 を作り直した（行ごと消して新しい id で入れ直し）。
    await local.db.insert(v2ConversationTable).values({
      id: conversationId,
      userId: TARGET,
      legacySourceUserId: options.sourceUserId,
      characterId,
      threadId: conversationId,
      promptVersion: "legacy-import-v1",
      createdAt: 1,
      updatedAt: 4,
    });
    await local.db.insert(v2MessageTable).values([
      {
        id: `${conversationId}-m0`,
        conversationId,
        turn: 1,
        role: "user",
        content: "発言 1",
        createdAt: 1,
      },
      {
        id: `${conversationId}-m2`,
        conversationId,
        turn: 3,
        role: "user",
        content: "発言 3",
        createdAt: 3,
      },
      {
        id: `${conversationId}-newU`,
        conversationId,
        turn: 4,
        role: "user",
        content: "v2 質問",
        createdAt: 10,
      },
      {
        id: `${conversationId}-newA`,
        conversationId,
        turn: 4,
        role: "assistant",
        content: "v2 返事",
        createdAt: 10,
      },
    ]);
    await local.db.insert(v2LedgerTable).values({
      conversationId,
      turn: 4,
      ledgerJson: "{}",
      createdAt: 10,
    });
    // N = max(一致した番号 1,3、v2 が書いた |M| 以下の番号 4) = 4。
    // m1(2)・m3(4) は N 以下で D に無い → v2 で消した物、台帳の行だけ足す。
    // newU/newA は N 以下で v2_ledger に番号が在る → source_deleted にしない。
    const dry = await migrateLegacyConversations(local.db, options);
    expect(dry).toMatchObject({
      skippedDeletedMessages: 2,
      skippedAfterV2Continue: 0,
      backfilledLedgerRows: 1 + 2 + 2, // 会話 1 + 一致 2 + N 以下の削除 2
      insertedMessages: 0,
      failures: [],
    });
    const applied = await migrateLegacyConversations(local.db, { ...options, apply: true });
    expect(applied.failures).toEqual([]);
    const rows = await ledgerRows(local, conversationId);
    // 会話 1 + m0〜m3 の 4 = 5 行。newU/newA は台帳に入らん。
    expect(rows).toHaveLength(5);
    const verify = await verifyLegacyConversations(local.db, options);
    expect(verify.items[0]).toMatchObject({ status: "match", deletedMessagesInV2: 2 });
  });

  it("移した会話は turn-store で続きを読めて、画像参照も生きる", async () => {
    const { conversationId, options } = await seedOne(
      local,
      characterId,
      owners,
      conversationIds,
      "c",
      [
        { role: "assistant" },
        { role: "user" },
        { role: "assistant" },
        { role: "assistant", imageKey: "preserved-image.png" },
      ],
    );
    await migrateLegacyConversations(local.db, { ...options, apply: true });
    const store = createD1TurnStore(local.db, {
      userId: TARGET,
      characterId,
      promptVersion: "test",
    });
    const loaded = await store.load(conversationId);
    expect(loaded.turn).toBe(5);
    expect(loaded.history.map((row) => row.role)).toEqual([
      "assistant",
      "user",
      "assistant",
      "assistant",
    ]);
    expect(await readOwnedImageKey(local.db, TARGET, `${conversationId}-m3`)).toBe(
      "preserved-image.png",
    );
    const display = await readDisplayHistory(
      local.db,
      { userId: TARGET, characterId, promptVersion: "test" },
      conversationId,
    );
    expect(display.history[3]?.imageKey).toBe("preserved-image.png");
    // 旧表は触らない。
    const [original] = await local.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.id, `${conversationId}-m3`));
    expect(original.imageKey).toBe("preserved-image.png");
  });
});

describe("v2 conversation list", () => {
  it("hides a pin-only retry placeholder until its first message is saved", async () => {
    const local = await openLocalD1();
    const listOwner = `list-test-${crypto.randomUUID()}`;
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    await local.db
      .insert(userTable)
      .values({ id: listOwner, email: `${listOwner}@example.invalid`, createdAt: 1 });
    const conversationId = `${listOwner}-conversation`;
    await ensureConversationVersion(local.db, {
      conversationId,
      userId: listOwner,
      characterId: character.id,
      promptVersion: "test",
      versionId: "pinned-version",
    });
    expect(await listConversations(local.db, listOwner)).toEqual([]);
    await local.db.insert(v2ConversationTable).values({
      id: `${listOwner}-legacy`,
      userId: listOwner,
      legacySourceUserId: listOwner,
      characterId: character.id,
      threadId: `${listOwner}-legacy`,
      promptVersion: "legacy-import-v1",
      createdAt: 1,
      updatedAt: 1,
    });
    const otherOwner = `${listOwner}-other`;
    const otherConversation = `${listOwner}-other-conversation`;
    await local.db.insert(v2ConversationTable).values({
      id: otherConversation,
      userId: otherOwner,
      characterId: character.id,
      threadId: otherConversation,
      promptVersion: "test",
      createdAt: 1,
      updatedAt: 1,
    });
    expect((await listConversations(local.db, listOwner)).map((row) => row.id)).toEqual([
      `${listOwner}-legacy`,
    ]);
    await local.db.insert(v2MessageTable).values({
      id: `${conversationId}-message`,
      conversationId,
      turn: 1,
      role: "user",
      content: "再試行",
      createdAt: 2,
    });
    await local.db.insert(v2MessageTable).values({
      id: `${otherConversation}-message`,
      conversationId: otherConversation,
      turn: 1,
      role: "user",
      content: "別の利用者",
      createdAt: 2,
    });
    const visible = (await listConversations(local.db, listOwner)).map((row) => row.id);
    expect(visible).toContain(conversationId);
    expect(visible).toContain(`${listOwner}-legacy`);
    expect(visible).not.toContain(otherConversation);
    await local.db.delete(v2MessageTable).where(eq(v2MessageTable.conversationId, conversationId));
    await local.db
      .delete(v2MessageTable)
      .where(eq(v2MessageTable.conversationId, otherConversation));
    await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, conversationId));
    await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, otherConversation));
    await local.db
      .delete(v2ConversationTable)
      .where(eq(v2ConversationTable.id, `${listOwner}-legacy`));
    await local.db.delete(userTable).where(eq(userTable.id, listOwner));
    await local.dispose();
  });

  it("一覧の preview は直近の active な assistant 発言で、枝分かれの inactive 行を出さない", async () => {
    const local = await openLocalD1();
    const listOwner = `list-preview-${crypto.randomUUID()}`;
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    await local.db
      .insert(userTable)
      .values({ id: listOwner, email: `${listOwner}@example.invalid`, createdAt: 1 });
    const conversationId = `${listOwner}-conversation`;
    const emptyId = `${listOwner}-empty`;
    for (const id of [conversationId, emptyId]) {
      await ensureConversationVersion(local.db, {
        conversationId: id,
        userId: listOwner,
        characterId: character.id,
        promptVersion: "test",
        versionId: "pinned-version",
      });
    }
    await local.db.insert(v2MessageTable).values([
      {
        id: `${conversationId}-a1`,
        conversationId,
        turn: 1,
        role: "assistant",
        content: "古い返事",
        createdAt: 1,
      },
      {
        id: `${conversationId}-u2`,
        conversationId,
        turn: 2,
        role: "user",
        content: "次の一言",
        createdAt: 2,
      },
      {
        id: `${conversationId}-a3`,
        conversationId,
        turn: 3,
        role: "assistant",
        content: "直近の返事",
        createdAt: 3,
      },
      {
        id: `${conversationId}-a3b`,
        conversationId,
        turn: 3,
        role: "assistant",
        content: "枝分かれで隠れた返事",
        createdAt: 4,
        branchNo: 1,
        active: 0,
      },
    ]);
    const rows = await listConversations(local.db, listOwner);
    expect(rows.find((row) => row.id === conversationId)?.lastMessage).toBe("直近の返事");
    expect(rows.find((row) => row.id === emptyId)).toBeUndefined();
    await local.db.delete(v2MessageTable).where(eq(v2MessageTable.conversationId, conversationId));
    await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, conversationId));
    await local.db.delete(v2ConversationTable).where(eq(v2ConversationTable.id, emptyId));
    await local.db.delete(userTable).where(eq(userTable.id, listOwner));
    await local.dispose();
  });
});
