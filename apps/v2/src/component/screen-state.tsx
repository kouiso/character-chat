// 画面まるごとの状態（板 HomeStates の「ほかの画面」と、タブのある画面の
// 失敗・空・見つからない）。文と形は WORDING.md の 1 つに揃える。
import { useEffect, useState } from "react";

import { useRouter } from "@tanstack/react-router";

import "./screen-state.css";

export const ArrowRightIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

export const RefreshIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 11a8 8 0 1 0-2.3 6.3" />
    <path d="M20 5v6h-6" />
  </svg>
);

export const AlertIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16v.5" />
  </svg>
);

export const ClockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const SearchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
);

export const LampIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 17h6" />
    <path d="M10 20h4" />
    <path d="M8.5 14a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2z" />
  </svg>
);

export const BackIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

// 板には「どのくらいで長引き扱いにするか」の指定が無い。返事待ち（15 秒）より
// 短い一覧・画面の読み込みの目安として、骨組みが出てから 5 秒で帯を足す。
export const SLOW_STATE_MS = 5000;

export const useSlowFlag = (ms: number = SLOW_STATE_MS) => {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return slow;
};

// 「ほかの画面」の頭。戻る 1 つだけ（題は読み込めた画面が出す）
export const ScreenBackHeader = () => {
  const router = useRouter();
  return (
    <header className="v2-back-header">
      <button type="button" aria-label="戻る" onClick={() => router.history.back()}>
        <BackIcon />
      </button>
    </header>
  );
};

type ScreenBandProps = {
  // status=長引き（副の色の時計）、alert=オフラインなど（失敗の色の札）
  kind: "status" | "alert";
  text: string;
  onRetry?: () => void;
  // タブのある画面では帯をタブのすぐ上に置く
  tab?: boolean;
};

export const ScreenBand = ({ kind, text, onRetry, tab }: ScreenBandProps) => (
  <div
    role={kind === "alert" ? "alert" : "status"}
    className={tab ? "v2-screen-band v2-screen-band--tab" : "v2-screen-band"}
  >
    <span
      className={
        kind === "alert"
          ? "v2-screen-band-icon v2-screen-band-icon--danger"
          : "v2-screen-band-icon v2-screen-band-icon--sub"
      }
    >
      {kind === "alert" ? <AlertIcon /> : <ClockIcon />}
    </span>
    <span className="v2-screen-band-text">{text}</span>
    {onRetry && (
      <button type="button" className="v2-screen-band-retry" onClick={onRetry}>
        もう一度
      </button>
    )}
  </div>
);

type ScreenBlockProps = {
  role: "alert" | "status";
  iconTone: "peach" | "danger" | "sub";
  icon: React.ReactNode;
  title: string;
  note?: string;
  // タブの無い「ほかの画面」では帯の分だけ持ち上げを浅くする
  inner?: boolean;
  children?: React.ReactNode;
};

export const ScreenBlock = ({
  role,
  iconTone,
  icon,
  title,
  note,
  inner,
  children,
}: ScreenBlockProps) => (
  <div role={role} className={inner ? "v2-screen-block v2-screen-block--inner" : "v2-screen-block"}>
    <span className={`v2-screen-badge v2-screen-badge--${iconTone}`} aria-hidden="true">
      {icon}
    </span>
    <h1>{title}</h1>
    {note && <div className="v2-screen-block-note">{note}</div>}
    {children}
  </div>
);

// 失敗・空・見つからないの次の一手（板は塗り＋図像）
export const RetryFillButton = ({ onRetry }: { onRetry: () => void }) => (
  <button type="button" className="v2-fill-btn" onClick={onRetry}>
    <RefreshIcon />
    <span>もう一度</span>
  </button>
);

type SkelProps = {
  width: number;
  height: number;
  hi?: boolean;
  circle?: boolean;
  pill?: boolean;
};

export const Skel = ({ width, height, hi, circle, pill }: SkelProps) => {
  const className = [
    "v2-skel",
    hi ? "v2-skel--hi" : "",
    circle ? "v2-skel--circle" : "",
    pill ? "v2-skel--pill" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return <span className={className} style={{ width, height }} aria-hidden="true" />;
};

export const SkeletonRow = ({ nameWidth, lineWidth }: { nameWidth: number; lineWidth: number }) => (
  <div className="v2-skel-row" aria-hidden="true">
    <Skel width={44} height={44} hi circle />
    <span className="v2-skel-row-body">
      <Skel width={nameWidth} height={12} hi />
      <Skel width={lineWidth} height={12} />
    </span>
  </div>
);
