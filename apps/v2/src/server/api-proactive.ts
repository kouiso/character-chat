import {
  createProactiveNotificationController,
  ProactiveCharacterNotFoundError,
  ProactiveSettingsInvalidError,
} from "./proactive-notification-controller";

import type { ProactiveControllerDependencies } from "./proactive-notification-controller";

export type ProactiveApiDependencies = Omit<ProactiveControllerDependencies, "recipientId"> & {
  authenticate(request: Request): Promise<string | null>;
};

const json = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      vary: "Cookie, Authorization",
      ...extraHeaders,
    },
  });

const validateRequest = (request: Request): Response | null => {
  if (request.method !== "GET" && request.method !== "PUT")
    return json(405, { message: "この操作は利用できません。" }, { allow: "GET, PUT" });
  if (request.method === "GET") return null;
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return json(403, { message: "操作元を確認できません。" });
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    return json(415, { message: "JSON 形式で送信してください。" });
  return null;
};

const readSettings = async (request: Request): Promise<unknown> => {
  const reader = request.body?.getReader();
  if (!reader) throw new ProactiveSettingsInvalidError();
  let total = 0;
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const next = await reader.read();
      total += next.value?.byteLength ?? 0;
      if (total > 8192) throw new ProactiveSettingsInvalidError();
      text += decoder.decode(next.value, { stream: !next.done });
      if (next.done) return JSON.parse(text) as unknown;
    }
  } catch {
    throw new ProactiveSettingsInvalidError();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

const errorResponse = (error: unknown): Response => {
  if (error instanceof ProactiveCharacterNotFoundError)
    return json(404, { message: error.message });
  if (error instanceof ProactiveSettingsInvalidError) return json(400, { message: error.message });
  return json(503, {
    message: "話しかけ設定を読み書きできません。接続を確認して再試行してください。",
  });
};

export const createProactiveApi =
  (dependencies: ProactiveApiDependencies) =>
  async (request: Request, characterId: string): Promise<Response> => {
    const invalid = validateRequest(request);
    if (invalid) return invalid;
    try {
      const recipientId = await dependencies.authenticate(request);
      if (!recipientId) return json(401, { message: "ログインが必要です。" });
      const controller = createProactiveNotificationController({ ...dependencies, recipientId });
      return json(
        200,
        await (request.method === "GET"
          ? controller.load(characterId)
          : controller.configure(characterId, await readSettings(request))),
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
