import {
  createManagedMemoryStore,
  MemoryAccessError,
  memoryCommandSchema,
  MemoryConflictError,
  resolveMemoryScope,
  type ManagedMemoryStore,
  type MemoryCommand,
  type V2Db,
} from "@v2/db";

export type MemoryApiDependencies = {
  db: V2Db;
  authenticate: (request: Request) => Promise<string | null>;
};

const json = (status: number, body: unknown, extraHeaders?: Record<string, string>): Response =>
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

const applyCommand = async (
  store: ManagedMemoryStore,
  command: MemoryCommand,
): Promise<Response> => {
  switch (command.action) {
    case "add":
      return json(201, {
        memory: await store.add({
          requestKey: command.requestKey,
          kind: command.kind,
          content: command.content,
        }),
      });
    case "edit":
      return json(200, {
        memory: await store.edit({
          requestKey: command.requestKey,
          id: command.id,
          content: command.content,
        }),
      });
    case "delete":
      await store.delete(command.id);
      break;
    case "pin":
      await store.setPinned(command.id, command.pinned);
      break;
    case "enable":
      await store.setMemoryEnabled(command.id, command.enabled);
      break;
    case "set-enabled":
      await store.setEnabled(command.enabled);
      break;
  }
  return json(200, { ok: true });
};

// Origin がないサーバー間要求でも認証は必須とし、ブラウザーの cross-site 更新は拒否する。
const isSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  return (
    (!origin || origin === new URL(request.url).origin) &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
};

const validateRequest = (request: Request): Response | null => {
  if (request.method !== "GET" && request.method !== "POST")
    return json(405, { message: "この操作は利用できません。" }, { allow: "GET, POST" });
  if (request.method !== "POST") return null;
  if (!isSameOrigin(request)) return json(403, { message: "操作元を確認できません。" });
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  return contentType === "application/json"
    ? null
    : json(415, { message: "JSON 形式で送信してください。" });
};
const readMemory = async (store: ManagedMemoryStore, request: Request): Promise<Response> => {
  const historyId = new URL(request.url).searchParams.get("history");
  if (historyId === null) return json(200, await store.snapshot());
  if (historyId.trim().length === 0) return json(400, { message: "記憶を指定してください。" });
  return json(200, { memories: await store.history(historyId) });
};
const writeMemory = async (store: ManagedMemoryStore, request: Request): Promise<Response> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { message: "JSON を読み取れません。" });
  }
  const parsed = memoryCommandSchema.safeParse(payload);
  if (!parsed.success) return json(400, { message: "記憶の操作内容を確認してください。" });
  return applyCommand(store, parsed.data);
};
const errorResponse = (error: unknown): Response => {
  if (error instanceof MemoryAccessError) return json(404, { message: "記憶が見つかりません。" });
  if (error instanceof MemoryConflictError)
    return json(409, { message: "記憶が更新されています。再読み込みしてください。" });
  return json(500, { message: "記憶を読み書きできません。時間をおいて再試行してください。" });
};
const authenticatedOwner = async (
  authenticate: MemoryApiDependencies["authenticate"],
  request: Request,
): Promise<string | Response> => {
  try {
    return (await authenticate(request)) || json(401, { message: "ログインが必要です。" });
  } catch {
    return json(503, { message: "認証を確認できません。時間をおいて再試行してください。" });
  }
};
export const createMemoryApi =
  ({ db, authenticate }: MemoryApiDependencies) =>
  async (request: Request, conversationId: string): Promise<Response> => {
    const invalid = validateRequest(request);
    if (invalid) return invalid;
    const owner = await authenticatedOwner(authenticate, request);
    if (owner instanceof Response) return owner;
    try {
      const scope = await resolveMemoryScope(db, owner, conversationId);
      const store = createManagedMemoryStore(db, scope);
      return await (request.method === "GET"
        ? readMemory(store, request)
        : writeMemory(store, request));
    } catch (error) {
      return errorResponse(error);
    }
  };
