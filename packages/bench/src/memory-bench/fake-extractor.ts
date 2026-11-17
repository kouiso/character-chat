// 決定論の偽抜き出し器。extractMemories が送る {userMessage} を台本の表で引き、
// 決められた記憶（kind/content/subject）を返す。表に無い文は、問いかけ語尾は空、
// それ以外は本文をそのまま 1 件の記憶にする（本番の LLM 抜き出しと同じ形）。
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk } from "@langchain/core/outputs";
import { FakeListChatModel } from "@langchain/core/utils/testing";

export type FakeExtractorMemory = {
  kind: "fact" | "preference";
  content: string;
  subject: string;
};

export type FakeExtractorTableEntry = { text: string; memories: FakeExtractorMemory[] };

const QUESTION_END = /[？?]$|っけ$/;

export const createFakeExtractor = (table: FakeExtractorTableEntry[]): FakeListChatModel => {
  const lookup = new Map(table.map((entry) => [entry.text, entry.memories]));
  return new (class extends FakeListChatModel {
    constructor() {
      super({ responses: ["{}"] });
    }

    private extract(source: string): FakeExtractorMemory[] {
      const hit = lookup.get(source);
      if (hit) return hit;
      if (QUESTION_END.test(source)) return [];
      return [{ kind: "fact", content: source, subject: "" }];
    }

    private decide(messages: BaseMessage[]): string {
      const last = String(messages.at(-1)?.content ?? "");
      let source = last;
      try {
        const parsed = JSON.parse(last) as { userMessage?: unknown };
        if (typeof parsed.userMessage === "string") source = parsed.userMessage;
      } catch {
        // JSON でない入力はそのまま発言として扱う。
      }
      const memories = this.extract(source).map((memory) => ({
        ...memory,
        importance: 3,
        validFrom: null,
        validUntil: null,
        category: "long",
      }));
      return JSON.stringify({ memories });
    }

    override async _generate(messages: BaseMessage[]) {
      return { generations: [this._formatGeneration(this.decide(messages))], llmOutput: {} };
    }

    override async *_streamResponseChunks(
      messages: BaseMessage[],
    ): AsyncGenerator<ChatGenerationChunk> {
      yield this._createResponseChunk(this.decide(messages));
    }
  })();
};
