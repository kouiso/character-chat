// 設定（板 Settings）。返事の長さ・文体・持つ手・声の自動再生を、
// 押した瞬間に切り替える「押してすぐ効く設定」の画面。
// 保存に失敗した項目は選びを元に戻し、その項目の下に文＋「もう一度」を出す（WORDING 2'）。
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import type { ChatMode, ChatStyle, Handedness } from "../server/user-settings";

import "./settings-screen.css";

export type UserSettings = {
  chatMode: ChatMode;
  style: ChatStyle;
  voiceAutoplay: boolean;
  handedness: Handedness;
};

// 設定の項目。失敗の文は項目ごとに出すので、このキーで場所を決める。
type SettingKey = keyof UserSettings;

type SaveFailure = {
  key: SettingKey;
  // 「もう一度」で同じ書き込みをやり直す。
  retry: () => void;
  offline: boolean;
};

const MODE_OPTIONS: { value: ChatMode; label: string }[] = [
  { value: "quality", label: "たっぷり" },
  { value: "standard", label: "ふつう" },
  { value: "light", label: "短め" },
];

const STYLE_OPTIONS: { value: ChatStyle; label: string }[] = [
  { value: "balanced", label: "そのまま" },
  { value: "prose", label: "地の文重め" },
  { value: "dialogue", label: "会話重め" },
];

const HAND_OPTIONS: { value: Handedness; label: string }[] = [
  { value: "right", label: "右" },
  { value: "left", label: "左" },
];

const BackIcon = () => (
  <svg
    width="20"
    height="20"
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

const ChevronRight = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 5l7 7-7 7" />
  </svg>
);

const AlertIcon = () => (
  <svg
    width="16"
    height="16"
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

const RetryIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 11a8 8 0 1 0-2.3 6.3" />
    <path d="M20 5v6h-6" />
  </svg>
);

// /api/settings への 1 項目の書き込み。失敗（応答の失敗・圏外）は例外にせず成否で返す。
const putSetting = async (
  body: Partial<Record<SettingKey, unknown>>,
): Promise<{ ok: boolean; offline: boolean }> => {
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, offline: false };
  } catch {
    // 通信そのものの失敗。navigator.onLine で圏外かどうかを分ける。
    return { ok: false, offline: typeof navigator !== "undefined" && !navigator.onLine };
  }
};

// 失敗の文（板 Settings / WORDING 1'・2'）。オフラインの時だけ文が替わる。
const failureText = (failure: SaveFailure) =>
  failure.offline
    ? "オフラインです。前の設定のままです。"
    : "保存できませんでした。前の設定のままです。";

const FailureBlock = ({ failure }: { failure: SaveFailure }) => (
  <div className="v2-settings-failure" role="alert">
    <div className="v2-settings-failure-line">
      <span className="v2-settings-failure-icon">
        <AlertIcon />
      </span>
      <span>{failureText(failure)}</span>
    </div>
    <button type="button" className="v2-settings-retry" onClick={failure.retry}>
      <RetryIcon />
      <span>もう一度</span>
    </button>
  </div>
);

const SettingsHeader = () => (
  <header className="v2-settings-header">
    {/* 設定はマイからしか入れないので、戻る先は /my で固定する */}
    <Link to="/my" aria-label="戻る" className="v2-settings-icon-button">
      <BackIcon />
    </Link>
    <h1 className="v2-settings-title">設定</h1>
  </header>
);

