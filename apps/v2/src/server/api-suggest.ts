// 発話候補 API（RIT-203）。POST=直近の会話から次の発話候補を3つ返す。
// 選択肢・おすすめ返信の両方をこの1経路で賄う（選んだ文はそのまま発話として送る）。
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createModelChain } from "@v2/engine";
import { z } from "zod";

import { loadHistory } from "./engine";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import { readChatMode, readSafeMode } from "./user-settings";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const bodySchema = z.object({ conversationId: z.string().min(1).max(120) });

// 所有者確認は生 D1（apps/v2 では drizzle 二重版の型衝突を避けるため・api-branch と同じ）。
const ownerGuard = async (d1: D1Database, conversationId: string) => {
  const row = await d1
    .prepare("SELECT user_id FROM v2_conversation WHERE id = ?")
    .bind(conversationId)
    .first<{ user_id: string }>();
  return row?.user_id === LOCAL_USER_ID;
};

// 候補生成用の最小プロンプト。キャラの枠は足さん（ユーザー発話の候補を考えるだけ）。
const SUGGEST_SYSTEM = [
  "あなたはロールプレイの続きを考える作家。",
  "渡す会話の続きとして、ユーザー（role=user の発話者）が次に言いそうな発話を3つ考え、1行1個だけ返す。",
  "各行は発話文だけ。番号・記号・引用・説明は付けん。各100字以内。場面を進める方向で3つとも違う内容にする。",
].join("\n");

// 出力はモデル任せなので行の掃除は広めに受ける（先頭記号・番号・括弧を剥がす）。
const parseSuggestions = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.replace(/^[\d\s*●・＊-]+[).:、）]?\s*/, "").trim())
    .map((line) => line.replace(/^["「『]|["」』]$/g, "").trim())
    .filter((line) => line.length >= 2 && line.length <= 200)
    .slice(0, 3);

const toTranscript = (history: { role: string; content: string }[]): string =>
  history
    .slice(-8)
    .map((message) => `${message.role === "user" ? "ユーザー" : "キャラ"}: ${message.content}`)
    .join("\n");

export const handleSuggestRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { message: "conversationId を指定してください。" });
  const { env } = await getPlatform();
  if (!(await ownerGuard(env.DB, parsed.data.conversationId)))
    return json(404, { message: "会話が見つかりません。" });

  // テストの固定経路。実モデルを呼ばんよう V2_FAKE_MODEL と同じ条件で固定文を返す。
  if (env.APP_ENV === "test" && env.V2_FAKE_MODEL === "1") {
    return json(200, {
      suggestions: ["もっと近くに来て", "その続きを聞かせて", "ゆっくりでいいから"],
    });
  }

  const history = await loadHistory({ characterId, conversationId: parsed.data.conversationId });
  const transcript = toTranscript(history.history);
  const safeMode = env.DB ? await readSafeMode(env.DB, LOCAL_USER_ID) : false;
  const chatMode = env.DB ? await readChatMode(env.DB, LOCAL_USER_ID) : "standard";
  const [candidate] = createModelChain(
    {
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      V2_MODEL: env.V2_MODEL,
      V2_OPENROUTER_BASE_URL: env.V2_OPENROUTER_BASE_URL,
      V2_MODEL_CHAIN: env.V2_MODEL_CHAIN,
      V2_SAFE_MODEL_CHAIN: env.V2_SAFE_MODEL_CHAIN,
      V2_QUALITY_MODEL_CHAIN: env.V2_QUALITY_MODEL_CHAIN,
      V2_LIGHT_MODEL_CHAIN: env.V2_LIGHT_MODEL_CHAIN,
    },
    { safeMode, chatMode },
  );
  const result = await candidate.model.invoke(
    [
      new SystemMessage(SUGGEST_SYSTEM),
      new HumanMessage(
        transcript.length > 0 ? `【会話】\n${transcript}` : "【会話】（まだ始まったばかり）",
      ),
    ],
    { maxTokens: 400 },
  );
  const text = typeof result.content === "string" ? result.content : "";
  const suggestions = parseSuggestions(text);
  return json(200, { suggestions });
};
