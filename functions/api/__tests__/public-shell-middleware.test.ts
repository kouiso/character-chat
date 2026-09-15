import { describe, expect, it, vi } from "vitest";

import { onRequest } from "../../_middleware";

type MiddlewareContext = Parameters<typeof onRequest>[0];

const runMiddleware = async (
  path: string,
  nextResponse: Response,
  method = "GET",
): Promise<{ next: ReturnType<typeof vi.fn>; response: Response }> => {
  const next = vi.fn(async () => nextResponse);
  const context = {
    request: new Request(`https://adult-ai-chat.pages.dev${path}`, { method }),
    next,
  } as unknown as MiddlewareContext;

  return { next, response: await onRequest(context) };
};

describe("Pages public shell middleware", () => {
  it("serves the root HTML without credentials", async () => {
    const html = '<!doctype html><html><body><div id="root"></div></body></html>';
    const { next, response } = await runMiddleware(
      "/",
      new Response(html, { headers: { "Content-Type": "text/html" } }),
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(html);
  });

  it("serves static assets without credentials", async () => {
    const { next, response } = await runMiddleware(
      "/assets/index.js",
      new Response("console.log('ready')", { status: 200 }),
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it("delegates API authentication without changing its 401 response", async () => {
    const protectedResponse = new Response('{"error":"unauthorized"}', { status: 401 });
    const { next, response } = await runMiddleware("/api/me", protectedResponse);

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects mutations outside the API namespace", async () => {
    const { next, response } = await runMiddleware("/", new Response(null), "POST");

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});
