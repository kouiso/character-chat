// @vitest-environment node
// 要約の係（RIT-72）の確かめ。モデルだけ差し替え、D1 はローカル Miniflare の本物を使う。
// 確かめるのは: 未要約 20 件で level 1・level 1 が 4 本で level 2 へ畳み直す・
// 元の hash が合わん要約は使わず無効化・止めの合図で保存せず終わる・失敗を数える。
// drizzle の下準備は @v2/db の関数経由か D1 の素の SQL でやる（apps/v2 と packages/db で
// drizzle-orm の写像先が違うので、helper 関数を直接は混ぜん・chat-room.test.ts と同じやり方）。
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createD1TurnStore,
  listActiveSummaries,
  loadCharacterName,
  loadTurnRange,
  saveSummaryRange,
  summarySourceHash,
  type TurnEvent,
} from "@v2/db";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import {
  SUMMARY_FAILURES_KEY,
  SUMMARY_PAUSED_KEY,
  summarizeConversation,
  type SummaryStorage,
} from "./summary-runner";

import type { ModelCandidate } from "@v2/engine";
import type { JudgeResult } from "@v2/judge";
import type { SceneLedger } from "@v2/prompt";

const OK_JUDGE: JudgeResult = {
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
};

const makeTurn = (text: string): TurnEvent[] => [
  {
    type: "generation",
    generationId: crypto.randomUUID(),
    model: "fake-list",
    promptVersion: "v0001",
    systemPrompt: "system",
    request: [{ role: "user", content: "user" }],
    rawOutput: `<action>${text}</action>`,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    latencyMs: 1,
    status: "ok",
  },
  { type: "chunk", seq: 1, text, judge: OK_JUDGE, attempt: 1, preExtend: true },
];

const LEDGER: SceneLedger = {
  phase: "conversation",
  location: null,
  time: null,
  present: [],
  clothing: {},
  position: null,
  lastEvents: [],
  items: {},
};

// 履歴の窓を 4 件（2 ターン）に絞り、少ないターン数で「窓の外」を作る。
const ENV = { V2_HISTORY_MESSAGES: "4" };

const fakeModels = (responses: string[]): ModelCandidate[] => [
  { name: "fake", model: new FakeListChatModel({ responses }) },
];

const memoryStorage = (): SummaryStorage & { map: Map<string, unknown> } => {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async (key) => map.get(key),
    put: async (key, value) => {
      map.set(key, value);
    },
  };
};

