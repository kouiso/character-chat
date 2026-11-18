// 置き換えの並べ直し（RIT-86）。届いた順ではなく source_turn → id の順で、
// 有効な行の中の一番新しい 1 つだけが superseded_by = null になることを確かめる。
import { emptyLedger } from "@v2/prompt";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { userTable } from "../../../src/schema/user";

import {
  completeMemoryExtraction,
  listPendingMemoryJobs,
  loadMemoryExtractionSource,
} from "./memory-extraction-store";
import { deleteMemory } from "./memory-crud-store";
import { recomputeSupersession, recomputeSupersessionStatements } from "./memory-supersession";
import { openLocalD1, type LocalD1 } from "./test/local-d1";
import { createD1TurnStore } from "./turn-store";
import {
  v2ChunkTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MemoryJobTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MemoryTombstoneTable,
  v2MessageTable,
} from "./v2-schema";

import type { TurnEvent } from "./turn-store";

const owner = `supersession-test-${crypto.randomUUID()}`;
const SUBJECT = "好きな飲み物";
const reply: TurnEvent = {
  type: "chunk",
  seq: 0,
  text: "<dialogue>覚えておきます。</dialogue>",
  attempt: 1,
  preExtend: true,
  judge: {
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
  },
};

describe("memory supersession", () => {
  let local: LocalD1;
  let characterId: string;
  const conversationIds: string[] = [];

  // 会話行だけ起こす（置き換え自体は利用者・キャラを見ないので最小の行で足る）。
  const conversation = async (id = crypto.randomUUID(), character = "") => {
    conversationIds.push(id);
    const now = Date.now();
    await local.db.insert(v2ConversationTable).values({
      id,
      userId: owner,
      characterId: character || characterId,
      threadId: id,
      promptVersion: "test",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  // 元発言（active=1 が既定）。同じターンの記憶が増える時は出どころを共有する
  // （抽出は 1 発言から複数の記憶を作る）ので、発言と記憶は別々に入れられるようにする。
  // id は全表でグローバル主キーなので、試験ごとに会話 id で名前を空けて衝突を避ける。
  const message = async (conversationId: string, id: string, turn: number, active = 1) => {
    const messageId = `${conversationId}:${id}`;
    await local.db.insert(v2MessageTable).values({
      id: messageId,
      conversationId,
      turn,
      role: "user",
      content: `${id}の発言`,
      active,
      createdAt: Date.now(),
    });
    return messageId;
  };

  const memory = async (input: {
    conversationId: string;
    id: string;
    sourceMessageId: string;
    turn: number;
    content?: string;
    subject?: string;
    pinned?: number;
    supersededBy?: string | null;
  }) => {
    const memoryId = `${input.conversationId}:${input.id}`;
    await local.db.batch([
      local.db.insert(v2MemoryTable).values({
        id: memoryId,
        conversationId: input.conversationId,
        kind: "preference",
        content: input.content ?? `${input.id}が好き`,
        pinned: input.pinned ?? 0,
        sourceTurn: input.turn,
        createdAt: Date.now(),
        subject: input.subject ?? SUBJECT,
        supersededBy: input.supersededBy ?? null,
      }),
      local.db.insert(v2MemorySourceTable).values({
        memoryId,
        sourceMessageId: input.sourceMessageId,
        sourceContentHash: `hash-${memoryId}`,
        importance: 3,
      }),
    ]);
    return memoryId;
  };

  // 1 発言から 1 記憶の素直な形。
  const planted = async (input: {
    conversationId: string;
    id: string;
    turn: number;
    content?: string;
    subject?: string;
    pinned?: number;
    active?: number;
  }) => {
    const sourceMessageId = await message(
      input.conversationId,
      `${input.id}-src`,
      input.turn,
      input.active ?? 1,
    );
    return memory({ ...input, sourceMessageId });
  };

  const states = async (conversationId: string) =>
    local.db
      .select({
        id: v2MemoryTable.id,
        content: v2MemoryTable.content,
        supersededBy: v2MemoryTable.supersededBy,
      })
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, conversationId));

  beforeAll(async () => {
    local = await openLocalD1();
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    characterId = character.id;
  }, 120_000);

  afterAll(async () => {
    const messages = local.db
      .select({ id: v2MessageTable.id })
      .from(v2MessageTable)
      .where(inArray(v2MessageTable.conversationId, conversationIds));
    await local.db.batch([
      local.db
        .delete(v2MemoryTombstoneTable)
        .where(inArray(v2MemoryTombstoneTable.conversationId, conversationIds)),
      local.db
        .delete(v2MemoryJobTable)
        .where(inArray(v2MemoryJobTable.conversationId, conversationIds)),
      local.db
        .delete(v2MemorySourceTable)
        .where(
          inArray(
            v2MemorySourceTable.memoryId,
            local.db
              .select({ id: v2MemoryTable.id })
              .from(v2MemoryTable)
              .where(inArray(v2MemoryTable.conversationId, conversationIds)),
          ),
        ),
      local.db.delete(v2MemoryTable).where(inArray(v2MemoryTable.conversationId, conversationIds)),
      local.db.delete(v2ChunkTable).where(inArray(v2ChunkTable.messageId, messages)),
      local.db
        .delete(v2MessageTable)
        .where(inArray(v2MessageTable.conversationId, conversationIds)),
      local.db.delete(v2LedgerTable).where(inArray(v2LedgerTable.conversationId, conversationIds)),
      local.db
        .delete(v2GenerationTable)
        .where(inArray(v2GenerationTable.conversationId, conversationIds)),
      local.db.delete(v2ConversationTable).where(inArray(v2ConversationTable.id, conversationIds)),
    ]);
    await local.dispose();
  });

  it("並べ直しは 1 主題あたり 2 文（NFR-1）", () => {
    expect(recomputeSupersessionStatements(local.db, "c", [SUBJECT, "好きな食べ物"]).length).toBe(
      4,
    );
    // 重複・空の主題は文を増やさない
    expect(recomputeSupersessionStatements(local.db, "c", [SUBJECT, SUBJECT, ""]).length).toBe(2);
    expect(recomputeSupersessionStatements(local.db, "c", [])).toEqual([]);
    expect(recomputeSupersessionStatements(local.db, "c", [""])).toEqual([]);
  });

  it("順に 3 回変えると最後のだけが有効で、古い 2 つは最後の id を指す", async () => {
    const conversationId = await conversation();
    const ids = [
      await planted({ conversationId, id: "j1:0", turn: 1, content: "紅茶が好き" }),
      await planted({ conversationId, id: "j2:0", turn: 2, content: "烏龍茶が好き" }),
      await planted({ conversationId, id: "j3:0", turn: 3, content: "麦茶が好き" }),
    ];
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    const rows = await states(conversationId);
    const byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
    expect(byId.get(ids[0])).toBe(ids[2]);
    expect(byId.get(ids[1])).toBe(ids[2]);
    expect(byId.get(ids[2])).toBeNull();
  });

  it("逆順に届いても（Queue のやり直し）古い値に戻らない", async () => {
    const conversationId = await conversation();
    const j3 = await planted({ conversationId, id: "j3:0", turn: 3, content: "麦茶が好き" });
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    // 1 ターン目の抜き出しが後から届く
    const j1 = await planted({ conversationId, id: "j1:0", turn: 1, content: "紅茶が好き" });
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    const j2 = await planted({ conversationId, id: "j2:0", turn: 2, content: "烏龍茶が好き" });
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    const rows = await states(conversationId);
    const byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
    expect(byId.get(j1)).toBe(j3);
    expect(byId.get(j2)).toBe(j3);
    expect(byId.get(j3)).toBeNull();
  });

  it("同じターンの同じ主題は両方とも有効のまま（別事実を潰さんため）", async () => {
    const conversationId = await conversation();
    // 1 回の抜き出しが 1 発言から 2 記憶を作った形。「姉は看護師。夜勤が多い」の
    // ように同じ発言に同居した別事実は、どちらも新しい言い直しではないので残る。
    const sourceMessageId = await message(conversationId, "j1-src", 1);
    const j10 = await memory({
      conversationId,
      id: "j1:0",
      sourceMessageId,
      turn: 1,
      content: "紅茶が好き",
    });
    const j11 = await memory({
      conversationId,
      id: "j1:1",
      sourceMessageId,
      turn: 1,
      content: "麦茶が好き",
    });
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    const rows = await states(conversationId);
    const byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
    expect(byId.get(j10)).toBeNull();
    expect(byId.get(j11)).toBeNull();
    // 別ターンの記憶が届いた時だけ、古い世代がまとめて置き換わる。
    const j2 = await planted({ conversationId, id: "j2:0", turn: 2, content: "ほうじ茶が好き" });
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    const rows2 = await states(conversationId);
    const byId2 = new Map(rows2.map((row) => [row.id, row.supersededBy]));
    expect(byId2.get(j10)).toBe(j2);
    expect(byId2.get(j11)).toBe(j2);
    expect(byId2.get(j2)).toBeNull();
  });

  it("一番新しい行を消すと次に新しい行が有効に戻る", async () => {
    const conversationId = await conversation();
    const j1 = await planted({ conversationId, id: "j1:0", turn: 1, content: "紅茶が好き" });
    const j2 = await planted({ conversationId, id: "j2:0", turn: 2, content: "烏龍茶が好き" });
    const j3 = await planted({ conversationId, id: "j3:0", turn: 3, content: "麦茶が好き" });
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    // RIT-94 の消す経路が呼ぶのと同じ並び: 論理削除してから主題を並べ直す。
    const deleted = await deleteMemory(local.db, { userId: owner, characterId }, j3);
    expect(deleted).not.toBeNull();
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    const rows = await states(conversationId);
    const byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
    expect(byId.get(j2)).toBeNull();
    expect(byId.get(j1)).toBe(j2);
    // 消した行は並べ直しの対象外（値はそのまま残る）
    expect(byId.get(j3)).toBeNull();
  });

  it("一番新しい行が眠った枝になると次が有効に戻り、枝が戻ると元に戻る", async () => {
    const conversationId = await conversation();
    const j2 = await planted({ conversationId, id: "j2:0", turn: 2, content: "烏龍茶が好き" });
    const j3 = await planted({ conversationId, id: "j3:0", turn: 3, content: "麦茶が好き" });
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    await local.db
      .update(v2MessageTable)
      .set({ active: 0 })
      .where(eq(v2MessageTable.id, `${j3}-src`));
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    let rows = await states(conversationId);
    let byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
    expect(byId.get(j2)).toBeNull();
    // 眠った枝の行は並べ直しの対象外（古い向き先のまま残る）
    expect(byId.get(j3)).toBeNull();
    await local.db
      .update(v2MessageTable)
      .set({ active: 1 })
      .where(eq(v2MessageTable.id, `${j3}-src`));
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    rows = await states(conversationId);
    byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
    expect(byId.get(j3)).toBeNull();
    expect(byId.get(j2)).toBe(j3);
  });

  it("固定した記憶は置き換わらず、ほかを置き換えもしない", async () => {
    const conversationId = await conversation();
    const pinnedOld = await planted({
      conversationId,
      id: "jp:0",
      turn: 1,
      content: "ずっと紅茶が好き",
      pinned: 1,
    });
    const j2 = await planted({ conversationId, id: "j2:0", turn: 2, content: "烏龍茶が好き" });
    const j3 = await planted({ conversationId, id: "j3:0", turn: 3, content: "麦茶が好き" });
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    let rows = await states(conversationId);
    let byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
    expect(byId.get(pinnedOld)).toBeNull();
    expect(byId.get(j3)).toBeNull();
    expect(byId.get(j2)).toBe(j3);
    // 一番新しい行が固定されると、次に新しい行が有効に戻る
    await local.db.update(v2MemoryTable).set({ pinned: 1 }).where(eq(v2MemoryTable.id, j3));
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    rows = await states(conversationId);
    byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
    expect(byId.get(j2)).toBeNull();
    expect(byId.get(pinnedOld)).toBeNull();
  });

  it("主題が空の行と別の主題の行は置き換わらない", async () => {
    const conversationId = await conversation();
    const blank = await planted({ conversationId, id: "jb:0", turn: 1, subject: "" });
    const food = await planted({
      conversationId,
      id: "jf:0",
      turn: 2,
      subject: "好きな食べ物",
      content: "カレーが好き",
    });
    const drink = await planted({ conversationId, id: "j3:0", turn: 3 });
    await recomputeSupersession(local.db, conversationId, [SUBJECT, ""]);
    const rows = await states(conversationId);
    const byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
    expect(byId.get(blank)).toBeNull();
    expect(byId.get(food)).toBeNull();
    expect(byId.get(drink)).toBeNull();
  });

  it("別の会話・別のキャラの同じ主題は変わらない", async () => {
    const first = await conversation();
    const otherCharacter = crypto.randomUUID();
    await local.db.insert(userTable).values({
      id: owner,
      email: `${owner}@example.invalid`,
      createdAt: Date.now(),
    });
    await local.db.insert(characterTable).values({
      id: otherCharacter,
      userId: owner,
      name: "別キャラ",
      systemPrompt: "別キャラです。",
      greeting: "こんにちは。",
      tags: [],
      createdAt: Date.now(),
    });
    try {
      const other = await conversation(crypto.randomUUID(), otherCharacter);
      const j1 = await planted({ conversationId: first, id: "j1:0", turn: 1 });
      const j2 = await planted({ conversationId: first, id: "j2:0", turn: 2 });
      const o1 = await planted({ conversationId: other, id: "o1:0", turn: 1 });
      const o2 = await planted({ conversationId: other, id: "o2:0", turn: 2 });
      await recomputeSupersession(local.db, first, [SUBJECT]);
      const rows = await states(other);
      const byId = new Map(rows.map((row) => [row.id, row.supersededBy]));
      expect(byId.get(o1)).toBeNull();
      expect(byId.get(o2)).toBeNull();
      const firstRows = await states(first);
      expect(new Map(firstRows.map((row) => [row.id, row.supersededBy])).get(j1)).toBe(j2);
    } finally {
      // 会話→子行→キャラ→利用者の順（FK があるので先に全部掃う）。
      const otherConversations = local.db
        .select({ id: v2ConversationTable.id })
        .from(v2ConversationTable)
        .where(eq(v2ConversationTable.characterId, otherCharacter));
      const otherMessages = local.db
        .select({ id: v2MessageTable.id })
        .from(v2MessageTable)
        .where(inArray(v2MessageTable.conversationId, otherConversations));
      await local.db.batch([
        local.db
          .delete(v2MemorySourceTable)
          .where(
            inArray(
              v2MemorySourceTable.memoryId,
              local.db
                .select({ id: v2MemoryTable.id })
                .from(v2MemoryTable)
                .where(inArray(v2MemoryTable.conversationId, otherConversations)),
            ),
          ),
        local.db
          .delete(v2MemoryTable)
          .where(inArray(v2MemoryTable.conversationId, otherConversations)),
        local.db.delete(v2MessageTable).where(inArray(v2MessageTable.id, otherMessages)),
        local.db
          .delete(v2ConversationTable)
          .where(eq(v2ConversationTable.characterId, otherCharacter)),
      ]);
      await local.db.delete(characterTable).where(eq(characterTable.id, otherCharacter));
      await local.db.delete(userTable).where(eq(userTable.id, owner));
    }
  });

  it("ターンの置き換えで消えた記憶の主題は次に新しい行が有効に戻る", async () => {
    const store = createD1TurnStore(local.db, {
      userId: owner,
      characterId,
      promptVersion: "test",
      extractMemory: true,
    });
    const conversationId = crypto.randomUUID();
    conversationIds.push(conversationId);
    const save = async (turn: number, content: string) => {
      await store.saveTurn({
        conversationId,
        turn,
        userText: `私は${content}です。`,
        ledger: emptyLedger(),
        events: [reply],
      });
      const [job] = await listPendingMemoryJobs(local.db, {
        userId: owner,
        characterId,
        conversationId,
      });
      const source = await loadMemoryExtractionSource(local.db, job.id);
      if (!source) throw new Error("source missing");
      await completeMemoryExtraction(local.db, source, [
        {
          kind: "preference",
          content,
          subject: SUBJECT,
          category: "long",
          importance: 3,
          validFrom: null,
          validUntil: null,
        },
      ]);
    };
    await save(1, "紅茶が好き");
    await save(2, "麦茶が好き");
    let rows = await states(conversationId);
    expect(new Map(rows.map((row) => [row.id, row.supersededBy])).values()).toContain(null);
    // 2 ターン目を送り直すと、その発言に載っていた「麦茶」の記憶は物理削除される。
    // 「紅茶」は 2 ターン目の記憶を指したまま残るはずが、並べ直しで有効に戻る。
    await store.saveTurn({
      conversationId,
      turn: 2,
      userText: "私はほうじ茶が好きです。",
      ledger: emptyLedger(),
      events: [reply],
    });
    rows = await states(conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("紅茶が好き");
    expect(rows[0].supersededBy).toBeNull();
  });

  it("同じ主題の行が 1,000 件でも並べ直しは 100 ms 以内（NFR-2）", async () => {
    const conversationId = await conversation();
    // 1 発言 1 記憶を raw SQL でまとめて入れる（バインド変数の上限対策）。
    const chunk = 400;
    for (let start = 0; start < 1000; start += chunk) {
      const end = Math.min(start + chunk, 1000);
      const messages = [];
      const memories = [];
      const sources = [];
      for (let i = start; i < end; i++) {
        const turn = i + 1;
        messages.push(
          `('bulk-msg-${conversationId}-${turn}','${conversationId}',${turn},'user','発言${turn}',0,1,0)`,
        );
        memories.push(
          `('bulk-${conversationId}-${turn}','${conversationId}','preference','事実${turn}',0,${turn},NULL,0,'${SUBJECT}',NULL,NULL,1,'long','extracted',NULL)`,
        );
        sources.push(
          `('bulk-${conversationId}-${turn}','bulk-msg-${conversationId}-${turn}','h${turn}',3,NULL,NULL)`,
        );
      }
      await local.d1.exec(
        `INSERT INTO v2_message (id,conversation_id,turn,role,content,branch_no,active,created_at) VALUES ${messages.join(",")}`,
      );
      await local.d1.exec(
        `INSERT INTO v2_memory (id,conversation_id,kind,content,pinned,source_turn,embedding,created_at,subject,superseded_by,deleted_at,revision,category,origin,edited_at) VALUES ${memories.join(",")}`,
      );
      await local.d1.exec(
        `INSERT INTO v2_memory_source (memory_id,source_message_id,source_content_hash,importance,valid_from,valid_until) VALUES ${sources.join(",")}`,
      );
    }
    const began = performance.now();
    await recomputeSupersession(local.db, conversationId, [SUBJECT]);
    const elapsed = performance.now() - began;
    expect(elapsed).toBeLessThan(100);
    const rows = await states(conversationId);
    const active = rows.filter((row) => row.supersededBy === null);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(`bulk-${conversationId}-1000`);
  });
});
