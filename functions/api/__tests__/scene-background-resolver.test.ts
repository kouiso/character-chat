import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";

import { conversationSceneStateTable } from "../../../src/schema";
import {
  extractAllUserSegments,
  isExplicitOutdoorPlayIntent,
  isOutdoorBackgroundTag,
  resolveBackgroundFromKeywords,
  resolveSceneBackground,
  updateConversationSceneState,
} from "../lib/scene-background-resolver";

const now = Date.now();

const makeMockD1 = (fixture: {
  characterDefaults?: Record<string, string>;
  sceneStates?: Record<string, { backgroundTag?: string; locationName: string; updatedAt: number }>;
}) =>
  ({
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => ({
        raw: <T = unknown[]>() => {
          if (sql.includes('"character_scene_default"')) {
            const characterId = binds[0] as string;
            const tag = fixture.characterDefaults?.[characterId];
            if (!tag) return Promise.resolve([] as T[]);
            return Promise.resolve([[tag]] as T[]);
          }
          if (sql.includes('"conversation_scene_state"')) {
            const conversationId = binds[0] as string;
            const state = fixture.sceneStates?.[conversationId];
            if (!state) return Promise.resolve([] as T[]);
            return Promise.resolve([
              [state.backgroundTag ?? null, null, state.updatedAt, state.locationName],
            ] as T[]);
          }
          return Promise.resolve([] as T[]);
        },
      }),
    }),
  }) as D1Database;

const makeMockDatabase = (fixture: Parameters<typeof makeMockD1>[0]) =>
  drizzle(makeMockD1(fixture));

