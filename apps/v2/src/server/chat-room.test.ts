// @vitest-environment node
import { DatabaseSync } from "node:sqlite";

import { judgeChunk, extractVoice } from "@v2/judge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatRoom } from "./chat-room";

import type { ChatSseEvent } from "../lib/sse-events";

type Saved = {
  text: string;
  assistant: string;
  generationId: string;
  status: string;
  events?: ChatSseEvent[];
};
const fixture = vi.hoisted(() => ({
  nextTurn: 1,
  saved: new Map<number, Saved>(),
  generated: [] as { expectedTurn: number; generationId: string }[],
  fail: false,
  afterHistory: undefined as (() => void) | undefined,
}));
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));
vi.mock("./engine", () => ({
  loadHistory: async () => {
    const turn = fixture.nextTurn;
    const action = fixture.afterHistory;
    fixture.afterHistory = undefined;
    action?.();
    return { turn, history: [] };
  },
  loadStoredTurn: async (_character: string, _conversation: string, turn: number) => {
    const saved = fixture.saved.get(turn);
    return saved
      ? [
          { role: "user", content: saved.text },
          { role: "assistant", content: saved.assistant },
        ]
      : [];
  },
  loadStoredReply: async (_character: string, _conversation: string, turn: number) => {
    const saved = fixture.saved.get(turn);
    return saved
      ? { id: saved.generationId, status: saved.status, events: saved.events ?? [] }
      : null;
  },
  startTurn: async (input: {
    text: string;
    conversationId: string;
    expectedTurn: number;
    generationId: string;
  }) => ({
    events: (async function* (): AsyncGenerator<ChatSseEvent> {
      fixture.generated.push({
        expectedTurn: input.expectedTurn,
        generationId: input.generationId,
      });
      if (fixture.fail) throw new Error("synthetic model failure");
      yield {
        type: "chunk",
        seq: 0,
        text: "synthetic response",
        judge: judgeChunk("synthetic response", {
          previousChunks: [],
          voice: extractVoice("synthetic"),
        }),
        attempt: 1,
        preExtend: true,
      };
      fixture.saved.set(input.expectedTurn, {
        text: input.text,
        assistant: "synthetic response",
        generationId: input.generationId,
        status: "ok",
        events: [
          {
            type: "chunk",
            seq: 0,
            text: "synthetic response",
            judge: judgeChunk("synthetic response", {
              previousChunks: [],
              voice: extractVoice("synthetic"),
            }),
            attempt: 1,
            preExtend: false,
            ...{ scheduledAt: 1234 },
          },
        ],
      });
      fixture.nextTurn = input.expectedTurn + 1;
      yield {
        type: "done",
        conversationId: input.conversationId,
        turn: input.expectedTurn,
        generationId: input.generationId,
      };
    })(),
  }),
}));

const input = {
  requestId: "synthetic-request",
  characterId: "synthetic-character",
  conversationId: "synthetic-room",
  text: "synthetic message",
  turn: 1,
};

