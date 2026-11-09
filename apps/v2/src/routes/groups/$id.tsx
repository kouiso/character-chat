// パーティモードの会話画面（RIT-216）。発言者名をバブルへ出して誰のセリフか識別する。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { postGroupMessage } from "../../lib/groups";
import { getGroupView } from "../../server/groups";

const routeApi = getRouteApi("/groups/$id");

type DisplayMessage = { speakerName: string | null; content: string };

const GroupChatPage = () => {
  const { id } = routeApi.useParams();
  const view = routeApi.useLoaderData();
  const [messages, setMessages] = useState<DisplayMessage[]>(
    () => view?.messages.map((m) => ({ speakerName: m.speakerName, content: m.content })) ?? [],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  if (!view) {
    return (
      <div className="v2-list">
        <h1>場が見つかりません</h1>
        <Link to="/groups">パーティ一覧へ</Link>
      </div>
    );
  }
  const names = new Map(view.members.map((m) => [m.characterId, m.name]));

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    setBusy(true);
    setInput("");
    try {
      const { replies } = await postGroupMessage(id, content);
      setMessages((prev) => [
        ...prev,
        { speakerName: null, content },
        ...replies.map((r) => ({
          speakerName: names.get(r.speakerCharacterId) ?? r.speakerCharacterId,
          content: r.text,
        })),
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v2-group-chat">
      <h1>{view.members.map((m) => m.name).join("・")}</h1>
      <Link to="/groups">パーティ一覧へ</Link>
      <div className="v2-group-messages">
        {messages.length === 0 && <p>まだ発言がありません。</p>}
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.speakerName === null ? "v2-bubble user" : "v2-bubble assistant"}
          >
            <span className="v2-bubble-speaker">{m.speakerName ?? "あなた"}</span>
            <span className="v2-bubble-text">{m.content}</span>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => void send(e)} className="v2-group-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="場への発言"
          disabled={busy}
          maxLength={4000}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          送信
        </button>
      </form>
    </div>
  );
};

export const Route = createFileRoute("/groups/$id")({
  loader: async ({ params }) => getGroupView({ data: params.id }),
  component: GroupChatPage,
});
