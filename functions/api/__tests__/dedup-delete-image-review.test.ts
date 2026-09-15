import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";

const AUTH_TOKEN = "test-token";
const REVIEW_KEY = "review/char-1/20260726-A-r1-1753500000000.jpg";
const SUB_KEY = "sub/char-1/a.jpg";
const ETAG = "d41d8cd98f00b204e9800998ecf8427e";

type Event = { kind: "sql"; sql: string; args: unknown[] } | { kind: "delete"; key: string };

const makeEnv = () => {
  const events: Event[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        events.push({ kind: "sql", sql, args });
        return {
          run: () => Promise.resolve({ success: true, meta: {}, results: [] }),
          all: () => Promise.resolve({ results: [], success: true }),
          first: () => Promise.resolve(null),
          raw: <T = unknown[]>() => Promise.resolve([] as T[]),
        };
      },
    }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  const bucket = {
    head: (key: string) =>
      Promise.resolve(key === REVIEW_KEY ? { httpEtag: `"${ETAG}"`, size: 1024 } : null),
    list: () =>
      Promise.resolve({
        objects: [{ key: SUB_KEY, etag: ETAG, size: 1024 }],
        truncated: false,
      }),
    delete: (key: string) => {
      events.push({ kind: "delete", key });
      return Promise.resolve();
    },
  };
  return { events, env: { AUTH_TOKEN, DB: db, BUCKET: bucket } };
};

const requestDedupDelete = async () => {
  const { events, env } = makeEnv();
  const response = await app.request(
    "/api/admin/dedup-delete",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reviewKeys: [REVIEW_KEY] }),
    },
    env,
  );
  return { events, response };
};

describe("POST /api/admin/dedup-delete", () => {
  it("repoints image_review to the sub key before deleting the review object", async () => {
    const { events, response } = await requestDedupDelete();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deletedCount: 1, freedBytes: 1024 });

    const updateIndex = events.findIndex(
      (event) => event.kind === "sql" && event.sql.includes('update "image_review"'),
    );
    const deleteIndex = events.findIndex(
      (event) => event.kind === "delete" && event.key === REVIEW_KEY,
    );

    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeLessThan(deleteIndex);

    const update = events[updateIndex];
    expect(update.kind === "sql" && update.args).toEqual([SUB_KEY, REVIEW_KEY]);
  });
});
