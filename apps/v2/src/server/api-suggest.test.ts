// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// RIT-203: 発話候補 API。所有者確認・入力検証・fake 経路・モデル呼出しを見る。
const mocks = vi.hoisted(() => ({
  ownerRow: { value: { user_id: "local" } as { user_id: string } | null },
  loadHistory: vi.fn(),
  invoke: vi.fn(),
  env: {
    APP_ENV: "test",
    V2_FAKE_MODEL: "1",
    OPENROUTER_API_KEY: "test-key",
  } as Record<string, unknown>,
}));

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      ...mocks.env,
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => mocks.ownerRow.value }) }),
      },
    },
  })),
}));

vi.mock("./engine", () => ({ loadHistory: mocks.loadHistory }));

vi.mock("@v2/engine", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createModelChain: vi.fn(() => [{ name: "m", model: { invoke: mocks.invoke } }]),
}));

const { handleSuggestRequest } = await import("./api-suggest");

const post = (body: unknown) =>
  new Request("https://example.com/api/chat/char/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ownerRow.value = { user_id: "local" };
  mocks.env.V2_FAKE_MODEL = "1";
  mocks.loadHistory.mockResolvedValue({
    conversationId: "conv",
    turn: 2,
    history: [
      { role: "user", content: "こんばんは" },
      { role: "assistant", content: "…来てくれたんだ" },
    ],
  });
});

describe("POST /api/chat/:id/suggest", () => {
  it("conversationId が欠けると 400", async () => {
    const response = await handleSuggestRequest("char", post({}));
    expect(response.status).toBe(400);
  });

  it("他人の会話は 404（ownerGuard が外す）", async () => {
    mocks.ownerRow.value = { user_id: "someone-else" };
    const response = await handleSuggestRequest("char", post({ conversationId: "conv" }));
    expect(response.status).toBe(404);
  });

  it("fake 経路は固定候補を3つ返し、モデルも履歴も触らん", async () => {
    const response = await handleSuggestRequest("char", post({ conversationId: "conv" }));
    expect(response.status).toBe(200);
    const body: { suggestions: string[] } = await response.json();
    expect(body.suggestions).toHaveLength(3);
    expect(mocks.loadHistory).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("実経路は履歴をモデルへ渡し、行を候補へ掃除して返す", async () => {
    mocks.env.V2_FAKE_MODEL = "0";
    mocks.invoke.mockResolvedValue({
      content: "1. もっと近くに来て\n- 「その続きを聞かせて」\n短\nゆっくりでいいから、ね",
    });
    const response = await handleSuggestRequest("char", post({ conversationId: "conv" }));
    expect(response.status).toBe(200);
    const body: { suggestions: string[] } = await response.json();
    // 先頭記号・番号・括弧を剥がし、2字未満を落として最大3件。
    expect(body.suggestions).toEqual([
      "もっと近くに来て",
      "その続きを聞かせて",
      "ゆっくりでいいから、ね",
    ]);
    expect(mocks.loadHistory).toHaveBeenCalledWith({
      characterId: "char",
      conversationId: "conv",
    });
    const [, human] = mocks.invoke.mock.calls[0][0];
    expect(human.content).toContain("ユーザー: こんばんは");
    expect(human.content).toContain("キャラ: …来てくれたんだ");
  });
});