describe("ChatRoom: 受付・alarm再実行（独立SQLite storage fake / 合成engine）", () => {
  let database: DatabaseSync;
  let context: DurableObjectState;
  let room: ChatRoom;
  let env: Cloudflare.Env;
  const job = (id = input.requestId) => database.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    fixture.nextTurn = 1;
    fixture.saved.clear();
    fixture.generated.length = 0;
    fixture.fail = false;
    fixture.afterHistory = undefined;
    let transactionTail = Promise.resolve();
    const storage = {
      sql: {
        exec: (sql: string, ...bindings: (string | number | null)[]) => {
          const rows = database.prepare(sql).all(...bindings);
          return { toArray: () => rows };
        },
      },
      transaction: async <T>(
        action: (transaction: DurableObjectTransaction) => Promise<T>,
      ): Promise<T> => {
        const previous = transactionTail;
        let release = () => {};
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        database.exec("BEGIN");
        try {
          const result = await action(storage as unknown as DurableObjectTransaction);
          database.exec("COMMIT");
          return result;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        } finally {
          release();
        }
      },
      transactionSync: <T>(action: () => T): T => {
        database.exec("BEGIN");
        try {
          const result = action();
          database.exec("COMMIT");
          return result;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      },
      setAlarm: vi.fn(async () => {}),
    };
    context = { storage } as unknown as DurableObjectState;
    env = { APP_ENV: "test", V2_TEST_FAULT: "" } as Cloudflare.Env;
    room = new ChatRoom(context, env);
  });
  afterEach(() => {
    database.close();
  });

  it("alarm予約に失敗したら受付もrollbackし、未実行の受付だけを残さない", async () => {
    vi.mocked(context.storage.setAlarm).mockRejectedValueOnce(
      new Error("synthetic alarm storage failure"),
    );
    await expect(room.submit(input)).rejects.toThrow("synthetic alarm storage failure");
    expect(job()).toBeUndefined();
    expect(await room.submit(input)).toMatchObject({ status: "accepted" });
    await room.alarm();
    expect(fixture.saved.size).toBe(1);
  });

  it("二重受付・alarm二重呼出しでも保存 turn と生成idが一つ", async () => {
    expect(await Promise.all([room.submit(input), room.submit(input)])).toEqual([
      { status: "accepted", requestId: input.requestId },
      { status: "accepted", requestId: input.requestId },
    ]);
    await Promise.all([room.alarm(), room.alarm()]);
    expect(fixture.generated).toEqual([
      { expectedTurn: 1, generationId: String(job()?.generation_id) },
    ]);
    expect(fixture.saved.size).toBe(1);
    expect(job()?.status).toBe("succeeded");
    expect(await room.submit(input)).toMatchObject({ status: "accepted" });
    await room.alarm();
    expect(fixture.generated).toHaveLength(1);
    expect(await room.submit({ ...input, text: "changed synthetic" })).toMatchObject({
      status: "conflict",
    });
    expect(await room.submit({ ...input, turn: 2 })).toMatchObject({ status: "conflict" });
  });

  it("D1保存後のalarm例外は同じstorageの新インスタンスで回収し、再生成しない", async () => {
    env.V2_TEST_FAULT = "after-persist-once";
    await room.submit(input);
    await expect(room.alarm()).rejects.toThrow("test interruption after persistence");
    expect(job()?.status).toBe("running");
    expect(fixture.saved.size).toBe(1);
    const staged = database
      .prepare("SELECT event FROM events WHERE job_id = ? ORDER BY id")
      .all(input.requestId)
      .map((row) => JSON.parse(String(row.event)) as ChatSseEvent);
    room = new ChatRoom(context, env);
    await room.alarm();
    expect(fixture.generated).toHaveLength(1);
    expect(job()?.status).toBe("succeeded");
    expect(staged[0]).not.toHaveProperty("scheduledAt");
    expect(room.readEvents(input.requestId, 0).events[0].event).toMatchObject({
      type: "chunk",
      seq: 0,
      scheduledAt: 1234,
    });
    expect(room.readEvents(input.requestId, 0).events.at(-1)?.event).toMatchObject({
      type: "done",
      generationId: String(job()?.generation_id),
    });
  });

  it.each(["running", "failed"])(
    "最後の生成試行後に保存済みなら %s でも回収できる",
    async (status) => {
      await room.submit(input);
      database
        .prepare("UPDATE jobs SET attempts = 3, status = ? WHERE id = ?")
        .run(status, input.requestId);
      fixture.saved.set(1, {
        text: input.text,
        assistant: "",
        generationId: String(job()?.generation_id),
        status: "ok",
        events: [
          {
            type: "chunk",
            seq: 0,
            text: "synthetic response",
            judge: judgeChunk("synthetic response", {
              previousChunks: [],
              voice: extractVoice("synthetic"),
            }),
            attempt: 1,
            preExtend: false,
            ...{ scheduledAt: 1234 },
          },
        ],
      });
      fixture.nextTurn = 3;
      if (status === "failed")
        expect(await room.submit({ ...input, retry: true })).toMatchObject({ status: "accepted" });
      await room.alarm();
      expect(job()?.status).toBe("succeeded");
      expect(job()?.attempts).toBe(3);
      expect(fixture.generated).toHaveLength(0);
    },
  );

  it("別の進行中ジョブがある間は古い失敗ジョブを再queueしない", async () => {
    await room.submit(input);
    fixture.fail = true;
    await expect(room.alarm()).rejects.toThrow("synthetic model failure");
    await expect(room.alarm()).rejects.toThrow("synthetic model failure");
    await room.alarm();
    fixture.nextTurn = 2;
    expect(await room.submit({ ...input, requestId: "synthetic-next", turn: 2 })).toMatchObject({
      status: "accepted",
    });
    expect(await room.submit({ ...input, retry: true })).toMatchObject({ status: "busy" });
    expect(job()?.status).toBe("failed");
  });

  it("受付中に別jobが保存完了しても古いturn番号を採番しない", async () => {
    fixture.afterHistory = () => {
      database
        .prepare(
          "INSERT INTO jobs (id,character_id,conversation_id,text,digest,turn,generation_id,status,created_at) VALUES (?,?,?,?,?,?,?,'succeeded',?)",
        )
        .run(
          "other",
          input.characterId,
          input.conversationId,
          "other synthetic",
          "digest",
          1,
          "other",
          0,
        );
      fixture.nextTurn = 2;
    };
    expect(await room.submit(input)).toMatchObject({ status: "conflict" });
    expect(job()).toBeUndefined();
  });

  it("旧版が複数queueを残していても残件のalarmを予約する", async () => {
    await room.submit(input);
    database
      .prepare(
        "INSERT INTO jobs (id,character_id,conversation_id,text,digest,turn,generation_id,status,created_at) VALUES (?,?,?,?,?,?,?,'queued',?)",
      )
      .run(
        "synthetic-next",
        input.characterId,
        input.conversationId,
        "synthetic next",
        "digest",
        2,
        "synthetic-next",
        Date.now() + 1,
      );
    const alarms = vi.mocked(context.storage.setAlarm);
    const count = alarms.mock.calls.length;
    await room.alarm();
    expect(alarms.mock.calls.length).toBeGreaterThan(count);
    await room.alarm();
    expect(fixture.generated.map((generation) => generation.expectedTurn)).toEqual([1, 2]);
  });

  it("未保存のモデル失敗は同じid/turnで明示再試行し、生成上限は3回", async () => {
    fixture.fail = true;
    await room.submit(input);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt < 2) await expect(room.alarm()).rejects.toThrow("synthetic model failure");
      else await room.alarm();
      await room.submit({ ...input, retry: true });
    }
    await room.alarm();
    expect(fixture.generated).toHaveLength(3);
    expect(
      fixture.generated.every(
        (generation) =>
          generation.generationId === String(job()?.generation_id) && generation.expectedTurn === 1,
      ),
    ).toBe(true);
    expect(fixture.saved.size).toBe(0);
    expect(job()?.status).toBe("failed");
  });

  it("別会話で受付idが同じでも生成idは衝突せず、各再試行では固定する", async () => {
    await room.submit(input);
    const firstGenerationId = String(job()?.generation_id);
    fixture.fail = true;
    await expect(room.alarm()).rejects.toThrow("synthetic model failure");
    await room.submit({ ...input, retry: true });
    await expect(room.alarm()).rejects.toThrow("synthetic model failure");
    expect(fixture.generated.map((generation) => generation.generationId)).toEqual([
      firstGenerationId,
      firstGenerationId,
    ]);
    const otherDatabase = new DatabaseSync(":memory:");
    try {
      const otherStorage = {
        sql: {
          exec: (sql: string, ...bindings: (string | number | null)[]) => {
            const rows = otherDatabase.prepare(sql).all(...bindings);
            return { toArray: () => rows };
          },
        },
        transaction: async <T>(
          action: (transaction: DurableObjectTransaction) => Promise<T>,
        ): Promise<T> => action(otherStorage as unknown as DurableObjectTransaction),
        transactionSync: <T>(action: () => T): T => action(),
        setAlarm: async () => {},
      };
      const otherRoom = new ChatRoom(
        { storage: otherStorage } as unknown as DurableObjectState,
        env,
      );
      await otherRoom.submit({ ...input, conversationId: "synthetic-other-room" });
      const other = otherDatabase.prepare("SELECT generation_id FROM jobs").get();
      expect(other?.generation_id).toBeTruthy();
      expect(other?.generation_id).not.toBe(firstGenerationId);
    } finally {
      otherDatabase.close();
    }
  });

  it("保存された別生成の本文が同じでも上書きしない", async () => {
    await room.submit(input);
    fixture.saved.set(1, {
      text: input.text,
      assistant: "synthetic",
      generationId: "other-generation",
      status: "ok",
    });
    fixture.nextTurn = 2;
    await room.alarm();
    expect(job()?.status).toBe("failed");
    expect(fixture.generated).toHaveLength(0);
  });
});
