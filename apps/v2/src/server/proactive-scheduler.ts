import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { ProactiveNotificationStore } from "./proactive-notification-store";
import { createEnvProactiveSink } from "./proactive-sink";

const SettingsBody = z.object({
  characterId: z.string().min(1).max(128),
  settings: z.object({
    enabled: z.boolean(),
    dailyLimit: z.number().int().min(0).max(24),
    idleMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    quietHours: z
      .object({
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(0).max(1439),
      })
      .nullable(),
  }),
});
const ActivityBody = z.object({ characterId: z.string().min(1).max(128) });
const EnabledBody = z.object({
  characterId: z.string().min(1).max(128),
  enabled: z.boolean(),
});

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

export class ProactiveScheduler extends DurableObject<Cloudflare.Env> {
  private readonly store: ProactiveNotificationStore;
  private readonly sinkFactory: typeof createEnvProactiveSink;

  constructor(
    ctx: DurableObjectState,
    env: Cloudflare.Env,
    sinkFactory: typeof createEnvProactiveSink = createEnvProactiveSink,
    clock?: () => Date,
  ) {
    super(ctx, env);
    this.store = new ProactiveNotificationStore({
      recipientId: LOCAL_USER_ID,
      storage: ctx.storage,
      clock,
    });
    this.sinkFactory = sinkFactory;
  }

  async alarm(): Promise<void> {
    // alarm は何発来ても store 側の予約で二重送信は起きん。
    await this.store.runAlarm(
      await this.sinkFactory(this.env as unknown as Parameters<typeof createEnvProactiveSink>[0]),
    );
  }

  private async putSettings(request: Request): Promise<Response> {
    const parsed = SettingsBody.safeParse(await request.json());
    if (!parsed.success) return json(400, { message: "invalid settings" });
    await this.store.configureCharacter(parsed.data.characterId, parsed.data.settings);
    return json(200, { ok: true });
  }

  private async getSettings(url: URL): Promise<Response> {
    const characterId = url.searchParams.get("characterId") ?? "";
    const settings = await this.store.getCharacterSettings(characterId);
    return json(200, { settings: settings ?? null });
  }

  private async postEnabled(request: Request): Promise<Response> {
    const parsed = EnabledBody.safeParse(await request.json());
    if (!parsed.success) return json(400, { message: "invalid enabled" });
    await this.store.setCharacterEnabled(parsed.data.characterId, parsed.data.enabled);
    return json(200, { ok: true });
  }

  private async postActivity(request: Request): Promise<Response> {
    const parsed = ActivityBody.safeParse(await request.json());
    if (!parsed.success) return json(400, { message: "invalid activity" });
    await this.store.recordActivity(parsed.data.characterId);
    return json(200, { ok: true });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const routes: Record<string, () => Promise<Response>> = {
      "PUT /settings": () => this.putSettings(request),
      "GET /settings": () => this.getSettings(url),
      "POST /enabled": () => this.postEnabled(request),
      "POST /activity": () => this.postActivity(request),
      "GET /schedule": async () => json(200, { schedule: await this.store.getSchedule() }),
    };
    const route = routes[`${request.method} ${url.pathname}`];
    if (!route) return new Response(null, { status: 404 });
    try {
      return await route();
    } catch (error) {
      return json(500, {
        message: error instanceof Error ? error.name : "proactive error",
      });
    }
  }
}
