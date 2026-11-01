// @vitest-environment node
// ChatRoom を本物の engine・D1（ローカル Miniflare）で回す。差し替えるのはモデルと
// Durable Object の器（storage.sql を node:sqlite で持つ）だけ。画面が見る結果
// （job の状態・配る事象・D1 から読み直す履歴）を通しで確かめる。
import { DatabaseSync } from "node:sqlite";

import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createDb, loadCharacter } from "@v2/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type * as EngineModule from "@v2/engine";

const VALID_REPLY =
  "<response><action>窓辺から振り向いて、湯気の立つ湯呑みを差し出す。</action><dialogue>おかえり。寒かったでしょ、先に温まって。</dialogue><inner>声を聞けただけで肩の力が抜けた。</inner></response>";

const SECOND_REPLY =
  "<response><action>マフラーをほどいて、隣の椅子をそっと引いた。</action><dialogue>座って。今日あったこと、全部聞かせてよ。</dialogue><inner>帰ってきてくれて、ほんまに嬉しい。</inner></response>";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const replies = vi.hoisted(() => ({ queue: [] as string[][], calls: 0 }));

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
  env: {},
}));

vi.mock("./platform", () => ({ getPlatform: async () => ({ env: platform.env }) }));

vi.mock("@v2/engine", async (importOriginal) => {
  const original = await importOriginal<typeof EngineModule>();
  return {
    ...original,
    // startTurn 1 回ごとに 1 つ作られる。続きの書き足し（invoke）も同じ並びから取る。
    createOpenRouterModel: (): BaseChatModel => {
      replies.calls += 1;
      const responses = replies.queue.shift() ?? [""];
      return new FakeListChatModel({ responses });
    },
  };
});

const { ChatRoom } = await import("./chat-room");
const { loadHistory } = await import("./engine");
const { handleHistoryRequest } = await import("./api-chat");

const HistoryBodySchema = z
  .object({ turn: z.number(), storedTurn: z.unknown().optional() })
  .passthrough();
const historyBody = async (response: Response) => HistoryBodySchema.parse(await response.json());

type SqlValue = string | number | null;

