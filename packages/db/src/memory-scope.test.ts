// 区切りの本体（RIT-89）。利用者 2 人 × 同名キャラ 2 人 × 会話 2 つ × 枝 2 本の
// 16 通りの記憶を植え、全読み手が自分の区切りだけを返すかを見る。
// 「漏れ」の相手は: 別利用者（同じキャラでも）・同名の別キャラ・同じキャラの別会話・
// 同じ会話の眠った枝。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashMemorySource, listPendingMemoryJobs } from "./memory-extraction-store";
import { loadMemoryCandidates, loadUnindexedMemoryJob } from "./memory-index-store";
import { listConversationMemories, loadOwnedMemory, loadPinnedMemories } from "./memory-crud-store";
import { loadRecentMemories, loadRecallCueMemories } from "./proactive-store";
import { MemoryScopeError, memoryReadConditions, selectScopedMemories } from "./memory-scope";
import { openLocalD1, type LocalD1 } from "./test/local-d1";

const now = Date.parse("2026-11-16T00:00:00.000Z");

// 2 利用者 × 2 同名キャラ（どちらも「鈴」）× 各 2 会話 × 枝 2 本 = 16 記憶。
// 会話は利用者・キャラの全組に作る（別利用者の区切りを同じキャラで確かめるため）。
const USERS = ["scope-user-1", "scope-user-2"] as const;
const CHARS = ["scope-char-a", "scope-char-b"] as const;

type Cell = { conversationId: string; userId: string; characterId: string };
const allMemoryIds: string[] = [];

