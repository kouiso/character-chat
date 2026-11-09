// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// RIT-202: 枝操作 API。所有者確認・入力検証・各 action の振り分けを見る。
const mocks = vi.hoisted(() => ({
  activateBranch: vi.fn(),
  listBranchSiblings: vi.fn(),
  restoreFromTurn: vi.fn(),
  rewriteUserMessage: vi.fn(),
  truncateFromTurn: vi.fn(),
  startTurn: vi.fn(),
  ownerRow: { value: { user_id: "local" } as { user_id: string } | null },
  userTextRow: { value: { content: "元の発話" } as { content: string } | null },
}));

vi.mock("@v2/db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  activateBranch: mocks.activateBranch,
  listBranchSiblings: mocks.listBranchSiblings,
  restoreFromTurn: mocks.restoreFromTurn,
  rewriteUserMessage: mocks.rewriteUserMessage,
  truncateFromTurn: mocks.truncateFromTurn,
}));

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      DB: {
        // ownerGuard は user_id、activeUserText は content を SELECT する。SQL で出し分ける。
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () =>
              sql.includes("user_id") ? mocks.ownerRow.value : mocks.userTextRow.value,
          }),
        }),
      },
    },
  })),
}));

vi.mock("./engine", () => ({ startTurn: mocks.startTurn }));

const { handleBranchList, handleBranchAction } = await import("./api-branch");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ownerRow.value = { user_id: "local" };
  mocks.userTextRow.value = { content: "元の発話" };
});

const post = (body: unknown) =>
  new Request("https://example.com/api/chat/char/branch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /api/chat/:id/branch", () => {
  it("クエリが欠けると 422", async () => {
    const response = await handleBranchList(new Request("https://example.com/api/chat/c/branch"));
    expect(response.status).toBe(422);
  });

  it("系列一覧を返す", async () => {
    mocks.listBranchSiblings.mockResolvedValue([{ id: "m1", branchNo: 0, active: true }]);
    const response = await handleBranchList(
      new Request(
        "https://example.com/api/chat/c/branch?conversationId=conv&turn=1&role=assistant",
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.listBranchSiblings).toHaveBeenCalledWith(
      expect.anything(),
      "conv",
      1,
      "assistant",
    );
  });

  it("他人の会話は 404", async () => {
    mocks.ownerRow.value = { user_id: "someone-else" };
    const response = await handleBranchList(
      new Request("https://example.com/api/chat/c/branch?conversationId=conv&turn=1&role=user"),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/chat/:id/branch", () => {
  it("壊れた body は 422", async () => {
    expect((await handleBranchAction("char", post({}))).status).toBe(422);
    expect(
      (await handleBranchAction("char", post({ action: "unknown", conversationId: "c" }))).status,
    ).toBe(422);
  });

  it("activate は対象 id を張り替える", async () => {
    mocks.activateBranch.mockResolvedValue("ok");
    const response = await handleBranchAction(
      "char",
      post({ action: "activate", conversationId: "conv", messageId: "m9" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.activateBranch).toHaveBeenCalledWith(expect.anything(), "m9");
  });

  it("activate の対象が無ければ 404", async () => {
    mocks.activateBranch.mockResolvedValue("not-found");
    const response = await handleBranchAction(
      "char",
      post({ action: "activate", conversationId: "conv", messageId: "none" }),
    );
    expect(response.status).toBe(404);
  });

  it("truncate / restore は fromTurn を渡す", async () => {
    mocks.truncateFromTurn.mockResolvedValue(undefined);
    mocks.restoreFromTurn.mockResolvedValue(undefined);
    await handleBranchAction(
      "char",
      post({ action: "truncate", conversationId: "c", fromTurn: 3 }),
    );
    await handleBranchAction("char", post({ action: "restore", conversationId: "c", fromTurn: 3 }));
    expect(mocks.truncateFromTurn).toHaveBeenCalledWith(expect.anything(), "c", 3);
    expect(mocks.restoreFromTurn).toHaveBeenCalledWith(expect.anything(), "c", 3);
  });

  it("rewrite は新しい id を返し、対象が無ければ 404", async () => {
    mocks.rewriteUserMessage.mockResolvedValue("new-id");
    const ok = await handleBranchAction(
      "char",
      post({ action: "rewrite", conversationId: "c", turn: 2, content: "書き換え" }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ messageId: "new-id" });
    mocks.rewriteUserMessage.mockResolvedValue(null);
    const missing = await handleBranchAction(
      "char",
      post({ action: "rewrite", conversationId: "c", turn: 2, content: "書き換え" }),
    );
    expect(missing.status).toBe(404);
  });

  it("regenerate は user 発話が無いターンで 404、startTurn は呼ばれない", async () => {
    mocks.userTextRow.value = null;
    const response = await handleBranchAction(
      "char",
      post({ action: "regenerate", conversationId: "c", turn: 2 }),
    );
    expect(response.status).toBe(404);
    expect(mocks.startTurn).not.toHaveBeenCalled();
  });

  it("regenerate は startTurn を branch=true・同じ発話で回し、系列を返す", async () => {
    const events = (async function* () {
      yield { type: "chunk", seq: 0, text: "再生成" };
    })();
    mocks.startTurn.mockResolvedValue({ conversationId: "c", events });
    mocks.listBranchSiblings.mockResolvedValue([
      { id: "a0", branchNo: 0, active: false },
      { id: "a1", branchNo: 1, active: true },
    ]);
    const response = await handleBranchAction(
      "char",
      post({ action: "regenerate", conversationId: "c", turn: 2 }),
    );
    expect(response.status).toBe(200);
    expect(mocks.startTurn).toHaveBeenCalledWith({
      characterId: "char",
      conversationId: "c",
      text: "元の発話",
      expectedTurn: 2,
      branch: true,
    });
    expect(await response.json()).toEqual({
      siblings: [
        { id: "a0", branchNo: 0, active: false },
        { id: "a1", branchNo: 1, active: true },
      ],
    });
  });

  it("regenerate で生成が失敗したら 502", async () => {
    const events = (async function* () {
      yield { type: "error", message: "x" };
    })();
    mocks.startTurn.mockResolvedValue({ conversationId: "c", events });
    const response = await handleBranchAction(
      "char",
      post({ action: "regenerate", conversationId: "c", turn: 2 }),
    );
    expect(response.status).toBe(502);
  });
});
