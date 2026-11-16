// POST /api/admin/failure-drill — 訓練用の知らせを 1 件送る（RIT-66 FR-7）。
// Basic 認証の内側。利用者のデータは読まん。届いたかを答えるため送信の結果を待って返す。
import { logEvent } from "@v2/db";

import { notifyFailure } from "./failure-notifier";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

export const handleFailureDrill = async (): Promise<Response> => {
  const { env } = await getPlatform();
  const entry = { event: "failure_drill", level: "info" } as const;
  logEvent(entry);
  const outcome = await notifyFailure(env, entry, { force: true });
  if (outcome === "unconfigured") return json(503, { reason: "notifier_unconfigured" });
  if (outcome === "sent") return json(202, { sent: true });
  return json(502, { reason: "notifier_rejected" });
};