const seed = async (local: LocalD1) => {
  for (const userId of USERS) {
    await local.d1
      .prepare("INSERT INTO user (id, email, created_at) VALUES (?, ?, ?)")
      .bind(userId, `${userId}@example.invalid`, now)
      .run();
  }
  for (const characterId of CHARS) {
    await local.d1
      .prepare(
        "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(characterId, USERS[0], "鈴", "同名キャラの試験用", "こんにちは", "[]", now)
      .run();
  }
  for (const userId of USERS) {
    for (const characterId of CHARS) {
      for (const convIdx of [0, 1]) {
        const tag = `${userId}-${characterId}-${convIdx}`;
        const conversationId = `conv-${tag}`;
        allMemoryIds.push(`mem-${tag}-active`, `mem-${tag}-sleep`);
        await local.d1
          .prepare(
            "INSERT INTO v2_conversation (id, user_id, character_id, thread_id, prompt_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(conversationId, userId, characterId, conversationId, "test", now, now)
          .run();
        // turn 3 の眠った枝（branch 0, active=0）と今の枝（branch 1, active=1）の発言
        for (const [branch, active] of [
          [0, 0],
          [1, 1],
        ] as const) {
          const messageId = `msg-${tag}-b${branch}`;
          const memoryId = `mem-${tag}-${active === 1 ? "active" : "sleep"}`;
          const content = `${tag} の枝${branch}の話`;
          await local.d1
            .prepare(
              "INSERT INTO v2_message (id, conversation_id, turn, role, content, branch_no, active, created_at) VALUES (?, ?, 3, 'user', ?, ?, ?, ?)",
            )
            .bind(messageId, conversationId, content, branch, active, now)
            .run();
          await local.d1
            .prepare(
              "INSERT INTO v2_memory (id, conversation_id, kind, content, pinned, source_turn, created_at, origin) VALUES (?, ?, 'fact', ?, 0, 3, ?, 'extracted')",
            )
            .bind(memoryId, conversationId, content, now)
            .run();
          await local.d1
            .prepare(
              "INSERT INTO v2_memory_source (memory_id, source_message_id, source_content_hash, importance) VALUES (?, ?, ?, 3)",
            )
            .bind(memoryId, messageId, await hashMemorySource(content))
            .run();
        }
      }
    }
  }
};

// 主区切り（user1 × 鈴A × 会話0）の固有の記憶 — 枝例外・置き換わり・手植えの検査用。
const EXTRA = {
  manualNoSource: "mem-extra-manual-no-source",
  manualSleeping: "mem-extra-manual-sleeping",
  pinnedSleeping: "mem-extra-pinned-sleeping",
  superseded: "mem-extra-superseded",
  summary: "mem-extra-summary",
  deleted: "mem-extra-deleted",
} as const;

const seedExtras = async (local: LocalD1, cell: Cell) => {
  const sleepingMessage = `msg-${cell.userId}-${cell.characterId}-0-b0`;
  const extras: {
    id: string;
    kind: string;
    pinned: number;
    origin: string;
    supersededBy: string | null;
    deletedAt: number | null;
    sourceMessageId: string | null;
    embedded?: boolean;
  }[] = [
    // 手植えで出どころ無し — 眠った枝の turn と同じ番号を持っても読める（未決 2）
    {
      id: EXTRA.manualNoSource,
      kind: "fact",
      pinned: 0,
      origin: "manual",
      supersededBy: null,
      deletedAt: null,
      sourceMessageId: null,
    },
    // 手植えで出どころ有り、その発言が眠っている — origin=manual は枝に関係なく読める。
    // 索引済みにしておく（手植えの未索引はジョブの再配送対象に数えられる正しい仕事なので、
    // FR-8 の「眠った枝しか出どころが無いジョブは出ない」の反証にならんよう）。
    {
      id: EXTRA.manualSleeping,
      kind: "fact",
      pinned: 0,
      origin: "manual",
      supersededBy: null,
      deletedAt: null,
      sourceMessageId: sleepingMessage,
      embedded: true,
    },
    // 抜き出しで固定済み、その発言が眠っている — 固定の道だけ出る（未決 3）
    {
      id: EXTRA.pinnedSleeping,
      kind: "fact",
      pinned: 1,
      origin: "extracted",
      supersededBy: null,
      deletedAt: null,
      sourceMessageId: sleepingMessage,
    },
    // 新しい記憶に置き換わった — 画面には出る、指示文・話しかけには出ない
    {
      id: EXTRA.superseded,
      kind: "fact",
      pinned: 0,
      origin: "extracted",
      supersededBy: "mem-newer",
      deletedAt: null,
      sourceMessageId: `msg-${cell.userId}-${cell.characterId}-0-b1`,
    },
    {
      id: EXTRA.summary,
      kind: "summary",
      pinned: 0,
      origin: "extracted",
      supersededBy: null,
      deletedAt: null,
      sourceMessageId: `msg-${cell.userId}-${cell.characterId}-0-b1`,
    },
    {
      id: EXTRA.deleted,
      kind: "fact",
      pinned: 0,
      origin: "extracted",
      supersededBy: null,
      deletedAt: now,
      sourceMessageId: `msg-${cell.userId}-${cell.characterId}-0-b1`,
    },
  ];
  for (const extra of extras) {
    await local.d1
      .prepare(
        "INSERT INTO v2_memory (id, conversation_id, kind, content, pinned, source_turn, embedding, created_at, subject, superseded_by, deleted_at, origin) VALUES (?, ?, ?, ?, ?, 3, ?, ?, '', ?, ?, ?)",
      )
      .bind(
        extra.id,
        cell.conversationId,
        extra.kind,
        `extra ${extra.id}`,
        extra.pinned,
        extra.embedded === true ? new Uint8Array([1]) : null,
        now,
        extra.supersededBy,
        extra.deletedAt,
        extra.origin,
      )
      .run();
    if (extra.sourceMessageId !== null) {
      await local.d1
        .prepare(
          "INSERT INTO v2_memory_source (memory_id, source_message_id, source_content_hash, importance) VALUES (?, ?, ?, 3)",
        )
        .bind(extra.id, extra.sourceMessageId, await hashMemorySource("x"))
        .run();
    }
  }
};

describe("memoryReadScope", () => {
  let local: LocalD1;
  const primary: Cell = {
    userId: USERS[0],
    characterId: CHARS[0],
    conversationId: `conv-${USERS[0]}-${CHARS[0]}-0`,
  };
  const activeId = `mem-${primary.userId}-${primary.characterId}-0-active`;
  const sleepingId = `mem-${primary.userId}-${primary.characterId}-0-sleep`;
  const otherConvActiveId = `mem-${primary.userId}-${primary.characterId}-1-active`;

  beforeAll(async () => {
    local = await openLocalD1();
    await seed(local);
    await seedExtras(local, primary);
  }, 120_000);

  afterAll(async () => {
    await local?.dispose();
  });

  it("区切りの関数は空の利用者・キャラを黙って通さん（MemoryScopeError）", () => {
    const scope = {
      conversationId: primary.conversationId,
      excludeSuperseded: true,
      activeBranchOnly: true,
    };
    expect(() => memoryReadConditions({ userId: "", characterId: "c", ...scope })).toThrow(
      MemoryScopeError,
    );
    expect(() => memoryReadConditions({ userId: "u", characterId: "", ...scope })).toThrow(
      MemoryScopeError,
    );
  });

  it("区切り select は 16 件のうち自分の会話の今の枝だけを返す", async () => {
    const rows = await selectScopedMemories(local.db, {
      ...primary,
      excludeSuperseded: true,
      activeBranchOnly: true,
      kinds: ["fact", "preference"],
    });
    const ids = rows.map((row) => row.v2_memory.id).sort();
    // 手植え（出どころ無し・眠った出どころ）は枝に関係なく読める
    expect(ids).toEqual([EXTRA.manualNoSource, EXTRA.manualSleeping, activeId].sort());
  });

  it("会話の画面は置き換わった記憶も返すが、眠った枝・summary・削除済みは返さん", async () => {
    const list = await listConversationMemories(local.db, primary);
    const ids = list.map((row) => row.id);
    expect(ids).toContain(activeId);
    expect(ids).toContain(EXTRA.superseded);
    expect(ids).toContain(EXTRA.manualNoSource);
    expect(ids).toContain(EXTRA.manualSleeping);
    expect(ids).not.toContain(sleepingId);
    expect(ids).not.toContain(EXTRA.pinnedSleeping);
    expect(ids).not.toContain(EXTRA.summary);
    expect(ids).not.toContain(EXTRA.deleted);
    expect(ids).not.toContain(otherConvActiveId);
  });

  it("固定の道は枝で絞らん — 眠った枝の固定記憶も出る（未決 3）", async () => {
    const pinned = await loadPinnedMemories(local.db, primary);
    const ids = pinned.map((row) => row.id);
    expect(ids).toContain(EXTRA.pinnedSleeping);
    // ただし置き換わった記憶・summary・別会話は出ない
    expect(ids).not.toContain(sleepingId); // pinned=0
    expect(ids).not.toContain(EXTRA.superseded);
    expect(ids).not.toContain(otherConvActiveId);
  });

  it("話しかけの最近の記憶は今の枝・置き換わっていない・fact/preference だけ", async () => {
    const recent = await loadRecentMemories(local.db, primary, 20);
    expect(recent).toContain(`${primary.userId}-${primary.characterId}-0 の枝1の話`);
    expect(recent).not.toContain(`${primary.userId}-${primary.characterId}-0 の枝0の話`);
    expect(recent).not.toContain(`extra ${EXTRA.superseded}`);
    expect(recent).not.toContain(`extra ${EXTRA.summary}`);
    expect(recent).not.toContain(`extra ${EXTRA.pinnedSleeping}`);
    expect(recent).not.toContain(`${primary.userId}-${primary.characterId}-1 の枝1の話`);
  });

  it("記念日キューの記憶スキャンは会話をまたぐが、利用者・キャラ・枝の区切りは守る", async () => {
    const memories = await loadRecallCueMemories(
      local.db,
      { userId: primary.userId, characterId: primary.characterId },
      100,
    );
    const contents = memories.map((memory) => memory.content);
    // 同じ利用者・同じキャラの別会話は出る（未決 1）
    expect(contents).toContain(`${primary.userId}-${primary.characterId}-1 の枝1の話`);
    // 眠った枝は出ない
    expect(contents).not.toContain(`${primary.userId}-${primary.characterId}-0 の枝0の話`);
    expect(contents).not.toContain(`${primary.userId}-${primary.characterId}-1 の枝0の話`);
    // 同名の別キャラ・別利用者は出ない
    expect(contents.some((content) => content.includes(CHARS[1]))).toBe(false);
    expect(contents.some((content) => content.includes(USERS[1]))).toBe(false);
  });

  it("1 件読みは記憶の属する会話の所有者・キャラで区切る", async () => {
    expect((await loadOwnedMemory(local.db, primary, activeId))?.id).toBe(activeId);
    // 同名の別キャラの会話の記憶は別所有者として弾く
    const otherCharMemory = `mem-${primary.userId}-${CHARS[1]}-0-active`;
    expect(await loadOwnedMemory(local.db, primary, otherCharMemory)).toBeNull();
    // 別利用者の記憶も弾く
    const otherUserMemory = `mem-${USERS[1]}-${primary.characterId}-0-active`;
    expect(await loadOwnedMemory(local.db, primary, otherUserMemory)).toBeNull();
    // 眠った枝の記憶は自分のものでも読めない
    expect(await loadOwnedMemory(local.db, primary, sleepingId)).toBeNull();
  });

  it("検索候補の再確認は全 id を渡しても自分の区切りだけを返す", async () => {
    // 実装は先頭 20 件までしか見ないので、検査したい例外群を先に並べる
    const candidates = await loadMemoryCandidates(local.db, primary, [
      ...Object.values(EXTRA),
      ...allMemoryIds,
    ]);
    const ids = candidates.map((row) => row.id);
    // 手植え（眠った出どころ）は出る、今の枝は出る — それ以外の 15 件と例外群は出ない
    expect(ids.sort()).toEqual([EXTRA.manualSleeping, activeId].sort());
  });

  it("未索引ジョブの読み出しは眠った枝の記憶を拾わん（FR-8）", async () => {
    const jobId = `job-${primary.conversationId}`;
    const sourceMessage = `msg-${primary.userId}-${primary.characterId}-0-b1`;
    await local.d1
      .prepare(
        "INSERT INTO v2_memory_job (id, conversation_id, user_id, character_id, source_message_id, source_turn, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 3, 'completed', ?, ?)",
      )
      .bind(
        jobId,
        primary.conversationId,
        primary.userId,
        primary.characterId,
        sourceMessage,
        now,
        now,
      )
      .run();
    const unindexed = await loadUnindexedMemoryJob(local.db, jobId);
    const ids = unindexed.map((row) => row.id).sort();
    // 今の枝の未索引記憶（embedding null）は拾う。置き換わり・summary は索引対象の
    // まま残す（この読み手は置き換わりを見ない区切り）。消した記憶は除く。
    expect(ids).toEqual([activeId, EXTRA.superseded, EXTRA.summary].sort());
    // 眠った枝の未索引記憶は拾わん（拾うと Queue へ送り続けて alarm を予約し直す）
    expect(ids).not.toContain(sleepingId);

    // 出どころが眠った枝しか持たん未索引ジョブは配送対象に出ない（FR-8）。
    const inactiveJobId = `job-${primary.conversationId}-inactive`;
    await local.d1
      .prepare(
        "INSERT INTO v2_memory_job (id, conversation_id, user_id, character_id, source_message_id, source_turn, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 3, 'completed', ?, ?)",
      )
      .bind(
        inactiveJobId,
        primary.conversationId,
        primary.userId,
        primary.characterId,
        `msg-${primary.userId}-${primary.characterId}-0-b0`,
        now,
        now,
      )
      .run();
    const pendingIds = (await listPendingMemoryJobs(local.db, primary, true)).map((job) => job.id);
    expect(pendingIds).toContain(jobId);
    expect(pendingIds).not.toContain(inactiveJobId);
  });

  it("EXPLAIN QUERY PLAN: 眠った枝の条件は v2_message を id で SEARCH する（NFR-2）", async () => {
    const { sql: query, params } = selectScopedMemories(local.db, {
      ...primary,
      excludeSuperseded: true,
      activeBranchOnly: true,
    }).toSQL();
    const plan = await local.d1
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = (plan.results ?? []).map((row) => row.detail).join("\n");
    // 副問い合わせの表は別名（s/m）で出る。眠った枝の検査は主キー引きで、全走査は無い。
    expect(details).not.toMatch(/SCAN\s+(v2_message|m)\b/);
    expect(details).toMatch(/SEARCH\s+\w+\s+USING.*\(id=\?\)/);
  });

  it("固定 + 候補の読みは手元の D1 で 50 ms 以内（NFR-1）", async () => {
    // miniflare は最初の呼び出しで準備に時間が掛かるので、温めてから中央値を見る
    const measure = async () => {
      const started = performance.now();
      await loadPinnedMemories(local.db, primary);
      await loadMemoryCandidates(local.db, primary, allMemoryIds);
      return performance.now() - started;
    };
    await measure();
    const samples = [await measure(), await measure(), await measure()].sort((a, b) => a - b);
    expect(samples[1]).toBeLessThan(50);
  });
});
