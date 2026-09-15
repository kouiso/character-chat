// vlong-session-dogfood.ts は import 時に main() が走る作りで、直接テストできん。
// 実クライアントと同じリクエスト形を守るための純粋関数だけをここへ抜き出し、
// vlong-session-request-shape.test.ts で固定する。

export type ScenePhase = "conversation" | "intimate" | "erotic" | "climax" | "afterglow";

const SCENE_PHASES: readonly ScenePhase[] = [
  "conversation",
  "intimate",
  "erotic",
  "climax",
  "afterglow",
];

export const isScenePhase = (value: string | null): value is ScenePhase =>
  value !== null && (SCENE_PHASES as readonly string[]).includes(value);

// 実クライアント(src/lib/api.ts:518)と同じヘッダ。無いとサーバは前ターンのフェーズを
// 読めず、applyPhaseFloor が一度も効かん。
// 実クライアント(src/lib/api.ts の streamChatWithQualityGuard)と同じヘッダ形。
// assistant の id を載せんと quality_measurement.message_id が NULL のままになり、
// 「どの試行が配られたか」を測定から追えん（実測 2026-08-20 phase55 で紐づき 0 件）。
export const buildChatHeaders = (
  conversationId?: string,
  assistantMessageId?: string,
): Record<string, string> => ({
  ...(conversationId ? { "x-conversation-id": conversationId } : {}),
  ...(assistantMessageId ? { "x-assistant-message-id": assistantMessageId } : {}),
});

// 実クライアント(src/lib/api.ts:1318 createConversationMessage)と同じ body 形。
// generationPhase は値がある時だけ載せる（無いのに固定文字列を送ると、読めなかった事実が
// 消えて次ターンの床が誤って効く）。
export const buildMessagePersistBody = (message: {
  id: string;
  role: "user" | "assistant";
  content: string;
  generationPhase?: string | null;
}): Record<string, unknown> => ({
  id: message.id,
  role: message.role,
  content: message.content,
  ...(message.generationPhase ? { generationPhase: message.generationPhase } : {}),
});
