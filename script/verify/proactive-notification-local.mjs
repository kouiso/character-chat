import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const localRequire = createRequire(path.join(repoRoot, "package.json"));
const wranglerRequire = createRequire(localRequire.resolve("wrangler"));
const { build } = await import(pathToFileURL(wranglerRequire.resolve("esbuild")).href);
const { Miniflare } = await import(pathToFileURL(wranglerRequire.resolve("miniflare")).href);
const output = path.resolve(process.argv[2] ?? path.join(repoRoot, ".work/rit-109-local"));
await mkdir(output, { recursive: true });
const persist = await mkdtemp(path.join(output, "isolated-do-"));
const storePath = path.join(repoRoot, "apps/v2/src/server/proactive-notification-store.ts");

// 実時刻による自動発火を避け、alarm 本体は合成時計で明示的に呼び出す。
const source = `
import { DurableObject } from "cloudflare:workers";
import { ProactiveNotificationStore } from ${JSON.stringify(storePath)};
export class SyntheticNotificationObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.now = Date.parse("2099-10-26T00:00:00.000Z");
    this.failure = false;
    this.store = new ProactiveNotificationStore({ recipientId: "synthetic-recipient", storage: ctx.storage, clock: () => new Date(this.now) });
    ctx.blockConcurrencyWhile(async () => { this.now = (await ctx.storage.get("fake-clock")) ?? this.now; });
  }
  async clock(instant) { this.now = Date.parse(instant); await this.ctx.storage.put("fake-clock", this.now); }
  async configure(characterId, settings) { await this.store.configureCharacter(characterId, settings); }
  async activity(characterId) { await this.store.recordActivity(characterId); }
  async enabled(characterId, enabled) { await this.store.setCharacterEnabled(characterId, enabled); }
  async alarm() {
    return await this.store.runAlarm({ send: async (notification) => {
      const sent = (await this.ctx.storage.get("synthetic-sink")) ?? [];
      sent.push(notification);
      await this.ctx.storage.put("synthetic-sink", sent);
      if (this.failure) throw new Error("synthetic failure after sink");
    }});
  }
  async trigger(failure) { this.failure = failure; return await this.alarm(); }
  async replay(occurrence) { return await this.store.handleAlarm(occurrence, { send: async () => { throw new Error("Unexpected duplicate sink call"); } }); }
  async summary(characterId) {
    return { sent: (await this.ctx.storage.get("synthetic-sink")) ?? [], settings: await this.store.getCharacterSettings(characterId), schedule: await this.store.getSchedule(), alarmAt: await this.ctx.storage.getAlarm() };
  }
}
export default { async fetch(request, env) {
  const body = await request.json();
  const stub = env.NOTIFICATIONS.getByName(body.name ?? "synthetic-main");
  try {
    let result;
    switch (body.op) {
      case "clock": result = await stub.clock(body.instant); break;
      case "configure": result = await stub.configure(body.characterId, body.settings); break;
      case "activity": result = await stub.activity(body.characterId); break;
      case "enabled": result = await stub.enabled(body.characterId, body.enabled); break;
      case "alarm": result = await stub.trigger(body.failure ?? false); break;
      case "replay": result = await stub.replay(body.occurrence); break;
      case "summary": result = await stub.summary(body.characterId); break;
      default: throw new Error("Unknown synthetic operation");
    }
    return Response.json({ result: result ?? null });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}};
`;

const bundle = await build({
  stdin: { contents: source, resolveDir: repoRoot, loader: "js" },
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["cloudflare:workers"],
  write: false,
});
let outboundAttempts = 0;
const open = () =>
  new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-03-17",
    durableObjects: {
      NOTIFICATIONS: { className: "SyntheticNotificationObject", useSQLite: true },
    },
    durableObjectsPersist: persist,
    outboundService: () => {
      outboundAttempts++;
      throw new Error("External requests forbidden");
    },
  });
