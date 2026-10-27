import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  db: {},
  readCharacter: vi.fn(),
  load: vi.fn(),
  loadChunkDeliveries: vi.fn(),
  loadConversationMessages: vi.fn(),
  loadConversationSnapshot: vi.fn(),
}));

vi.mock("@v2/db", () => ({
  createDb: () => fixture.db,
  createD1TurnStore: () => ({ load: fixture.load }),
  loadChunkDeliveries: fixture.loadChunkDeliveries,
}));
vi.mock("./characters", () => ({ readCharacter: fixture.readCharacter }));
vi.mock("./platform", () => ({ getPlatform: async () => ({ env: { DB: {} } }) }));
vi.mock("./model", () => ({ createRuntimeModel: vi.fn() }));
vi.mock("./conversation-data", () => ({
  loadConversationMessages: fixture.loadConversationMessages,
  loadConversationSnapshot: fixture.loadConversationSnapshot,
}));

import { ConversationNotFoundError, loadHistory } from "./engine";

describe("authenticated history delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.readCharacter.mockResolvedValue({ ok: { id: "synthetic-character" }, failures: [] });
    fixture.load.mockResolvedValue({ turn: 2, history: [{ role: "user", content: "synthetic" }] });
    fixture.loadConversationMessages.mockResolvedValue([{ role: "user", content: "synthetic" }]);
  });

  it("rejects an inaccessible conversation before loading message history", async () => {
    fixture.loadConversationSnapshot.mockResolvedValue(null);
    await expect(
      loadHistory({ characterId: "synthetic-character", conversationId: "other" }),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it("returns persisted delivery identity and schedule under the server's owner", async () => {
    const deliveries = [
      {
        conversationId: "synthetic-conversation",
        turn: 1,
        generationId: "synthetic-generation",
        serverNow: 2000,
        chunks: [{ seq: 0, text: "synthetic reply", scheduledAt: 1000 }],
      },
    ];
    fixture.loadConversationSnapshot.mockResolvedValue({
      conversationId: "synthetic-conversation",
      turn: 2,
      history: [{ role: "user", content: "synthetic" }],
      deliveries,
    });
    expect(
      await loadHistory({
        characterId: "synthetic-character",
        conversationId: "synthetic-conversation",
      }),
    ).toEqual({
      conversationId: "synthetic-conversation",
      turn: 2,
      history: [{ role: "user", content: "synthetic" }],
      deliveries,
    });
    expect(fixture.loadConversationSnapshot).toHaveBeenCalledWith(fixture.db, {
      userId: "local",
      characterId: "synthetic-character",
      conversationId: "synthetic-conversation",
    });
  });
});
