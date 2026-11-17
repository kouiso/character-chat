// つくる系の画面（Create・Clips・Stories・Groups・Album 板）で共有する KIT 部品。
// 色・寸法は design-token.css の変数だけを参照する（make-screen.css）。
import { Link } from "@tanstack/react-router";

import { avatarUrl } from "../lib/avatar-url";

import "./make-screen.css";

type IconProps = { size?: number; width?: number; children: React.ReactNode };

// KIT 7: 線の SVG。線の太さは 1.75、矢印と「＋」「×」は 2
const LineIcon = ({ size = 18, width = 1.75, children }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const ChevronIcon = () => (
  <span className="v2-make-sub-icon">
    <LineIcon>
      <path d="M9 5l7 7-7 7" />
    </LineIcon>
  </span>
);

export const ArrowIcon = ({ size = 20 }: { size?: number }) => (
  <LineIcon size={size} width={2}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </LineIcon>
);

export const BackIcon = () => (
  <LineIcon size={20} width={2}>
    <path d="M15 5l-7 7 7 7" />
  </LineIcon>
);

export const PlusIcon = () => (
  <LineIcon size={20} width={2}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </LineIcon>
);

// 下からの帯に主ボタンを 1 つだけ置く（板 Clips・Stories・Groups の一覧）
export const BottomBar = ({ children }: { children: React.ReactNode }) => (
  <div className="v2-make-bottom-bar">{children}</div>
);

export const SubHeader = ({ title, back }: { title: string; back: "/create" }) => (
  <header className="v2-make-head">
    <Link to={back} aria-label="戻る" className="v2-make-icon-button">
      <BackIcon />
    </Link>
    <h1>{title}</h1>
  </header>
);

export const PencilIcon = () => (
  <LineIcon size={20}>
    <path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" />
    <path d="M14 7l3 3" />
  </LineIcon>
);

export const RetryIcon = () => (
  <LineIcon>
    <path d="M20 11a8 8 0 1 0-2.3 6.3" />
    <path d="M20 5v6h-6" />
  </LineIcon>
);

const LampIcon = () => (
  <LineIcon size={24}>
    <path d="M9 17h6" />
    <path d="M10 20h4" />
    <path d="M8.5 14a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2z" />
  </LineIcon>
);

const AlertIcon = () => (
  <LineIcon size={20}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16v.5" />
  </LineIcon>
);

// 頭文字の札の色は id から決め打ちにして、同じ子がいつも同じ色になるようにする
const initialTone = (id: string): number => {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 4) + 1;
};

export const Face = ({
  id,
  name,
  avatar,
}: {
  id: string;
  name: string;
  avatar: string | null | undefined;
}) => {
  const src = avatarUrl(id, avatar);
  return (
    <span className={`v2-make-face tone-${initialTone(id)}`} aria-hidden="true">
      {name.slice(0, 1)}
      {src && <img src={src} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />}
    </span>
  );
};

// タブの根の画面は題 22px（KIT 2）。戻るのある画面は 16px のまま
export const RootHeader = ({ title }: { title: string }) => (
  <header className="v2-make-head root">
    <h1>{title}</h1>
  </header>
);

export const SectionHead = ({
  title,
  level = 2,
  children,
}: {
  title: string;
  level?: 2 | 3;
  children?: React.ReactNode;
}) => {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={level === 2 ? "v2-make-section" : "v2-make-subsection"}>
      <Heading>{title}</Heading>
      {children}
    </div>
  );
};

export const EmptyState = ({
  title,
  text,
  children,
}: {
  title: string;
  text: React.ReactNode;
  children?: React.ReactNode;
}) => (
  <div className="v2-make-empty">
    <span className="v2-make-empty-lamp" aria-hidden="true">
      <LampIcon />
    </span>
    <div className="v2-make-empty-title">{title}</div>
    <div className="v2-make-empty-text">{text}</div>
    {children}
  </div>
);

export const ErrorCard = ({
  message,
  note,
  onRetry,
}: {
  message: string;
  note?: string;
  onRetry: () => void;
}) => (
  <div role="alert" className="v2-make-error">
    <div className="v2-make-error-head">
      <div className="v2-make-error-line">
        <span className="v2-make-error-icon">
          <AlertIcon />
        </span>
        <span>{message}</span>
      </div>
      {note && <div className="v2-make-error-note">{note}</div>}
    </div>
    <button type="button" className="v2-make-surface-button small" onClick={onRetry}>
      <RetryIcon />
      <span>もう一度</span>
    </button>
  </div>
);

export const SkeletonRows = ({ count = 3 }: { count?: number }) => (
  <div role="status" aria-label="読み込んでいます" className="v2-make-skeleton">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="v2-make-skeleton-row">
        <span className="v2-make-skeleton-face" />
        <span className="v2-make-skeleton-lines">
          <span className="hi" />
          <span className="lo" />
        </span>
      </div>
    ))}
  </div>
);

export const MoreLink = ({
  label,
  ariaLabel,
  to,
}: {
  label: string;
  ariaLabel: string;
  to: "/my" | "/stories" | "/clips" | "/groups";
}) => (
  <Link to={to} aria-label={ariaLabel} className="v2-make-quiet-link">
    <span>{label}</span>
    <ChevronIcon />
  </Link>
);

export const CheckIcon = ({ size = 18 }: { size?: number }) => (
  <LineIcon size={size} width={2}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </LineIcon>
);

const CloseIcon = () => (
  <LineIcon size={20} width={2}>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </LineIcon>
);

// 6.27 下からのシート。暗幕を押しても閉じる
export const Sheet = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) => (
  <div className="v2-make-scrim" onClick={onClose}>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="v2-make-sheet"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="v2-make-sheet-grabber" aria-hidden="true" />
      <div className="v2-make-sheet-head">
        <h2>{title}</h2>
        <button type="button" aria-label="閉じる" className="v2-make-icon-button" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {children}
    </div>
  </div>
);
