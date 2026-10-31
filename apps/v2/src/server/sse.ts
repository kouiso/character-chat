import type { ChatSseEvent } from "../lib/sse-events";

export type SequencedSseEvent = { id: number; event: ChatSseEvent };
type StreamEvent = ChatSseEvent | SequencedSseEvent;

const encodeEvent = (value: StreamEvent): string => {
  const event = "event" in value ? value.event : value;
  const prefix = "event" in value ? `id: ${value.id}\n` : "";
  const { type, ...rest } = event;
  return `${prefix}event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`;
};

export const toSseStream = (events: AsyncGenerator<StreamEvent>): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
    },
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeEvent(value)));
    },
    async cancel() {
      await events.return?.(undefined);
    },
  });
};

export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};
