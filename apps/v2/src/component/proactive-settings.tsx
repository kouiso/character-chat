import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  loadProactiveSettings,
  ProactiveRequestError,
  saveProactiveSettings,
} from "../lib/proactive-notification-client";
import { proactiveSettingsSchema } from "../lib/proactive-notification-contract";

import type {
  ProactiveSettings as Settings,
  ProactiveState,
} from "../lib/proactive-notification-contract";

import "./proactive-settings.css";

type Draft = {
  enabled: boolean;
  dailyLimit: string;
  idleMinutes: string;
  quiet: boolean;
  start: string;
  end: string;
};
const emptyDraft: Draft = {
  enabled: false,
  dailyLimit: "3",
  idleMinutes: "",
  quiet: false,
  start: "",
  end: "",
};
const formatMinute = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const draftOf = (settings: Settings): Draft => ({
  enabled: settings.enabled,
  dailyLimit: String(settings.dailyLimit),
  idleMinutes: String(settings.idleMinutes),
  quiet: settings.quietHours !== null,
  start: settings.quietHours ? formatMinute(settings.quietHours.startMinute) : "",
  end: settings.quietHours ? formatMinute(settings.quietHours.endMinute) : "",
});
const minuteOf = (text: string): number => {
  if (!/^\d{2}:\d{2}$/.test(text)) return NaN;
  const [hour, minute] = text.split(":").map(Number);
  return hour < 24 && minute < 60 ? hour * 60 + minute : NaN;
};
const integerOf = (text: string): number => (/^\d+$/.test(text) ? Number(text) : NaN);
const isMockMode = (state: ProactiveState | null): boolean => state?.deliveryMode === "mock-only";
const failureMessage = (failure: unknown): string =>
  failure instanceof ProactiveRequestError
    ? failure.message
    : "話しかけ設定を読み書きできません。接続を確認して再試行してください。";
const settingsOf = (draft: Draft) =>
  proactiveSettingsSchema.safeParse({
    enabled: draft.enabled,
    dailyLimit: integerOf(draft.dailyLimit),
    idleMinutes: integerOf(draft.idleMinutes),
    quietHours: draft.quiet
      ? { startMinute: minuteOf(draft.start), endMinute: minuteOf(draft.end) }
      : null,
  });
const dueText = (state: ProactiveState | null): string => {
  if (
    !state?.settings.enabled ||
    state.schedule?.dueAt === null ||
    state.schedule?.dueAt === undefined
  )
    return "次の予定はありません。";
  if (state.settings.dailyLimit === 0) return "1日上限が0通のため、通知は送られません。";
  return `次の予定（日本時間）: ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(state.schedule.dueAt)}`;
};

type SettingsFormProps = {
  id: string;
  draft: Draft;
  disabled: boolean;
  online: boolean;
  saving: boolean;
  canEnable: boolean;
  change(value: Partial<Draft>): void;
  submit(event: FormEvent): Promise<void>;
};
const SettingsForm = ({
  id,
  draft,
  disabled,
  online,
  saving,
  canEnable,
  change,
  submit,
}: SettingsFormProps) => (
  <form
    onSubmit={(event) => {
      void submit(event);
    }}
  >
    <fieldset disabled={disabled}>
      <label className="proactive-settings__toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={!canEnable && !draft.enabled}
          onChange={(event) => change({ enabled: event.target.checked })}
        />
        このキャラクターからの通知を受け取る
      </label>
      <label htmlFor={`${id}-limit`}>このキャラクターの1日上限（通）</label>
      <input
        id={`${id}-limit`}
        type="number"
        min="0"
        step="1"
        value={draft.dailyLimit}
        onChange={(event) => change({ dailyLimit: event.target.value })}
      />
      <label htmlFor={`${id}-idle`}>操作後に待つ時間（分）</label>
      <input
        id={`${id}-idle`}
        type="number"
        min="1"
        step="1"
        value={draft.idleMinutes}
        onChange={(event) => change({ idleMinutes: event.target.value })}
      />
      <label className="proactive-settings__toggle">
        <input
          type="checkbox"
          checked={draft.quiet}
          onChange={(event) => change({ quiet: event.target.checked })}
        />
        静穏時間を設定する（日本時間）
      </label>
      {draft.quiet && (
        <div className="proactive-settings__time">
          <label htmlFor={`${id}-start`}>
            開始（日本時間）
            <input
              id={`${id}-start`}
              type="time"
              value={draft.start}
              onChange={(event) => change({ start: event.target.value })}
            />
          </label>
          <label htmlFor={`${id}-end`}>
            終了（日本時間）
            <input
              id={`${id}-end`}
              type="time"
              value={draft.end}
              onChange={(event) => change({ end: event.target.value })}
            />
          </label>
        </div>
      )}
      <button type="submit" disabled={!online}>
        {saving ? "保存中です…" : "設定を保存"}
      </button>
    </fieldset>
  </form>
);

