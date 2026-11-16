// apps/v2 の記録の出口（RIT-66）。記録は logEvent を通し、「知らせる失敗」の表に
// 当たる時だけ Slack の受け口へ裏で送る。送信は応答を遅らせんよう waitUntil に渡す（NFR-2）。
import { waitUntil } from "cloudflare:workers";

import { logEvent, type LogEntry } from "@v2/db";

import { notifyFailure, shouldNotifyFailure } from "./failure-notifier";

export const reportFailure = (env: unknown, entry: LogEntry): void => {
  logEvent(entry);
  if (shouldNotifyFailure(entry)) {
    waitUntil(notifyFailure(env, entry));
  }
};
