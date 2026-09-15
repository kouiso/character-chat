import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export type GateNotifyOptions = {
  gate: string;
  message: string;
  sourceLog: string;
  dashboardUrl?: string;
  evidencePath: string;
  dryRun: boolean;
  now: Date;
};

export type GateNotifyEnv = {
  GATE_SLACK_WEBHOOK_URL?: string;
  GATE_EMAIL_WEBHOOK_URL?: string;
  GATE_WEBHOOK_URL?: string;
  GATE_DASHBOARD_URL?: string;
  GATE_EVIDENCE_PATH?: string;
};

export type GateNotifyResult = {
  channel: "slack" | "email" | "webhook" | "local";
  status: "sent" | "dry-run" | "recorded";
  target?: string;
};

const DEFAULT_GATE = "Phase E user GATE";
const DEFAULT_MESSAGE = "Migration Manager is waiting for user approval.";
const DEFAULT_SOURCE_LOG = "/tmp/migration-manager.log";
const DEFAULT_EVIDENCE_PATH = "/tmp/adultai-gate-notifications.jsonl";

const parseArgValue = (args: readonly string[], name: string): string | undefined => {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
};

export const parseGateNotifyOptions = (
  args: readonly string[],
  env: GateNotifyEnv,
  now = new Date(),
): GateNotifyOptions => ({
  gate: parseArgValue(args, "--gate") ?? DEFAULT_GATE,
  message: parseArgValue(args, "--message") ?? DEFAULT_MESSAGE,
  sourceLog: parseArgValue(args, "--source-log") ?? DEFAULT_SOURCE_LOG,
  dashboardUrl: parseArgValue(args, "--dashboard-url") ?? env.GATE_DASHBOARD_URL,
  evidencePath:
    parseArgValue(args, "--evidence") ?? env.GATE_EVIDENCE_PATH ?? DEFAULT_EVIDENCE_PATH,
  dryRun: args.includes("--dry-run"),
  now,
});

const safeTarget = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid-url>";
  }
};

const buildText = (options: GateNotifyOptions): string => {
  const lines = [
    `adult-ai migration gate: ${options.gate}`,
    options.message,
    `source log: ${options.sourceLog}`,
  ];
  if (options.dashboardUrl) lines.push(`dashboard: ${options.dashboardUrl}`);
  return lines.join("\n");
};

const postJson = async (fetchImpl: typeof fetch, url: string, body: unknown): Promise<void> => {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`notification webhook failed: ${response.status} ${response.statusText}`);
  }
};

const appendEvidence = async (
  options: GateNotifyOptions,
  results: readonly GateNotifyResult[],
): Promise<void> => {
  await mkdir(dirname(options.evidencePath), { recursive: true });
  await appendFile(
    options.evidencePath,
    `${JSON.stringify({
      at: options.now.toISOString(),
      gate: options.gate,
      message: options.message,
      sourceLog: options.sourceLog,
      dashboardUrl: options.dashboardUrl ?? null,
      results,
    })}\n`,
  );
};

export const notifyUserGate = async (
  options: GateNotifyOptions,
  env: GateNotifyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<GateNotifyResult[]> => {
  const text = buildText(options);
  const results: GateNotifyResult[] = [];

  const webhooks = [
    {
      channel: "slack" as const,
      url: env.GATE_SLACK_WEBHOOK_URL,
      body: { text },
    },
    {
      channel: "email" as const,
      url: env.GATE_EMAIL_WEBHOOK_URL,
      body: {
        subject: `adult-ai migration gate: ${options.gate}`,
        text,
      },
    },
    {
      channel: "webhook" as const,
      url: env.GATE_WEBHOOK_URL,
      body: {
        title: `adult-ai migration gate: ${options.gate}`,
        message: options.message,
        sourceLog: options.sourceLog,
        dashboardUrl: options.dashboardUrl ?? null,
      },
    },
  ];

  for (const webhook of webhooks) {
    if (!webhook.url) continue;
    const result: GateNotifyResult = {
      channel: webhook.channel,
      status: options.dryRun ? "dry-run" : "sent",
      target: safeTarget(webhook.url),
    };
    if (!options.dryRun) await postJson(fetchImpl, webhook.url, webhook.body);
    results.push(result);
  }

  results.push({ channel: "local", status: "recorded", target: options.evidencePath });
  await appendEvidence(options, results);
  return results;
};

const isDirectRun = (): boolean =>
  Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);

if (isDirectRun()) {
  const options = parseGateNotifyOptions(process.argv.slice(2), process.env);
  notifyUserGate(options, process.env)
    .then((results) => {
      console.info(JSON.stringify({ ok: true, results }, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
