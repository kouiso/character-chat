import { useRef, useState } from "react";

import { parseSseEvent, type ChatSseEvent } from "../lib/sse-events";

export type ChatViewProps = {
  characterId: string;
  characterName: string;
};

type Bubble = { role: "user" | "assistant"; text: string; pending?: boolean };
type Assembled = { preview: string; confirmed: string[] };

// api-chat（src/server/api-chat.ts の BodySchema）と同じ形。
type ChatRequestBody = { conversationId: string | null; text: string };

const updateLastAssistant = (
  setBubbles: React.Dispatch<React.SetStateAction<Bubble[]>>,
  text: string,
  pending: boolean,
): void => {
  setBubbles((prev) => {
    const next = [...prev];
    const lastIndex = next.length - 1;
    if (lastIndex < 0 || next[lastIndex].role !== "assistant") return prev;
    next[lastIndex] = { role: "assistant", text, pending };
    return next;
  });
};

const parseSseBlock = (block: string): ChatSseEvent | null => {
  const lines = block.split("\n");
  const eventLine = lines.find((l) => l.startsWith("event:"));
  const dataLine = lines.find((l) => l.startsWith("data:"));
  if (!eventLine || !dataLine) return null;
  const eventName = eventLine.slice("event:".length).trim();
  return parseSseEvent(eventName, dataLine.slice("data:".length).trim());
};

// SSE を自前パース（EventSource は POST を送れんため fetch + ReadableStream で読む）。
// `event: <type>\ndata: <json>\n\n` のブロック単位で読み進める。
const readSseEvents = async function* (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ChatSseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) yield event;
    }
  }
};

export const ChatView = ({ characterId, characterName }: ChatViewProps) => {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  // token は生成中の暫定表示、chunk は judge を通った確定文。generate が終わってから
  // chunk が届くので、最初の chunk で暫定表示を捨てて確定文へ置き換える（足すと二重に出る）。
  const applyEvent = (event: ChatSseEvent, assembled: Assembled): void => {
    if (event.type === "token") {
      assembled.preview += event.text;
      updateLastAssistant(setBubbles, assembled.preview, true);
    } else if (event.type === "chunk") {
      assembled.confirmed.push(event.text);
      updateLastAssistant(setBubbles, assembled.confirmed.join("\n"), true);
    } else if (event.type === "done") {
      conversationIdRef.current = event.conversationId;
      updateLastAssistant(setBubbles, assembled.confirmed.join("\n"), false);
    } else if (event.type === "error") {
      setError(event.message);
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setError(null);
    setInput("");
    setBusy(true);
    setBubbles((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", text: "", pending: true },
    ]);

    try {
      const body: ChatRequestBody = { conversationId: conversationIdRef.current, text };
      const res = await fetch(`/api/chat/${characterId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? `サーバエラー（${res.status}）`);
      }
      if (!res.body) throw new Error("応答が空やった");

      const assembled: Assembled = { preview: "", confirmed: [] };
      for await (const evt of readSseEvents(res.body.getReader())) {
        applyEvent(evt, assembled);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信に失敗した");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v2-chat">
      <div className="v2-chat-header">{characterName}</div>
      <div className="v2-chat-log">
        {bubbles.map((b, i) => (
          <div key={i} className={`v2-bubble ${b.role} ${b.pending ? "pending" : ""}`}>
            {b.text || (b.pending ? "…" : "")}
          </div>
        ))}
      </div>
      {error && <div className="v2-error">{error}</div>}
      <form
        className="v2-chat-form"
        onSubmit={(event) => {
          void send(event);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力"
          disabled={busy}
        />
        <button type="submit" disabled={busy || input.trim().length === 0}>
          送信
        </button>
      </form>
    </div>
  );
};
