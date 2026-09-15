import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX } from "react";

import { ApiResponseError, fetchSharedConversation, type SharedConversation } from "@/lib/api";
import { resolveAvatarSrc } from "@/lib/avatar-url";
import { createLogger } from "@/lib/logger";
import { handleNavClick } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import {
  parseXmlResponse,
  stripInlineEmphasisMarkers,
  stripXmlTags,
  type StructuredResponse,
} from "@/lib/xml-response-parser";

const logger = createLogger("shared-conversation-view");

interface SharedConversationViewProps {
  shareId: string;
  // ?m=<messageId> で指定された特定の発言。読み込み後にそこへスクロール＋ハイライトする。
  focusMessageId?: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: SharedConversation }
  // backend の 404(not_found) / 410(payload_corrupt) を区別して文言を変える
  | { status: "not_found" }
  | { status: "corrupt" }
  | { status: "error" };

// 設計 2e 共有ビューの夜×灯りの地。theme に依存せず暖色ダークで固定したいため .dark を強制する。
const NIGHT_BG =
  "radial-gradient(125% 78% at 50% -8%, var(--ink) 0%, var(--night-mid) 52%, var(--night) 100%)";
// 灯りのグラデ CTA。明るい金は --gold-cta、暗端は --lamp。
const LAMP_CTA = "linear-gradient(145deg, var(--gold-cta), var(--lamp))";

// her-message.tsx の layerStyles と同じ構造レイヤー表現（読み取り専用なので簡略スタイル）
type LayerType = "scene" | "action" | "dialogue" | "inner" | "narration";
const LAYER_ORDER: readonly LayerType[] = ["scene", "action", "dialogue", "inner", "narration"];
const layerStyles: Record<LayerType, CSSProperties> = {
  scene: { fontSize: 10.5, lineHeight: 1.7, letterSpacing: "0.2em", color: "var(--faint)" },
  action: {
    fontFamily: "'Shippori Mincho', 'Noto Serif JP', serif",
    fontSize: 13.5,
    lineHeight: 1.9,
    color: "rgba(243,234,217,0.86)",
  },
  dialogue: {
    fontFamily: "'Shippori Mincho', 'Noto Serif JP', serif",
    fontSize: 17,
    lineHeight: 1.85,
    color: "var(--text)",
  },
  inner: {
    fontFamily: "'Shippori Mincho', 'Noto Serif JP', serif",
    fontSize: 13.5,
    fontStyle: "italic",
    lineHeight: 1.9,
    color: "oklch(0.72 0.16 14)",
  },
  narration: {
    fontFamily: "'Shippori Mincho', 'Noto Serif JP', serif",
    fontSize: 14,
    lineHeight: 1.85,
    color: "var(--dim)",
  },
};

// XMLタグを共有ビューでも生表示させない。ライブチャット(her-message.tsx buildDisplayResponse)と
// 同じフォールバック規則: 構造化パース成功→各レイヤー描画、失敗→タグ除去した平文。
const buildSharedDisplayParts = (content: string): { type: LayerType; text: string }[] => {
  const parsed: Partial<StructuredResponse> | null = parseXmlResponse(content);
  if (parsed) {
    // 共有ページは圏点を描かんので、記号だけ落として語を残す。残すとアプリでは
    // 圏点、共有リンクでは *こらえきれん* と、同じ発言が二つの見た目で出る。
    return LAYER_ORDER.map((type) => ({
      type,
      text: stripInlineEmphasisMarkers(parsed[type] ?? ""),
    })).filter((part) => part.text);
  }
  const plain = stripXmlTags(content) || content;
  return plain ? [{ type: "dialogue" as const, text: plain }] : [];
};

// 共有日付は「6月30日」形式で薄く添える。未取得なら空にしてフォールバック文言に委ねる。
const formatShareDate = (createdAt: number): string => {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return "";
  return new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric" }).format(
    new Date(createdAt),
  );
};

const CharAvatar = ({
  url,
  name,
  size,
}: {
  url: string | null;
  name: string;
  size: number;
}): JSX.Element =>
  url ? (
    <img
      src={url}
      alt=""
      className="shrink-0 rounded-full object-cover"
      style={{
        width: size,
        height: size,
        border: "1px solid var(--hairline)",
        objectPosition: "50% 20%",
      }}
    />
  ) : (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-serif text-dim"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        border: "1px solid var(--hairline)",
        background: "var(--ink)",
      }}
    >
      {name.slice(0, 1)}
    </div>
  );