// 各試験はローカル D1 へ 1 ターンずつ数十件を書き込んでから要約する。CPU を取り合う手元の
// push 前の検査では既定の 5 秒を越える（4 CPU で 1 本あたり約 9 秒を測った）。2 CPU の機械や重い時にも収まるよう 30 秒にする
describe("summarizeConversation（RIT-72）", { timeout: 30_000 }, () => {
  let local: LocalD1;
  let characterId = "";
  const conversationIds: string[] = [];

  const seedTurns = async (count: number): Promise<string> => {
    const store = createD1TurnStore(local.db, {
      userId: "vitest",
      characterId,
      promptVersion: "v0001",
    });
    const conversationId = `summary-test-${crypto.randomUUID()}`;
    conversationIds.push(conversationId);
    for (let turn = 1; turn <= count; turn += 1) {
      await store.saveTurn({
        conversationId,
        turn,
        userText: `user ${turn}`,
        events: makeTurn(`assistant ${turn}`),
        ledger: LEDGER,
      });
    }
    return conversationId;
  };

  const allSummaries = async (conversationId: string) => {
    const { results } = await local.d1
      .prepare(
        "SELECT level, from_turn, to_turn, text, invalidated_at FROM v2_summary WHERE conversation_id = ?",
      )
      .bind(conversationId)
      .all<{
        level: number;
        from_turn: number | null;
        to_turn: number | null;
        text: string;
        invalidated_at: number | null;
      }>();
    return results ?? [];
  };

  beforeAll(async () => {
    local = await openLocalD1();
    const { results: rows } = await local.d1
      .prepare("SELECT id FROM character ORDER BY display_order, created_at")
      .all<{ id: string }>();
    for (const row of rows ?? []) {
      if ((await loadCharacterName(local.db, row.id)) !== null) {
        characterId = row.id;
        break;
      }
    }
    if (!characterId) throw new Error("ローカル D1 に読める character が無い");
  }, 120_000);

  afterAll(async () => {
    for (const id of conversationIds) {
      await local.d1.prepare("DELETE FROM v2_summary WHERE conversation_id = ?").bind(id).run();
    }
    await local.dispose();
  });

  it("窓の外の未要約が 20 件貯まると level 1 を 1 本作る（満たん時は呼ばれん）", async () => {
    // 窓 4 件（ターン 11-12）に対し、ターン 1-10 の 20 件が未要約。
    const few = await seedTurns(3);
    expect(
      await summarizeConversation(
        ENV,
        { userId: "vitest", characterId, conversationId: few },
        // 未要約 2 件ではモデルを解決する前に止まるので models は要らん。
        { db: local.db },
      ),
    ).toBe("idle");
    expect(await listActiveSummaries(local.db, few)).toHaveLength(0);

    const infos = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const conversationId = await seedTurns(12);
      const outcome = await summarizeConversation(
        ENV,
        { userId: "vitest", characterId, conversationId },
        { models: fakeModels(["範囲の要約"]), db: local.db },
      );
      expect(outcome).toBe("saved");
      const active = await listActiveSummaries(local.db, conversationId);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ level: 1, fromTurn: 1, toTurn: 10, text: "範囲の要約" });
      // source_hash はその範囲の表示中メッセージの並びから作れる（FR-8）。
      const rows = await loadTurnRange(local.db, {
        conversationId,
        fromTurn: 1,
        toTurn: 10,
      });
      expect(active[0]?.sourceHash).toBe(await summarySourceHash(rows));
      const logged = infos.mock.calls.map((call) => JSON.parse(String(call[0])));
      expect(
        logged.some(
          (entry) =>
            entry.event === "summary_saved" &&
            entry.summaryLevel === 1 &&
            entry.fromTurn === 1 &&
            entry.toTurn === 10,
        ),
      ).toBe(true);

      // もう一度走らせても未要約は無いので idle（同じキーの重複保存も無い）。
      expect(
        await summarizeConversation(
          ENV,
          { userId: "vitest", characterId, conversationId },
          { db: local.db },
        ),
      ).toBe("idle");
      expect(await listActiveSummaries(local.db, conversationId)).toHaveLength(1);
    } finally {
      infos.mockRestore();
    }
  });

  // 植える要約の source_hash はその場の本物の並びから作る。嘘の hash だと
  // 確かめ（FR-8）に先に消されるので、意図した畳み込みだけを試せる。
  const plantRange = async (
    conversationId: string,
    level: number,
    fromTurn: number,
    toTurn: number,
    text: string,
  ): Promise<void> => {
    const sourceHash = await summarySourceHash(
      await loadTurnRange(local.db, { conversationId, fromTurn, toTurn }),
    );
    await saveSummaryRange(local.db, {
      conversationId,
      level,
      fromTurn,
      toTurn,
      sourceHash,
      text,
    });
  };

  it("最新の level 2 より後の level 1 が 4 本で、前のまとめも畳んで level 2 を作り直す", async () => {
    const conversationId = await seedTurns(10);
    const storage = memoryStorage();
    // 先に level 2（1-2）と、その後ろに続く level 1 を 4 本植える。
    await plantRange(conversationId, 2, 1, 2, "前のまとめ");
    for (let index = 0; index < 4; index += 1) {
      await plantRange(conversationId, 1, 3 + index * 2, 4 + index * 2, `level1-${index}`);
    }
    const model = new FakeListChatModel({ responses: ["一段上の要約"] });
    const invoke = vi.spyOn(model, "invoke");
    const outcome = await summarizeConversation(
      ENV,
      {
        userId: "vitest",
        characterId,
        conversationId,
        signal: new AbortController().signal,
        storage,
      },
      { models: [{ name: "fake", model }], db: local.db },
    );
    expect(outcome).toBe("saved");
    const active = await listActiveSummaries(local.db, conversationId);
    const level2 = active.filter((row) => row.level === 2);
    // 新しい level 2 は前のまとめの先頭から畳んだ 4 本の末尾まで覆う。古い行は
    // 有効のまま残る（compose は一番新しい level 2 だけを見る）。
    const newest = level2.sort((a, b) => b.toTurn - a.toTurn)[0];
    expect(newest).toMatchObject({ fromTurn: 1, toTurn: 10, text: "一段上の要約" });
    const expectedHash = await summarySourceHash(
      await loadTurnRange(local.db, { conversationId, fromTurn: 1, toTurn: 10 }),
    );
    expect(newest?.sourceHash).toBe(expectedHash);
    // モデルへ渡した入力には前の level 2 と畳む 4 本の本文が全部入っとる。
    const request = invoke.mock.calls[0]?.[0] as { content: unknown }[];
    const body = String(request.at(-1)?.content);
    expect(body).toContain("前のまとめ");
    for (let index = 0; index < 4; index += 1) {
      expect(body).toContain(`level1-${index}`);
    }
    expect(storage.map.get(SUMMARY_FAILURES_KEY)).toBe(0);
  });

  it("元の hash が合わん要約は使わず無効にして作り直す（FR-8）", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const conversationId = await seedTurns(12);
      // 本物とは違う hash で範囲を名乗る要約を植える（改ざん・欠損した行）。
      await saveSummaryRange(local.db, {
        conversationId,
        level: 1,
        fromTurn: 1,
        toTurn: 10,
        sourceHash: "forged-hash",
        text: "作り話の要約",
      });
      const model = new FakeListChatModel({ responses: ["正しい範囲の要約"] });
      const outcome = await summarizeConversation(
        ENV,
        { userId: "vitest", characterId, conversationId, signal: new AbortController().signal },
        { models: [{ name: "fake", model }], db: local.db },
      );
      expect(outcome).toBe("saved");
      const active = await listActiveSummaries(local.db, conversationId);
      expect(active).toHaveLength(1);
      expect(active[0]?.text).toBe("正しい範囲の要約");
      const expectedHash = await summarySourceHash(
        await loadTurnRange(local.db, { conversationId, fromTurn: 1, toTurn: 10 }),
      );
      expect(active[0]?.sourceHash).toBe(expectedHash);
      // 合わんかった行は消さず invalidated_at が立つだけ。
      const all = await allSummaries(conversationId);
      expect(all).toHaveLength(2);
      expect(all.find((row) => row.text === "作り話の要約")?.invalidated_at).not.toBeNull();
      const logged = warns.mock.calls.map((call) => JSON.parse(String(call[0])));
      expect(logged.some((entry) => entry.event === "summary_source_mismatch")).toBe(true);
    } finally {
      warns.mockRestore();
    }
  });

  it("穴の修復は次に有効な level 1 の手前で止まり、既存範囲を取り込まん", async () => {
    const conversationId = await seedTurns(30);
    // 1-10 と 21-30 に有効な level 1 があり、11-20 だけが穴（無効化された跡）。
    // 係の網を通るよう hash はそれぞれの範囲の本文から正しく作る。
    for (const [fromTurn, toTurn, text] of [
      [1, 10, "前半の要約"],
      [21, 30, "後半の要約"],
    ] as const) {
      await saveSummaryRange(local.db, {
        conversationId,
        level: 1,
        fromTurn,
        toTurn,
        sourceHash: await summarySourceHash(
          await loadTurnRange(local.db, { conversationId, fromTurn, toTurn }),
        ),
        text,
      });
    }
    const model = new FakeListChatModel({ responses: ["穴の修復分"] });
    const invokeSpy = vi.spyOn(model, "invoke");
    const outcome = await summarizeConversation(
      ENV,
      { userId: "vitest", characterId, conversationId },
      { models: [{ name: "fake", model }], db: local.db },
    );
    expect(outcome).toBe("saved");
    const active = await listActiveSummaries(local.db, conversationId);
    // 新しくできた level 1 は 11-20 だけ。既存の 21-30 を取り込んだ 11-30 は作らん。
    const repaired = active.find((row) => row.level === 1 && row.fromTurn === 11);
    expect(repaired?.toTurn).toBe(20);
    expect(repaired?.text).toBe("穴の修復分");
    expect(active.filter((row) => row.level === 1 && row.fromTurn === 21)).toHaveLength(1);
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("止めの合図で要約は保存せず終わり、失敗にも数えん（FR-5）", async () => {
    const conversationId = await seedTurns(12);
    const storage = memoryStorage();
    // 呼ばれても返さんモデル。止めの合図が来るまで寝る。呼び出しが始まったことを
    // テストへ知らせて、実行中への中断通知を確かめる（待ち時間頼みにせん）。
    let invoked!: () => void;
    const invokeStarted = new Promise<void>((resolve) => {
      invoked = resolve;
    });
    const hanging = new FakeListChatModel({ responses: [] });
    vi.spyOn(hanging, "invoke").mockImplementation((_input, opts) => {
      invoked();
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });
    const controller = new AbortController();
    const run = summarizeConversation(
      ENV,
      {
        userId: "vitest",
        characterId,
        conversationId,
        signal: controller.signal,
        storage,
      },
      { models: [{ name: "hanging", model: hanging }], db: local.db },
    );
    await invokeStarted;
    controller.abort();
    expect(await run).toBe("aborted");
    expect(await listActiveSummaries(local.db, conversationId)).toHaveLength(0);
    expect(storage.map.get(SUMMARY_FAILURES_KEY)).toBeUndefined();
    // 合図が先に立っとる呼び出しはモデルすら呼ばず aborted。
    const pre = new AbortController();
    pre.abort();
    expect(
      await summarizeConversation(
        ENV,
        { userId: "vitest", characterId, conversationId, signal: pre.signal, storage },
        { models: [{ name: "hanging", model: hanging }], db: local.db },
      ),
    ).toBe("aborted");
  });

  it("失敗を数え、3 回続いたら止まり、成功で数を戻す（NFR-2）", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const conversationId = await seedTurns(12);
      const storage = memoryStorage();
      let now = 1_000_000;
      const failingModel = new FakeListChatModel({ responses: [] });
      vi.spyOn(failingModel, "invoke").mockRejectedValue(new Error("boom"));
      const failing: ModelCandidate[] = [{ name: "failing", model: failingModel }];
      const input = {
        userId: "vitest",
        characterId,
        conversationId,
        signal: new AbortController().signal,
        storage,
      };
      const deps = { models: failing, db: local.db, now: () => now };
      for (let round = 1; round <= 3; round += 1) {
        expect(await summarizeConversation(ENV, input, deps)).toBe("failed");
        expect(storage.map.get(SUMMARY_FAILURES_KEY)).toBe(round);
      }
      expect(Number(storage.map.get(SUMMARY_PAUSED_KEY))).toBe(now + 3_600_000);
      // 止まっとる間はモデルを呼ばず paused を返す。
      expect(await summarizeConversation(ENV, input, deps)).toBe("paused");
      // 1 時間を超えたら再び動く。成功すると失敗回数は 0 に戻る。
      now += 3_600_001;
      expect(
        await summarizeConversation(ENV, input, {
          models: fakeModels(["回復した要約"]),
          db: local.db,
          now: () => now,
        }),
      ).toBe("saved");
      expect(storage.map.get(SUMMARY_FAILURES_KEY)).toBe(0);
      const logged = errors.mock.calls.map((call) => JSON.parse(String(call[0])));
      expect(logged.filter((entry) => entry.event === "summary_failed")).toHaveLength(3);
      // 例外の本文ではなく理由の符号だけを記録する（NFR-4）。
      for (const entry of logged) {
        expect(entry.reason).toBe("model_error");
        expect(JSON.stringify(entry)).not.toContain("boom");
      }
    } finally {
      errors.mockRestore();
    }
  });
});