export const SettingsScreen = ({ settings }: { settings: UserSettings }) => {
  // confirmed = 最後に読み込み・保存が確定した値。values = 画面に出している値（押すと先に変わる）。
  const [confirmed, setConfirmed] = useState<UserSettings>(settings);
  const [values, setValues] = useState<UserSettings>(settings);
  const [failures, setFailures] = useState<Partial<Record<SettingKey, SaveFailure>>>({});
  // 同じ項目に重ねて押された時、古い書き込みの失敗で新しい選択が巻き戻らんようにする通し番号。
  const writeSeq = useRef<Record<SettingKey, number>>({
    chatMode: 0,
    style: 0,
    handedness: 0,
    voiceAutoplay: 0,
  });
  const clearFailure = (key: SettingKey) => {
    setFailures((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  // 失敗した書き込みの「もう一度」が save 自身を呼ぶので、関数宣言（巻き上げ）にして
  // const の初期化中の自己参照を避けている。
  function save<K extends SettingKey>(key: K, value: UserSettings[K]) {
    const seq = ++writeSeq.current[key];
    setValues((previous) => ({ ...previous, [key]: value }));
    clearFailure(key);
    void (async () => {
      const result = await putSetting({ [key]: value });
      setConfirmed((previousConfirmed) => {
        if (result.ok) return { ...previousConfirmed, [key]: value };
        return previousConfirmed;
      });
      if (result.ok) return;
      // 失敗した書き込みより新しい選択がある時は、巻き戻しも失敗の表示もしない。
      if (writeSeq.current[key] !== seq) return;
      const previous = confirmed[key];
      setValues((current) => (current[key] === value ? { ...current, [key]: previous } : current));
      setFailures((current) => ({
        ...current,
        [key]: { key, offline: result.offline, retry: () => save(key, value) },
      }));
    })();
  }

  const segmented = <K extends "chatMode" | "style" | "handedness">(
    key: K,
    label: string,
    options: { value: UserSettings[K]; label: string }[],
  ) => (
    <div role="radiogroup" aria-label={label} className="v2-settings-segmented">
      {options.map((option) => {
        const selected = values[key] === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`v2-settings-choice${selected ? " is-selected" : ""}`}
            onClick={() => {
              if (!selected) save(key, option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="v2-settings-page">
      <SettingsHeader />
      <div className="v2-settings-body">
        <p className="v2-settings-note">変えると、次の返事から、どの子にも効きます。</p>
        <div className="v2-settings-gap-16" aria-hidden="true" />

        <section aria-label="返事の長さ" className="v2-settings-section">
          <h2 className="v2-settings-section-title">返事の長さ</h2>
          {segmented("chatMode", "返事の長さ", MODE_OPTIONS)}
          {failures.chatMode && <FailureBlock failure={failures.chatMode} />}
          <p className="v2-settings-note">たっぷりは少し待ちます。短めは早く届きます。</p>
        </section>
        <div className="v2-settings-gap-24" aria-hidden="true" />

        <section aria-label="文体" className="v2-settings-section">
          <h2 className="v2-settings-section-title">文体</h2>
          {segmented("style", "文体", STYLE_OPTIONS)}
          {failures.style && <FailureBlock failure={failures.style} />}
          <p className="v2-settings-note">地の文重めは描写を厚く、会話重めはセリフ中心に。</p>
        </section>
        <div className="v2-settings-gap-8" aria-hidden="true" />
        <p className="v2-settings-note">どちらも、会話に合わせて AI が変えることがあります。</p>
        <div className="v2-settings-gap-24" aria-hidden="true" />

        <section aria-label="持つ手" className="v2-settings-section">
          <h2 className="v2-settings-section-title">持つ手</h2>
          {segmented("handedness", "持つ手", HAND_OPTIONS)}
          {failures.handedness && <FailureBlock failure={failures.handedness} />}
          <p className="v2-settings-note">
            左にすると、トークの送信と「＋」の並びが
            <br />
            左右入れ替わります。
          </p>
        </section>
        <div className="v2-settings-gap-24" aria-hidden="true" />

        <div className="v2-settings-group">
          <div className="v2-settings-card">
            <button
              type="button"
              role="switch"
              aria-checked={values.voiceAutoplay}
              className="v2-settings-switch-row"
              onClick={() => save("voiceAutoplay", !values.voiceAutoplay)}
            >
              <span className="v2-settings-row-label">声を自動で再生</span>
              <span
                className={`v2-settings-switch-track${values.voiceAutoplay ? " is-on" : ""}`}
                aria-hidden="true"
              >
                <span className="v2-settings-switch-knob" />
              </span>
            </button>
          </div>
          {failures.voiceAutoplay && <FailureBlock failure={failures.voiceAutoplay} />}
          <p className="v2-settings-note">
            新しい返事を、届いたらすぐ読み上げます。
            <br />
            通話中は鳴りません。
          </p>
        </div>
        <div className="v2-settings-gap-24" aria-hidden="true" />

        <div className="v2-settings-card">
          {/* 行き先（AIがおぼえた好みの画面）はまだ無い。見た目だけ揃えて押せないまま置く */}
          <span className="v2-settings-nav-row" role="link" aria-disabled="true">
            <span className="v2-settings-row-label">AI がおぼえた好み</span>
            <span className="v2-settings-nav-chevron">
              <ChevronRight />
            </span>
          </span>
        </div>
        <div className="v2-settings-gap-32" aria-hidden="true" />
      </div>
    </div>
  );
};

// 読み込み中（板「読み込んでいる間（読めるまで押せない）」）。骨組みだけ、字は出さない。
export const SettingsLoadingState = () => (
  <div className="v2-settings-page">
    <SettingsHeader />
    <div className="v2-settings-skeleton" role="status" aria-label="読み込んでいます">
      <div className="v2-settings-skeleton-label-wrap">
        <span className="v2-settings-skeleton-label" style={{ width: 96 }} />
      </div>
      <span className="v2-settings-skeleton-pill" />
      <div className="v2-settings-skeleton-label-wrap is-next">
        <span className="v2-settings-skeleton-label" style={{ width: 56 }} />
      </div>
      <span className="v2-settings-skeleton-pill" />
      <div className="v2-settings-skeleton-label-wrap is-next">
        <span className="v2-settings-skeleton-label" style={{ width: 56 }} />
      </div>
      <span className="v2-settings-skeleton-pill" />
      <div className="v2-settings-gap-8" aria-hidden="true" />
      <span className="v2-settings-skeleton-card" />
      <span className="v2-settings-skeleton-card" />
    </div>
  </div>
);

// 読み込みの失敗（板「設定を読めなかった時」）。
export const SettingsErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <div className="v2-settings-page">
    <SettingsHeader />
    <div className="v2-settings-error-body">
      <div className="v2-settings-error-card">
        <div className="v2-settings-error-line">
          <span className="v2-settings-error-icon">
            <AlertIcon />
          </span>
          <span className="v2-settings-error-text">設定を読み込めませんでした。</span>
        </div>
        <button type="button" className="v2-settings-retry" onClick={onRetry}>
          <RetryIcon />
          <span>もう一度</span>
        </button>
      </div>
    </div>
  </div>
);
