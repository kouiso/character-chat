// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    BASIC_AUTH_USER: "local-user",
    BASIC_AUTH_PASS: "local-pass",
    ASSETS: { fetch: vi.fn() },
  },
  start: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: mocks.start },
  createServerEntry: <T>(entry: T): T => entry,
}));

import entry from "./server";

const authorized = (path: string, method = "GET") =>
  new Request(`https://local.invalid${path}`, {
    method,
    headers: { Authorization: `Basic ${btoa("local-user:local-pass")}` },
  });

describe("custom Start entry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.env.BASIC_AUTH_PASS = "local-pass";
    mocks.env.ASSETS.fetch.mockResolvedValue(new Response(null, { status: 404 }));
    mocks.start.mockImplementation(() => new Response("synthetic-start"));
  });

  it.each(["/", "/api/chat/synthetic", "/api/chat/synthetic/history", "/assets/app.js"])(
    "rejects %s before invoking Start or the assets binding",
    async (path) => {
      for (const method of ["GET", "POST", "HEAD", "OPTIONS"]) {
        expect(
          (await entry.fetch(new Request(`https://local.invalid${path}`, { method }))).status,
        ).toBe(401);
      }
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.env.ASSETS.fetch).not.toHaveBeenCalled();
    },
  );

  it("fails closed before any downstream work when a secret is empty", async () => {
    mocks.env.BASIC_AUTH_PASS = "";
    expect((await entry.fetch(authorized("/assets/app.js"))).status).toBe(503);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("forwards authenticated assets unchanged", async () => {
    const asset = new Response("synthetic-asset", {
      headers: { "content-type": "text/javascript" },
    });
    mocks.env.ASSETS.fetch.mockResolvedValue(asset);
    expect(await entry.fetch(authorized("/assets/app.js"))).toBe(asset);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("forwards authenticated pages and server routes to Start", async () => {
    for (const path of ["/", "/api/chat/synthetic/history"]) {
      expect(await (await entry.fetch(authorized(path))).text()).toBe("synthetic-start");
    }
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("preserves authenticated SSE streaming without buffering", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"mock"}\n\n'));
        controller.close();
      },
    });
    const sse = new Response(stream, { headers: { "content-type": "text/event-stream" } });
    mocks.start.mockResolvedValue(sse);
    const result = await entry.fetch(authorized("/api/chat/synthetic", "POST"));
    expect(result).toBe(sse);
    expect(result.body).toBe(stream);
    expect(await result.text()).toContain("event: token");
    expect(mocks.env.ASSETS.fetch).not.toHaveBeenCalled();
  });
});
