// M0 の LangGraph 実装（intake→...→persist の状態機械）はこのファイルの外。
// engine と cf/db/prompt/judge の間で受け渡す型だけ置く。
// TurnStore の契約（HistoryMessage / TurnEvent / GenerationRecord / TurnStore）は @v2/db が持つ。
// engine は package.json で @v2/db に依存しとるので、契約を engine 側に置くと db → engine → db の
// 循環になる。D1 実装は @v2/db の createD1TurnStore、テストは createMemoryTurnStore を注入する。
export type { GenerationRecord, HistoryMessage, SaveTurnInput, TurnEvent, TurnStore } from "@v2/db";

import type { HistoryMessage } from "@v2/db";

export type CharacterSheet = { id: string; name: string; systemPrompt: string; greeting: string };
export type ComposedPrompt = { version: "v0001"; system: string; messages: HistoryMessage[] };