const SettingsNotice = ({
  loading,
  error,
  hasState,
  online,
  reload,
}: {
  loading: boolean;
  error: string | null;
  hasState: boolean;
  online: boolean;
  reload(): void;
}) => (
  <>
    {loading && <p role="status">話しかけ設定を読み込み中です。</p>}
    {error && <p role="alert">{error}</p>}
    {!hasState && !loading && (
      <button type="button" onClick={reload}>
        設定を再読み込み
      </button>
    )}
    {!online && (
      <p role="status">オフラインです。入力はこの画面に残ります。接続後に保存してください。</p>
    )}
  </>
);

const canSave = (
  saving: boolean,
  state: ProactiveState | null,
  characterId: string,
  online: boolean,
  pending: AbortController | null,
): boolean =>
  !saving &&
  state !== null &&
  state.characterId === characterId &&
  online &&
  (!pending || pending.signal.aborted);

export const ProactiveSettings = ({
  characterId,
  endpoint = `/api/proactive/${encodeURIComponent(characterId)}`,
}: {
  characterId: string;
  endpoint?: string;
}) => {
  const id = useId();
  const [state, setState] = useState<ProactiveState | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const saveAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    saveAbort.current?.abort();
    setState(null);
    setDraft(emptyDraft);
    setLoading(true);
    setSaving(false);
    setError(null);
    setSaved(false);
    void loadProactiveSettings(endpoint, characterId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setState(next);
        setDraft(draftOf(next.settings));
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      saveAbort.current?.abort();
    };
  }, [characterId, endpoint, reload]);

  const change = (value: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...value }));
    setSaved(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave(saving, state, characterId, online, saveAbort.current)) return;
    const parsed = settingsOf(draft);
    if (!parsed.success) {
      setError(
        "上限は0以上、待ち時間は1以上の整数にしてください。静穏時間は異なる開始・終了時刻が必要です。",
      );
      return;
    }
    const controller = new AbortController();
    saveAbort.current = controller;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveProactiveSettings(
        endpoint,
        characterId,
        parsed.data,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setState(next);
        setDraft(draftOf(next.settings));
        setSaved(true);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failureMessage(failure));
    } finally {
      if (saveAbort.current === controller) saveAbort.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  };
  const currentState = state?.characterId === characterId ? state : null;
  const disabled = loading || saving || !currentState;

  return (
    <section className="proactive-settings" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>このキャラクターからの話しかけ</h3>
      <p>通知は初期状態ではOFFです。静穏時間と1日の区切りには日本時間を使います。</p>
      <SettingsNotice
        loading={loading}
        error={error}
        hasState={currentState !== null}
        online={online}
        reload={() => setReload((value) => value + 1)}
      />
      <SettingsForm
        id={id}
        draft={currentState ? draft : emptyDraft}
        disabled={disabled}
        online={online}
        saving={saving}
        canEnable={isMockMode(currentState)}
        change={change}
        submit={submit}
      />
      {saved && <p role="status">設定を保存しました。</p>}
      {currentState && (
        <>
          <p>{dueText(currentState)}</p>
          <p>
            {currentState.deliveryMode === "mock-only"
              ? "この環境では通知を送信せず、予定の動作を確認できます。"
              : "通知の配信先は未設定です。この環境では通知を有効にできません。"}
          </p>
        </>
      )}
    </section>
  );
};
