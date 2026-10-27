// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createDocumentRequestHandler } from "./document-api";

import type { DocumentService } from "@v2/engine";

const address =
  "https://synthetic.invalid/api/chat/character/documents?conversationId=conversation";
const service = (): DocumentService => ({
  source: {
    loadSettings: async () => ({ budgetChars: 4000, documents: [] }),
    search: async () => [],
  },
  list: async () => [],
  settings: async () => ({ budgetChars: 4000, documents: [] }),
  upload: async () => {
    throw new Error("synthetic unused upload");
  },
  update: async () => {
    throw new Error("synthetic unused update");
  },
  remove: async () => undefined,
  setBudget: async () => undefined,
});

describe("document HTTP privacy boundary", () => {
  it.each(["POST", "PATCH", "DELETE"])(
    "rejects a foreign Origin for %s before resolving any scope",
    async (method) => {
      const resolve = vi.fn(async () => service());
      const form = new FormData();
      form.set("file", new File(["合成資料"], "fixture.txt", { type: "text/plain" }));
      const response = await createDocumentRequestHandler(resolve)(
        "character",
        new Request(address, {
          method,
          headers: { origin: "https://foreign.invalid" },
          body: form,
        }),
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it.each(["cross-site", "same-site"])(
    "rejects %s writes even when Origin is absent",
    async (site) => {
      const resolve = vi.fn(async () => service());
      const response = await createDocumentRequestHandler(resolve)(
        "character",
        new Request(address, {
          method: "POST",
          headers: { "sec-fetch-site": site },
          body: new FormData(),
        }),
      );
      expect(response.status).toBe(403);
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it("accepts same-origin mutation and marks private reads, writes and errors no-store", async () => {
    const handler = createDocumentRequestHandler(async () => service());
    const responses = [
      await handler("character", new Request(address)),
      await handler(
        "character",
        new Request(address, {
          method: "PATCH",
          headers: { origin: "https://synthetic.invalid", "sec-fetch-site": "same-origin" },
          body: JSON.stringify({ budgetChars: 100 }),
        }),
      ),
      await handler(
        "character",
        new Request(address, {
          method: "DELETE",
          body: JSON.stringify({ documentId: "synthetic-document" }),
        }),
      ),
      await handler(
        "character",
        new Request(address, { method: "POST", body: "invalid multipart" }),
      ),
      await handler("character", new Request(address, { method: "PUT" })),
    ];
    expect(responses.map((response) => response.status)).toEqual([200, 200, 204, 400, 405]);
    expect(
      responses.every((response) => response.headers.get("cache-control") === "no-store"),
    ).toBe(true);
  });

  it("preserves a resolver denial's status while replacing its cache policy", async () => {
    const handler = createDocumentRequestHandler(
      async () =>
        new Response(null, {
          status: 401,
          headers: { "cache-control": "public, max-age=3600", "www-authenticate": "Basic" },
        }),
    );
    const response = await handler("character", new Request(address));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("www-authenticate")).toBe("Basic");
  });
});
