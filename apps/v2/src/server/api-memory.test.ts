// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@v2/db";

const calls = vi.hoisted(() => ({ add: vi.fn(), change: vi.fn(), remove: vi.fn(), list: vi.fn() }));
vi.mock("./platform", () => ({ getPlatform: async () => ({ env: { DB: {} } }) }));
vi.mock("@v2/db", async (original) => ({
  ...(await original<typeof DbModule>()),
  createDb: () => ({}),
  addMemory: calls.add,
  changeMemory: calls.change,
  removeMemory: calls.remove,
  listMemories: calls.list,
}));

const { handleMemoryRequest } = await import("./api-memory");
const { MemoryConflictError, ConversationAccessError } = await import("@v2/db");
const value = { id: "memory", content: "今日は図書館で集合", kind: "fact", pinned: false };
const request = (method: string, body?: unknown) =>
  handleMemoryRequest(
    "character",
    new Request("https://example.test/api/memory/character?conversationId=conversation", {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  calls.list.mockResolvedValue([]);
  calls.add.mockResolvedValue(value);
});

describe("記憶API", () => {
  it("一覧と追加をサーバーの利用者と指定会話へ限定する", async () => {
    expect((await request("GET")).status).toBe(200);
    const response = await request("POST", { ...value, userId: "attacker" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls.add).toHaveBeenCalledWith(
      {},
      { userId: "local", characterId: "character", conversationId: "conversation" },
      value,
    );
  });
  it("空・長文・版番号なしをDB到達前に拒否する", async () => {
    for (const content of ["", " ", "x".repeat(1_001)])
      expect((await request("POST", { ...value, content })).status).toBe(400);
    expect((await request("PUT", value)).status).toBe(400);
    expect((await request("DELETE", { id: "memory" })).status).toBe(400);
    expect(calls.add).not.toHaveBeenCalled();
    expect(calls.change).not.toHaveBeenCalled();
    expect(calls.remove).not.toHaveBeenCalled();
  });
  it("競合を409、所有者違いを404にし、内部のエラー本文を公開しない", async () => {
    calls.change.mockRejectedValueOnce(new MemoryConflictError());
    expect((await request("PUT", { ...value, revision: 0 })).status).toBe(409);
    calls.list.mockRejectedValueOnce(new ConversationAccessError());
    expect((await request("GET")).status).toBe(404);
    calls.list.mockRejectedValueOnce(new Error("private-database-info"));
    const response = await request("GET");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-database-info");
  });
});
