// @vitest-environment node
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatRoom } from "./chat-room";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));
vi.mock("./engine", () => ({
  loadHistory: vi.fn(),
  loadStoredTurn: vi.fn(),
  startTurn: vi.fn(),
}));

describe("保存イベントの公開境界（独立SQLite・合成行）", () => {
  let database: DatabaseSync;
  let room: ChatRoom;
  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    const state = {
      storage: {
        sql: {
          exec: (query: string, ...bindings: (string | number | null)[]) => {
            const rows = database.prepare(query).all(...bindings);
            return { toArray: () => rows };
          },
        },
      },
    };
    room = new ChatRoom(state as unknown as DurableObjectState, {} as Cloudflare.Env);
    database
      .prepare(
        "INSERT INTO jobs (id,character_id,conversation_id,text,digest,turn,attempts,status,created_at) VALUES ('synthetic-request','synthetic-character','synthetic-room','synthetic-input','synthetic-digest',1,1,'succeeded',1)",
      )
      .run();
  });
  afterEach(() => database.close());

  it.each([
    "{",
    "null",
    JSON.stringify({ type: "unknown" }),
    JSON.stringify({ type: "done", turn: 1 }),
    JSON.stringify({ type: "chunk", seq: "0", text: "synthetic" }),
    JSON.stringify({ type: "generation", systemPrompt: "synthetic internal metadata" }),
  ])("不正な保存行を固定文面で拒否する: %s", (raw) => {
    database
      .prepare("INSERT INTO events (job_id,event) VALUES (?,?)")
      .run("synthetic-request", raw);
    expect(() => room.readEvents("synthetic-request", 0)).toThrow(
      "保存されたイベントの形式が不正です。",
    );
    expect(database.prepare("SELECT COUNT(*) AS total FROM events").get()?.total).toBe(1);
  });

  it("既知イベントへ混入した内部情報を配信せず、連番は維持する", () => {
    const inserted = database.prepare("INSERT INTO events (job_id,event) VALUES (?,?)").run(
      "synthetic-request",
      JSON.stringify({
        type: "token",
        text: "synthetic public text",
        systemPrompt: "synthetic internal metadata",
        request: [],
      }),
    );
    expect(room.readEvents("synthetic-request", 0)).toEqual({
      status: "succeeded",
      hasMore: false,
      events: [
        {
          id: Number(inserted.lastInsertRowid),
          event: { type: "token", text: "synthetic public text" },
        },
      ],
    });
    expect(room.readEvents("synthetic-request", Number(inserted.lastInsertRowid)).events).toEqual(
      [],
    );
  });
});
