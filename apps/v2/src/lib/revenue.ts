import { z } from "zod";

// クリエイター収益 API クライアント（RIT-195）。
const revenueItemSchema = z.object({
  id: z.string(),
  sourceType: z.string(),
  refId: z.string().nullable(),
  grossAmount: z.number(),
  shareAmount: z.number(),
  createdAt: z.number(),
});
export type RevenueItem = z.infer<typeof revenueItemSchema>;

export const revenueReportSchema = z.object({
  items: z.array(revenueItemSchema),
  totalGross: z.number(),
  totalShare: z.number(),
});
export type RevenueReport = z.infer<typeof revenueReportSchema>;

export const loadRevenue = async (signal?: AbortSignal): Promise<RevenueReport> => {
  const res = await fetch("/api/revenue", { signal: signal ?? null });
  if (!res.ok) throw new Error(`収益の取得に失敗しました（${res.status}）`);
  return revenueReportSchema.parse(await res.json());
};

export const aggregateRevenue = async (): Promise<number> => {
  const res = await fetch("/api/revenue/aggregate", { method: "POST" });
  if (!res.ok) throw new Error(`収益の集計に失敗しました（${res.status}）`);
  return z.object({ aggregated: z.number() }).parse(await res.json()).aggregated;
};
