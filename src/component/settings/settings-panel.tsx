import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { OU2 } from "@/component/ouse/ouse-tokens";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/component/ui/sheet";
import { useChatQuery } from "@/hook/use-chat-query";
import { useSpeechSynthesis } from "@/hook/use-speech-synthesis";
import { fetchCurrentUser, updateMyDisplayName, type MeResponse } from "@/lib/api";
import { pushPath } from "@/lib/navigation";
import { type ImageProvider, type ResponseLength, useSettingsStore } from "@/store/settings-store";
import { useUiStore } from "@/store/ui-store";

// 開発者向けの技術設定は通常ユーザーに見せない（D-8 は法務とログアウトのみ）。
// localStorage の隠しフラグでのみ露出させ、バージョン行の秘密操作で切り替える。
const DEV_MODE_KEY = "ou_dev";
const readDevMode = (): boolean => {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === "1";
  } catch {
    // プライベートモード等で localStorage が使えない場合は既定（非表示）に倒す
    return false;
  }
};

// 法務リンクは app-route.ts の LEGAL_ROUTES に対応するパスへ遷移させる。
const LEGAL_ROWS: ReadonlyArray<{ path: string; label: string }> = [
  { path: "/legal/tos", label: "利用規約" },
  { path: "/legal/privacy", label: "プライバシーポリシー" },
  { path: "/legal/tokushoho", label: "特定商取引法に基づく表示" },
] as const;

const RESPONSE_LENGTH_LABELS: ReadonlyArray<{ value: ResponseLength; label: string }> = [
  // チップ（chips-panel.tsx）と返信設定シートに表記を揃える。同じ設定が面ごとに
  // 「みじかめ／ながめ」「短め／長め」と違う名前で出とると、別物の設定に見える。
  { value: "short", label: "短め" },
  { value: "medium", label: "ふつう" },
  { value: "long", label: "長め" },
  { value: "very_long", label: "たっぷり" },
] as const;
const PHOTO_STYLE_LABELS: ReadonlyArray<{ value: ImageProvider; label: string }> = [
  { value: "auto", label: "カード" },
  { value: "novita", label: "画面ごと" },
] as const;
const VOICE_TONE_OPTIONS = [
  { label: "ささやくように", type: "female-calm" },
  { label: "おだやかに", type: "other" },
  { label: "凛と", type: "female-high" },
  { label: "あまく", type: "synthetic" },
] as const;
const TTS_RATE_OPTIONS = [
  { label: "ゆっくり", value: 0.8 },
  { label: "ふつう", value: 1 },
  { label: "すこし速く", value: 1.15 },
] as const;
const CALL_NAME_OPTIONS = ["けんちゃん", "健太さん", "あなた", "ご主人さま"] as const;

const getNextIndex = <T,>(items: readonly T[], currentIndex: number): number =>
  currentIndex >= 0 ? (currentIndex + 1) % items.length : 0;

const shellStyle: CSSProperties = {
  minHeight: "100dvh",
  background: `radial-gradient(120% 50% at 50% -6%, ${OU2.ink} 0%, ${OU2.night} 60%)`,
  color: OU2.text,
};
const scrollStyle: CSSProperties = {
  height: "calc(100dvh - 116px)",
  overflowY: "auto",
  padding: "0 22px calc(32px + env(safe-area-inset-bottom))",
};
const headStyle: CSSProperties = { padding: "42px 22px 26px" };
const groupLabelStyle: CSSProperties = {
  fontFamily: OU2.mono,
  fontSize: 8.5,
  letterSpacing: ".3em",
  color: OU2.ghost,
  marginBottom: 4,
};
const focusVisibleClassName =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--settings-focus)]";
const focusVisibleStyle = { "--settings-focus": OU2.lamp } as CSSProperties;
const unsetButtonStyle: CSSProperties = {
  ...focusVisibleStyle,
  all: "unset",
  display: "block",
  width: "100%",
  borderRadius: 18,
};

