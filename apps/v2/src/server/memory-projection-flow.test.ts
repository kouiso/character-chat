// @vitest-environment node
import { createManagedMemoryStore, resolveMemoryScope } from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { openSyntheticMemoryD1 } from "../../../../packages/db/src/test/memory-d1";
import {
  createMemoryProjectionSource,
  createScopedMemoryProjection,
} from "../../../../packages/engine/src/memory-projection";

import { createMemoryApi } from "./api-memory";

import type { MemoryScope } from "@v2/db";

const inputFor = (scope: MemoryScope) => ({
  characterId: scope.characterId,
  query: "合成の確認",
  maxChars: 200,
});
const receiptSchema = z.object({ memory: z.object({ id: z.string().min(1) }) });

describe("mapped memory API to next-compose projection", () => {
  let local: Awaited<ReturnType<typeof openSyntheticMemoryD1>>;
  beforeAll(async () => {
    local = await openSyntheticMemoryD1();
  }, 60_000);
  afterAll(async () => local?.dispose());

  const setup = async (key: string) => {
    const scope = await local.scope(key);
    const mapped = await resolveMemoryScope(local.db, scope.ownerUserId, scope.conversationId);
    const api = createMemoryApi({ db: local.db, authenticate: async () => scope.ownerUserId });
    const command = (body: unknown) =>
      api(
        new Request(`https://memory.invalid/api/memory/${scope.conversationId}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://memory.invalid" },
          body: JSON.stringify(body),
        }),
        scope.conversationId,
      );
    return { scope, command, project: createScopedMemoryProjection(local.db, mapped) };
  };

  it("reflects three corrections, history, OFF and deletion in the next projection", async () => {
    const { scope, command, project } = await setup("projection-corrections");
    const first = await command({
      action: "add",
      requestKey: "add",
      kind: "preference",
      content: "好きな色は青",
    });
    expect(first.status).toBe(201);
    let { memory } = receiptSchema.parse(await first.json());
    const originalId = memory.id;
    const projectedIds = [memory.id];
    for (const [index, color] of ["緑", "黄", "紫"].entries()) {
      const response = await command({
        action: "edit",
        requestKey: `edit-${index}`,
        id: memory.id,
        content: `好きな色は${color}`,
      });
      expect(response.status).toBe(200);
      ({ memory } = receiptSchema.parse(await response.json()));
      const next = await project(inputFor(scope));
      expect(next).toEqual({
        context: [`【記憶】\n- 好きな色は${color}`],
        usedMemoryIds: [memory.id],
      });
      expect(projectedIds).not.toContain(memory.id);
      projectedIds.push(memory.id);
    }
    const store = createManagedMemoryStore(local.db, scope);
    expect(await store.history(originalId)).toHaveLength(4);
    expect((await command({ action: "set-enabled", enabled: false })).status).toBe(200);
    expect(await project(inputFor(scope))).toEqual({ context: [], usedMemoryIds: [] });
    expect((await command({ action: "set-enabled", enabled: true })).status).toBe(200);
    expect((await project(inputFor(scope))).usedMemoryIds).toEqual([memory.id]);
    expect((await command({ action: "delete", id: memory.id })).status).toBe(200);
    expect(await project(inputFor(scope))).toEqual({ context: [], usedMemoryIds: [] });
    expect(
      (await store.history(originalId)).every(
        (row) => row.state === "deleted" && row.content === "",
      ),
    ).toBe(true);
  });

  it("rechecks an ID changed between candidate selection and compose", async () => {
    const scope = await local.scope("projection-stale");
    const store = createManagedMemoryStore(local.db, scope);
    const old = await store.add({ requestKey: "add", kind: "fact", content: "旧い合成本文" });
    const listCurrent = store.listCurrent;
    let currentId = "";
    vi.spyOn(store, "listCurrent").mockImplementationOnce(async () => {
      const candidates = await listCurrent();
      currentId = (
        await store.edit({ requestKey: "correct", id: old.id, content: "現在の合成本文" })
      ).id;
      return candidates;
    });
    const project = createMemoryProjectionSource(scope, store);
    expect(await project(inputFor(scope))).toEqual({ context: [], usedMemoryIds: [] });
    expect(await project(inputFor(scope))).toEqual({
      context: ["【記憶】\n- 現在の合成本文"],
      usedMemoryIds: [currentId],
    });
  });

  it("excludes a deleted parent and derived summary even when the summary is pinned", async () => {
    const scope = await local.scope("projection-summary");
    const store = createManagedMemoryStore(local.db, scope);
    const parent = await store.add({ requestKey: "parent", kind: "fact", content: "合成の親記憶" });
    const summary = await store.recordExtracted({
      requestKey: "summary",
      key: "summary",
      kind: "summary",
      content: "合成の派生要約",
      expectedCurrentId: null,
      scopeEpoch: await store.extractionEpoch(),
      parents: [parent.id],
    });
    if (summary.status !== "stored") throw new Error("synthetic summary was not saved");
    await store.setPinned(summary.memory.id, true);
    const project = createScopedMemoryProjection(local.db, scope);
    expect((await project(inputFor(scope))).usedMemoryIds.sort()).toEqual(
      [parent.id, summary.memory.id].sort(),
    );
    await store.delete(parent.id);
    expect(await project(inputFor(scope))).toEqual({ context: [], usedMemoryIds: [] });
  });

  it("does not accept browser owner/worldline fields or cross-scope access", async () => {
    const { scope, command, project } = await setup("projection-authority");
    expect(
      (
        await command({
          action: "add",
          requestKey: "bad",
          kind: "fact",
          content: "合成本文",
          ownerUserId: "forged",
          worldlineId: "forged",
        })
      ).status,
    ).toBe(400);
    const foreign = createMemoryApi({ db: local.db, authenticate: async () => "foreign-owner" });
    expect(
      (
        await foreign(
          new Request("https://memory.invalid/api/memory/foreign"),
          scope.conversationId,
        )
      ).status,
    ).toBe(404);
    await expect(project({ ...inputFor(scope), characterId: "other-character" })).rejects.toThrow();
    const other = await local.scope("projection-other");
    await createManagedMemoryStore(local.db, other).add({
      requestKey: "other",
      kind: "fact",
      content: "別世界線の合成本文",
    });
    expect(await project(inputFor(scope))).toEqual({ context: [], usedMemoryIds: [] });
  });
});
