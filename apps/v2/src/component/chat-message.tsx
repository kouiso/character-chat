type MessagePart = { kind: "action" | "dialogue" | "inner" | "text"; text: string };

const parseParts = (content: string): MessagePart[] => {
  const source = content.replace(/^\s*<response>|<\/response>\s*$/g, "");
  const pattern = /<(action|dialogue|inner)>([\S\s]*?)<\/\1>/g;
  const parts: MessagePart[] = [];
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const before = source.slice(cursor, match.index).trim();
    if (before) parts.push({ kind: "text", text: before });
    const kind = match[1];
    if (kind === "action" || kind === "dialogue" || kind === "inner") {
      parts.push({ kind, text: match[2].trim() });
    }
    cursor = match.index + match[0].length;
  }
  const after = source.slice(cursor).trim();
  if (after) parts.push({ kind: "text", text: after });
  return parts;
};

export const ChatMessage = ({ content }: { content: string }) => (
  <>
    {parseParts(content).map((part, index) =>
      part.kind === "inner" ? (
        <details className="v2-inner" key={index}>
          <summary>心の声</summary>
          <p>{part.text}</p>
        </details>
      ) : (
        <p className={`v2-${part.kind}`} key={index}>
          {part.text}
        </p>
      ),
    )}
  </>
);