const CenteredNotice = ({
  title,
  description,
}: {
  title: string;
  description: string;
}): JSX.Element => (
  <div
    className="dark flex h-full w-full items-center justify-center px-6 text-text"
    style={{ background: NIGHT_BG }}
  >
    <div className="flex max-w-md flex-col items-center gap-3 text-center">
      <h2 className="font-serif text-xl font-semibold text-text">{title}</h2>
      <p className="text-sm leading-7 text-dim">{description}</p>
      <a
        href="/discover"
        onClick={handleNavClick("/discover")}
        className="mt-2 inline-flex min-h-11 items-center rounded-[20px] px-5 py-2 text-sm font-bold text-night"
        style={{ background: LAMP_CTA }}
      >
        トップへ
      </a>
    </div>
  </div>
);

export const SharedConversationView = ({
  shareId,
  focusMessageId,
}: SharedConversationViewProps): JSX.Element => {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // ディープリンク対象を一時的に光らせるための state。null = ハイライトなし。
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  // メッセージ id -> DOM ノードの対応表。スクロール対象の取得に使う。
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());

  const registerNode = useCallback((id: string, node: HTMLElement | null): void => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // shareId 変更時にローディングへ戻す。effect 同期実行ではなく async 内で行い
      // cascading render を避ける（react-hooks/set-state-in-effect 対策）。
      setState({ status: "loading" });
      try {
        const data = await fetchSharedConversation(shareId);
        if (!cancelled) setState({ status: "ready", data });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiResponseError) {
          // 410 は時間切れではなく payload 破損なので「壊れた」文言に分ける
          if (error.status === 410) {
            setState({ status: "corrupt" });
            return;
          }
          if (error.status === 404) {
            setState({ status: "not_found" });
            return;
          }
        }
        logger.warn("failed to load shared conversation", { error });
        setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  // 読み込み完了後、?m=<id> で指定された発言までスクロールし、約2秒だけハイライトする。
  // 対象 id がスナップショットに無い（共有時点より後の発言など）場合は黙ってスキップする。
  useEffect(() => {
    if (state.status !== "ready" || !focusMessageId) return;
    const node = nodeRefs.current.get(focusMessageId);
    if (!node) return;
    let clearTimer = 0;
    // スクロール（DOM API）とハイライト state 更新を rAF コールバックに逃がし、
    // effect 本体での同期 setState（cascading render）を避ける。
    const raf = window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashMessageId(focusMessageId);
      clearTimer = window.setTimeout(() => setFlashMessageId(null), 2000);
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (clearTimer) window.clearTimeout(clearTimer);
    };
  }, [state.status, focusMessageId]);

  if (state.status === "loading") {
    return (
      <div
        className="dark flex h-full w-full items-center justify-center text-dim"
        style={{ background: NIGHT_BG }}
      >
        <p className="text-sm text-dim">共有された会話を読み込んでいます…</p>
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <CenteredNotice
        title="会話が見つかりません"
        description="この共有リンクは無効か、削除された可能性があります。URL をもう一度確認してください。"
      />
    );
  }

  if (state.status === "corrupt") {
    return (
      <CenteredNotice
        title="会話を読み込めませんでした"
        description="共有データが壊れてしまい、この会話はもう表示できません。"
      />
    );
  }

  if (state.status === "error") {
    return (
      <CenteredNotice
        title="読み込みに失敗しました"
        description="通信エラーが発生しました。時間をおいて、もう一度お試しください。"
      />
    );
  }

  const { payload } = state.data;
  // avatar は R2 直 URL でない場合 /api/avatar/:key 経由になるため保存キーを解決してから渡す
  const avatarUrl = resolveAvatarSrc(payload.character.avatar);
  const characterName = payload.character.name;
  const title = payload.title?.trim() || characterName;
  const shareDate = formatShareDate(state.data.createdAt);
  const headerSub = shareDate ? `${shareDate} ・ 読み取り専用` : "読み取り専用の共有";

  return (
    <div
      className="dark flex h-full w-full flex-col overflow-hidden text-text"
      style={{ background: NIGHT_BG }}
    >
      {/* 設計 2e: 「読むことだけできる」ことを最初に一言で伝える栞のバナー */}
      <div className="mx-5 mt-3 flex items-center gap-2 rounded-[14px] border border-lamp-30 bg-lamp-10 px-3.5 py-2.5 text-[11.5px] text-dim">
        <span className="text-lamp">❝</span>
        共有された一夜 — 読むことだけできます
      </div>

      <header className="flex items-center gap-3 px-5 pb-2.5 pt-3.5">
        <CharAvatar url={avatarUrl} name={characterName} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-base font-semibold text-text">{title}</p>
          <p className="mt-0.5 truncate text-[10.5px] text-dim">{headerSub}</p>
        </div>
      </header>

      <div
        className="mx-5 h-px"
        style={{ background: "linear-gradient(90deg, transparent, var(--lamp-30), transparent)" }}
      />

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5">
        {payload.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-dim">この会話にはメッセージがありません。</p>
        ) : (
          <>
            {payload.messages.map((message) => {
              const isUser = message.role === "user";
              const isFlashing = flashMessageId === message.id;
              return (
                <div
                  key={message.id}
                  id={`msg-${message.id}`}
                  ref={(node): void => registerNode(message.id, node)}
                  data-flash={isFlashing ? "true" : undefined}
                  className="mb-5 scroll-mt-24"
                >
                  {isUser ? (
                    // 相手（＝共有した側）の発言。右寄せ・灯りグラデのバブル。
                    <>
                      <div className="mb-1.5 text-right text-[11px] tracking-[0.14em] text-faint">
                        相手
                      </div>
                      <div className="flex justify-end">
                        <div
                          className={cn(
                            "max-w-[80%] rounded-[20px_20px_7px_20px] border border-lamp-30 px-4 py-3 text-sm leading-relaxed text-text",
                            isFlashing && "ring-2 ring-lamp ring-offset-2 ring-offset-night",
                          )}
                          style={{
                            background: "linear-gradient(145deg, var(--lamp-30), var(--lamp-14))",
                          }}
                        >
                          {message.content ? (
                            <p className="whitespace-pre-wrap break-words">{message.content}</p>
                          ) : null}
                          {message.imageUrl ? (
                            <img
                              src={message.imageUrl}
                              alt="共有された画像"
                              className="mt-2 max-h-96 w-full rounded-lg object-contain"
                              loading="lazy"
                            />
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : (
                    // キャラの発言。アバター＋名前＋明朝の台詞。バブルは持たず地に溶かす。
                    <div className="flex gap-3">
                      <CharAvatar url={avatarUrl} name={characterName} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 font-serif text-[13px] text-lamp">
                          {characterName}
                        </div>
                        <div
                          className={cn(
                            "rounded-2xl",
                            isFlashing &&
                              "px-3 py-2 ring-2 ring-lamp ring-offset-2 ring-offset-night",
                          )}
                        >
                          {buildSharedDisplayParts(message.content).map((part, index) => (
                            <p
                              key={part.type}
                              className="m-0 whitespace-pre-wrap break-words"
                              style={{ marginTop: index > 0 ? 8 : 0, ...layerStyles[part.type] }}
                            >
                              {part.text}
                            </p>
                          ))}
                          {message.imageUrl ? (
                            <img
                              src={message.imageUrl}
                              alt="共有された画像"
                              className="mt-2 max-h-96 w-full rounded-lg object-contain"
                              loading="lazy"
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="mt-2 text-center text-[11px] text-faint">— ここまで —</div>
          </>
        )}
      </div>

      <footer
        className="shrink-0 px-6 pb-7 pt-3.5 text-center"
        style={{ borderTop: "1px solid var(--hairline)", background: "var(--night)" }}
      >
        <a
          href="/discover"
          onClick={handleNavClick("/discover")}
          className="flex min-h-11 items-center justify-center rounded-[26px] py-[15px] text-sm font-bold text-night"
          style={{ background: LAMP_CTA }}
        >
          あなたも、あなただけの夜を →
        </a>
        <p className="mt-2.5 text-[10.5px] text-faint">
          共有した側はいつでもリンクを消せます ・ 名前や記憶は含まれません
        </p>
      </footer>
    </div>
  );
};
