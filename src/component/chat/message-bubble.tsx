import { memo, useCallback, useEffect, useState, type JSX } from "react";
import ReactMarkdown from "react-markdown";

import {
  BookmarkPlus,
  Download,
  Eye,
  GitBranch,
  ImageOff,
  Pencil,
  RefreshCw,
  RotateCcw,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeOff,
} from "lucide-react";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { MessageActionMenu } from "@/component/chat/message-action-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/component/ui/avatar";
import { Badge } from "@/component/ui/badge";
import { Skeleton } from "@/component/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/component/ui/tooltip";
import { apiFetch, type MessageFeedbackRating } from "@/lib/api";
import { isDisplayableImageUrl, useAuthenticatedImageUrl } from "@/lib/authenticated-image";
import { resolveAvatarSrc } from "@/lib/avatar-url";
import { saveBlobAsImage } from "@/lib/download-image";
import { cn, getAvatarFallback } from "@/lib/utils";
import {
  isXmlResponse,
  parseXmlResponse,
  stripRememberTags,
  stripXmlTagsStreaming,
} from "@/lib/xml-response-parser";
import {
  isImageGenerationPlaceholderContent,
  parseImageGenerationProgressPercent,
} from "@/store/chat-store";

interface MessageBubbleProps {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  isStreaming?: boolean;
  isLoading?: boolean;
  characterName?: string;
  characterAvatar?: string | null;
  nsfwBlur?: boolean;
  canSpeak?: boolean;
  isSpeaking?: boolean;
  error?: boolean;
  warningLevel?: boolean;
  isLast?: boolean;
  showLabel?: boolean;
  isAutoGeneratingImage?: boolean;
  isHighlighted?: boolean;
  onSpeak?: (messageId: string, text: string) => void;
  onStopSpeaking?: () => void;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onRetry?: (messageId: string) => void;
  onBookmark?: (messageId: string) => void;
  onBranch?: (messageId: string) => void;
  onShareMessage?: (messageId: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onPromoteMemory?: (messageId: string, content: string) => void;
  feedbackRating?: MessageFeedbackRating;
  onFeedback?: (messageId: string, rating: MessageFeedbackRating, reason?: string) => void;
  imageKey?: string;
}

interface MessageContentProps {
  content: string;
  isStreaming?: boolean;
  role?: "user" | "assistant";
}

const markdownParagraph = ({ children }: { children?: React.ReactNode }) => (
  <p className="mb-2 last:mb-0">{children}</p>
);
const markdownEm = ({ children }: { children?: React.ReactNode }) => (
  <em className="italic text-current/90">{children}</em>
);
const markdownStrong = ({ children }: { children?: React.ReactNode }) => (
  <strong className="font-semibold">{children}</strong>
);
// レンダー毎の配列再生成を防ぎ、ReactMarkdownのプラグイン再初期化をスキップさせる
const markdownComponents = { p: markdownParagraph, em: markdownEm, strong: markdownStrong };
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeSanitize];

const formatParentheticalAction = (action: string): string => {
  const trimmed = action.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("（") && trimmed.endsWith("）")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? `（${inner}）` : "";
  }
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? `（${inner}）` : "";
  }
  return `（${trimmed}）`;
};

// アシスタント応答を「台詞」「(ト書き)」「地の文」に分割してスタイル付与
const StyledNarrative = memo(({ content }: { content: string }) => {
  const segments = content.split(/(「[^」]*」|\([^)]*\)|（[^）]*）)/g).filter(Boolean);
  return (
    <span>
      {segments.map((seg, i) => {
        const isParentheticalAction =
          (seg.startsWith("(") && seg.endsWith(")")) ||
          (seg.startsWith("（") && seg.endsWith("）"));
        if (isParentheticalAction) {
          return (
            <span key={i} className="italic text-muted-foreground/70 text-[0.85em]">
              {seg}
            </span>
          );
        }
        if (seg.startsWith("「") && seg.endsWith("」")) {
          return (
            <span key={i} className="font-medium">
              {seg}
            </span>
          );
        }
        return <span key={i}>{seg}</span>;
      })}
    </span>
  );
});
StyledNarrative.displayName = "StyledNarrative";

