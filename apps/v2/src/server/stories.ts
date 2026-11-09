// ストーリー画面用の server fn（RIT-214）。API と同じクエリを loader から直接呼ぶ。
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  listStoryRows,
  storyDetailRows,
  type StoryDetailRow,
  type StoryListRow,
} from "./api-stories";
import { getPlatform } from "./platform";

export const listStories = createServerFn({ method: "GET" }).handler(
  async (): Promise<StoryListRow[]> => {
    const { env } = await getPlatform();
    const { results } = await listStoryRows(env.DB);
    return results;
  },
);

export const getStory = createServerFn({ method: "GET" })
  .inputValidator(z.string().min(1))
  .handler(async ({ data: storyId }): Promise<StoryDetailRow | null> => {
    const { env } = await getPlatform();
    return storyDetailRows(env.DB, storyId);
  });
