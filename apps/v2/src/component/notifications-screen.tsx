// 通知の設定（板 Notifications）。通知の大元・届くもの・文の隠し方・
// 話しかけてくる子を、押した瞬間に切り替える画面。
// 大元の入切りはブラウザの通知許可が前提: 許可前は切のまま、拒否・未対応では
// 板の案内文を出す（はじめてオンにする前／止められている時／受け取れない時）。
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { subscribeToPush } from "../lib/push";
import { avatarUrl } from "../lib/avatar-url";

import "./notifications-screen.css";

export type NotifySettings = {
  enabled: boolean;
  proactive: boolean;
  feed: boolean;
  call: boolean;
  anniversary: boolean;
  hideText: boolean;
};

export type NotificationChild = {
  id: string;
  name: string;
  avatar: string | null;
  enabled: boolean;
};

// 失敗の文は項目ごとに出す。設定キーか `child:{id}` で場所を決める。
type SettingKey = keyof NotifySettings | `child:${string}`;

type SaveFailure = {
  key: SettingKey;
  retry: () => void;
  offline: boolean;
};

// 板の通知許可ゲート。環境は起動時に一度だけ見る。
type PermissionState = "default" | "granted" | "denied" | "unsupported";

const pushSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  typeof navigator.serviceWorker === "object" &&
  typeof globalThis.PushManager === "function" &&
  typeof Notification !== "undefined";

const detectPermission = (): PermissionState =>
  pushSupported() ? Notification.permission : "unsupported";

const CATEGORY_ROWS: { key: "proactive" | "feed" | "call" | "anniversary"; label: string }[] = [
  { key: "proactive", label: "話しかけ" },
  { key: "feed", label: "つぶやき・日記" },
  { key: "call", label: "電話の約束" },
  { key: "anniversary", label: "おぼえている日" },
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

const CloseIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);

// スイッチ行（設定画面と同じ面・つまみの形）。
const SwitchRow = ({
  label,
  on,
  ariaLabel,
  onToggle,
}: {
  label: string;
  on: boolean;
  ariaLabel?: string;
  onToggle: () => void;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={ariaLabel}
    className="v2-notify-switch-row"
    onClick={onToggle}
  >
    <span className="v2-notify-row-label">{label}</span>
    <span className={`v2-notify-switch-track${on ? " is-on" : ""}`} aria-hidden="true">
      <span className="v2-notify-switch-knob" />
    </span>
  </button>
);

const failureText = (failure: SaveFailure) =>
  failure.offline
    ? "オフラインです。前の設定のままです。"
    : "保存できませんでした。前の設定のままです。";

const FailureBlock = ({ failure }: { failure: SaveFailure }) => (
  <div className="v2-notify-failure" role="alert">
    <div className="v2-notify-failure-line">
      <span className="v2-notify-failure-icon">
        <AlertIcon />
      </span>
      <span>{failureText(failure)}</span>
    </div>
    <button type="button" className="v2-notify-retry" onClick={failure.retry}>
      <RetryIcon />
      <span>もう一度</span>
    </button>
  </div>
);

const NotificationsHeader = () => (
  <header className="v2-notify-header">
    {/* 通知の設定はマイからしか入れないので、戻る先は /my で固定する */}
    <Link to="/my" aria-label="戻る" className="v2-notify-icon-button">
      <BackIcon />
    </Link>
    <h1 className="v2-notify-title">通知の設定</h1>
  </header>
);

// 大元スイッチの下の案内。状態はブラウザの許可で決まる（板の3帯＋通常の注記）。
const GateNote = ({
  permission,
  onRetry,
  onHowTo,
}: {
  permission: PermissionState;
  onRetry: () => void;
  onHowTo: () => void;
}) => {
  if (permission === "granted")
    return <p className="v2-notify-note">下で選んだものだけが届きます。</p>;
  if (permission === "denied")
    return (
      <div className="v2-notify-gate">
        <p className="v2-notify-note">
          通知が止められています。
          <br />
          スマホの設定で許可すると、届きます。
        </p>
        <button type="button" className="v2-notify-retry" onClick={onRetry}>
          <RetryIcon />
          <span>もう一度</span>
        </button>
      </div>
    );
  if (permission === "unsupported")
    return (
      <div className="v2-notify-gate">
        <p className="v2-notify-note">ホーム画面に追加すると、受け取れます。</p>
        <button type="button" className="v2-notify-retry" onClick={onHowTo}>
          <span>追加のしかた</span>
        </button>
      </div>
    );
  return (
    <p className="v2-notify-note">
      オンにすると、スマホから許可を聞かれます。
      <br />
      それまで、通知も音も出ません。
    </p>
  );
};

// 「追加のしかた」のシート（板「追加のしかた」を押した時）。
const HowToSheet = ({ onClose }: { onClose: () => void }) => (
  <div className="v2-notify-sheet-overlay" onClick={onClose}>
    <div
      className="v2-notify-sheet"
      role="dialog"
      aria-label="ホーム画面に追加"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="v2-notify-sheet-grabber" />
      <div className="v2-notify-sheet-head">
        <h2>ホーム画面に追加</h2>
        <button
          type="button"
          className="v2-notify-icon-button"
          aria-label="閉じる"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <ol className="v2-notify-steps">
        <li>共有</li>
        <li>ホーム画面に追加</li>
        <li>燈をひらく</li>
      </ol>
      <p className="v2-notify-note">
        共有から「ホーム画面に追加」を選びます。
        <br />
        追加した燈から開くと、通知が届きます。
      </p>
    </div>
  </div>
);

// ロック画面の例。文を隠す時はアプリ名＋1 行だけ（push.ts の payload と同じ文）。
const LockPreview = ({ hideText, firstName }: { hideText: boolean; firstName?: string }) => (
  <div className="v2-notify-preview">
    <span className="v2-notify-preview-head">
      <span className="v2-notify-preview-app">{hideText ? "燈" : (firstName ?? "燈")}</span>
      <span className="v2-notify-preview-time">いま</span>
    </span>
    <span className="v2-notify-preview-body">
      {hideText ? "新しいメッセージがあります" : "「…起きてる？ 鍵、開けといた」"}
    </span>
  </div>
);

const putSetting = async (body: Record<string, unknown>) => {
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, offline: false };
  } catch {
    return { ok: false, offline: typeof navigator !== "undefined" && !navigator.onLine };
  }
};