describe("scene-background-resolver", () => {
  describe("extractAllUserSegments", () => {
    it("returns the whole prompt when no user markers exist", () => {
      expect(extractAllUserSegments("sakura, on bed")).toEqual(["sakura, on bed"]);
    });

    it("extracts user segments in chronological order", () => {
      const prompt =
        "[1ターン前] ユーザー: 公園で待ってる\n[1ターン前] キャラ: いいね\n[最新] ユーザー: ベッドで\n[最新] キャラ: もっと";
      expect(extractAllUserSegments(prompt)).toEqual(["公園で待ってる", "ベッドで"]);
    });
  });

  describe("isOutdoorBackgroundTag", () => {
    it("returns true for outdoor tags", () => {
      expect(isOutdoorBackgroundTag("alley, outdoors")).toBe(true);
      expect(isOutdoorBackgroundTag("outdoors")).toBe(true);
      expect(isOutdoorBackgroundTag("park")).toBe(true);
      expect(isOutdoorBackgroundTag("beach")).toBe(true);
      expect(isOutdoorBackgroundTag("street")).toBe(true);
    });

    it("returns false for indoor tags", () => {
      expect(isOutdoorBackgroundTag("bedroom, indoors")).toBe(false);
      expect(isOutdoorBackgroundTag("bar, indoors")).toBe(false);
      expect(isOutdoorBackgroundTag("apartment_room, indoors")).toBe(false);
    });
  });

  describe("isExplicitOutdoorPlayIntent", () => {
    it("detects explicit outdoor play cues", () => {
      expect(isExplicitOutdoorPlayIntent("外でしよう")).toBe(true);
      expect(isExplicitOutdoorPlayIntent("野外プレイしたい")).toBe(true);
      expect(isExplicitOutdoorPlayIntent("outdoor play")).toBe(true);
      expect(isExplicitOutdoorPlayIntent("public sex")).toBe(true);
      expect(isExplicitOutdoorPlayIntent("open air")).toBe(true);
      expect(isExplicitOutdoorPlayIntent("人目が気になる")).toBe(true);
    });

    it("returns false for casual mentions", () => {
      expect(isExplicitOutdoorPlayIntent("路地裏で拾われた")).toBe(false);
      expect(isExplicitOutdoorPlayIntent("公園で待ってる")).toBe(false);
      expect(isExplicitOutdoorPlayIntent("外見が気になる")).toBe(false);
    });
  });

  describe("resolveBackgroundFromKeywords", () => {
    it("resolves to outdoors for conversation without explicit intent", () => {
      expect(resolveBackgroundFromKeywords("路地裏で待ってる", "conversation")).toContain("alley");
      expect(resolveBackgroundFromKeywords("公園で", "conversation")).toContain("outdoors");
    });

    it("returns null for erotic/climax/afterglow without explicit outdoor play intent", () => {
      expect(resolveBackgroundFromKeywords("路地裏で拾われた話", "erotic")).toBeNull();
      expect(resolveBackgroundFromKeywords("公園で", "climax")).toBeNull();
      expect(resolveBackgroundFromKeywords("street corner", "afterglow")).toBeNull();
    });

    it("returns outdoors for erotic/climax/afterglow with explicit outdoor play intent", () => {
      expect(resolveBackgroundFromKeywords("外で野外プレイしよう", "erotic")).toContain("outdoors");
      expect(resolveBackgroundFromKeywords("public sex", "climax")).toContain("outdoors");
      expect(resolveBackgroundFromKeywords("open air", "afterglow")).toContain("outdoors");
    });

    it("uses only the latest user segment for explicit phases", () => {
      const prompt =
        "[1ターン前] ユーザー: 公園で待ってる\n[1ターン前] キャラ: いいね\n[最新] ユーザー: ベッドで激しく\n[最新] キャラ: もっと";
      expect(resolveBackgroundFromKeywords(prompt, "erotic")).toContain("bedroom");
      expect(resolveBackgroundFromKeywords(prompt, "erotic")).not.toContain("outdoors");
    });

    it("preserves indoor tags for explicit phases", () => {
      expect(resolveBackgroundFromKeywords("ベッドで", "erotic")).toContain("bedroom");
      expect(resolveBackgroundFromKeywords("風呂で", "climax")).toContain("bathroom");
      expect(resolveBackgroundFromKeywords("バーで", "afterglow")).toContain("bar");
    });
  });

  describe("resolveSceneBackground", () => {
    it("suppresses outdoor character_default for climax unless explicit outdoor play is requested", async () => {
      const database = makeMockDatabase({
        characterDefaults: { "char-downer": "alley, outdoors" },
      });
      const noOutdoor = await resolveSceneBackground(database, {
        characterId: "char-downer",
        prompt: "[最新] ユーザー: 今夜はもっと激しくしたい",
        phase: "climax",
        now,
      });
      expect(noOutdoor.tag).not.toContain("alley");
      expect(noOutdoor.tag).not.toContain("outdoors");
      expect(noOutdoor.tag).toBe("indoors");

      const explicit = await resolveSceneBackground(database, {
        characterId: "char-downer",
        prompt: "[最新] ユーザー: 外で野外プレイしよう",
        phase: "climax",
        now,
      });
      expect(explicit.tag).toContain("alley");
      expect(explicit.tag).toContain("outdoors");
    });

    it("keeps indoor character_default for climax", async () => {
      const database = makeMockDatabase({
        characterDefaults: { "char-sakura": "bedroom, indoors" },
      });
      const result = await resolveSceneBackground(database, {
        characterId: "char-sakura",
        prompt: "[最新] ユーザー: 今夜はもっと激しくしたい",
        phase: "climax",
        now,
      });
      expect(result.tag).toContain("bedroom");
      expect(result.tag).toContain("indoors");
    });

    it("suppresses outdoor scene_state for climax unless explicit outdoor play is requested", async () => {
      const database = makeMockDatabase({
        sceneStates: {
          "conv-alley": { locationName: "路地裏", updatedAt: now - 1_000 },
        },
      });
      const noOutdoor = await resolveSceneBackground(database, {
        conversationId: "conv-alley",
        prompt: "[最新] ユーザー: 今夜はもっと激しくしたい",
        phase: "climax",
        now,
      });
      expect(noOutdoor.tag).toBe("indoors");

      const explicit = await resolveSceneBackground(database, {
        conversationId: "conv-alley",
        prompt: "[最新] ユーザー: 外で野外プレイしよう",
        phase: "climax",
        now,
      });
      expect(explicit.tag).toContain("路地裏");
    });

    it("uses backgroundTag from scene_state when present", async () => {
      const database = makeMockDatabase({
        sceneStates: {
          "conv-bedroom": {
            backgroundTag: "bedroom, indoors",
            locationName: "寝室",
            updatedAt: now - 1_000,
          },
        },
      });
      const result = await resolveSceneBackground(database, {
        conversationId: "conv-bedroom",
        prompt: "[最新] ユーザー: 今夜はもっと激しくしたい",
        phase: "climax",
        now,
      });
      expect(result.tag).toContain("bedroom");
      expect(result.tag).toContain("indoors");
      expect(result.source).toBe("scene_state");
    });

    it("suppresses outdoor backgroundTag from scene_state for climax unless explicit outdoor play is requested", async () => {
      const database = makeMockDatabase({
        sceneStates: {
          "conv-park": {
            backgroundTag: "park, outdoors",
            locationName: "公園",
            updatedAt: now - 1_000,
          },
        },
      });
      const noOutdoor = await resolveSceneBackground(database, {
        conversationId: "conv-park",
        prompt: "[最新] ユーザー: 今夜はもっと激しくしたい",
        phase: "climax",
        now,
      });
      expect(noOutdoor.tag).toBe("indoors");

      const explicit = await resolveSceneBackground(database, {
        conversationId: "conv-park",
        prompt: "[最新] ユーザー: 外で野外プレイしよう",
        phase: "climax",
        now,
      });
      expect(explicit.tag).toContain("park");
      expect(explicit.tag).toContain("outdoors");
    });
  });

  describe("updateConversationSceneState", () => {
    it("upserts the resolved background tag from user content", async () => {
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn(() => ({ onConflictDoUpdate }));
      const insert = vi.fn(() => ({ values }));
      const database = { insert } as unknown as Parameters<typeof updateConversationSceneState>[0];

      await updateConversationSceneState(database, "conv-1", "公園で待ってる", now);

      expect(insert).toHaveBeenCalledWith(conversationSceneStateTable);
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          backgroundTag: expect.stringContaining("outdoors"),
          updatedAt: now,
        }),
      );
      expect(onConflictDoUpdate).toHaveBeenCalled();
    });

    it("skips memory mentions", async () => {
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn(() => ({ onConflictDoUpdate }));
      const insert = vi.fn(() => ({ values }));
      const database = { insert } as unknown as Parameters<typeof updateConversationSceneState>[0];

      await updateConversationSceneState(database, "conv-1", "路地裏で拾われた話を思い出す", now);

      expect(insert).not.toHaveBeenCalled();
    });
  });
});
