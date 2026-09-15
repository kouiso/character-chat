import { describe, expect, it } from "vitest";

import {
  scoreMemoryNote,
  selectRelevantMemories,
  type MemoryNoteInput,
  type MemoryRelevanceContext,
} from "./memory-relevance";

const now = Date.UTC(2026, 4, 14);

const baseContext: MemoryRelevanceContext = {
  recentMessagesText: "coffee shop rainy day",
  characterName: "みつき",
  now,
};

const note = (input: Partial<MemoryNoteInput> & Pick<MemoryNoteInput, "id" | "content">) => ({
  createdAt: now,
  lastUsedAt: null,
  usageCount: 0,
  ...input,
});

describe("memory relevance", () => {
  it("empty notes -> empty array", () => {
    expect(selectRelevantMemories([], baseContext)).toEqual([]);
  });

  it("recency decays after long elapsed time", () => {
    const recent = scoreMemoryNote(note({ id: "recent", content: "quiet memory" }), baseContext);
    const old = scoreMemoryNote(
      note({
        id: "old",
        content: "quiet memory",
        createdAt: now - 1000 * 60 * 60 * 24 * 60,
      }),
      baseContext,
    );

    expect(recent).toBeGreaterThan(old);
  });

  it("keyword match boosts score", () => {
    const matched = scoreMemoryNote(
      note({ id: "matched", content: "coffee shop rainy promise" }),
      baseContext,
    );
    const unrelated = scoreMemoryNote(
      note({ id: "unrelated", content: "train station ticket" }),
      baseContext,
    );

    expect(matched).toBeGreaterThan(unrelated);
  });

  it("phase fit picks correct tokens", () => {
    const context = { ...baseContext, scenePhase: "afterglow" as const };
    const matched = scoreMemoryNote(
      note({ id: "phase", content: "余韻の中で眠そうにする" }),
      context,
    );
    const fallback = scoreMemoryNote(
      note({ id: "fallback", content: "明るく会話して笑う" }),
      context,
    );

    expect(matched).toBeGreaterThan(fallback);
  });

  it("overuse penalty reduces score for high usageCount", () => {
    const lowUsage = scoreMemoryNote(
      note({ id: "low", content: "coffee shop rainy promise", usageCount: 0 }),
      baseContext,
    );
    const highUsage = scoreMemoryNote(
      note({ id: "high", content: "coffee shop rainy promise", usageCount: 30 }),
      baseContext,
    );

    expect(lowUsage).toBeGreaterThan(highUsage);
  });

  it("selectRelevantMemories respects limit and ordering", () => {
    const notes = [
      note({ id: "old-match", content: "coffee shop rainy", createdAt: now - 10_000 }),
      note({ id: "new-match", content: "coffee shop rainy", createdAt: now }),
      note({ id: "unmatched", content: "train station ticket", createdAt: now + 1_000 }),
    ];

    expect(selectRelevantMemories(notes, baseContext, 2).map((selected) => selected.id)).toEqual([
      "new-match",
      "old-match",
    ]);
  });
});
