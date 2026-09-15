import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

const AUTH_TOKEN = "test-token";

type PreparedStatementCall = {
  sql: string;
  binds: unknown[];
};

const makeD1Mock = () => {
  const calls: PreparedStatementCall[] = [];

  return {
    calls,
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => {
        calls.push({ sql, binds });
        return {
          run: () => {
            if (sql.toLowerCase().startsWith("update")) {
              return Promise.resolve({ success: true, meta: { changes: 0 } });
            }
            return Promise.resolve({ success: true, meta: {} });
          },
          all: <T = unknown>() => {
            const normalizedSql = sql.toLowerCase();
            if (normalizedSql.includes("from") && normalizedSql.includes("message")) {
              return Promise.resolve({
                results: [{ id: "message-1" }] as T[],
                success: true,
              });
            }
            return Promise.resolve({ results: [] as T[], success: true });
          },
          first: <T = unknown>() => Promise.resolve(null as T | null),
          raw: <T = unknown[]>() => Promise.resolve([["message-1"]] as T),
        };
      },
    }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
};

describe("POST /api/image/persist", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 404 and deletes the R2 object when DB update changes 0 rows", async () => {
    const db = makeD1Mock();
    const put = vi.fn().mockResolvedValue(undefined);
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("image-bytes", {
          headers: { "content-type": "image/png" },
        }),
      ),
    );

    const response = await app.request(
      "/api/image/persist",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: "https://image.novita.ai/result.png",
          messageId: "message-1",
        }),
      },
      {
        AUTH_TOKEN,
        DB: db,
        BUCKET: {
          put,
          delete: deleteObject,
        },
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "message not found or already updated" });
    expect(put).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(expect.stringMatching(/^images\/.+\.png$/));
  });
});
