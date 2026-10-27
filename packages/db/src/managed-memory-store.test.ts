import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMemoryApi } from "../../../apps/v2/src/server/api-memory";

import { createDb } from "./client";
import {
  createManagedMemoryStore,
  registerMemoryConversation,
  resolveMemoryScope,
} from "./managed-memory-store";
import { MemoryAccessError, MemoryConflictError } from "./memory-contract";
import { openSyntheticMemoryD1 } from "./test/memory-d1";

import type { ManagedMemoryEngineStore } from "./managed-memory-store";
import type { MemoryScope } from "./memory-contract";

describe("managed memory: synthetic D1 acceptance", () => {
  let local: Awaited<ReturnType<typeof openSyntheticMemoryD1>>;
  const open = async (suffix: string) => {
    const scope = await local.scope(suffix);
    return { scope, store: createManagedMemoryStore(local.db, scope) };
  };
  const source = async (
    scope: MemoryScope,
    store: ManagedMemoryEngineStore,
    id: string,
    turn = 1,
  ) => {
    await local.message(scope, id, turn);
    await store.registerCommittedSource({
      messageId: id,
      revision: 1,
      characterVersionId: "character-version-1",
    });
    return { messageId: id, revision: 1 };
  };
  beforeAll(async () => {
    local = await openSyntheticMemoryD1();
  });
  afterAll(async () => {
    await local?.dispose();
  });

  it("keeps correction history, replays exact mutations, and rejects changed retry payloads", async () => {
    const { store } = await open("edits");
    const first = await store.add({ requestKey: "add", kind: "preference", content: "blue" });
    expect(await store.add({ requestKey: "add", kind: "preference", content: "blue" })).toEqual(
      first,
    );
    await expect(
      store.add({ requestKey: "add", kind: "preference", content: "green" }),
    ).rejects.toBeInstanceOf(MemoryConflictError);
    let last = first;
    for (const content of ["green", "yellow", "purple"])
      last = await store.edit({ requestKey: `edit-${content}`, id: last.id, content });
    expect(await store.listCurrent()).toEqual([last]);
    expect(await store.history(first.id)).toHaveLength(4);
    expect(
      (await store.history(first.id)).find((memory) => memory.id === first.id)?.supersededById,
    ).not.toBeNull();
    const replay = await store.edit({
      requestKey: "edit-purple",
      id: (await store.history(first.id)).find((memory) => memory.content === "yellow")!.id,
      content: "purple",
    });
    expect(replay.id).toBe(last.id);
  });

  it("refuses reads and mutations from another owner, character, worldline, or conversation", async () => {
    const { scope, store } = await open("scope");
    const memory = await store.add({ requestKey: "add", kind: "fact", content: "private marker" });
    for (const changed of [
      { ownerUserId: "another-owner" },
      { characterId: "character-b" },
      { worldlineId: "another-worldline" },
      { conversationId: "another-conversation" },
    ]) {
      const other = createManagedMemoryStore(local.db, { ...scope, ...changed });
      await expect(other.snapshot()).rejects.toBeInstanceOf(MemoryAccessError);
      await expect(other.history(memory.id)).rejects.toBeInstanceOf(MemoryAccessError);
      await expect(
        other.edit({ requestKey: "attack", id: memory.id, content: "wrong" }),
      ).rejects.toBeInstanceOf(MemoryAccessError);
      await expect(other.delete(memory.id)).rejects.toBeInstanceOf(MemoryAccessError);
      await expect(other.setPinned(memory.id, true)).rejects.toBeInstanceOf(MemoryAccessError);
    }
    await expect(
      resolveMemoryScope(local.db, "another-owner", scope.conversationId),
    ).rejects.toBeInstanceOf(MemoryAccessError);
    await expect(
      registerMemoryConversation(local.db, { ...scope, worldlineId: "forged-worldline" }),
    ).rejects.toBeInstanceOf(MemoryAccessError);
    const b = await local.scope("same-name-b", { characterId: "character-b" });
    expect(await createManagedMemoryStore(local.db, b).listCurrent()).toEqual([]);
    expect(await store.listCurrent()).toEqual([memory]);
  });

  it("replaces extracted preferences three times and blocks a delayed pre-correction extraction", async () => {
    const { scope, store } = await open("extraction");
    let previous: string | null = null;
    for (const [index, content] of ["blue", "green", "yellow", "purple"].entries()) {
      const origin = await source(scope, store, `color-${index}`, index + 1);
      const result = await store.recordExtracted({
        requestKey: `color-${index}`,
        key: "color",
        kind: "preference",
        content,
        source: origin,
        scopeEpoch: 0,
        expectedCurrentId: previous,
      });
      expect(result.status).toBe("stored");
      if (result.status === "stored") previous = result.memory.id;
    }
    const [current] = await store.listCurrent();
    expect(current.content).toBe("purple");
    const corrected = await store.edit({
      requestKey: "correct",
      id: current.id,
      content: "orange",
    });
    expect(
      (
        await store.recordExtracted({
          requestKey: "late-job",
          key: "color",
          kind: "preference",
          content: "purple",
          source: { messageId: "color-3", revision: 1 },
          scopeEpoch: 0,
          expectedCurrentId: current.id,
        })
      ).status,
    ).toBe("blocked");
    expect(
      (
        await store.recordExtracted({
          requestKey: "late-recomputed-job",
          key: "color",
          kind: "preference",
          content: "purple",
          source: { messageId: "color-3", revision: 1 },
          scopeEpoch: 0,
          expectedCurrentId: corrected.id,
        })
      ).status,
    ).toBe("blocked");
    expect(await store.listCurrent()).toEqual([corrected]);
  });

  it("tombstones a deleted fact and blocks renamed-key and exact replay resurrection", async () => {
    const { scope, store } = await open("delete");
    const origin = await source(scope, store, "deleted-source");
    const job = {
      requestKey: "extract",
      key: "color",
      kind: "preference" as const,
      content: "blue",
      source: origin,
      scopeEpoch: 0,
      expectedCurrentId: null,
    };
    const result = await store.recordExtracted(job);
    if (result.status !== "stored") throw new Error("fixture extraction failed");
    const candidates = [result.memory.id];
    await store.setPinned(result.memory.id, true);
    await store.delete(result.memory.id);
    expect(await store.listCurrent()).toEqual([]);
    expect(await store.selectForGeneration(candidates)).toEqual([]);
    expect(
      (
        await store.recordExtracted({
          ...job,
          requestKey: "retry",
          expectedCurrentId: result.memory.id,
        })
      ).status,
    ).toBe("blocked");
    expect(
      (await store.recordExtracted({ ...job, requestKey: "renamed", key: "renamed-color" })).status,
    ).toBe("blocked");
    const replay = await store.recordExtracted(job);
    if (replay.status !== "stored") throw new Error("idempotent receipt missing");
    expect(replay.memory.state).toBe("deleted");
    expect(replay.memory.content).toBe("");
    expect((await store.history(result.memory.id)).every((memory) => memory.content === "")).toBe(
      true,
    );
  });

  it("invalidates nested pinned summaries when their message revision changes", async () => {
    const { scope, store } = await open("derived");
    const origin = await source(scope, store, "derived-source");
    const first = await store.recordExtracted({
      requestKey: "root",
      key: "city",
      kind: "fact",
      content: "Osaka",
      source: origin,
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (first.status !== "stored") throw new Error("fixture failed");
    const summary = await store.recordExtracted({
      requestKey: "summary",
      key: "summary",
      kind: "summary",
      content: "city: Osaka",
      parents: [first.memory.id],
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (summary.status !== "stored") throw new Error("fixture failed");
    const nested = await store.recordExtracted({
      requestKey: "nested",
      key: "nested",
      kind: "summary",
      content: "retained city: Osaka",
      parents: [summary.memory.id],
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (nested.status !== "stored") throw new Error("fixture failed");
    await store.setPinned(nested.memory.id, true);
    await store.registerCommittedSource({
      messageId: origin.messageId,
      revision: 2,
      characterVersionId: "character-version-1",
    });
    expect(await store.listCurrent()).toEqual([]);
    expect(
      (await store.snapshot()).memories.every((memory) => memory.state === "invalidated"),
    ).toBe(true);
    expect(
      (
        await store.recordExtracted({
          requestKey: "stale-source",
          key: "other-city",
          kind: "fact",
          content: "Osaka",
          source: origin,
          scopeEpoch: 0,
          expectedCurrentId: null,
        })
      ).status,
    ).toBe("blocked");
  });

  it("does not resurrect an invalidated or deleted source through later registration", async () => {
    const { scope, store } = await open("source-tombstone");
    await local.message(scope, "unregistered-source");
    await store.invalidateSource({ messageId: "unregistered-source", revision: 1 });
    await expect(
      store.registerCommittedSource({
        messageId: "unregistered-source",
        revision: 1,
        characterVersionId: "v1",
      }),
    ).rejects.toBeInstanceOf(MemoryConflictError);
    await store.registerCommittedSource({
      messageId: "unregistered-source",
      revision: 2,
      characterVersionId: "v1",
    });
    await store.invalidateSource({ messageId: "unregistered-source", revision: 2, deleted: true });
    await store.invalidateSource({ messageId: "unregistered-source", revision: 2 });
    await expect(
      store.registerCommittedSource({
        messageId: "unregistered-source",
        revision: 3,
        characterVersionId: "v1",
      }),
    ).rejects.toBeInstanceOf(MemoryConflictError);
  });

  it("retains stored memories while OFF and rejects old extraction jobs after OFF then ON", async () => {
    const { scope, store } = await open("off");
    const memory = await store.add({
      requestKey: "manual",
      kind: "fact",
      content: "kept while off",
    });
    const origin = await source(scope, store, "off-source");
    const job = {
      requestKey: "queued",
      key: "city",
      kind: "fact" as const,
      content: "Osaka",
      source: origin,
      scopeEpoch: await store.extractionEpoch(),
      expectedCurrentId: null,
    };
    await store.setEnabled(false);
    expect(await store.listCurrent()).toEqual([]);
    expect((await store.snapshot()).memories).toEqual([{ ...memory, eligible: false }]);
    expect((await store.recordExtracted(job)).status).toBe("blocked");
    await store.setEnabled(true);
    expect((await store.recordExtracted({ ...job, requestKey: "after-on" })).status).toBe(
      "blocked",
    );
    expect(await store.listCurrent()).toEqual([memory]);
  });

  it("shares only explicitly registered sessions in the same worldline", async () => {
    const { scope, store } = await open("shared-one");
    const item = await store.add({ requestKey: "one", kind: "fact", content: "same worldline" });
    const next = await local.scope("shared-two", { worldlineId: scope.worldlineId });
    const same = createManagedMemoryStore(local.db, next);
    expect(await same.listCurrent()).toEqual([item]);
    const edited = await same.edit({
      requestKey: "two",
      id: item.id,
      content: "changed in same worldline",
    });
    expect(await store.listCurrent()).toEqual([edited]);
    const different = await local.scope("other-worldline");
    expect(await createManagedMemoryStore(local.db, different).listCurrent()).toEqual([]);
  });

  it("executes the management HTTP boundary against real isolated D1", async () => {
    const { scope, store } = await open("http");
    const api = createMemoryApi({
      db: local.db,
      authenticate: async (request) => request.headers.get("x-synthetic-owner"),
    });
    const url = "http://synthetic.test/api/memory/test";
    const request = (owner: string, body?: unknown) =>
      new Request(url, {
        method: body ? "POST" : "GET",
        headers: {
          "x-synthetic-owner": owner,
          "content-type": "application/json",
          origin: "http://synthetic.test",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    expect((await api(request("other-owner"), scope.conversationId)).status).toBe(404);
    expect(
      (
        await api(
          request(scope.ownerUserId, {
            action: "add",
            requestKey: "http-add",
            kind: "preference",
            content: "green",
          }),
          scope.conversationId,
        )
      ).status,
    ).toBe(201);
    const [memory] = await store.listCurrent();
    expect(
      (
        await api(
          request(scope.ownerUserId, { action: "delete", id: memory.id }),
          scope.conversationId,
        )
      ).status,
    ).toBe(200);
    expect(await store.listCurrent()).toEqual([]);
    const response = await api(request(scope.ownerUserId), scope.conversationId);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("checks deletion and OFF again at the final extraction transaction", async () => {
    for (const change of ["delete", "off"] as const) {
      const { scope, store } = await open(`race-${change}`);
      const initial = await store.add({
        requestKey: "initial",
        kind: "fact",
        content: "retained initial fact",
      });
      const origin = await source(scope, store, `race-source-${change}`);
      let hook: (() => Promise<void>) | undefined = () =>
        change === "delete" ? store.delete(initial.id) : store.setEnabled(false);
      const intercepted = new Proxy(local.d1, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              const action = hook;
              hook = undefined;
              await action?.();
              return target.batch(statements);
            };
          const member: unknown = Reflect.get(target, key);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      const queued = createManagedMemoryStore(createDb(intercepted), scope);
      expect(
        (
          await queued.recordExtracted({
            requestKey: "queued",
            key: initial.memoryKey,
            kind: "fact",
            content: "delayed old data",
            source: origin,
            scopeEpoch: 0,
            expectedCurrentId: initial.id,
          })
        ).status,
      ).toBe("blocked");
      const snapshot = await store.snapshot();
      expect(snapshot.memories).toHaveLength(1);
      expect(snapshot.memories[0].supersededById).toBeNull();
      expect(snapshot.memories[0].state).toBe(change === "delete" ? "deleted" : "active");
    }
  });

  it("rejects older source turns even if a delayed job refreshes its expected head", async () => {
    const { scope, store } = await open("late-old-turn");
    const old = await source(scope, store, "older-fact", 1);
    const newer = await source(scope, store, "newer-fact", 2);
    const current = await store.recordExtracted({
      requestKey: "new",
      key: "city",
      kind: "fact",
      content: "Kyoto",
      source: newer,
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (current.status !== "stored") throw new Error("fixture failed");
    expect(
      (
        await store.recordExtracted({
          requestKey: "old",
          key: "city",
          kind: "fact",
          content: "Osaka",
          source: old,
          scopeEpoch: 0,
          expectedCurrentId: current.memory.id,
        })
      ).status,
    ).toBe("blocked");
    expect((await store.listCurrent()).map((memory) => memory.content)).toEqual(["Kyoto"]);
  });

  it("atomically rejects competing extraction heads and replays concurrent manual submissions", async () => {
    const { scope, store } = await open("managed-concurrency");
    const origin = await source(scope, store, "concurrent-origin");
    const results = await Promise.all(
      ["green", "purple"].map((content) =>
        store.recordExtracted({
          requestKey: content,
          key: "color",
          kind: "preference",
          content,
          source: origin,
          scopeEpoch: 0,
          expectedCurrentId: null,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "stored")).toHaveLength(1);
    expect(results.filter((result) => result.status === "blocked")).toHaveLength(1);
    const [current] = await store.listCurrent();
    expect(await store.history(current.id)).toHaveLength(1);
    const duplicates = await Promise.all(
      [0, 1].map(() =>
        store.add({ requestKey: "same-operation", kind: "fact", content: "single saved value" }),
      ),
    );
    expect(duplicates[0].id).toBe(duplicates[1].id);
    expect((await store.snapshot()).memories).toHaveLength(2);
  });

  it("rolls back correction, tombstones, and receipt together if saving a new version fails", async () => {
    const { store } = await open("managed-rollback");
    const initial = await store.add({ requestKey: "initial", kind: "fact", content: "original" });
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(initial.id);
    try {
      await expect(
        store.edit({ requestKey: "failed-edit", id: initial.id, content: "must not persist" }),
      ).rejects.toThrow();
    } finally {
      uuid.mockRestore();
    }
    expect(await store.listCurrent()).toEqual([initial]);
    expect(await store.history(initial.id)).toEqual([initial]);
    expect(
      (await store.edit({ requestKey: "failed-edit", id: initial.id, content: "saved on retry" }))
        .content,
    ).toBe("saved on retry");
  });

  it("adopts a legacy unkeyed row without exposing it until explicitly corrected", async () => {
    const { scope, store } = await open("legacy-adoption");
    await local.d1
      .prepare(
        "insert into v2_memory (id, conversation_id, kind, content, created_at) values ('legacy-unkeyed', ?, 'preference', 'blue', 0)",
      )
      .bind(scope.conversationId)
      .run();
    expect(await store.listCurrent()).toEqual([]);
    const adopted = await store.adoptLegacyMemory("legacy-unkeyed");
    expect(adopted.state).toBe("invalidated");
    const corrected = await store.edit({
      requestKey: "correct-legacy",
      id: adopted.id,
      content: "green",
    });
    expect(await store.listCurrent()).toEqual([corrected]);
    expect(await store.history(adopted.id)).toHaveLength(2);
  });

  it("rechecks ancestor validity before generation even after a physical source deletion", async () => {
    const { scope, store } = await open("projection");
    const origin = await source(scope, store, "projection-origin");
    const root = await store.recordExtracted({
      requestKey: "root",
      key: "city",
      kind: "fact",
      content: "Osaka",
      source: origin,
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (root.status !== "stored") throw new Error("fixture failed");
    const summary = await store.recordExtracted({
      requestKey: "summary",
      key: "summary",
      kind: "summary",
      content: "Osaka city",
      parents: [root.memory.id],
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (summary.status !== "stored") throw new Error("fixture failed");
    const selected = (await store.listCurrent()).map((memory) => memory.id);
    await local.d1.prepare("delete from v2_message where id = ?").bind(origin.messageId).run();
    expect(await store.selectForGeneration(selected)).toEqual([]);
    expect((await store.snapshot()).memories.every((memory) => !memory.eligible)).toBe(true);
    expect(
      (
        await store.recordExtracted({
          requestKey: "deleted-source-retry",
          key: "alias",
          kind: "fact",
          content: "Osaka",
          source: origin,
          scopeEpoch: 0,
          expectedCurrentId: null,
        })
      ).status,
    ).toBe("blocked");
  });
  it("keeps a replacement rolling summary eligible by retaining its root dependencies", async () => {
    const { scope, store } = await open("rolling-summary");
    const origin = await source(scope, store, "rolling-source-one");
    const root = await store.recordExtracted({
      requestKey: "root",
      key: "city",
      kind: "fact",
      content: "Osaka",
      source: origin,
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (root.status !== "stored") throw new Error("fixture failed");
    const first = await store.recordExtracted({
      requestKey: "first",
      key: "rolling",
      kind: "summary",
      content: "Osaka city",
      parents: [root.memory.id],
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (first.status !== "stored") throw new Error("fixture failed");
    const originTwo = await source(scope, store, "rolling-source-two", 2);
    const additional = await store.recordExtracted({
      requestKey: "additional",
      key: "food",
      kind: "preference",
      content: "rice",
      source: originTwo,
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (additional.status !== "stored") throw new Error("fixture failed");
    const dependent = await store.recordExtracted({
      requestKey: "dependent",
      key: "dependent-summary",
      kind: "summary",
      content: "old dependent summary",
      parents: [first.memory.id],
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (dependent.status !== "stored") throw new Error("fixture failed");
    expect(
      (
        await store.recordExtracted({
          requestKey: "would-retire-parent",
          key: "rolling",
          kind: "summary",
          content: "unsafe combined basis",
          parents: [first.memory.id, dependent.memory.id],
          scopeEpoch: 0,
          expectedCurrentId: first.memory.id,
        })
      ).status,
    ).toBe("blocked");
    const replacement = await store.recordExtracted({
      requestKey: "replacement",
      key: "rolling",
      kind: "summary",
      content: "Osaka city and rice",
      parents: [first.memory.id, additional.memory.id],
      scopeEpoch: 0,
      expectedCurrentId: first.memory.id,
    });
    if (replacement.status !== "stored") throw new Error("rolling summary unexpectedly blocked");
    expect(replacement.memory.eligible).toBe(true);
    expect(await store.selectForGeneration([replacement.memory.id])).toEqual([replacement.memory]);
    expect(
      (await store.history(first.memory.id)).find((memory) => memory.id === first.memory.id)
        ?.supersededById,
    ).toBe(replacement.memory.id);
    await store.invalidateSource({ messageId: origin.messageId, revision: 1 });
    expect(await store.selectForGeneration([replacement.memory.id])).toEqual([]);
  });

  it("orders registered sources across sessions in the same worldline", async () => {
    const { scope, store } = await open("ordered-session-one");
    const original = await source(scope, store, "ordered-old", 9);
    const first = await store.recordExtracted({
      requestKey: "first",
      key: "color",
      kind: "preference",
      content: "blue",
      source: original,
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (first.status !== "stored") throw new Error("fixture failed");
    const nextScope = await local.scope("ordered-session-two", { worldlineId: scope.worldlineId });
    const next = createManagedMemoryStore(local.db, nextScope);
    const newer = await source(nextScope, next, "ordered-new", 1);
    const latest = await next.recordExtracted({
      requestKey: "latest",
      key: "color",
      kind: "preference",
      content: "green",
      source: newer,
      scopeEpoch: 0,
      expectedCurrentId: first.memory.id,
    });
    if (latest.status !== "stored") throw new Error("new session preference rejected");
    expect(
      (
        await store.recordExtracted({
          requestKey: "old-retry-new-head",
          key: "color",
          kind: "preference",
          content: "blue",
          source: original,
          scopeEpoch: 0,
          expectedCurrentId: latest.memory.id,
        })
      ).status,
    ).toBe("blocked");
    expect((await store.listCurrent()).map((memory) => memory.content)).toEqual(["green"]);
  });
  it("rejects hybrid summary provenance so rolling cannot discard a direct source", async () => {
    const { scope, store } = await open("hybrid-provenance");
    const origin = await source(scope, store, "hybrid-origin");
    const parent = await store.add({ requestKey: "parent", kind: "fact", content: "parent value" });
    const input = {
      requestKey: "hybrid",
      key: "summary",
      kind: "summary" as const,
      content: "hybrid summary",
      source: origin,
      parents: [parent.id],
      scopeEpoch: 0,
      expectedCurrentId: null,
    };
    await expect(store.recordExtracted(input)).rejects.toThrow();
    await expect(
      store.recordExtracted({ ...input, requestKey: "hybrid-fact", kind: "fact" }),
    ).rejects.toThrow();
    expect(await store.listCurrent()).toEqual([parent]);
  });
});
