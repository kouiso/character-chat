import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createManagedMemoryStore } from "./managed-memory-store";
import { openSyntheticMemoryD1 } from "./test/memory-d1";

describe("independent review: historical-source resurrection", () => {
  let local: Awaited<ReturnType<typeof openSyntheticMemoryD1>>;
  beforeAll(async () => {
    local = await openSyntheticMemoryD1();
  });
  afterAll(async () => {
    await local?.dispose();
  });

  const setup = async (suffix: string) => {
    const scope = await local.scope(`review-${suffix}`);
    const store = createManagedMemoryStore(local.db, scope);
    for (const [index, messageId] of ["first", "second", "new"].entries()) {
      await local.message(scope, `${suffix}-${messageId}`, index + 1);
      await store.registerCommittedSource({
        messageId: `${suffix}-${messageId}`,
        revision: 1,
        characterVersionId: "synthetic-version-1",
      });
    }
    const first = await store.recordExtracted({
      requestKey: "first",
      key: "favorite-color",
      kind: "preference",
      content: "blue",
      source: { messageId: `${suffix}-first`, revision: 1 },
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (first.status !== "stored") throw new Error("synthetic fixture failed");
    const second = await store.recordExtracted({
      requestKey: "second",
      key: "favorite-color",
      kind: "preference",
      content: "green",
      source: { messageId: `${suffix}-second`, revision: 1 },
      scopeEpoch: 0,
      expectedCurrentId: first.memory.id,
    });
    if (second.status !== "stored") throw new Error("synthetic fixture failed");
    return { store, first: first.memory, second: second.memory };
  };

  it("does not reextract a deleted memory family from a historical source under a different key", async () => {
    const { store, second } = await setup("deleted-family");
    await store.delete(second.id);
    expect(await store.listCurrent()).toEqual([]);
    const alias = await store.recordExtracted({
      requestKey: "historical-alias",
      key: "color-alias",
      kind: "preference",
      content: "blue",
      source: { messageId: "deleted-family-first", revision: 1 },
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    expect(alias.status).toBe("blocked");
    expect(await store.listCurrent()).toEqual([]);
  });

  it("does not restore an older contradicted fact under another key after an explicit correction", async () => {
    const { store, second } = await setup("corrected-family");
    await store.edit({ requestKey: "correction", id: second.id, content: "purple" });
    const alias = await store.recordExtracted({
      requestKey: "historical-alias",
      key: "color-alias",
      kind: "preference",
      content: "blue",
      source: { messageId: "corrected-family-first", revision: 1 },
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    expect(alias.status).toBe("blocked");
    expect((await store.listCurrent()).map((memory) => memory.content)).toEqual(["purple"]);
  });

  it("accepts a new independent source that updates the corrected preference", async () => {
    const { store, second } = await setup("new-source");
    const corrected = await store.edit({
      requestKey: "correction",
      id: second.id,
      content: "purple",
    });
    const updated = await store.recordExtracted({
      requestKey: "new-independent-source",
      key: "favorite-color",
      kind: "preference",
      content: "yellow",
      source: { messageId: "new-source-new", revision: 1 },
      scopeEpoch: 0,
      expectedCurrentId: corrected.id,
    });
    expect(updated.status).toBe("stored");
    expect((await store.listCurrent()).map((memory) => memory.content)).toEqual(["yellow"]);
  });

  it("does not overwrite an explicit summary correction using the unchanged original parents", async () => {
    const { store, second } = await setup("corrected-summary");
    const summary = await store.recordExtracted({
      requestKey: "summary",
      key: "summary-color",
      kind: "summary",
      content: "favorite color: green",
      parents: [second.id],
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (summary.status !== "stored") throw new Error("synthetic fixture failed");
    const corrected = await store.edit({
      requestKey: "correct-summary",
      id: summary.memory.id,
      content: "the summary was explicitly corrected",
    });
    const recomputed = await store.recordExtracted({
      requestKey: "recomputed-summary",
      key: "summary-color",
      kind: "summary",
      content: "favorite color: green",
      parents: [second.id],
      scopeEpoch: 0,
      expectedCurrentId: corrected.id,
    });
    expect(recomputed.status).toBe("blocked");
    expect((await store.listCurrent()).map((memory) => memory.content)).toContain(
      "the summary was explicitly corrected",
    );
  });

  it("does not resurrect a deleted summary by reextracting its source into an alias parent", async () => {
    const { store, second } = await setup("deleted-summary-alias");
    const summary = await store.recordExtracted({
      requestKey: "summary",
      key: "summary-color",
      kind: "summary",
      content: "favorite color: green",
      parents: [second.id],
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (summary.status !== "stored") throw new Error("synthetic fixture failed");
    await store.delete(summary.memory.id);
    const aliasParent = await store.recordExtracted({
      requestKey: "alias-parent",
      key: "alias-color",
      kind: "preference",
      content: "green",
      source: { messageId: "deleted-summary-alias-second", revision: 1 },
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    if (aliasParent.status === "blocked") return;
    const aliasSummary = await store.recordExtracted({
      requestKey: "alias-summary",
      key: "alias-summary-color",
      kind: "summary",
      content: "favorite color: green",
      parents: [aliasParent.memory.id],
      scopeEpoch: 0,
      expectedCurrentId: null,
    });
    expect(aliasSummary.status).toBe("blocked");
  });
});
