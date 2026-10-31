// @vitest-environment node
// ChatRoom を本物の engine・D1（ローカル Miniflare）で回す。差し替えるのはモデルと
// Durable Object の器（storage.sql を node:sqlite で持つ）だけ。画面が見る結果
// （job の状態・配る事象・D1 から読み直す履歴）を通しで確かめる。
import { DatabaseSync } from "node:sqlite";

import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createDb, loadCharacter } from "@v2/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type * as EngineModule from "@v2/engine";

const VALID_REPLY =
  "<response><action>窓辺から振り向いて、湯気の立つ湯呑みを差し出す。</action><dialogue>おかえり。寒かったでしょ、先に温まって。</dialogue><inner>声を聞けただけで肩の力が抜けた。</inner></response>";

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

type SqlValue = string | number | null;

// Durable Object の SQLite storage と同じ呼び口だけを持つ器。
const createDurableState = () => {
  const sqlite = new DatabaseSync(":memory:");
  return {
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
      setAlarm: async () => undefined,
    },
  };
};

describe("ChatRoom", () => {
  let local: LocalD1;
  let characterId: string;
  const conversationIds: string[] = [];

  const newRoom = (env: Record<string, unknown> = {}) => {
    platform.env = { DB: local.d1, APP_ENV: "test", ...env };
    return new ChatRoom(
      createDurableState() as unknown as DurableObjectState,
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
});