const titleStyle: CSSProperties = {
  fontFamily: OU2.serif,
  fontSize: 14.5,
  color: OU2.text,
  letterSpacing: ".06em",
};
const subStyle: CSSProperties = {
  fontFamily: OU2.round,
  fontSize: 10,
  color: OU2.faint,
  marginTop: 3,
  lineHeight: 1.6,
};

interface StRowProps {
  t: string;
  s?: string;
  right: JSX.Element;
  first?: boolean;
  onTap?: () => void;
}

const StRow = ({ t, s, right, first = false, onTap }: StRowProps): JSX.Element => (
  <div
    role={onTap ? "button" : undefined}
    tabIndex={onTap ? 0 : undefined}
    onClick={onTap}
    onKeyDown={(event) => {
      if (onTap && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onTap();
      }
    }}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "13px 2px",
      cursor: onTap ? "pointer" : "default",
      borderTop: first ? "none" : `1px solid ${OU2.hairline}`,
    }}
  >
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={titleStyle}>{t}</div>
      {s ? <div style={subStyle}>{s}</div> : null}
    </div>
    {right}
  </div>
);

const StGroup = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element => (
  <section style={{ marginBottom: 20 }}>
    <div style={groupLabelStyle}>{label}</div>
    {children}
  </section>
);

const Toggle = ({ value }: { value: boolean }): JSX.Element => (
  <span
    aria-hidden="true"
    style={{
      display: "block",
      width: 42,
      height: 24,
      borderRadius: 999,
      background: value ? OU2.lamp : OU2.hairline,
      position: "relative",
      boxShadow: value ? `0 0 20px ${OU2.lampDim}` : "none",
      transition: "background .2s ease",
    }}
  >
    <span
      style={{
        position: "absolute",
        top: 3,
        left: value ? 21 : 3,
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: OU2.text,
        transition: "left .2s ease",
      }}
    />
  </span>
);

