// クライアント/サーバ両方から import する型だけの定義。実体は @v2/engine の TurnEvent
// （型のみの再 export なのでクライアントバンドルに engine の実装は入らん）。
import type { TurnEvent } from "@v2/engine";

export type ChatSseEvent = TurnEvent;

const isChatSseEvent = (value: unknown): value is ChatSseEvent =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string";

export const parseSseEvent = (eventName: string, dataLine: string): ChatSseEvent | null => {
  try {
    const data: unknown = JSON.parse(dataLine);
    if (typeof data !== "object" || data === null) return null;
    const event: unknown = { type: eventName, ...data };
    return isChatSseEvent(event) ? event : null;
  } catch {
    return null;
  }
};
