import type { ChatChunkDelivery } from "../lib/sse-events";

export type FixtureChatRequest = {
  conversationId: string;
  requestId: string;
  text: string;
  turn: number;
  retry: boolean;
};

export const readFixtureChatRequest = (input: RequestInit): FixtureChatRequest =>
  JSON.parse(String(input.body)) as FixtureChatRequest;

export const makeFixtureReply = (
  request: FixtureChatRequest,
  chunks: ChatChunkDelivery["chunks"],
  serverNow = 1_800_000_000_000,
) => {
  const delivery: ChatChunkDelivery = {
    conversationId: request.conversationId,
    turn: request.turn,
    generationId: request.requestId,
    serverNow,
    chunks,
  };
  const frame = (id: number, type: string, value: object) =>
    `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
  return {
    delivery,
    response: () =>
      new Response(
        frame(1, "delivery", delivery) +
          frame(2, "done", {
            conversationId: request.conversationId,
            turn: request.turn,
            generationId: request.requestId,
          }),
      ),
    history: {
      conversationId: request.conversationId,
      turn: request.turn + 1,
      history: [
        { role: "user", content: request.text, turn: request.turn },
        {
          role: "assistant",
          content: chunks.map((chunk) => chunk.text).join("\n"),
          turn: request.turn,
        },
      ],
      deliveries: [delivery],
    },
  };
};