const Segment = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}): JSX.Element => (
  <div style={{ display: "flex", gap: 14 }}>
    {options.map((option) => {
      const active = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onChange(option.value);
          }}
          aria-pressed={active}
          className={focusVisibleClassName}
          style={{
            ...focusVisibleStyle,
            border: 0,
            borderBottom: `1px solid ${active ? OU2.lamp : "transparent"}`,
            background: "transparent",
            color: active ? OU2.lamp : OU2.ghost,
            fontFamily: OU2.round,
            fontSize: 11,
            letterSpacing: ".12em",
            padding: "4px 0 3px",
            cursor: "pointer",
          }}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

const CycleValue = ({ label }: { label: string }): JSX.Element => (
  <span
    style={{
      color: OU2.lamp,
      fontFamily: OU2.serif,
      fontSize: 13,
      letterSpacing: ".04em",
      whiteSpace: "nowrap",
    }}
  >
    {label} ›
  </span>
);

// D-8 最小構成のカード（角丸・ヘアライン・veil 背景）。法務／ログアウトで共用する。
const minimalCardStyle: CSSProperties = {
  borderRadius: 18,
  border: `1px solid ${OU2.hairline}`,
  background: OU2.veil,
  padding: "4px 16px",
};
const minimalGroupLabelStyle: CSSProperties = {
  fontFamily: OU2.round,
  fontSize: 11,
  letterSpacing: ".2em",
  color: OU2.lamp,
  marginBottom: 10,
};
const versionStyle: CSSProperties = {
  textAlign: "center",
  fontFamily: OU2.round,
  fontSize: 10.5,
  letterSpacing: ".18em",
  color: OU2.ghost,
  marginTop: 26,
  // 秘密操作の存在を悟らせないため、見た目は完全に無反応のテキストに留める
  background: "transparent",
  border: 0,
  width: "100%",
  cursor: "default",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const MinimalRow = ({
  label,
  muted = false,
  last = false,
  onTap,
}: {
  label: string;
  muted?: boolean;
  last?: boolean;
  onTap: () => void;
}): JSX.Element => (
  <button
    type="button"
    onClick={onTap}
    className={focusVisibleClassName}
    style={{
      ...focusVisibleStyle,
      all: "unset",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
      boxSizing: "border-box",
      padding: "14px 0",
      cursor: "pointer",
      borderBottom: last ? "none" : `1px solid ${OU2.hairline}`,
    }}
  >
    <span style={{ fontFamily: OU2.round, fontSize: 12.5, color: muted ? OU2.faint : OU2.dim }}>
      {label}
    </span>
    <span style={{ fontSize: 11.5, color: OU2.ghost }}>›</span>
  </button>
);

const getVoiceToneLabel = (
  categorizedVoices: ReturnType<typeof useSpeechSynthesis>["categorizedVoices"],
  ttsVoiceUri: string,
): string =>
  VOICE_TONE_OPTIONS.find((option) => {
    const voice = categorizedVoices.find((v) => v.type === option.type);
    return voice?.voice.voiceURI === ttsVoiceUri;
  })?.label ?? VOICE_TONE_OPTIONS[1].label;

// #1224/#1228: アカウント単位の表示名（呼ばれ方）。サーバーの値が届いたら1回だけ同期する。
// レンダー中にstateを合わせる公式パターン(useEffect無し)で、届いた後のユーザー編集を上書きしない。
// SettingsPanel本体から切り出して複雑度を抑える。テストから直接呼べるようexportする。
// 表示名の上限はサーバ側 zod の .max(24) と揃える必要がある。zod は JS の string.length、
// つまり UTF-16 単位で数えるため、コードポイント単位で24へ切ると絵文字を含む値が
// 25単位になってサーバに400で弾かれる。一方 String.slice(0,24) は UTF-16 単位で切るので
// サロゲートペアを割り、壊れた文字を入力欄とPATCHへ残す（敵対レビュー・18巡目）。
// 24単位を超えず、かつペアを割らんところで止める。
const truncateForDisplayName = (value: string, maxUnits: number): string => {
  let result = "";
  for (const char of value) {
    if (result.length + char.length > maxUnits) break;
    result += char;
  }
  return result;
};

export const useAccountDisplayNameField = (
  me: MeResponse | undefined,
  queryClient: ReturnType<typeof useQueryClient>,
) => {
  const [displayNameInput, setDisplayNameInputState] = useState("");
  const [syncedMe, setSyncedMe] = useState<MeResponse | undefined>(undefined);
  // /api/me がまだ読み込み中でも入力欄は操作できる。初回同期が「一度もsyncしてない」
  // だけを見て無条件に上書きすると、読み込み中に打ち始めた編集が初回応答到着で
  // 消し飛ぶ（敵対レビュー #1236 指摘4巡目）。ユーザーが一度でも編集したら以降の
  // 初回同期はスキップする。render中に参照するためrefではなくstateで持つ
  // （react-hooks/refs: refはrender中に読まない）。
  const [hasEdited, setHasEdited] = useState(false);
  // 初回だけ me から同期する。me !== syncedMe（参照比較）で毎回同期し直すと、
  // このフック自身の onSuccess が queryClient.setQueryData で書き込んだだけの
  // （サーバから新しく取得したわけではない）キャッシュ更新でも me の参照が変わり、
  // まだ保存してない入力中の編集を巻き戻してしまう（敵対レビュー #1236 指摘）。
  // 以降の更新はユーザーの入力か、この下の onSuccess の明示的な同期だけに任せる。
  if (me !== undefined && syncedMe === undefined) {
    setSyncedMe(me);
    if (!hasEdited) setDisplayNameInputState(me.displayName ?? "");
  }
  const setDisplayNameInput = (value: string): void => {
    setHasEdited(true);
    setDisplayNameInputState(value);
  };
  // 連続blurで複数リクエストが飛ぶと、レスポンスは送信順どおりに届くとは限らない。
  // 「一番最後に送った値」だけをここへ記録し、それと違う submittedValue の応答は
  // 入力欄・キャッシュのどちらも触らせない（Codex 敵対レビュー #1236 指摘: 旧実装は
  // displayNameInput の現在値とだけ比較しとって、古い応答が後から届くとキャッシュだけは
  // 無条件で上書きしてしまう窓があった）。
  const latestSubmittedRef = useRef<string | null>(null);
  // A→B→Aのように値を戻して連続送信すると、3回目の送信が1回目と同じ文字列を
  // latestSubmittedRefへ書く。文字列だけで「これは最新の送信か」を判定すると、
  // 1回目の失敗が3回目（実際は最新でキュー待ち中）の失敗と取り違えられ、まだキューに
  // 残っているB・Aの送信を守るためのrefを誤って巻き戻してしまう（敵対レビュー #1236
  // 指摘・9巡目）。値ではなく送信ごとに振るIDで最新かどうかを判定する。
  const latestRequestIdRef = useRef(0);
  const requestIdCounterRef = useRef(0);
  const saveDisplayNameMutation = useMutation({
    mutationFn: (vars: { value: string; requestId: number }) => updateMyDisplayName(vars.value),
    onSuccess: async (saved, vars) => {
      if (vars.requestId !== latestRequestIdRef.current) return;
      if (displayNameInput === vars.value) setDisplayNameInput(saved ?? "");
      // 敵対レビュー #1236 指摘・11巡目: 画面を開いた直後の初回 useQuery(["me"]) がまだ
      // in-flight のまま保存が先に成功すると、setQueryData は進行中のfetchをキャンセル
      // しないため、後から届く初回取得（保存前の古い値）がこのキャッシュ書き込みを
      // 上書きしてしまう。書き込み前に進行中の["me"]取得を先にキャンセルして、その
      // 上書き経路そのものを断つ。加えて、初回取得がまだ一度も完了しておらずキャッシュに
      // 元データが無い場合は displayName だけの部分オブジェクトを捏造せず、
      // アクティブな購読（実際の画面）がある時だけ取り直して正しい値へ揃える
      // （購読の無い単体テストでは何もしない）。
      await queryClient.cancelQueries({ queryKey: ["me"] });
      const hadCachedMe = queryClient.getQueryData(["me"]) !== undefined;
      queryClient.setQueryData(["me"], (prev: MeResponse | undefined) =>
        prev ? { ...prev, displayName: saved } : prev,
      );
      if (!hadCachedMe) {
        void queryClient.refetchQueries({ queryKey: ["me"] });
      }
      toast.success(saved ? `「${saved}」と呼ぶようにするね` : "表示名を未設定にもどしました");
    },
    onError: (_error, vars) => {
      toast.error("表示名を保存できませんでした");
      // commitDisplayNameのbaseline判定はlatestSubmittedRefを優先して見るため、失敗した値を
      // 残したままにすると、同じ値へ戻して再blurした「リトライ」が「変更なし」と誤認されて
      // 送信自体がスキップされる（敵対レビュー #1236 指摘・7巡目）。この失敗が最新の送信で
      // あった時だけ（＝送信順が入れ替わっとらん時だけ）基準をme.displayNameへ戻す。
      if (vars.requestId === latestRequestIdRef.current) {
        latestSubmittedRef.current = null;
      }
    },
  });
  // クライアント側での応答の握り潰しだけでは、Aの保存リクエスト自体はBより後にサーバへ
  // 届いて先にD1へ書き込まれてしまう余地が残る（敵対レビュー #1236 指摘: リロードすると
  // 古い値に戻る）。1件ずつ完了を待ってから次を送ることで、サーバへの到達順を送信順と
  // 一致させ、この種の書き込み競合そのものを起こさせない。
  const pendingChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveDisplayName = (value: string): void => {
    latestSubmittedRef.current = value;
    const requestId = (requestIdCounterRef.current += 1);
    latestRequestIdRef.current = requestId;
    pendingChainRef.current = pendingChainRef.current
      .then(() => saveDisplayNameMutation.mutateAsync({ value, requestId }))
      .then(() => undefined)
      .catch(async () => {
        // 連続blur A→Bで、Aが失敗した直後にBが成功すると、Aの再取得（invalidateQueries）が
        // 未awaitのまま並行して走り、Bのonsuccessが書いたキャッシュより後に古い値で
        // 上書きしてしまう競合があった（敵対レビュー #1236 指摘・8巡目）。この再取得を
        // チェーンの一部として待つことで、次の送信（B）が始まる前に必ず完了させる。
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      });
  };
  // #1224/#1228: blur時の「変更なしなら送らない」判定は me.displayName とだけ比べると、
  // 保存中Aの応答がまだ届いてへん間に元の値へ戻してblurした時、真の最新状態（送信中のA）
  // やのうて古いme.displayNameと一致してしまい送信自体をスキップする（敵対レビュー #1236
  // 指摘・6巡目）。Aは後で成功してキャッシュへ書き込まれるため、ユーザーが最後に見せた
  // 「元に戻す」編集がサーバーへ送られずキャッシュ・D1側とだけ乖離する。送信中の値がある間は
  // それを基準にし、無ければme.displayNameを基準にする。
  const commitDisplayName = (value: string): void => {
    const baseline = latestSubmittedRef.current ?? me?.displayName ?? "";
    if (value.trim() === baseline) return;
    saveDisplayName(value);
  };
  return { displayNameInput, setDisplayNameInput, saveDisplayName, commitDisplayName };
};

export const SettingsPanel = (): JSX.Element => {
  const isSettingsOpen = useUiStore((s) => s.isSettingsOpen);
  const openSettings = useUiStore((s) => s.openSettings);
  const closeSettings = useUiStore((s) => s.closeSettings);
  const state = useSettingsStore(
    useShallow((s) => ({
      nsfwBlur: s.nsfwBlur,
      autoGenerateImages: s.autoGenerateImages,
      autoExtractMemories: s.autoExtractMemories,
      ttsEnabled: s.ttsEnabled,
      ttsVoiceUri: s.ttsVoiceUri,
      ttsRate: s.ttsRate,
      userProfile: s.userProfile,
      userRole: s.userRole,
      responseLength: s.responseLength,
      imageProvider: s.imageProvider,
      toggleNsfwBlur: s.toggleNsfwBlur,
      setResponseLength: s.setResponseLength,
      toggleAutoGenerateImages: s.toggleAutoGenerateImages,
      toggleAutoExtractMemories: s.toggleAutoExtractMemories,
      toggleTts: s.toggleTts,
      setTtsVoiceUri: s.setTtsVoiceUri,
      setTtsRate: s.setTtsRate,
      setUserProfile: s.setUserProfile,
      setUserRole: s.setUserRole,
      setImageProvider: s.setImageProvider,
    })),
  );
  const { categorizedVoices, isSupported: isSpeechSynthesisSupported } = useSpeechSynthesis(
    state.ttsVoiceUri,
    state.ttsRate,
    1,
  );

  const voiceToneLabel = getVoiceToneLabel(categorizedVoices, state.ttsVoiceUri);
  // Older builds persisted rates (e.g. 0.7/0.9/1.1/1.3) that no longer exist in
  // TTS_RATE_OPTIONS. Snap to the closest current option instead of an exact-match
  // lookup so legacy values still show (and cycle from) a sensible label.
  const closestTtsRateIndex = TTS_RATE_OPTIONS.reduce(
    (closestIndex, option, index) =>
      Math.abs(option.value - state.ttsRate) <
      Math.abs(TTS_RATE_OPTIONS[closestIndex].value - state.ttsRate)
        ? index
        : closestIndex,
    0,
  );
  const voiceRateLabel = TTS_RATE_OPTIONS[closestTtsRateIndex].label;
  const trimmedUserRole = state.userRole.trim();
  const callName = trimmedUserRole.length > 0 ? state.userRole : CALL_NAME_OPTIONS[2];

  const nextVoiceTone = useCallback(() => {
    const currentIndex = VOICE_TONE_OPTIONS.findIndex((option) => option.label === voiceToneLabel);
    const nextOption = VOICE_TONE_OPTIONS[getNextIndex(VOICE_TONE_OPTIONS, currentIndex)];
    const voice = categorizedVoices.find((v) => v.type === nextOption.type);
    state.setTtsVoiceUri(voice?.voice.voiceURI ?? "");
  }, [categorizedVoices, state, voiceToneLabel]);

  // 設定画面は特定の会話を開いてへん。
  const { deleteAllConversationsEntry } = useChatQuery(null);
  // 全消しは戻せんので、行の中で二段にして「やめる」を必ず残す。
  const [historyDeleteConfirming, setHistoryDeleteConfirming] = useState(false);

  const handleDeleteAllHistory = (): void => {
    setHistoryDeleteConfirming(false);
    void deleteAllConversationsEntry()
      .then(() => toast.success("履歴をすべて消しました"))
      .catch(() => toast.error("履歴を消せませんでした"));
  };

  const handleReset = (): void => {
    useSettingsStore.persist.clearStorage();
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    toast.success("しつらえを、はじめの形にもどしました");
  };

  // 技術設定の表示可否。既定は非表示で、バージョン行の秘密操作でのみ切り替わる。
  const [devMode, setDevMode] = useState(readDevMode);
  const toggleDevMode = useCallback(() => {
    setDevMode((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(DEV_MODE_KEY, "1");
        else localStorage.removeItem(DEV_MODE_KEY);
      } catch {
        // 保存できなくても当該セッションの表示状態は切り替える
      }
      return next;
    });
  }, []);

  // 隠しエスケープハッチ：バージョン行の 5 連タップ、または長押しで dev を切り替える。
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);
  const longPressRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
      if (longPressRef.current) window.clearTimeout(longPressRef.current);
    },
    [],
  );
  const handleVersionTap = useCallback(() => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => {
      tapCountRef.current = 0;
    }, 1200);
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      toggleDevMode();
    }
  }, [toggleDevMode]);
  const startLongPress = useCallback(() => {
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      toggleDevMode();
    }, 700);
  }, [toggleDevMode]);
  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  // ログアウトは UserMenu と同じ挙動（CF Access のログアウト URL へ遷移。ローカルは不可）。
  const queryClient = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000,
  });

  const displayNameInputRef = useRef<HTMLInputElement>(null);
  const { displayNameInput, setDisplayNameInput, commitDisplayName } = useAccountDisplayNameField(
    me,
    queryClient,
  );
  const commitDisplayNameFromDom = (): void => {
    const value = displayNameInputRef.current?.value ?? displayNameInput;
    setDisplayNameInput(value);
    commitDisplayName(value);
  };
  const handleLogout = useCallback(() => {
    if (me?.logoutUrl) {
      window.location.href = me.logoutUrl;
      return;
    }
    toast.info(me?.isLocal ? "ローカル開発中はログアウト不可" : "ログアウトURLが未設定です");
  }, [me]);

  // 法務ルートは History API 遷移で app 側の route 同期を発火させ、シートは閉じる。
  const navigateLegal = useCallback(
    (path: string) => {
      closeSettings();
      pushPath(path);
    },
    [closeSettings],
  );

  return (
    <Sheet
      open={isSettingsOpen}
      onOpenChange={(o) => {
        if (o) {
          openSettings();
          return;
        }
        // Escape やオーバーレイで閉じると入力欄に focus が残ったまま消えるため blur が
        // 飛ばず、commitDisplayName が走らんまま入力が失われる（敵対レビュー・18巡目）。
        // 加えて、直前の onChange バッチが未コミットの場合、state からだと空値を送る恐れがある。
        // DOM から最新の入力値を読んでから state 同期と保存を行う。
        commitDisplayNameFromDom();
        closeSettings();
      }}
    >
      <SheetContent
        side="right"
        className="w-screen max-w-none border-l-0 p-0 sm:max-w-none"
        style={shellStyle}
      >
        <SheetHeader style={headStyle}>
          <SheetTitle
            style={{
              margin: 0,
              color: OU2.text,
              fontFamily: OU2.serif,
              fontSize: 20,
              letterSpacing: ".12em",
            }}
          >
            設定
          </SheetTitle>
        </SheetHeader>
        <div style={scrollStyle}>
          {/* D-8：通常ユーザーには法務とログアウトのみ。技術設定は dev でのみ露出する。 */}
          <section style={{ marginBottom: 20 }}>
            <div style={minimalGroupLabelStyle}>法的文章</div>
            <div style={minimalCardStyle}>
              {LEGAL_ROWS.map((row, index) => (
                <MinimalRow
                  key={row.path}
                  label={row.label}
                  last={index === LEGAL_ROWS.length - 1}
                  onTap={() => navigateLegal(row.path)}
                />
              ))}
            </div>
          </section>

          <div style={{ ...minimalCardStyle, marginBottom: 20 }}>
            <MinimalRow label="ログアウト" muted last onTap={handleLogout} />
          </div>

          {/* #1224: アカウント単位の呼ばれ方は dev 限定にせず常に露出する。
              キャラ個別の呼び方(userRole)や写真/動画等の技術設定とは独立した設定なので、
              下の devMode ブロックには入れない。 */}
          <StGroup label="あなたのこと">
            <div style={{ padding: "14px 2px" }}>
              <label htmlFor="user-display-name" style={titleStyle}>
                あなたの名前
              </label>
              <p style={subStyle}>キャラごとに呼び方を決めてなければ、ここの名前で呼ばれる</p>
              <input
                ref={displayNameInputRef}
                id="user-display-name"
                type="text"
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(truncateForDisplayName(e.target.value, 24))}
                onBlur={() => commitDisplayNameFromDom()}
                maxLength={24}
                placeholder="たとえば — コウスケ"
                style={{
                  width: "100%",
                  marginTop: 10,
                  border: `1px solid ${OU2.hairline}`,
                  borderRadius: 14,
                  background: OU2.veil,
                  color: OU2.text,
                  fontFamily: OU2.round,
                  fontSize: 13,
                  padding: "11px 14px",
                }}
              />
            </div>
          </StGroup>

          {devMode ? (
            <>
              <StGroup label="写真">
                <button
                  type="button"
                  onClick={state.toggleAutoGenerateImages}
                  aria-pressed={state.autoGenerateImages}
                  className={focusVisibleClassName}
                  style={unsetButtonStyle}
                >
                  <StRow
                    first
                    t="写真が、ひとりでにとどく"
                    s="夜の流れにあわせて、彼女のほうから"
                    right={<Toggle value={state.autoGenerateImages} />}
                  />
                </button>
                <StRow
                  t="とどきかた"
                  s="ふだんはカードで。ひらくと画面いっぱいに"
                  right={
                    <Segment
                      value={state.imageProvider}
                      options={PHOTO_STYLE_LABELS}
                      onChange={state.setImageProvider}
                    />
                  }
                />
                <button
                  type="button"
                  onClick={state.toggleNsfwBlur}
                  aria-pressed={state.nsfwBlur}
                  className={focusVisibleClassName}
                  style={unsetButtonStyle}
                >
                  <StRow
                    t="紗をかける"
                    s="人のいる場所では、写真をそっとぼかす"
                    right={<Toggle value={state.nsfwBlur} />}
                  />
                </button>
              </StGroup>

              <StGroup label="ことばと声">
                <StRow
                  first
                  t="ことばの量"
                  s="ひと晩の語りの、ふくらみかた"
                  right={
                    <Segment
                      value={state.responseLength}
                      options={RESPONSE_LENGTH_LABELS}
                      onChange={state.setResponseLength}
                    />
                  }
                />
                {isSpeechSynthesisSupported ? (
                  <button
                    type="button"
                    onClick={state.toggleTts}
                    aria-pressed={state.ttsEnabled}
                    className={focusVisibleClassName}
                    style={unsetButtonStyle}
                  >
                    <StRow
                      t="声で、よみあげる"
                      s="セリフだけを、彼女の声で"
                      right={<Toggle value={state.ttsEnabled} />}
                    />
                  </button>
                ) : null}
                {isSpeechSynthesisSupported && state.ttsEnabled ? (
                  <>
                    <StRow
                      t="声のかんじ"
                      right={<CycleValue label={voiceToneLabel} />}
                      onTap={nextVoiceTone}
                    />
                    <StRow
                      t="声のはやさ"
                      right={<CycleValue label={voiceRateLabel} />}
                      onTap={() => {
                        state.setTtsRate(
                          TTS_RATE_OPTIONS[getNextIndex(TTS_RATE_OPTIONS, closestTtsRateIndex)]
                            .value,
                        );
                      }}
                    />
                  </>
                ) : null}
              </StGroup>

              <StGroup label="呼ばれかた・記憶">
                <StRow
                  first
                  t="呼ばれかた"
                  s="彼女があなたを呼ぶときの名前"
                  right={<CycleValue label={callName} />}
                  onTap={() => {
                    const currentIndex = CALL_NAME_OPTIONS.findIndex(
                      (option) => option === callName,
                    );
                    state.setUserRole(
                      CALL_NAME_OPTIONS[getNextIndex(CALL_NAME_OPTIONS, currentIndex)],
                    );
                  }}
                />
                <button
                  type="button"
                  onClick={state.toggleAutoExtractMemories}
                  aria-pressed={state.autoExtractMemories}
                  className={focusVisibleClassName}
                  style={unsetButtonStyle}
                >
                  <StRow
                    t="彼女がじぶんで覚える"
                    s="会話のなかの大事なことを、そっと書きとめる"
                    right={<Toggle value={state.autoExtractMemories} />}
                  />
                </button>
                <div style={{ borderTop: `1px solid ${OU2.hairline}`, padding: "14px 2px 0" }}>
                  <label htmlFor="user-profile" style={titleStyle}>
                    彼女たちに、伝えておくこと
                  </label>
                  <p style={subStyle}>好みや、してほしいこと。誰と話すときも、心得てくれる</p>
                  <textarea
                    id="user-profile"
                    value={state.userProfile}
                    onChange={(e) => state.setUserProfile(e.target.value)}
                    maxLength={2000}
                    rows={5}
                    placeholder="たとえば — 名前は呼び捨てがいい。甘やかされるのに弱い…"
                    style={{
                      width: "100%",
                      marginTop: 10,
                      border: `1px solid ${OU2.hairline}`,
                      borderRadius: 18,
                      background: OU2.veil,
                      color: OU2.text,
                      fontFamily: OU2.round,
                      fontSize: 12,
                      lineHeight: 1.7,
                      padding: "13px 14px",
                      resize: "vertical",
                    }}
                  />
                </div>
              </StGroup>

              <StGroup label="履歴">
                {historyDeleteConfirming ? (
                  <StRow
                    first
                    t="ほんまに、すべて消す？"
                    s="この操作は戻せません"
                    right={
                      <span style={{ display: "flex", gap: 12 }}>
                        <button
                          type="button"
                          onClick={handleDeleteAllHistory}
                          className={focusVisibleClassName}
                          style={{ ...unsetButtonStyle, ...focusVisibleStyle, color: OU2.lamp }}
                        >
                          消す
                        </button>
                        <button
                          type="button"
                          onClick={() => setHistoryDeleteConfirming(false)}
                          className={focusVisibleClassName}
                          style={{ ...unsetButtonStyle, ...focusVisibleStyle, color: OU2.faint }}
                        >
                          やめる
                        </button>
                      </span>
                    }
                  />
                ) : (
                  <StRow
                    first
                    t="履歴をすべて消す"
                    s="これまでの会話が、ぜんぶ消えます"
                    right={<span style={{ color: OU2.faint, fontSize: 16 }}>›</span>}
                    onTap={() => setHistoryDeleteConfirming(true)}
                  />
                )}
              </StGroup>

              <button
                type="button"
                onClick={handleReset}
                className={focusVisibleClassName}
                style={{
                  ...focusVisibleStyle,
                  display: "block",
                  width: "100%",
                  marginTop: 26,
                  border: 0,
                  background: "transparent",
                  color: OU2.ghost,
                  fontFamily: OU2.round,
                  fontSize: 11,
                  letterSpacing: ".14em",
                  textAlign: "center",
                  cursor: "pointer",
                }}
              >
                今夜を、はじめからやりなおす
              </button>
            </>
          ) : null}

          <button
            type="button"
            onClick={handleVersionTap}
            onPointerDown={startLongPress}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            aria-label="バージョン 1.0.0"
            style={versionStyle}
          >
            燈 ・ 1.0.0
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
