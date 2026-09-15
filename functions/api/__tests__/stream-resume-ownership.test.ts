import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";

type StreamingChunkRow = {
  stream_id: string;
  seq: number;
  raw_data: string;
  is_done: number;
  user_id: string | null;
};

type PreparedStatementCall = {
  sql: string;
  binds: unknown[];
};

const makeD1Mock = (rows: StreamingChunkRow[]) => {
  const calls: PreparedStatementCall[] = [];

  return {
    calls,
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => {
        calls.push({ sql, binds });
        return {
          run: () => Promise.resolve({ success: true, meta: {} }),
          all: <T = unknown>() => {
            if (!sql.includes("FROM streaming_chunk")) {
              return Promise.resolve({ results: [] as T[], success: true });
            }

            const [streamId, userId] = binds;
            const results = rows
              .filter(
                (row) =>
                  row.stream_id === streamId && (row.user_id === userId || row.user_id === null),
              )
              .sort((a, b) => a.seq - b.seq)
              .map((row) => ({
                raw_data: row.raw_data,
                seq: row.seq,
                is_done: row.is_done,
              }));

            return Promise.resolve({ results: results as T[], success: true });
          },
          first: <T = unknown>() => Promise.resolve(null as T | null),
          raw: <T = unknown[]>() => Promise.resolve([] as T[]),
        };
      },
    }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
};

const requestStream = async (rows: StreamingChunkRow[], _email: string, messageId = "abc") => {
  const db = makeD1Mock(rows);
  const response = await app.request(
    `/api/chat/stream?messageId=${messageId}`,
    {
      headers: {
        Authorization: "Bearer test-token",
      },
    },
    {
      AUTH_TOKEN: "test-token",
      DB: db,
      OPENROUTER_API_KEY: "",
      NOVITA_API_KEY: "",
    },
  );

  return { db, response };
};

describe("GET /api/chat/stream ownership", () => {
  it("returns stream data for the owning user", async () => {
    const { db, response } = await requestStream(
      [
        {
          stream_id: "abc",
          seq: 0,
          raw_data: "event: message\n",
          is_done: 0,
          user_id: "sukererion@gmail.com",
        },
        {
          stream_id: "abc",
          seq: 1,
          raw_data: "data: hello\n\n",
          is_done: 1,
          user_id: "sukererion@gmail.com",
        },
      ],
      "sukererion@gmail.com",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("event: message\ndata: hello\n\n");
    expect(db.calls.some((call) => call.binds.includes("sukererion@gmail.com"))).toBe(true);
  });

  it("returns 404 for another user's stream_id", async () => {
    const { response } = await requestStream(
      [
        {
          stream_id: "abc",
          seq: 0,
          raw_data: "data: secret\n\n",
          is_done: 1,
          user_id: "other@example.com",
        },
      ],
      "sukererion@gmail.com",
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("stream not found");
  });

  it("keeps legacy rows without user_id accessible", async () => {
    const { response } = await requestStream(
      [
        {
          stream_id: "legacy-stream",
          seq: 0,
          raw_data: "data: legacy\n\n",
          is_done: 1,
          user_id: null,
        },
      ],
      "sukererion@gmail.com",
      "legacy-stream",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("data: legacy\n\n");
  });

  it("does not close a replay response before the stream is complete", async () => {
    const { response } = await requestStream(
      [
        {
          stream_id: "abc",
          seq: 0,
          raw_data: "data: partial",
          is_done: 0,
          user_id: "sukererion@gmail.com",
        },
      ],
      "sukererion@gmail.com",
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toBe("stream not complete");
  });
});
