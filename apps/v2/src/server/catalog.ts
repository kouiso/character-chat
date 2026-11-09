// /catalog ページ用の server fn。API と同じクエリを loader から直接呼ぶ
// （SSR の loader で fetch("/api/catalog") すると origin 無しで Invalid URL になる）。
import { createServerFn } from "@tanstack/react-start";

import { loadCatalogItems, type CatalogItem } from "./api-publish";
import { getPlatform } from "./platform";

export const listCatalogItems = createServerFn({ method: "GET" }).handler(
  async (): Promise<CatalogItem[]> => {
    const { env } = await getPlatform();
    return loadCatalogItems(env.DB);
  },
);
