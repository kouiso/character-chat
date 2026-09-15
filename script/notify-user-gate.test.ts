import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { notifyUserGate, parseGateNotifyOptions, type GateNotifyEnv } from "./notify-user-gate";

describe("migration user gate notifier", () => {
  it("parses CLI options with safe defaults", () => {
    const options = parseGateNotifyOptions(
      ["--gate", "Phase E", "--message=approval needed", "--dry-run"],
      { GATE_DASHBOARD_URL: "https://example.test/dashboard" },
      new Date("2026-05-24T00:00:00.000Z"),
    );

    expect(options).toMatchObject({
      gate: "Phase E",
      message: "approval needed",
      sourceLog: "/tmp/migration-manager.log",
      dashboardUrl: "https://example.test/dashboard",
      dryRun: true,
    });
  });

  it("posts configured notifications and records local evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adultai-gate-"));
    const evidencePath = join(dir, "notifications.jsonl");
    const calls: unknown[] = [];
    const fetchMock = (async (...args: unknown[]) => {
      calls.push(args);
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const env: GateNotifyEnv = {
      GATE_SLACK_WEBHOOK_URL: "https://hooks.slack.test/services/T000/B000/token",
      GATE_EMAIL_WEBHOOK_URL: "https://mail.test/send",
      GATE_WEBHOOK_URL: "https://notify.test/gate",
    };

    try {
      const results = await notifyUserGate(
        {
          gate: "Phase E",
          message: "123 char migration completed. User approval required.",
          sourceLog: "/tmp/migration-manager.log",
          evidencePath,
          dryRun: false,
          now: new Date("2026-05-24T01:02:03.000Z"),
        },
        env,
        fetchMock,
      );

      expect(calls).toHaveLength(3);
      expect(results.map((result) => result.channel)).toEqual([
        "slack",
        "email",
        "webhook",
        "local",
      ]);

      const evidence = JSON.parse((await readFile(evidencePath, "utf8")).trim()) as {
        gate: string;
        results: Array<{ channel: string }>;
      };
      expect(evidence.gate).toBe("Phase E");
      expect(evidence.results).toHaveLength(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