let runtime = open();
const call = async (body, status = 200) => {
  const response = await runtime.dispatchFetch("https://synthetic.invalid/control", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const json = await response.json();
  assert.equal(response.status, status, JSON.stringify(json));
  return json.result ?? json.error;
};
const characterId = "synthetic-character";
const settings = { enabled: true, dailyLimit: 3, idleMinutes: 60, quietHours: null };
const evidence = {};

try {
  await call({ op: "configure", characterId, settings });
  let summary = await call({ op: "summary", characterId });
  assert.equal(summary.alarmAt, Date.parse("2099-10-26T01:00:00.000Z"));
  for (let hour = 1; hour <= 4; hour++) {
    await call({ op: "clock", instant: `2099-10-26T0${hour}:00:00.000Z` });
    await call({ op: "alarm" });
  }
  summary = await call({ op: "summary", characterId });
  assert.equal(summary.sent.length, 3);
  assert.equal(summary.alarmAt, Date.parse("2099-10-26T15:00:00.000Z"));
  evidence.dailyCap = { notifications: 3, nextAtJstMidnight: summary.alarmAt };

  await call({ op: "enabled", characterId, enabled: false });
  await call({ op: "clock", instant: "2099-10-26T15:00:00.000Z" });
  await call({ op: "alarm" });
  summary = await call({ op: "summary", characterId });
  assert.equal(summary.sent.length, 3);
  assert.equal(summary.alarmAt, null);
  evidence.off = { additionalNotifications: 0, nativeAlarmAt: null };

  await call({ op: "clock", name: "synthetic-quiet", instant: "2099-10-26T12:30:00.000Z" });
  await call({
    op: "configure",
    name: "synthetic-quiet",
    characterId,
    settings: { ...settings, quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 } },
  });
  summary = await call({ op: "summary", name: "synthetic-quiet", characterId });
  assert.equal(summary.alarmAt, Date.parse("2099-10-26T22:00:00.000Z"));
  evidence.quiet = { nextAt0700Jst: summary.alarmAt };
  await call({ op: "clock", name: "synthetic-quiet", instant: "2099-10-26T22:00:00.000Z" });
  await call({ op: "alarm", name: "synthetic-quiet" });
  summary = await call({ op: "summary", name: "synthetic-quiet", characterId });
  assert.equal(summary.sent.length, 1);

  await call({ op: "configure", name: "synthetic-retry", characterId, settings });
  const retryOccurrence = (await call({ op: "summary", name: "synthetic-retry", characterId }))
    .schedule[0];
  await call({ op: "clock", name: "synthetic-retry", instant: "2099-10-26T01:00:00.000Z" });
  await call({ op: "alarm", name: "synthetic-retry", failure: true }, 500);
  await call({ op: "alarm", name: "synthetic-retry", failure: true });
  await call({ op: "alarm", name: "synthetic-retry", failure: true });
  summary = await call({ op: "summary", name: "synthetic-retry", characterId });
  assert.equal(summary.sent.length, 1);
  assert.equal(summary.alarmAt, Date.parse("2099-10-26T02:00:00.000Z"));
  evidence.retry = { notifications: 1, retries: 2, nextAlarmAt: summary.alarmAt };

  for (let index = 0; index < 8; index++)
    await call({
      op: "configure",
      name: "synthetic-fanout",
      characterId: `synthetic-${index}`,
      settings,
    });
  await call({ op: "clock", name: "synthetic-fanout", instant: "2099-10-26T01:00:00.000Z" });
  await call({ op: "alarm", name: "synthetic-fanout", failure: true }, 500);
  await call({ op: "alarm", name: "synthetic-fanout", failure: true });
  await call({ op: "alarm", name: "synthetic-fanout", failure: true });
  summary = await call({ op: "summary", name: "synthetic-fanout", characterId: "synthetic-0" });
  assert.equal(summary.sent.length, 8);
  assert.equal(summary.alarmAt, Date.parse("2099-10-26T02:00:00.000Z"));
  evidence.fanoutFailure = { characters: 8, notificationsPerCharacter: 1, allRearmed: true };

  await call({
    op: "configure",
    name: "synthetic-restore",
    characterId,
    settings: { ...settings, idleMinutes: 30 },
  });
  await call({ op: "clock", name: "synthetic-restore", instant: "2099-10-26T00:15:00.000Z" });
  await call({ op: "activity", name: "synthetic-restore", characterId });
  const beforeRestart = await call({ op: "summary", name: "synthetic-restore", characterId });
  await runtime.dispose();
  runtime = open();
  assert.equal(
    await call({ op: "replay", name: "synthetic-retry", occurrence: retryOccurrence }),
    "duplicate",
  );
  summary = await call({ op: "summary", name: "synthetic-restore", characterId });
  assert.deepEqual(summary, beforeRestart);
  await call({ op: "clock", name: "synthetic-restore", instant: "2099-10-26T00:45:00.000Z" });
  await call({ op: "alarm", name: "synthetic-restore" });
  summary = await call({ op: "summary", name: "synthetic-restore", characterId });
  assert.equal(summary.sent.length, 1);
  evidence.restart = { restored: true, notificationsAtRescheduledTime: 1 };
  evidence.outboundAttempts = outboundAttempts;
  assert.equal(outboundAttempts, 0);
  await writeFile(path.join(output, "native-do.json"), JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify(
      { status: "PASS", evidence, persistence: "fresh isolated SQLite Durable Object storage" },
      null,
      2,
    ),
  );
} finally {
  await runtime.dispose();
}
