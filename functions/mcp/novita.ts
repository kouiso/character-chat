import { createMcpImageGenHandler, type McpEnv } from "./_shared";

export const onRequestPost: PagesFunction<McpEnv> = createMcpImageGenHandler("novita");

export const onRequest: PagesFunction<McpEnv> = async () =>
  new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