// XML構造化レスポンス用レンダラー
// <action>/<dialogue>/<inner>を視覚的に分離して表示
const StructuredNarrative = memo(({ content }: { content: string }) => {
  const parsed = parseXmlResponse(content);
  if (!parsed) {
    // XMLパース失敗時は既存レンダラーにフォールバック
    const paragraphs = content.split(/\n+/).filter(Boolean);
    return (
      <>
        {paragraphs.map((para, i) => (
          <p key={i} className="mb-2 last:mb-0">
            <StyledNarrative content={para} />
          </p>
        ))}
      </>
    );
  }
  // action/dialogueが交互に複数出た場合、モデルが書いた地の文→台詞→地の文…の順序を
  // 画面でもそのまま保つため、出現順の blocks をそのまま描画する
  // （種別ごとにまとめて「地の文→台詞」の2段に組み替えると場面の時系列が壊れる）。
  const renderableBlocks = parsed.blocks
    .map((block) =>
      block.type === "action" ? { ...block, text: formatParentheticalAction(block.text) } : block,
    )
    .filter((block) => block.text.length > 0);

  return (
    <div className="space-y-3">
      {parsed.narration && (
        <p className="font-narrative italic text-current/85 leading-relaxed text-sm">
          {parsed.narration}
        </p>
      )}
      {renderableBlocks.map((block, index) =>
        block.type === "action" ? (
          <p
            key={`action-${index}`}
            className="narrative-action font-narrative italic text-current/85 leading-relaxed text-[0.9em]"
          >
            {block.text}
          </p>
        ) : (
          <p
            key={`dialogue-${index}`}
            className="font-narrative text-[1.08em] font-medium leading-8 tracking-wide"
          >
            <StyledNarrative content={block.text} />
          </p>
        ),
      )}
      {parsed.inner && (
        <p className="narrative-inner text-xs italic text-current/75 leading-relaxed">
          {parsed.inner}
        </p>
      )}
    </div>
  );
});
StructuredNarrative.displayName = "StructuredNarrative";

// ストリーミング中はReactMarkdownのフルパースを避けて生テキスト表示にする
// ReactMarkdown+remarkGfmはチャンク毎に数十msメインスレッドをブロックするため
const StreamingContent = memo(({ content }: { content: string }) => {
  const sanitizedContent = stripXmlTagsStreaming(content);
  if (!content) {
    return (
      <div className="animate-thinking-pulse inline-flex items-center gap-2.5 rounded-md border border-dashed border-foreground/20 px-3 py-2">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-foreground/40" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-foreground/40" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-foreground/40" />
        <span className="text-xs tracking-widest text-foreground/30">ことばを探している…</span>
      </div>
    );
  }
  return <span className="whitespace-pre-wrap">{sanitizedContent}</span>;
});

StreamingContent.displayName = "StreamingContent";

