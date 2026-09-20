type SlackField = {
  type: "mrkdwn";
  text: string;
};

type SlackBindings = {
  SLACK_ERROR_WEBHOOK_URL?: string;
  APP_ORIGIN?: string;
  CF_PAGES_URL?: string;
  CF_PAGES_BRANCH?: string;
  CF_PAGES_COMMIT_SHA?: string;
};

type SlackContext = {
  env: SlackBindings;
  req: {
    url: string;
    method: string;
    header(name: string): string | undefined;
  };
};

type NotifyInput = {
  context: SlackContext;
  error: unknown;
  source: "api" | "status" | "worker";
  statusCode?: number;
  labels?: Record<string, string | number | boolean | undefined>;
};

const NOTIFY_COOLDOWN_MS = 60_000;
const recentNotifications = new Map<string, number>();

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const errorStack = (error: unknown): string | undefined => {
  if (error instanceof Error && error.stack) return truncate(error.stack, 2_800);
  return undefined;
};

const field = (
  label: string,
  value: string | number | boolean | undefined,
): SlackField | undefined => {
  if (value === undefined || value === "") return undefined;
  return { type: "mrkdwn", text: `*${label}:*\n${String(value)}` };
};

const shouldNotify = (fingerprint: string): boolean => {
  const now = Date.now();
  const last = recentNotifications.get(fingerprint);
  if (last && now - last < NOTIFY_COOLDOWN_MS) return false;
  recentNotifications.set(fingerprint, now);
  return true;
};

const requestUrl = (context: SlackContext): string => {
  const url = new URL(context.req.url);
  return `${url.origin}${url.pathname}${url.search}`;
};

export const notifySlackError = async ({
  context,
  error,
  source,
  statusCode = 500,
  labels = {},
}: NotifyInput): Promise<void> => {
  const webhookUrl = context.env.SLACK_ERROR_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;

  const message = truncate(errorMessage(error), 700);
  const stack = errorStack(error);
  const branch = context.env.CF_PAGES_BRANCH ?? "unknown";
  const commit = context.env.CF_PAGES_COMMIT_SHA?.slice(0, 12);
  const severity = statusCode >= 500 ? "error" : "warning";
  const path = new URL(context.req.url).pathname;
  const fingerprint = ["character-chat", source, statusCode, path, message].join(":");
  if (!shouldNotify(fingerprint)) return;

  const labelText = Object.entries({ ...labels, branch, commit })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `\`${key}:${String(value)}\``)
    .join(" ");

  const fields = [
    field("project", "character-chat"),
    field("severity", severity),
    field("source", source),
    field("status", statusCode),
    field("method", context.req.method),
    field("path", path),
    field("ray", context.req.header("cf-ray")),
  ].filter((value): value is SlackField => Boolean(value));

  const payload = {
    text: `[character-chat][${severity}] ${message}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Character Chat ${severity.toUpperCase()} error`,
          emoji: true,
        },
      },
      { type: "section", text: { type: "mrkdwn", text: `*${message}*` } },
      { type: "section", fields },
      ...(labelText
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: `labels: ${labelText}` }] }]
        : []),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Request URL" },
            url: requestUrl(context),
          },
          ...(context.env.CF_PAGES_URL
            ? [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Pages URL" },
                  url: context.env.CF_PAGES_URL,
                },
              ]
            : []),
        ],
      },
      ...(stack
        ? [{ type: "section", text: { type: "mrkdwn", text: `*stack*\n\`\`\`${stack}\`\`\`` } }]
        : []),
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Slack notification must never break the API response path.
  }
};
