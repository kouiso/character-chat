// /board ページ用の server fn。API と同じクエリを loader から直接呼ぶ
// （SSR の loader で fetch("/api/board") すると origin 無しで Invalid URL になる）。
import { createServerFn } from "@tanstack/react-start";

import { loadBoardPage, type BoardPageData } from "./api-board";
import { getPlatform } from "./platform";

export const listBoardPage = createServerFn({ method: "GET" }).handler(
  async (): Promise<BoardPageData> => {
    const { env } = await getPlatform();
    return loadBoardPage(env.DB);
  },
);
