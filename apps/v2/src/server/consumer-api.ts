import { characterTable, createDb, readSessionContext } from "@v2/db";
import { and, eq, or } from "drizzle-orm";

import { createMemoryApi } from "./api-memory";
import { createProactiveApi } from "./api-proactive";
import { createDocumentRequestHandler } from "./document-api";
import { createScopedDocumentService } from "./document-runtime";

const USER_ID = "local";
const unavailable = () =>
  Response.json(
    { message: "会話またはキャラクターが見つかりません。" },
    { status: 404, headers: { "cache-control": "no-store" } },
  );

// BASIC検査後だけ呼ぶ。owner/worldlineはリクエスト本文・ヘッダから受け取らない。
export const handleConsumerApi = async (
  request: Request,
  env: Cloudflare.Env,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const memory = url.pathname.match(/^\/api\/memory\/([^/]+)$/);
  const documents = url.pathname.match(/^\/api\/chat\/([^/]+)\/documents$/);
  const proactive = url.pathname.match(/^\/api\/proactive\/([^/]+)$/);
  if (!memory && !documents && !proactive) return null;
  const db = createDb(env.DB);
  try {
    if (memory)
      return createMemoryApi({ db, authenticate: async () => USER_ID })(
        request,
        decodeURIComponent(memory[1]),
      );
    if (documents)
      return createDocumentRequestHandler(async (req, characterId) => {
        const conversationId = new URL(req.url).searchParams.get("conversationId");
        if (!conversationId || conversationId.length > 120) return unavailable();
        const session = await readSessionContext(db, {
          ownerUserId: USER_ID,
          characterId,
          conversationId,
        });
        if (!session) return unavailable();
        return createScopedDocumentService(env, {
          userId: USER_ID,
          characterId,
          worldlineId: session.worldlineId,
        });
      })(decodeURIComponent(documents[1]), request);
    if (proactive)
      return createProactiveApi({
        authenticate: async () => USER_ID,
        verifyCharacter: async (recipientId, characterId) => {
          const [row] = await db
            .select({ proactiveSettings: characterTable.proactiveSettings })
            .from(characterTable)
            .where(
              and(
                eq(characterTable.id, characterId),
                or(eq(characterTable.userId, recipientId), eq(characterTable.isOfficial, true)),
              ),
            );
          return row ?? null;
        },
        getRecipient: (recipientId) => env.PROACTIVE_RECIPIENTS.getByName(recipientId),
        deliveryMode:
          env.APP_ENV === "test" && env.V2_PROACTIVE_MOCK === "1" ? "mock-only" : "unavailable",
      })(request, decodeURIComponent(proactive[1]));
    return null;
  } catch {
    return Response.json(
      { message: "設定を読み書きできません。再試行してください。" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
};
