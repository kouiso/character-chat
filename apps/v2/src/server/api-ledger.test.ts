// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(() => ({ database: true })),
  loadLatestLedger: vi.fn(),
  updateLatestLedger: vi.fn(),
  getPlatform: vi.fn(async () => ({ env: { DB: {} } })),
}));

vi.mock("@v2/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@v2/db")>()),
  createDb: mocks.createDb,
  loadLatestLedger: mocks.loadLatestLedger,
  updateLatestLedger: mocks.updateLatestLedger,
}));

vi.mock("./platform", () => ({ getPlatform: mocks.getPlatform }));

const { handleLedgerGet, handleLedgerRequest } = await import("./api-ledger");

const baseLedger = {
  phase: "conversation",
  location: "台所",
  time: "深夜",
  present: ["さくら"],
  clothing: { さくら: "ニット" },
  position: null,
  lastEvents: ["キスをした"],
  items: { スマホ: "彼のポケット" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/chat/:id/ledger", () => {
  it("conversationId が無いと 422", async () => {
    const response = await handleLedgerGet(
      "char",
      new Request("https://example.com/api/chat/char/ledger"),
    );
    expect(response.status).toBe(422);
  });

  it("台帳を返す", async () => {
    mocks.loadLatestLedger.mockResolvedValue(baseLedger);
    const response = await handleLedgerGet(
      "char",
      new Request("https://example.com/api/chat/char/ledger?conversationId=conv"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ledger: baseLedger });
  });

  it("台帳行が無ければ ledger: null", async () => {
    mocks.loadLatestLedger.mockResolvedValue(null);
    const response = await handleLedgerGet(
      "char",
      new Request("https://example.com/api/chat/char/ledger?conversationId=conv"),
    );
    expect(await response.json()).toEqual({ ledger: null });
  });

  it("権限外の会話は 404", async () => {
    const { ConversationAccessError } = await import("@v2/db");
    mocks.loadLatestLedger.mockRejectedValue(new ConversationAccessError());
    const response = await handleLedgerGet(
      "char",
      new Request("https://example.com/api/chat/char/ledger?conversationId=conv"),
    );
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/chat/:id/ledger", () => {
  const patch = (body: unknown) =>
    handleLedgerRequest(
      "char",
      new Request("https://example.com/api/chat/char/ledger", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("JSON でない本体は 400", async () => {
    const response = await handleLedgerRequest(
      "char",
      new Request("https://example.com/api/chat/char/ledger", {
        method: "PATCH",
        body: "not-json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("台帳の形が違うと 422", async () => {
    const response = await patch({
      conversationId: "conv",
      ledger: { ...baseLedger, phase: "invalid-phase" },
    });
    expect(response.status).toBe(422);
  });

  it("items の無い旧形式も受け付ける（v0002 後方互換）", async () => {
    const legacy = { ...baseLedger } as Record<string, unknown>;
    delete legacy.items;
    mocks.updateLatestLedger.mockResolvedValue(3);
    const response = await patch({ conversationId: "conv", ledger: legacy });
    expect(response.status).toBe(200);
    // 保存される形には items が空で補われる。
    expect(mocks.updateLatestLedger.mock.calls[0][3]).toEqual({
      ...baseLedger,
      items: {},
    });
  });

  it("有効な台帳を保存してターン番号を返す", async () => {
    mocks.updateLatestLedger.mockResolvedValue(4);
    const response = await patch({ conversationId: "conv", ledger: baseLedger });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ turn: 4, ledger: baseLedger });
  });

  it("台帳行が無い会話は 409", async () => {
    mocks.updateLatestLedger.mockResolvedValue(null);
    const response = await patch({ conversationId: "conv", ledger: baseLedger });
    expect(response.status).toBe(409);
  });

  it("権限外の会話は 404", async () => {
    const { ConversationAccessError } = await import("@v2/db");
    mocks.updateLatestLedger.mockRejectedValue(new ConversationAccessError());
    const response = await patch({ conversationId: "conv", ledger: baseLedger });
    expect(response.status).toBe(404);
  });
});
