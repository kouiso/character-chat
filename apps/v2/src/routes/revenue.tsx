// RIT-195: クリエイター収益画面。支払い申請の元データ（明細＋合計）。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { aggregateRevenue, loadRevenue, type RevenueReport } from "../lib/revenue";

const routeApi = getRouteApi("/revenue");

const RevenuePage = () => {
  const initial = routeApi.useLoaderData();
  const [report, setReport] = useState<RevenueReport>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void aggregateRevenue()
      .then(() => loadRevenue())
      .then(setReport)
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="v2-revenue">
      <h1>クリエイター収益</h1>
      <Link to="/">キャラクター一覧へ戻る</Link>
      <button type="button" disabled={busy} onClick={refresh}>
        {busy ? "集計中…" : "最新の収益を集計"}
      </button>
      {error && <p role="alert">{error}</p>}
      <p>
        収益合計: {report.totalShare}（総額 {report.totalGross} の50%還元）
      </p>
      <ul>
        {report.items.map((item) => (
          <li key={item.id}>
            <span>{item.sourceType}</span> <strong>{item.shareAmount}</strong>
            <span>（総額 {item.grossAmount}）</span>
            <time dateTime={new Date(item.createdAt).toISOString()}>
              {new Date(item.createdAt).toLocaleString()}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const Route = createFileRoute("/revenue")({
  loader: ({ abortController }) => loadRevenue(abortController.signal),
  component: RevenuePage,
});
