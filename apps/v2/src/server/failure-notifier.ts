// 失敗の知らせ（RIT-66 FR-4〜FR-6）。Slack の受け口へ「決めた項目だけ」の本文を
// 1 件送る。受け口の URL は secret で、記録・知らせ・チケットのどこにも出さん（NFR-4）。
import { describeError, logEvent, type LogEntry } from "@v2/db";

export type NotifierEnv = {
  SLACK_ERROR_WEBHOOK_URL?: string;
  APP_ENV?: string;
  // 版の印（version）は RIT-64 の tag が束ねられてから出る。無い間は項目を出さん。
  CF_VERSION_METADATA?: { tag?: string };
};

// 呼び出し側は WorkerEntryEnv・DO の env・束ねの部分集合など形が様々なので、入口では
// unknown で受けて決めた鍵だけを文字列として読む。秘密値以外は絶対に読まん。
const notifierEnv = (env: unknown): NotifierEnv => {
  const e = (env ?? {}) as Partial<NotifierEnv>;
  return {
    SLACK_ERROR_WEBHOOK_URL:
      typeof e.SLACK_ERROR_WEBHOOK_URL === "string" ? e.SLACK_ERROR_WEBHOOK_URL : undefined,
    APP_ENV: typeof e.APP_ENV === "string" ? e.APP_ENV : undefined,
    CF_VERSION_METADATA:
      typeof e.CF_VERSION_METADATA === "object" && e.CF_VERSION_METADATA !== null
        ? { tag: e.CF_VERSION_METADATA.tag }
        : undefined,
  };
};

export type NotifyOutcome = "sent" | "suppressed" | "unconfigured" | "rejected";

// 知らせの送信を打ち切る秒数（仕様の未決 2、既定案 5 秒）。
const NOTIFY_TIMEOUT_MS = 5_000;
const NOTIFY_COOLDOWN_MS = 60_000;

// 「知らせる失敗」の表（仕様 FR-4）。表に無い出来事は記録だけで届けん。
export const shouldNotifyFailure = (entry: LogEntry): boolean => {
  switch (entry.event) {
    case "worker_request_failed":
    case "memory_queue_publish_failed":
    case "context_budget_config_invalid":
    case "binding_unavailable":
    case "failure_drill":
      return true;
    case "chat_turn_failed":
    case "memory_extraction_failed":
      return entry.terminal === true;
    case "image_generation_error":
      return entry.status === 500;
    default:
      return false;
  }
};

// isolate ごとの記憶（v1 の slack-error-notifier と同じ作り）。同じ isolate がいつまで
// 生きるかは決まらんので、別の isolate からは重ねて届きうる。持ち主 1 人運用で許す。
const recentNotifications = new Map<string, { lastSentAt: number; suppressed: number }>();

// 試験が時刻と抑えの状態を差し替えられる口。本番コードは触らん。
export const resetFailureNotifierState = (): void => {
  recentNotifications.clear();
};

const field = (label: string, value: string | number | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : `*${label}:*\n${value}`;

// 知らせの本文は決めた項目だけで組む。例外の message・stack・要求の URL・
// 会話やキャラの id は入れん（FR-5）。
const buildPayload = (
  environment: string,
  entry: LogEntry,
  suppressed: number,
  version: string | undefined,
): { text: string; blocks: { type: string; fields: { type: string; text: string }[] }[] } => {
  const fields = [
    field("environment", environment),
    field("event", entry.event),
    field("reason", entry.reason),
    field("status", entry.status),
    field("route", entry.route),
    field("version", version),
    field("suppressed", suppressed > 0 ? suppressed : undefined),
  ]
    .filter((text): text is string => typeof text === "string")
    .map((text) => ({ type: "mrkdwn", text }));
  return {
    text: `[character-chat v2][${environment}] ${entry.event}`,
    blocks: [{ type: "section", fields }],
  };
};

const deliver = async (
  webhookUrl: string,
  payload: ReturnType<typeof buildPayload>,
  send: typeof fetch,
): Promise<NotifyOutcome> => {
  try {
    const response = await send(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      logEvent({ event: "failure_notice_failed", level: "warn", status: response.status });
      return "rejected";
    }
    return "sent";
  } catch (error) {
    // 知らせの送信失敗は元の処理を失敗にせん。記録だけ残す（NFR-3）。
    // 受け口の URL は理由にも含めん。
    logEvent({ event: "failure_notice_failed", level: "warn", reason: describeError(error) });
    return "rejected";
  }
};

// 60 秒に 1 件の抑え（FR-6）。指紋は送る前に書く。同じ失敗が同時に 2 つ来ても、
// 2 つ目はここで抑えられる。返すのは前回送信までに抑えた回数か "suppressed"。
const claimSend = (fingerprint: string, now: number, force: boolean): number | "suppressed" => {
  const seen = recentNotifications.get(fingerprint);
  if (!force && seen && now - seen.lastSentAt < NOTIFY_COOLDOWN_MS) {
    seen.suppressed += 1;
    return "suppressed";
  }
  const suppressed = seen?.suppressed ?? 0;
  recentNotifications.set(fingerprint, { lastSentAt: now, suppressed: 0 });
  return suppressed;
};

export const notifyFailure = async (
  env: unknown,
  entry: LogEntry,
  options: { now?: number; fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<NotifyOutcome> => {
  const { SLACK_ERROR_WEBHOOK_URL: webhookUrl, APP_ENV, CF_VERSION_METADATA } = notifierEnv(env);
  if (!webhookUrl) return "unconfigured";

  const environment = APP_ENV ?? "unknown";
  const suppressed = claimSend(
    `${environment}:${entry.event}:${entry.reason ?? ""}`,
    options.now ?? Date.now(),
    options.force === true,
  );
  if (suppressed === "suppressed") return "suppressed";

  const payload = buildPayload(environment, entry, suppressed, CF_VERSION_METADATA?.tag);
  return deliver(webhookUrl, payload, options.fetchImpl ?? fetch);
};