const MessageContent = memo(({ content, isStreaming, role }: MessageContentProps) => {
  const sanitizedContent = stripRememberTags(content);
  if (isStreaming) {
    return <StreamingContent content={content} />;
  }
  if (!content) return null;

  // アシスタントの応答: XML構造化 or 既存フォーマットで表示
  if (role === "assistant") {
    if (isXmlResponse(content)) {
      return <StructuredNarrative content={content} />;
    }
    const paragraphs = sanitizedContent.split(/\n+/).filter(Boolean);
    return (
      <>
        {paragraphs.map((para, i) => (
          <p key={i} className="mb-2 last:mb-0">
            <StyledNarrative content={para} />
          </p>
        ))}
      </>
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={markdownComponents}
    >
      {sanitizedContent}
    </ReactMarkdown>
  );
});

MessageContent.displayName = "MessageContent";

interface SpeakButtonProps {
  messageId: string;
  isSpeaking: boolean;
  content: string;
  onSpeak?: (messageId: string, text: string) => void;
  onStopSpeaking?: () => void;
}

const SpeakButton = ({
  messageId,
  isSpeaking,
  content,
  onSpeak,
  onStopSpeaking,
}: SpeakButtonProps): JSX.Element => (
  <button
    type="button"
    onClick={() => (isSpeaking ? onStopSpeaking?.() : onSpeak?.(messageId, content))}
    className={cn(
      "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs transition-colors min-h-[44px]",
      isSpeaking
        ? "bg-primary/10 text-primary hover:bg-primary/20"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    )}
  >
    {isSpeaking ? <VolumeOff className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
    {isSpeaking ? "停止" : "再生"}
  </button>
);

// ── 画像ビューワー ──────────────────────────────────────────────────────
interface AvatarViewerProps {
  src: string;
  alt: string;
  onClose: () => void;
}

const AvatarViewer = ({ src, alt, onClose }: AvatarViewerProps): JSX.Element => {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt}の画像`}
    >
      <button
        type="button"
        className="fixed inset-0 cursor-default appearance-none border-none bg-transparent"
        onClick={onClose}
        aria-label="閉じる"
      />
      <img
        src={src}
        alt={alt}
        className="relative max-h-[80vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
      />
    </div>
  );
};

interface ImagePreviewProps {
  imageUrl: string;
  nsfwBlur: boolean;
}

const ImagePreview = ({ imageUrl, nsfwBlur }: ImagePreviewProps): JSX.Element | null => {
  const [revealed, setRevealed] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  // <img>要素自体のデコード失敗（解決済みURLが壊れている等）を捕捉する。認証フェッチ失敗とは別経路。
  const [imgError, setImgError] = useState(false);
  const image = useAuthenticatedImageUrl(imageUrl);
  const imageSrc = image.url;
  // URLが差し替わった（S3→R2への置換等）ら過去のデコード失敗状態をリセットして再読込を許可する
  useEffect(() => {
    setImgError(false);
  }, [imageSrc]);

  const handleDownload = async (): Promise<void> => {
    try {
      setIsDownloading(true);
      const response = await apiFetch(imageUrl);
      if (!response.ok) {
        toast.error("画像の取得に失敗しました");
        return;
      }
      const blob = await response.blob();
      const ext = blob.type.split("/")[1] ?? "png";
      const filename = `chat-${Date.now()}.${ext}`;

      await saveBlobAsImage(blob, filename);
    } catch (error) {
      toast.error(`画像の取得に失敗しました: ${String(error)}`);
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isDisplayableImageUrl(imageUrl)) {
    return null;
  }

  // 認証フェッチ失敗・<img>デコード失敗のどちらでも、壊れた画像アイコンの代わりにフォールバックを出す
  if (image.failed || imgError) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ImageOff className="h-4 w-4 shrink-0" />
        <span>画像を読み込めませんでした</span>
      </div>
    );
  }

  if (!imageSrc) {
    // 生成中・フェッチ中はスケルトンで占位し、レイアウトのガタつきと無表示を防ぐ
    return <Skeleton className="aspect-square w-full max-w-xs rounded-xl" />;
  }

  if (!nsfwBlur || revealed) {
    return (
      <div className="max-w-xs space-y-2">
        <button
          type="button"
          className="relative cursor-zoom-in overflow-hidden rounded-xl"
          onClick={() => setShowViewer(true)}
        >
          {/* onErrorは読み込み失敗の検知であってユーザー操作ではないため、a11yルールの誤検知を抑止する */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <img
            src={imageSrc}
            alt="AIが生成したシーン画像"
            className="max-h-[30vh] max-w-full w-auto rounded-xl object-contain"
            onError={() => setImgError(true)}
          />
        </button>
        {showViewer && (
          <AvatarViewer
            src={imageSrc}
            alt="AIが生成したシーン画像"
            onClose={() => setShowViewer(false)}
          />
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="AI生成画像をダウンロード"
        >
          <Download className="h-3.5 w-3.5" />
          {isDownloading ? "取得中" : "ダウンロード"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="relative max-w-xs cursor-pointer overflow-hidden rounded-xl"
      onClick={() => setRevealed(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setRevealed(true);
      }}
      aria-label="タップして画像を表示"
    >
      {/* onErrorは読み込み失敗の検知であってユーザー操作ではないため、a11yルールの誤検知を抑止する */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <img
        src={imageSrc}
        alt="AIが生成したシーン画像"
        className="max-h-[30vh] max-w-full rounded-xl object-contain blur-2xl brightness-50 transition-all duration-300"
        onError={() => setImgError(true)}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 ring-2 ring-white/40 backdrop-blur-sm">
          <Eye className="h-6 w-6 text-white" />
        </div>
        <span className="text-white text-sm font-medium drop-shadow-lg">タップで表示</span>
      </div>
    </button>
  );
};

interface MessageAvatarProps {
  isUser: boolean;
  characterName: string;
  avatarUrl?: string | null;
  onAvatarClick?: () => void;
}

const MessageAvatar = ({ isUser, characterName, avatarUrl, onAvatarClick }: MessageAvatarProps) => {
  const avatarImage = resolveAvatarSrc(avatarUrl);
  const clickable = !isUser && avatarImage !== null;
  return (
    <Avatar
      className={cn(
        "h-8 w-8 max-md:h-11 max-md:w-11 shrink-0",
        clickable &&
          "cursor-pointer ring-offset-background transition-all hover:ring-2 hover:ring-primary/40 hover:ring-offset-1",
      )}
      onClick={clickable ? onAvatarClick : undefined}
    >
      {!isUser && avatarImage ? <AvatarImage src={avatarImage} alt={characterName} /> : null}
      <AvatarFallback
        className={cn(
          "text-xs font-medium",
          isUser ? "bg-gradient-user-bubble text-white" : "bg-accent text-accent-foreground",
        )}
      >
        {isUser ? "あなた" : getAvatarFallback(characterName)}
      </AvatarFallback>
    </Avatar>
  );
};

// ── ユーザーメッセージのインライン編集 ─────────────────────────────────────
interface UserEditFormProps {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

const UserEditForm = ({ initialContent, onSave, onCancel }: UserEditFormProps) => {
  const [value, setValue] = useState(initialContent);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME変換中のキーイベントは無視
    if (e.nativeEvent.isComposing) return;
    // ChatInputと統一: Ctrl+Enter(またはCmd+Enter)で送信
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (value.trim()) onSave(value.trim());
    }
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg border border-primary bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        rows={Math.min(8, value.split("\n").length + 1)}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => value.trim() && onSave(value.trim())}
          disabled={!value.trim()}
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          送信
        </button>
      </div>
    </div>
  );
};

// ── エラー表示 ───────────────────────────────────────────────────────────
interface ErrorIndicatorProps {
  messageId: string;
  isLoading: boolean;
  onRetry?: (messageId: string) => void;
}

const ErrorIndicator = ({ messageId, isLoading, onRetry }: ErrorIndicatorProps) => (
  <div className="flex items-center gap-2 text-destructive">
    <span className="text-xs font-medium">送信エラー</span>
    {onRetry && (
      <button
        type="button"
        onClick={() => onRetry(messageId)}
        disabled={isLoading}
        className="flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="再試行"
      >
        <RotateCcw className="h-3 w-3" />
        再試行
      </button>
    )}
  </div>
);

// ── アクションボタン群 ───────────────────────────────────────────────────
interface MessageActionsProps {
  id: string;
  isUser: boolean;
  isLoading: boolean;
  isLast: boolean;
  warningLevel: boolean;
  canSpeak: boolean;
  isSpeaking: boolean;
  content: string;
  onSpeak?: (messageId: string, text: string) => void;
  onStopSpeaking?: () => void;
  onRegenerate?: (messageId: string) => void;
  onBookmark?: (messageId: string) => void;
  onBranch?: (messageId: string) => void;
  onShareMessage?: (messageId: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onPromoteMemory?: (messageId: string, content: string) => void;
  feedbackRating?: MessageFeedbackRating;
  onFeedback?: (messageId: string, rating: MessageFeedbackRating, reason?: string) => void;
  onStartEdit: () => void;
  hasEditHandler: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

interface EditButtonProps {
  isUser: boolean;
  isLoading: boolean;
  hasEditHandler: boolean;
  onStartEdit: () => void;
}

const EditButton = ({
  isUser,
  isLoading,
  hasEditHandler,
  onStartEdit,
}: EditButtonProps): JSX.Element | null => {
  if (!isUser || isLoading || !hasEditHandler) return null;
  return (
    <button
      type="button"
      onClick={onStartEdit}
      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground min-h-[44px]"
      aria-label="メッセージを編集"
    >
      <Pencil className="h-3.5 w-3.5" />
      編集
    </button>
  );
};

interface RegenerateButtonProps {
  id: string;
  isUser: boolean;
  isLast: boolean;
  isLoading: boolean;
  content: string;
  onRegenerate?: (messageId: string) => void;
}

const RegenerateButton = ({
  id,
  isUser,
  isLast,
  isLoading,
  onRegenerate,
}: RegenerateButtonProps): JSX.Element | null => {
  if (isUser || !isLast || isLoading || !onRegenerate) return null;
  return (
    <button
      type="button"
      onClick={() => onRegenerate(id)}
      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground min-h-[44px]"
      aria-label="再生成"
    >
      <RefreshCw className="h-3.5 w-3.5" />
      再生成
    </button>
  );
};

const QualityWarningBadge = () => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="inline-flex appearance-none border-0 bg-transparent p-0"
        aria-label="別案生成の案内"
      >
        <Badge
          variant="outline"
          className="border-yellow-500/40 text-yellow-700 dark:text-yellow-300"
        >
          別案あり
        </Badge>
      </TooltipTrigger>
      <TooltipContent>別案を生成中です</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

const MessageActions = ({
  id,
  isUser,
  isLoading,
  isLast,
  warningLevel,
  canSpeak,
  isSpeaking,
  content,
  onSpeak,
  onStopSpeaking,
  onRegenerate,
  onBookmark,
  onBranch,
  onShareMessage,
  onDeleteMessage,
  onPromoteMemory,
  feedbackRating,
  onFeedback,
  onStartEdit,
  hasEditHandler,
  menuOpen,
  onMenuOpenChange,
}: MessageActionsProps): JSX.Element => (
  <div
    role="toolbar"
    aria-label={isUser ? "ユーザーメッセージの操作" : "AIメッセージの操作"}
    className={cn(
      "flex max-w-full flex-wrap items-center gap-2 rounded-2xl px-1 py-1",
      isUser ? "justify-end bg-transparent" : "justify-start bg-card/90 ring-1 ring-border/35",
    )}
  >
    {canSpeak && (
      <SpeakButton
        messageId={id}
        isSpeaking={isSpeaking}
        content={content}
        onSpeak={onSpeak}
        onStopSpeaking={onStopSpeaking}
      />
    )}
    <EditButton
      isUser={isUser}
      isLoading={isLoading}
      hasEditHandler={hasEditHandler}
      onStartEdit={onStartEdit}
    />
    {warningLevel && !isUser && <QualityWarningBadge />}
    {!isUser && feedbackRating && (
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs",
          feedbackRating === "good" ? "text-emerald-400" : "text-rose-400",
        )}
        aria-label={feedbackRating === "good" ? "Good済み" : "Bad済み"}
      >
        {feedbackRating === "good" ? (
          <ThumbsUp className="h-3 w-3" />
        ) : (
          <ThumbsDown className="h-3 w-3" />
        )}
      </span>
    )}
    {!isUser && onBookmark && content && !isLoading && (
      <button
        type="button"
        onClick={() => onBookmark(id)}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground min-h-[44px]"
        aria-label="場面を保存"
      >
        <BookmarkPlus className="h-3.5 w-3.5" />
        保存
      </button>
    )}
    {!isUser && onBranch && content && !isLoading && (
      <button
        type="button"
        onClick={() => onBranch(id)}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground min-h-[44px]"
        aria-label="ここから分岐"
      >
        <GitBranch className="h-3.5 w-3.5" />
        分岐
      </button>
    )}
    {onShareMessage && content && !isLoading && (
      <button
        type="button"
        onClick={() => onShareMessage(id)}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground min-h-[44px]"
        aria-label="この発言を共有"
      >
        <Share2 className="h-3.5 w-3.5" />
        共有
      </button>
    )}
    {feedbackRating === "good" && (
      <ThumbsUp className="h-3 w-3 shrink-0 text-green-500" aria-label="Good評価済み" />
    )}
    {feedbackRating === "bad" && (
      <ThumbsDown className="h-3 w-3 shrink-0 text-red-500" aria-label="Bad評価済み" />
    )}
    <RegenerateButton
      id={id}
      isUser={isUser}
      isLast={isLast}
      isLoading={isLoading}
      content={content}
      onRegenerate={onRegenerate}
    />
    {!isLoading && (
      <MessageActionMenu
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        onCopy={() => {
          void navigator.clipboard.writeText(content);
          toast.success("コピーしました");
        }}
        onPromoteMemory={onPromoteMemory ? () => onPromoteMemory(id, content) : undefined}
        onFeedback={onFeedback ? (rating, reason) => onFeedback(id, rating, reason) : undefined}
        feedbackRating={feedbackRating}
        onDelete={onDeleteMessage ? () => onDeleteMessage(id) : undefined}
        className="md:opacity-0 md:group-hover/message:opacity-100"
      />
    )}
  </div>
);

interface BubbleBodyProps {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  isGeneratingImage: boolean;
  isHighlighted: boolean;
  isEditing: boolean;
  bubbleStyle: string;
  onSave: (content: string) => void;
  onCancelEdit: () => void;
}

const BubbleBody = ({
  id,
  content,
  role,
  isStreaming,
  isGeneratingImage,
  isHighlighted,
  isEditing,
  bubbleStyle,
  onSave,
  onCancelEdit,
}: BubbleBodyProps) => {
  if (isEditing) {
    return <UserEditForm initialContent={content} onSave={onSave} onCancel={onCancelEdit} />;
  }
  if (isGeneratingImage) {
    // backend が progress_percent を返したときは確定プログレス、無いときは不定形バーにフォールバックする。
    const progressPercent = parseImageGenerationProgressPercent(content);
    const isDeterminate = progressPercent !== null;
    return (
      <div
        data-testid="message-bubble"
        data-message-id={id}
        className={cn("w-[280px] rounded-2xl px-4 py-3", bubbleStyle)}
      >
        <div className="h-[180px] w-full animate-pulse rounded-xl bg-muted/70" />
        <div
          role="progressbar"
          aria-label="画像生成の進捗"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={isDeterminate ? progressPercent : undefined}
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted/70"
        >
          {isDeterminate ? (
            <div
              data-testid="image-progress-fill"
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {isDeterminate ? `画像を生成中... (${progressPercent}%)` : "画像を生成中..."}
        </p>
      </div>
    );
  }
  // 空 content (失敗/NSFW block 等で stream が空のまま終了) は空 bubble 表示しない
  if (!isStreaming && content.trim().length === 0) {
    return null;
  }
  return (
    <div
      data-testid="message-bubble"
      data-message-id={id}
      className={cn(
        "rounded-2xl px-4 py-3 text-sm leading-relaxed select-text",
        bubbleStyle,
        isHighlighted && "ring-2 ring-yellow-400/50 bg-yellow-50/10",
      )}
    >
      <MessageContent content={content} isStreaming={isStreaming} role={role} />
    </div>
  );
};

interface BubbleFooterProps {
  id: string;
  isUser: boolean;
  isStreaming?: boolean;
  isLoading: boolean;
  isEditing: boolean;
  isLast: boolean;
  error: boolean;
  warningLevel: boolean;
  canSpeak: boolean;
  isSpeaking: boolean;
  content: string;
  imageUrl?: string;
  nsfwBlur: boolean;
  onSpeak?: (messageId: string, text: string) => void;
  onStopSpeaking?: () => void;
  onRegenerate?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  onBookmark?: (messageId: string) => void;
  onBranch?: (messageId: string) => void;
  onShareMessage?: (messageId: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onPromoteMemory?: (messageId: string, content: string) => void;
  feedbackRating?: MessageFeedbackRating;
  onFeedback?: (messageId: string, rating: MessageFeedbackRating, reason?: string) => void;
  onStartEdit: () => void;
  hasEditHandler: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

const BubbleFooter = ({
  id,
  isUser,
  isStreaming,
  isLoading,
  isEditing,
  isLast,
  error,
  warningLevel,
  canSpeak,
  isSpeaking,
  content,
  imageUrl,
  nsfwBlur,
  onSpeak,
  onStopSpeaking,
  onRegenerate,
  onRetry,
  onBookmark,
  onBranch,
  onShareMessage,
  onDeleteMessage,
  onPromoteMemory,
  feedbackRating,
  onFeedback,
  onStartEdit,
  hasEditHandler,
  menuOpen,
  onMenuOpenChange,
}: BubbleFooterProps) => (
  <>
    {error && !isUser && !isEditing && (
      <ErrorIndicator messageId={id} isLoading={isLoading} onRetry={onRetry} />
    )}
    {warningLevel && !isUser && !isEditing && !error && isStreaming && <QualityWarningBadge />}

    {!isStreaming && !isEditing && !error && (
      <MessageActions
        id={id}
        isUser={isUser}
        isLoading={isLoading}
        isLast={isLast}
        warningLevel={warningLevel}
        canSpeak={canSpeak}
        isSpeaking={isSpeaking}
        content={content}
        onSpeak={onSpeak}
        onStopSpeaking={onStopSpeaking}
        onRegenerate={onRegenerate}
        onBookmark={onBookmark}
        onBranch={onBranch}
        onShareMessage={onShareMessage}
        onDeleteMessage={onDeleteMessage}
        onPromoteMemory={onPromoteMemory}
        feedbackRating={feedbackRating}
        onFeedback={onFeedback}
        onStartEdit={onStartEdit}
        hasEditHandler={hasEditHandler}
        menuOpen={menuOpen}
        onMenuOpenChange={onMenuOpenChange}
      />
    )}

    {imageUrl && <ImagePreview imageUrl={imageUrl} nsfwBlur={nsfwBlur} />}
  </>
);

const userBubbleStyle =
  "bg-gradient-user-bubble text-white rounded-tr-sm shadow-md shadow-black/20";
const assistantBubbleStyle =
  "bg-card/95 text-foreground rounded-tl-sm shadow-md shadow-black/20 ring-1 ring-border/70 backdrop-blur-md";

const UserMessageLabel = (): JSX.Element => (
  <span className="mt-2 shrink-0 select-none whitespace-nowrap rounded-full border border-border/40 bg-card/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
    あなた
  </span>
);

const getVisibleCharacterName = (name: string): string | null => {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName === "AI") return null;
  return trimmedName;
};

// デフォルト値をスプレッドで適用し、関数内のcyclomatic complexityを削減
const applyBubbleDefaults = (props: MessageBubbleProps) => ({
  isLoading: false,
  error: false,
  warningLevel: false,
  characterName: "AI",
  nsfwBlur: false,
  canSpeak: false,
  isSpeaking: false,
  isLast: false,
  showLabel: false,
  isAutoGeneratingImage: false,
  isHighlighted: false,
  ...props,
});

export const MessageBubble = memo((rawProps: MessageBubbleProps) => {
  const {
    id,
    role,
    content,
    imageUrl,
    isStreaming,
    isLoading,
    error,
    warningLevel,
    characterName,
    characterAvatar,
    nsfwBlur,
    canSpeak,
    isSpeaking,
    isLast,
    showLabel,
    isAutoGeneratingImage,
    isHighlighted,
    onSpeak,
    onStopSpeaking,
    onRegenerate,
    onEdit,
    onRetry,
    onBookmark,
    onBranch,
    onShareMessage,
    onDeleteMessage,
    onPromoteMemory,
    feedbackRating,
    onFeedback,
  } = applyBubbleDefaults(rawProps);

  const isUser = role === "user";
  const [isEditing, setIsEditing] = useState(false);
  const [showAvatarViewer, setShowAvatarViewer] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pressTimer, setPressTimer] = useState<number | null>(null);
  const bubbleStyle = isUser ? userBubbleStyle : assistantBubbleStyle;
  const startLongPress = useCallback(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => setMenuOpen(true), 500);
    setPressTimer(timer);
  }, [setMenuOpen]);
  const clearLongPress = useCallback(() => {
    if (!pressTimer) return;
    window.clearTimeout(pressTimer);
    setPressTimer(null);
  }, [pressTimer]);

  // 完全に空のメッセージ (背景タブ等で stream が空のまま終了 / 失敗) は bubble 全体を非表示
  // 画像生成中 (imageUrl 後で付く) は loading 残すので isLoading/isStreaming 中は表示維持
  const isStaleImageGenerationPlaceholder =
    !isStreaming &&
    !isLoading &&
    !imageUrl &&
    !error &&
    isImageGenerationPlaceholderContent(content);
  const isCompletelyEmpty =
    (!isStreaming && !isLoading && !imageUrl && !error && content.trim().length === 0) ||
    isStaleImageGenerationPlaceholder;
  const visibleCharacterName = isUser ? null : getVisibleCharacterName(characterName);
  const shouldShowMessageMeta =
    !isUser && ((showLabel && visibleCharacterName) || isAutoGeneratingImage);

  const handleEditSave = (newContent: string) => {
    setIsEditing(false);
    onEdit?.(id, newContent);
  };

  if (isCompletelyEmpty) {
    return null;
  }

  const messageContent = (
    <div
      className={cn(
        "flex max-w-[80%] items-start gap-2 space-y-2",
        isUser ? "max-md:max-w-[calc(100%-3.25rem)]" : "max-w-[75%] flex-col",
      )}
    >
      {isUser && <UserMessageLabel />}
      <div className={cn("min-w-0 space-y-2", isUser ? "text-left" : "w-full")}>
        <div
          onTouchStart={startLongPress}
          onTouchEnd={clearLongPress}
          onTouchCancel={clearLongPress}
        >
          {shouldShowMessageMeta && (
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {showLabel && visibleCharacterName ? (
                <p className="rounded-full bg-background/75 px-2 py-0.5 text-xs font-semibold text-foreground shadow-sm ring-1 ring-border/60 backdrop-blur-sm">
                  {visibleCharacterName}
                </p>
              ) : null}
              {isAutoGeneratingImage ? (
                <Badge variant="secondary" className="h-5 animate-pulse bg-primary/10 text-primary">
                  <Sparkles className="h-3 w-3" />
                  自動生成中
                </Badge>
              ) : null}
            </div>
          )}
          <BubbleBody
            id={id}
            role={role}
            content={content}
            isStreaming={isStreaming}
            isGeneratingImage={
              !isUser && !!isStreaming && isImageGenerationPlaceholderContent(content)
            }
            isHighlighted={isHighlighted}
            isEditing={isEditing}
            bubbleStyle={bubbleStyle}
            onSave={handleEditSave}
            onCancelEdit={() => setIsEditing(false)}
          />
        </div>

        <BubbleFooter
          id={id}
          isUser={isUser}
          isStreaming={isStreaming}
          isLoading={isLoading}
          isEditing={isEditing}
          isLast={isLast}
          error={error}
          warningLevel={warningLevel}
          canSpeak={canSpeak}
          isSpeaking={isSpeaking}
          content={content}
          imageUrl={imageUrl}
          nsfwBlur={nsfwBlur}
          onSpeak={onSpeak}
          onStopSpeaking={onStopSpeaking}
          onRegenerate={onRegenerate}
          onRetry={onRetry}
          onBookmark={onBookmark}
          onBranch={onBranch}
          onShareMessage={onShareMessage}
          onDeleteMessage={onDeleteMessage}
          onPromoteMemory={onPromoteMemory}
          feedbackRating={feedbackRating}
          onFeedback={onFeedback}
          onStartEdit={() => setIsEditing(true)}
          hasEditHandler={!!onEdit}
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
        />
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 group/message message-enter",
        isUser ? "justify-end pr-3" : "justify-start",
      )}
    >
      {!isUser && (
        <MessageAvatar
          isUser={isUser}
          characterName={characterName}
          avatarUrl={characterAvatar}
          onAvatarClick={() => setShowAvatarViewer(true)}
        />
      )}
      {messageContent}
      {isUser && (
        <MessageAvatar
          isUser={isUser}
          characterName={characterName}
          avatarUrl={characterAvatar}
          onAvatarClick={() => setShowAvatarViewer(true)}
        />
      )}

      {showAvatarViewer && resolveAvatarSrc(characterAvatar) ? (
        <AvatarViewer
          src={resolveAvatarSrc(characterAvatar) ?? ""}
          alt={characterName}
          onClose={() => setShowAvatarViewer(false)}
        />
      ) : null}
    </div>
  );
});

MessageBubble.displayName = "MessageBubble";
