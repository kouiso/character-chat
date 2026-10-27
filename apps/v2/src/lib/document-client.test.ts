import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteDocument,
  DocumentClientError,
  listDocuments,
  MAX_DOCUMENT_UPLOAD_BYTES,
  parseDocumentBudget,
  setDocumentBudget,
  updateDocument,
  uploadDocument,
} from "./document-client";

const scope = { characterId: "character /one", conversationId: "conversation&two" };
const listing = { documents: [], settings: { budgetChars: 4000 } };
afterEach(() => vi.restoreAllMocks());

describe("scoped document client", () => {
  it("encodes the conversation locator and sends no owner/worldline claims", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(listing));
    const signal = new AbortController().signal;
    expect(await listDocuments(scope, signal)).toEqual(listing);
    await updateDocument(scope, "document-1", { enabled: false, budgetChars: 20 }, signal);
    await setDocumentBudget(scope, 200, signal);
    await deleteDocument(scope, "document-1", signal);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe("/api/chat/character%20%2Fone/documents?conversationId=conversation%26two");
      expect(options?.signal).toBe(signal);
      if (typeof options?.body === "string") {
        const payload: unknown = JSON.parse(options.body);
        expect(payload).not.toHaveProperty("userId");
        expect(payload).not.toHaveProperty("worldlineId");
      }
    }
    expect(fetchMock.mock.calls.slice(1).map(([, options]) => options?.body)).toEqual([
      JSON.stringify({ documentId: "document-1", enabled: false, budgetChars: 20 }),
      JSON.stringify({ budgetChars: 200 }),
      JSON.stringify({ documentId: "document-1" }),
    ]);
  });

  it("normalizes only a MIME-less TXT and posts a file without scope fields", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    await uploadDocument(scope, new File(["合成資料"], "fixture.txt"));
    const form = fetchMock.mock.calls[0][1]?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) throw new Error("synthetic multipart missing");
    expect([...form.keys()]).toEqual(["file"]);
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    if (!(file instanceof File)) throw new Error("synthetic file missing");
    expect(file.type).toBe("text/plain");
  });

  it("rejects an oversized TXT, empty content and unsupported PDF before fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    for (const file of [
      new File(["x".repeat(MAX_DOCUMENT_UPLOAD_BYTES + 1)], "large.txt", { type: "text/plain" }),
      new File([], "empty.txt"),
      new File(["synthetic"], "file.pdf", { type: "application/pdf" }),
    ]) {
      await expect(uploadDocument(scope, file)).rejects.toBeInstanceOf(DocumentClientError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the server recovery ID and returns a safe fallback for non-JSON errors", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "storage_failure",
            message: "取り込みを再試行してください",
            documentId: "pending-1",
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(new Response("synthetic-proxy-private", { status: 503 }));
    await expect(listDocuments(scope)).rejects.toMatchObject({
      code: "storage_failure",
      documentId: "pending-1",
    });
    await expect(listDocuments(scope)).rejects.toThrow(
      "資料の操作に失敗しました。再試行してください",
    );
  });

  it.each(["", "-1", "1.5", "100001", "Infinity", "1e2"])("rejects invalid budget %s", (value) => {
    expect(() => parseDocumentBudget(value)).toThrow("整数");
  });
});