const putChild = async (id: string, enabled: boolean) => {
  try {
    const res = await fetch(`/api/proactive/characters/${encodeURIComponent(id)}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    return { ok: res.ok, offline: false };
  } catch {
    return { ok: false, offline: typeof navigator !== "undefined" && !navigator.onLine };
  }
};

export const NotificationsScreen = ({
  settings,
  characters,
}: {
  settings: NotifySettings;
  characters: NotificationChild[];
}) => {
  const [values, setValues] = useState<NotifySettings>(settings);
  const [childValues, setChildValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(characters.map((child) => [child.id, child.enabled])),
  );
  const [failures, setFailures] = useState<Partial<Record<SettingKey, SaveFailure>>>({});
  // 許可状態はブラウザ側だけで分かる。SSR と初描画を揃えるため unsupported から始めて
  // 載ってから確かめる（hydration の不一致を避ける）。
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  useEffect(() => setPermission(detectPermission()), []);
  const [showHowTo, setShowHowTo] = useState(false);
  // values = 画面に出している値。confirmedRef = 最後に保存が確定した値（巻き戻し先）。
  // prop のオブジェクトをそのまま持つと確定書き込みで呼び出し側の値まで書き変わるので写す。
  const confirmedRef = useRef<NotifySettings>({ ...settings });
  const confirmedChildrenRef = useRef<Record<string, boolean>>(
    Object.fromEntries(characters.map((child) => [child.id, child.enabled])),
  );
  const writeSeq = useRef<Record<string, number>>({});
  // 同じ項目への PUT は直列にする（先の PUT が後から着くと、画面と保存値が食い違う）。
  const writeChain = useRef<Partial<Record<SettingKey, Promise<void>>>>({});

  const clearFailure = (key: SettingKey) => {
    setFailures((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const queue = (key: SettingKey, task: () => Promise<void>) => {
    const queued = writeChain.current[key] ?? Promise.resolve();
    writeChain.current[key] = queued.catch(() => {}).then(task);
  };

  const showFailure = (key: SettingKey, offline: boolean, retry: () => void) => {
    setFailures((current) => ({ ...current, [key]: { key, offline, retry } }));
  };

  // 失敗した書き込みの「もう一度」が save 自身を呼ぶので関数宣言にしている。
  function save<K extends keyof NotifySettings>(key: K, value: NotifySettings[K]) {
    const seqKey = `setting:${key}`;
    const seq = (writeSeq.current[seqKey] = (writeSeq.current[seqKey] ?? 0) + 1);
    setValues((previous) => ({ ...previous, [key]: value }));
    clearFailure(key);
    queue(key, async () => {
      const apiKey = `notify${key[0].toUpperCase()}${key.slice(1)}`;
      const result = await putSetting({ [apiKey]: value });
      if (result.ok) {
        confirmedRef.current[key] = value;
        return;
      }
      if (writeSeq.current[seqKey] !== seq) return;
      const previous = confirmedRef.current[key];
      setValues((current) => (current[key] === value ? { ...current, [key]: previous } : current));
      showFailure(key, result.offline, () => save(key, value));
    });
  }

  function saveChild(id: string, value: boolean) {
    const key: SettingKey = `child:${id}`;
    const seq = (writeSeq.current[key] = (writeSeq.current[key] ?? 0) + 1);
    setChildValues((previous) => ({ ...previous, [id]: value }));
    clearFailure(key);
    queue(key, async () => {
      const result = await putChild(id, value);
      if (result.ok) {
        confirmedChildrenRef.current[id] = value;
        return;
      }
      if (writeSeq.current[key] !== seq) return;
      const previous = confirmedChildrenRef.current[id] ?? false;
      setChildValues((current) =>
        current[id] === value ? { ...current, [id]: previous } : current,
      );
      showFailure(key, result.offline, () => saveChild(id, value));
    });
  }

  // 大元の入。許可が無いと入にできない（板: スイッチは許可まで切のまま）。
  async function enableMaster() {
    const result = await subscribeToPush();
    if (result === "subscribed" || result === "already") {
      setPermission("granted");
      if (!confirmedRef.current.enabled) save("enabled", true);
      return;
    }
    if (result === "denied") setPermission("denied");
    else setPermission("unsupported");
  }

  function toggleMaster() {
    if (masterOn) save("enabled", false);
    else void enableMaster();
  }

  const masterOn = values.enabled && permission === "granted";

  return (
    <div className="v2-notify-page">
      <NotificationsHeader />
      <div className="v2-notify-body">
        <div className="v2-notify-card">
          <SwitchRow label="通知を受け取る" on={masterOn} onToggle={toggleMaster} />
        </div>
        {failures.enabled && <FailureBlock failure={failures.enabled} />}
        {!masterOn && (
          <GateNote
            permission={permission}
            onRetry={() => void enableMaster()}
            onHowTo={() => setShowHowTo(true)}
          />
        )}
        {masterOn && (
          <>
            <p className="v2-notify-note">下で選んだものだけが届きます。</p>
            <div className="v2-notify-gap-16" aria-hidden="true" />

            <section aria-label="届くもの" className="v2-notify-section">
              <h2 className="v2-notify-section-title">届くもの</h2>
              <div className="v2-notify-card">
                {CATEGORY_ROWS.map((row) => (
                  <SwitchRow
                    key={row.key}
                    label={row.label}
                    on={values[row.key]}
                    onToggle={() => save(row.key, !values[row.key])}
                  />
                ))}
              </div>
              {CATEGORY_ROWS.map((row) =>
                failures[row.key] ? (
                  <FailureBlock key={row.key} failure={failures[row.key]!} />
                ) : null,
              )}
              <p className="v2-notify-note">
                通知を押すと、その会話や、つぶやき・日記・
                <br />
                電話・おぼえている日がひらきます。
              </p>
            </section>
            <div className="v2-notify-gap-24" aria-hidden="true" />

            <div className="v2-notify-group">
              <div className="v2-notify-card">
                <SwitchRow
                  label="通知の文を隠す"
                  on={values.hideText}
                  onToggle={() => save("hideText", !values.hideText)}
                />
              </div>
              {failures.hideText && <FailureBlock failure={failures.hideText} />}
              <p className="v2-notify-note">名前とセリフを出さず、1 行だけにします。</p>
            </div>
            <div className="v2-notify-gap-8" aria-hidden="true" />
            <p className="v2-notify-caption">ロック画面にはこう出ます</p>
            <LockPreview hideText={values.hideText} firstName={characters[0]?.name} />
            <div className="v2-notify-gap-24" aria-hidden="true" />

            <section aria-label="話しかけてくる子" className="v2-notify-section">
              <h2 className="v2-notify-section-title">話しかけてくる子</h2>
              {characters.length === 0 ? (
                <div className="v2-notify-card v2-notify-empty">
                  <p className="v2-notify-empty-title">まだ、話した子はいません</p>
                  <p className="v2-notify-empty-sub">話した子が、ここに並びます。</p>
                  <Link to="/catalog" className="v2-notify-empty-link">
                    出会うへ
                  </Link>
                </div>
              ) : (
                <div className="v2-notify-card">
                  {characters.map((child, index) => (
                    <div key={child.id} className="v2-notify-child-wrap">
                      <div className="v2-notify-child-row">
                        <span
                          className={`v2-notify-child-face plate-${(index % 4) + 1}`}
                          aria-hidden="true"
                        >
                          {!child.avatar && child.name.slice(0, 1)}
                          {child.avatar && (
                            <img
                              src={avatarUrl(child.id, child.avatar) ?? undefined}
                              alt=""
                              loading="lazy"
                              onError={(event) => event.currentTarget.remove()}
                            />
                          )}
                        </span>
                        <span className="v2-notify-child-name">{child.name}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-label={`${child.name}から話しかける`}
                          aria-checked={childValues[child.id] === true}
                          className="v2-notify-child-switch"
                          onClick={() => saveChild(child.id, childValues[child.id] !== true)}
                        >
                          <span
                            className={`v2-notify-switch-track${
                              childValues[child.id] === true ? " is-on" : ""
                            }`}
                            aria-hidden="true"
                          >
                            <span className="v2-notify-switch-knob" />
                          </span>
                        </button>
                      </div>
                      {failures[`child:${child.id}`] && (
                        <FailureBlock failure={failures[`child:${child.id}`]!} />
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="v2-notify-note">
                ここで切り替えられます。
                <br />
                回数や時刻は、その子との設定で変えます。
              </p>
            </section>
          </>
        )}
        <div className="v2-notify-gap-32" aria-hidden="true" />
      </div>
      {showHowTo && <HowToSheet onClose={() => setShowHowTo(false)} />}
    </div>
  );
};

// 読み込み中（板「読み込んでいる間」）。骨組みだけ、字は出さない。
export const NotificationsLoadingState = () => (
  <div className="v2-notify-page">
    <NotificationsHeader />
    <div className="v2-notify-skeleton" role="status" aria-label="読み込んでいます">
      <span className="v2-notify-skeleton-card" />
      <div className="v2-notify-skeleton-label-wrap">
        <span className="v2-notify-skeleton-label" style={{ width: 80 }} />
      </div>
      <span className="v2-notify-skeleton-card" />
      <span className="v2-notify-skeleton-card" />
      <div className="v2-notify-skeleton-label-wrap is-next">
        <span className="v2-notify-skeleton-label" style={{ width: 128 }} />
      </div>
      <span className="v2-notify-skeleton-card" />
    </div>
  </div>
);

// 読み込みの失敗（板「通知の設定を読み込めなかった時」）。
export const NotificationsErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <div className="v2-notify-page">
    <NotificationsHeader />
    <div className="v2-notify-error-body">
      <div className="v2-notify-error-card">
        <div className="v2-notify-error-line">
          <span className="v2-notify-error-icon">
            <AlertIcon />
          </span>
          <span className="v2-notify-error-text">通知の設定を読み込めませんでした。</span>
        </div>
        <button type="button" className="v2-notify-retry" onClick={onRetry}>
          <RetryIcon />
          <span>もう一度</span>
        </button>
      </div>
    </div>
  </div>
);
