// /revenue ページ用の server fn。API と同じクエリを loader から直接呼ぶ
// （SSR の loader で fetch("/api/revenue") すると origin 無しで Invalid URL になる）。
import { createServerFn } from "@tanstack/react-start";

import { loadRevenueReport, type RevenueReportData } from "./api-revenue";
import { getPlatform } from "./platform";

export const getRevenueReport = createServerFn({ method: "GET" }).handler(
  async (): Promise<RevenueReportData> => {
    const { env } = await getPlatform();
    return loadRevenueReport(env.DB);
  },
);