// Durable Object の SQLite storage と同じ呼び口だけを持つ器。
const createDurableState = () => {
  const sqlite = new DatabaseSync(":memory:");
  const alarms: number[] = [];
  return {
    sqlite,
    alarms,
    storage: {
      sql: {
        exec: <T>(query: string, ...bindings: SqlValue[]) => {
          const rows = sqlite.prepare(query).all(...bindings) as T[];
          return { toArray: () => rows };
        },
      },
      transactionSync: <T>(callback: () => T): T => {
        sqlite.exec("BEGIN");
        try {
          const result = callback();
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
      setAlarm: async (at: number) => {
        alarms.push(at);
      },
    },
  };
};

let state: ReturnType<typeof createDurableState>;

describe("ChatRoom", () => {
  let local: LocalD1;
  let characterId: string;
  const conversationIds: string[] = [];

  const newRoom = (env: Record<string, unknown> = {}) => {
    platform.env = { DB: local.d1, APP_ENV: "test", ...env };
    state = createDurableState();
    return new ChatRoom(
      state as unknown as DurableObjectState,
      platform.env as unknown as Cloudflare.Env,
    );
  };

  const newConversation = (): string => {
    const id = `chat-room-test-${crypto.randomUUID()}`;
    conversationIds.push(id);
    return id;
  };

  beforeAll(async () => {
    local = await openLocalD1();
    const { results: rows } = await local.d1
      .prepare("SELECT id FROM character ORDER BY display_order, created_at")
      .all<{ id: string }>();
    for (const row of rows) {
      const { ok } = await loadCharacter(createDb(local.d1), row.id);
      if (ok) {
        characterId = row.id;
        break;
      }
    }
    if (!characterId) throw new Error("ローカル D1 に読める character が無い");
  }, 120_000);

  beforeEach(() => {
    replies.queue = [];
    replies.calls = 0;
  });

  afterAll(async () => {
    // 子の表から消す（v2_chunk → v2_message → … → v2_conversation の FK 順）。
    for (const id of conversationIds) {
      await local.d1.batch([
        local.d1
          .prepare(
            "DELETE FROM v2_chunk WHERE message_id IN (SELECT id FROM v2_message WHERE conversation_id = ?)",
          )
          .bind(id),
        local.d1.prepare("DELETE FROM v2_message WHERE conversation_id = ?").bind(id),
        local.d1.prepare("DELETE FROM v2_ledger WHERE conversation_id = ?").bind(id),
        local.d1.prepare("DELETE FROM v2_generation WHERE conversation_id = ?").bind(id),
        local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind(id),
      ]);
    }
    await local?.dispose();
  });

  const submitAndRun = async (
    room: InstanceType<typeof ChatRoom>,
    input: { requestId: string; conversationId: string; text: string; retry?: boolean },
  ) => {
    const receipt = await room.submit({ ...input, characterId });
    expect(receipt.status).toBe("accepted");
    await room.alarm();
    return room.readEvents(input.requestId, 0);
  };

  it("モデルが空の返事を返したら失敗として配り、再試行で同じ番号に本文を保存する", async () => {
    const room = newRoom();
    const conversationId = newConversation();
    const input = { requestId: "req-1", conversationId, text: "ただいま" };

    replies.queue.push([""]);
    const failed = await submitAndRun(room, input);
    expect(failed.status).toBe("failed");
    expect(failed.events.map((item) => item.event)).toEqual([
      {
        type: "error",
        message: "返信を完了できませんでした。再試行してください。",
        terminal: false,
      },
    ]);
    const afterFailure = await loadHistory({ characterId, conversationId });
    expect(afterFailure.turn).toBe(1);
    expect(afterFailure.history).toEqual([]);

    replies.queue.push([VALID_REPLY]);
    const retried = await submitAndRun(room, { ...input, retry: true });
    expect(retried.status).toBe("succeeded");
    expect(retried.events.at(-1)?.event).toMatchObject({ type: "done", turn: 1 });
    const saved = await loadHistory({ characterId, conversationId });
    expect(saved.turn).toBe(2);
    expect(saved.history[0]).toEqual({ role: "user", content: "ただいま" });
    expect(saved.history[1]?.content).toContain("おかえり");
  });

  it("3 回とも空の返事なら入力へ戻す失敗で終え、送信文を履歴に残さん", async () => {
    const room = newRoom();
    const conversationId = newConversation();
    const input = { requestId: "req-2", conversationId, text: "聞こえてる？" };
    replies.queue.push([""], ["  "], ["<response></response>"]);

    const first = await submitAndRun(room, input);
    expect(first.status).toBe("failed");
    await submitAndRun(room, { ...input, retry: true });
    const last = await submitAndRun(room, { ...input, retry: true });
    expect(last.status).toBe("failed");
    expect(last.events.map((item) => item.event)).toEqual([
      {
        type: "error",
        message: "返信を完了できませんでした。入力に戻してください。",
        terminal: true,
      },
    ]);
    // 「入力に戻す」は次の番号が送信時の番号以下かで判断する（chat-view の recoverPending）。
    const history = await loadHistory({ characterId, conversationId });
    expect(history.turn).toBe(1);
    expect(history.history).toEqual([]);
    expect(replies.calls).toBe(3);
  });

  it("保存の直後に落ちた job は、再試行で作り直さず保存済みの返事で成功にする", async () => {
    const room = newRoom({ V2_TEST_FAULT: "after-persist-once" });
    const conversationId = newConversation();
    const input = { requestId: "req-3", conversationId, text: "続きを聞かせて" };
    replies.queue.push([VALID_REPLY]);

    const interrupted = await submitAndRun(room, input);
    expect(interrupted.status).toBe("failed");
    const stored = await loadHistory({ characterId, conversationId });
    expect(stored.turn).toBe(2);

    const recovered = await submitAndRun(room, { ...input, retry: true });
    expect(recovered.status).toBe("succeeded");
    expect(recovered.events.map((item) => item.event)).toEqual([
      { type: "done", conversationId, turn: 1, generationId: null },
    ]);
    expect(replies.calls).toBe(1);
    expect((await loadHistory({ characterId, conversationId })).history).toEqual(stored.history);
  });

  it("最後の試行が保存した直後に止まった job は、試行上限で失敗にせず保存済みの返事で成功にする", async () => {
    const room = newRoom();
    const conversationId = newConversation();
    const input = { requestId: "req-4", conversationId, text: "三度目の正直" };
    replies.queue.push([""], [""], [VALID_REPLY]);

    await submitAndRun(room, input);
    await submitAndRun(room, { ...input, retry: true });
    const third = await submitAndRun(room, { ...input, retry: true });
    expect(third.status).toBe("succeeded");
    // D1 への保存は済んだが、finish() が成功を記録する前に Worker が止まった状態を作る。
    state.sqlite.exec("UPDATE jobs SET status = 'running' WHERE id = 'req-4'");
    state.sqlite.exec("DELETE FROM events WHERE job_id = 'req-4'");

    await room.alarm();
    const resumed = room.readEvents("req-4", 0);
    expect(resumed.status).toBe("succeeded");
    expect(resumed.events.map((item) => item.event)).toEqual([
      { type: "done", conversationId, turn: 1, generationId: null },
    ]);
    expect(replies.calls).toBe(3);
  });

  it("失敗した送信の再試行は、その間に受け付けた別の送信が残っとる間は busy で断る", async () => {
    const room = newRoom();
    const conversationId = newConversation();
    const first = { requestId: "req-5a", conversationId, text: "一通目" };
    replies.queue.push([""]);
    expect((await submitAndRun(room, first)).status).toBe("failed");

    const second = await room.submit({
      requestId: "req-5b",
      conversationId,
      text: "別のタブから",
      characterId,
    });
    expect(second.status).toBe("accepted");
    const retried = await room.submit({ ...first, retry: true, characterId });
    expect(retried.status).toBe("busy");

    replies.queue.push([VALID_REPLY]);
    await room.alarm();
    expect(room.readEvents("req-5b", 0).status).toBe("succeeded");
    expect(room.readEvents("req-5a", 0).status).toBe("failed");
    const history = await loadHistory({ characterId, conversationId });
    expect(history.history[0]).toEqual({ role: "user", content: "別のタブから" });
  });

  it("alarm は残った job があれば次の alarm を予約する", async () => {
    const room = newRoom();
    const conversationId = newConversation();
    replies.queue.push([VALID_REPLY]);
    expect(
      (await room.submit({ requestId: "req-6a", conversationId, text: "先", characterId })).status,
    ).toBe("accepted");
    state.sqlite
      .prepare(
        "INSERT INTO jobs (id,character_id,conversation_id,text,digest,turn,status,created_at) VALUES (?,?,?,?,?,?,'queued',?)",
      )
      .run("req-6b", characterId, conversationId, "後", "digest", 2, Date.now() + 1000);
    state.alarms.length = 0;

    await room.alarm();
    expect(room.readEvents("req-6a", 0).status).toBe("succeeded");
    expect(state.alarms).toHaveLength(1);
  });

  it("失敗の記録には固定の理由だけを出し、送信文や例外の本文を出さん", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const room = newRoom();
      const conversationId = newConversation();
      replies.queue.push([""]);
      await submitAndRun(room, { requestId: "req-7", conversationId, text: "秘密の合言葉" });
      const logged = errors.mock.calls.map((call) => String(call[0]));
      expect(logged).toHaveLength(1);
      expect(JSON.parse(logged[0] ?? "{}")).toEqual({
        event: "chat_turn_failed",
        category: "turn_processing_failure",
        jobId: "req-7",
        attempt: 1,
        terminal: false,
        reason: "generation_failed",
      });
      expect(logged[0]).not.toContain("秘密の合言葉");
    } finally {
      errors.mockRestore();
    }
  });

  it("履歴 API は送信が割り当てられたターンに残った発言と、返信が残ったかを返す", async () => {
    const room = newRoom();
    platform.env = { ...platform.env, CHAT_ROOMS: { getByName: () => room } };
    const conversationId = newConversation();
    replies.queue.push([""]);
    await submitAndRun(room, { requestId: "req-8a", conversationId, text: "届かん質問" });
    const url = (requestId: string) =>
      `https://example.com/api/chat/x/history?conversationId=${conversationId}&requestId=${requestId}`;

    const dead = await handleHistoryRequest(characterId, new Request(url("req-8a")));
    expect((await historyBody(dead)).storedTurn).toEqual({
      turn: 1,
      user: "届かん質問",
      answered: false,
    });

    replies.queue.push([VALID_REPLY]);
    await submitAndRun(room, {
      requestId: "req-8a",
      conversationId,
      text: "届かん質問",
      retry: true,
    });
    const saved = await historyBody(
      await handleHistoryRequest(characterId, new Request(url("req-8a"))),
    );
    expect(saved.storedTurn).toEqual({ turn: 1, user: "届かん質問", answered: true });
    expect(saved.turn).toBe(2);

    // サーバーに届いとらん送信は null（保存されてへん）。
    const unknown = await historyBody(
      await handleHistoryRequest(characterId, new Request(url("req-never-sent"))),
    );
    expect(unknown.storedTurn).toBeNull();
    expect(
      (await handleHistoryRequest(characterId, new Request(url("x".repeat(121))))).status,
    ).toBe(400);
    const plain = await handleHistoryRequest(
      characterId,
      new Request(`https://example.com/api/chat/x/history?conversationId=${conversationId}`),
    );
    expect(await historyBody(plain)).not.toHaveProperty("storedTurn");
  });

  it("別の送信が同じターンを埋めた後の再試行は、1 回で入力へ戻す失敗にし、それ以上受けん", async () => {
    const room = newRoom();
    const conversationId = newConversation();
    const first = { requestId: "req-10a", conversationId, text: "一通目" };
    replies.queue.push([""]);
    await submitAndRun(room, first);
    replies.queue.push([VALID_REPLY]);
    await submitAndRun(room, { requestId: "req-10b", conversationId, text: "別のタブから" });

    const retried = await submitAndRun(room, { ...first, retry: true });
    expect(retried.status).toBe("failed");
    expect(retried.events.map((item) => item.event)).toEqual([
      {
        type: "error",
        message: "返信を完了できませんでした。入力に戻してください。",
        terminal: true,
      },
    ]);
    await room.submit({ ...first, retry: true, characterId });
    expect(state.sqlite.prepare("SELECT status FROM jobs WHERE id = 'req-10a'").get()).toEqual({
      status: "failed",
    });
    expect(replies.calls).toBe(2);
  });

  it("履歴を読む間に別の job が終わっても、古いターン番号で受け付けず読み直す", async () => {
    const room = newRoom();
    const conversationId = newConversation();
    replies.queue.push([VALID_REPLY], [SECOND_REPLY]);
    expect(
      (await room.submit({ requestId: "req-9a", conversationId, text: "先の送信", characterId }))
        .status,
    ).toBe("accepted");

    // 次の送信が履歴を読み終えた直後（load は 1 回の batch で読む）に、先の job を最後まで走らせる。
    let armed = true;
    const d1 = local.d1;
    const racing = new Proxy(d1, {
      get(target, property) {
        if (property !== "batch") {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (armed) {
            armed = false;
            platform.env = { ...platform.env, DB: d1 };
            await room.alarm();
          }
          return result;
        };
      },
    });
    platform.env = { ...platform.env, DB: racing };

    const late = await room.submit({
      requestId: "req-9b",
      conversationId,
      text: "後の送信",
      characterId,
    });
    platform.env = { ...platform.env, DB: d1 };
    expect(armed).toBe(false);
    expect(state.sqlite.prepare("SELECT turn FROM jobs WHERE id = ?").get("req-9b")).toEqual({
      turn: 2,
    });
    expect(room.readEvents("req-9a", 0).status).toBe("succeeded");
    expect(late.status).toBe("accepted");

    await room.alarm();
    const done = room.readEvents("req-9b", 0);
    expect(done.status).toBe("succeeded");
    expect(done.events.at(-1)?.event).toMatchObject({ type: "done", turn: 2 });
    const history = await loadHistory({ characterId, conversationId });
    expect(history.history.filter((message) => message.role === "user")).toEqual([
      { role: "user", content: "先の送信" },
      { role: "user", content: "後の送信" },
    ]);
  });
});
