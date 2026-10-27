import { parseSseEvent } from "./sse-events";

type OpenStream = (after: number) => Promise<ReadableStream<Uint8Array>>;
type Frame = { text: string; id: number | null; terminal: boolean };
type ReconnectOptions = { after?: number; onCursor?: (cursor: number) => void };

const MAX_RECONNECTS = 10;
const encoder = new TextEncoder();

const frameId = (lines: string[]): number | null => {
  const rawId = lines
    .find((line) => line.startsWith("id:"))
    ?.slice(3)
    .trim();
  if (!rawId || !/^\d+$/.test(rawId)) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) ? id : null;
};

const parseFrame = (text: string): Frame => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const eventName = lines
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  const event = eventName ? parseSseEvent(eventName, data) : null;
  return {
    text: `${lines.join("\n")}\n\n`,
    id: event ? frameId(lines) : null,
    terminal: event?.type === "done" || event?.type === "error",
  };
};

class ChatReconnect {
  readonly stream: ReadableStream<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";
  private cursor = 0;
  private reconnects = 0;
  private closed = false;
  private controller?: ReadableStreamDefaultController<Uint8Array>;
  private readonly open: OpenStream;
  private readonly signal: AbortSignal;
  private readonly onCursor?: (cursor: number) => void;

  constructor(
    initial: ReadableStream<Uint8Array>,
    open: OpenStream,
    signal: AbortSignal,
    options: ReconnectOptions,
  ) {
    this.reader = initial.getReader();
    this.open = open;
    this.signal = signal;
    this.cursor = options.after ?? 0;
    this.onCursor = options.onCursor;
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        signal.addEventListener("abort", this.abort, { once: true });
        if (signal.aborted) this.abort();
      },
      pull: async () => {
        try {
          await this.pull();
        } catch (error) {
          await this.finish(error);
        }
      },
      cancel: async (reason) => {
        await this.finish(reason, true);
      },
    });
  }

  private readonly abort = (): void => {
    void this.finish(this.signal.reason ?? new DOMException("Aborted", "AbortError"));
  };

  private async finish(error?: unknown, canceled = false): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener("abort", this.abort);
    if (!canceled) {
      if (error !== undefined) this.controller?.error(error);
      else this.controller?.close();
    }
    await this.reader.cancel(error).catch(() => undefined);
    this.reader.releaseLock();
  }

  private async readFrame(): Promise<string | null> {
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(this.buffer);
      if (boundary) {
        const frame = this.buffer.slice(0, boundary.index);
        this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
        return frame;
      }
      const result = await this.reader.read();
      if (result.done) return null;
      this.buffer += this.decoder.decode(result.value, { stream: true });
    }
  }

  private async reconnect(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
    this.reader.releaseLock();
    while (!this.closed && this.reconnects < MAX_RECONNECTS) {
      this.signal.throwIfAborted();
      this.reconnects++;
      try {
        const stream = await this.open(this.cursor);
        if (this.closed) {
          await stream.cancel();
          return;
        }
        this.reader = stream.getReader();
        this.decoder = new TextDecoder();
        this.buffer = "";
        return;
      } catch {
        this.signal.throwIfAborted();
      }
    }
    if (!this.closed) throw new Error("接続を復元できませんでした。再接続してください。");
  }

  private async nextFrame(): Promise<string | null> {
    let frame: string | null;
    try {
      frame = await this.readFrame();
    } catch {
      frame = null;
    }
    if (frame === null && !this.closed) await this.reconnect();
    return frame;
  }

  private rememberCursor(frame: Frame): void {
    if (frame.id === null) return;
    this.cursor = Math.max(this.cursor, frame.id);
    // 完了の番号まで保存すると、再開時に最後の通知を読む機会が無くなる。
    if (!frame.terminal) this.onCursor?.(this.cursor);
  }

  private async pull(): Promise<void> {
    while (!this.closed) {
      const text = await this.nextFrame();
      if (text === null || this.closed) continue;
      const frame = parseFrame(text);
      if (frame.id !== null && frame.id <= this.cursor && !frame.terminal) continue;
      // 途切れた frame の番号を先に進めると、その本文を再取得できなくなる。
      this.rememberCursor(frame);
      this.controller?.enqueue(encoder.encode(frame.text));
      if (frame.terminal) await this.finish();
      return;
    }
  }
}

export const createReconnectingChatStream = (
  initial: ReadableStream<Uint8Array>,
  open: OpenStream,
  signal: AbortSignal,
  options: ReconnectOptions = {},
): ReadableStream<Uint8Array> => new ChatReconnect(initial, open, signal, options).stream;
