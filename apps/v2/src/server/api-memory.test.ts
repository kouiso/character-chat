// @vitest-environment node
import { MemoryAccessError, MemoryConflictError } from "@v2/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryApi } from "./api-memory";

import type { ManagedMemory, ManagedMemoryStore, MemoryScope, V2Db } from "@v2/db";

const mocks = vi.hoisted(() => ({ createStore: vi.fn(), resolveScope: vi.fn() }));
vi.mock(import("@v2/db"), async (importOriginal) => ({
  ...(await importOriginal()),
  createManagedMemoryStore: mocks.createStore,
  resolveMemoryScope: mocks.resolveScope,
}));

const memory: ManagedMemory = {
  id: "memory-1",
  conversationId: "conversation-1",
  memoryKey: "favorite-color",
  kind: "preference",
  content: "好きな色は緑",
  supersededById: null,
  sourceTurn: null,
  createdAt: 1,
  updatedAt: 1,
  state: "active",
  eligible: true,
  pinned: false,
  enabled: true,
  sourceType: "user",
  sourceMessageId: null,
  sourceRevision: null,
  characterVersionId: null,
};
const scope: MemoryScope = {
  ownerUserId: "verified-user",
  characterId: "synthetic-character",
  worldlineId: "worldline-1",
  conversationId: "conversation-1",
};
const database = {} as V2Db;

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/memory/conversation-1", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("memory HTTP management API", () => {
  let store: ManagedMemoryStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      snapshot: vi.fn().mockResolvedValue({ enabled: true, memories: [memory] }),
      listCurrent: vi.fn().mockResolvedValue([memory]),
      history: vi.fn().mockResolvedValue([memory]),
      add: vi.fn().mockResolvedValue(memory),
      edit: vi.fn().mockResolvedValue(memory),
      delete: vi.fn().mockResolvedValue(undefined),
      setPinned: vi.fn().mockResolvedValue(undefined),
      setMemoryEnabled: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn().mockResolvedValue(undefined),
    };
    mocks.createStore.mockReturnValue(store);
    mocks.resolveScope.mockResolvedValue(scope);
  });

  const authenticated = () =>
    createMemoryApi({ db: database, authenticate: async () => "verified-user" });

  it("uses the authenticated principal and database scope and never caches a private snapshot", async () => {
    const response = await authenticated()(
      new Request(
        "https://example.test/api/memory/conversation-1?ownerUserId=attacker&worldlineId=other",
      ),
      "conversation-1",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, memories: [memory] });
    expect(mocks.resolveScope).toHaveBeenCalledWith(database, "verified-user", "conversation-1");
    expect(mocks.createStore).toHaveBeenCalledWith(database, scope);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
  });

  it("rejects unauthenticated requests and hides authentication implementation errors", async () => {
    const unauthorized = createMemoryApi({ db: database, authenticate: async () => null });
    const response = await unauthorized(
      new Request("https://example.test/api/memory/conversation-1"),
      "conversation-1",
    );
    expect(response.status).toBe(401);
    expect(mocks.resolveScope).not.toHaveBeenCalled();
    const unavailable = createMemoryApi({
      db: database,
      authenticate: async () => {
        throw new Error("private-token");
      },
    });
    const failure = await unavailable(
      new Request("https://example.test/api/memory/conversation-1"),
      "conversation-1",
    );
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("private-token");
  });

  it("returns scoped history without treating a supplied memory id as authorization", async () => {
    const response = await authenticated()(
      new Request("https://example.test/api/memory/conversation-1?history=memory-1"),
      "conversation-1",
    );
    expect(await response.json()).toEqual({ memories: [memory] });
    expect(store.history).toHaveBeenCalledWith("memory-1");
    vi.mocked(store.history).mockRejectedValueOnce(new MemoryAccessError());
    const denied = await authenticated()(
      new Request("https://example.test/api/memory/conversation-1?history=foreign-id"),
      "conversation-1",
    );
    expect(denied.status).toBe(404);
    const empty = await authenticated()(
      new Request("https://example.test/api/memory/conversation-1?history="),
      "conversation-1",
    );
    expect(empty.status).toBe(400);
  });

  it("dispatches every public command with a validated payload", async () => {
    const api = authenticated();
    expect(
      (
        await api(
          post({ action: "add", requestKey: "add-1", kind: "fact", content: "好きな飲み物はお茶" }),
          "conversation-1",
        )
      ).status,
    ).toBe(201);
    expect(store.add).toHaveBeenCalledWith({
      requestKey: "add-1",
      kind: "fact",
      content: "好きな飲み物はお茶",
    });
    expect(
      (
        await api(
          post({ action: "edit", requestKey: "edit-1", id: "memory-1", content: "好きな色は紫" }),
          "conversation-1",
        )
      ).status,
    ).toBe(200);
    expect(store.edit).toHaveBeenCalledWith({
      requestKey: "edit-1",
      id: "memory-1",
      content: "好きな色は紫",
    });
    for (const command of [
      { action: "delete", id: "memory-1" },
      { action: "pin", id: "memory-1", pinned: true },
      { action: "enable", id: "memory-1", enabled: false },
      { action: "set-enabled", enabled: false },
    ])
      expect((await api(post(command), "conversation-1")).status).toBe(200);
    expect(store.delete).toHaveBeenCalledWith("memory-1");
    expect(store.setPinned).toHaveBeenCalledWith("memory-1", true);
    expect(store.setMemoryEnabled).toHaveBeenCalledWith("memory-1", false);
    expect(store.setEnabled).toHaveBeenCalledWith(false);
  });

  it("rejects cross-origin browser writes and accepts authenticated JSON server requests", async () => {
    const command = { action: "set-enabled", enabled: false };
    const api = authenticated();
    const browserHeaders: Record<string, string>[] = [
      { origin: "https://foreign.test" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of browserHeaders) {
      expect((await api(post(command, headers), "conversation-1")).status).toBe(403);
    }
    expect(store.setEnabled).not.toHaveBeenCalled();
    expect(
      (await api(post(command, { origin: "https://example.test" }), "conversation-1")).status,
    ).toBe(200);
    expect((await api(post(command), "conversation-1")).status).toBe(200);
    expect(
      (await api(post(command, { "content-type": "text/plain" }), "conversation-1")).status,
    ).toBe(415);
    expect(
      (
        await api(
          new Request("https://example.test/api/memory/conversation-1", { method: "DELETE" }),
          "conversation-1",
        )
      ).headers.get("allow"),
    ).toBe("GET, POST");
  });

  it("rejects unknown fields, invalid bodies, and attempts to assign extraction provenance", async () => {
    const api = authenticated();
    for (const command of [
      { action: "add", requestKey: "a", kind: "fact", content: " " },
      { action: "add", requestKey: "a", kind: "fact", content: "tea", ownerUserId: "other" },
      { action: "add", requestKey: "a", kind: "fact", content: "tea", sourceRevision: 2 },
      { action: "unrecognized" },
    ])
      expect((await api(post(command), "conversation-1")).status).toBe(400);
    const malformed = await api(
      new Request("https://example.test/api/memory/conversation-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      "conversation-1",
    );
    expect(malformed.status).toBe(400);
    expect(store.add).not.toHaveBeenCalled();
  });

  it("maps authorization, conflicts, and internal errors without exposing database details", async () => {
    mocks.resolveScope.mockRejectedValueOnce(new MemoryAccessError());
    expect(
      (await authenticated()(post({ action: "delete", id: "memory-1" }), "conversation-1")).status,
    ).toBe(404);
    vi.mocked(store.delete).mockRejectedValueOnce(new MemoryConflictError());
    expect(
      (await authenticated()(post({ action: "delete", id: "memory-1" }), "conversation-1")).status,
    ).toBe(409);
    vi.mocked(store.snapshot).mockRejectedValueOnce(
      new Error("SELECT private-data FROM internal_table"),
    );
    const failure = await authenticated()(
      new Request("https://example.test/api/memory/conversation-1"),
      "conversation-1",
    );
    expect(failure.status).toBe(500);
    expect(failure.headers.get("cache-control")).toBe("no-store");
    expect(await failure.text()).not.toContain("private-data");
  });
});
