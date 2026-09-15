import type { ChatSseEvent } from "../lib/sse-events";

const encodeEvent = (event: ChatSseEvent): string => {
  const { type, ...rest } = event;
  return `event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`;
};

export const toSseStream = (events: AsyncGenerator<ChatSseEvent>): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
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
