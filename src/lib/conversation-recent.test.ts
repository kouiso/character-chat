import { describe, expect, it } from "vitest";

import { recentConversations } from "./conversation-recent";

describe("recentConversations", () => {
  it("同一キャラクターが複数あっても最新 1 件のみ残る", () => {
    const conversations = [
      { id: "c1", characterId: "char-a", updatedAt: 1000 },
      { id: "c2", characterId: "char-a", updatedAt: 2000 },
      { id: "c3", characterId: "char-a", updatedAt: 500 },
    ];
    const result = recentConversations(conversations);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2");
  });

  it("更新日時順にソートされ、limit 件まで返る", () => {
    const conversations = [
      { id: "c1", characterId: "char-a", updatedAt: 1000 },
      { id: "c2", characterId: "char-b", updatedAt: 3000 },
      { id: "c3", characterId: "char-c", updatedAt: 2000 },
      { id: "c4", characterId: "char-d", updatedAt: 4000 },
      { id: "c5", characterId: "char-e", updatedAt: 500 },
      { id: "c6", characterId: "char-f", updatedAt: 6000 },
    ];
    const result = recentConversations(conversations, 3);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.characterId)).toEqual(["char-f", "char-d", "char-b"]);
  });

  it("空配列を受け取ったら空配列を返す", () => {
    expect(recentConversations([])).toEqual([]);
  });
});
