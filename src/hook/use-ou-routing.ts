import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { OuScreen } from "@/component/ouse/ouse-screen-types";
import type { Character } from "@/lib/api";
import {
  buildPath,
  isRoutedScreen,
  parseRoute,
  pathForScreen,
  screenForRoute,
  type AppRoute,
  type RoutedScreen,
} from "@/lib/app-route";
import { getRoutePath, pushPath, replacePath } from "@/lib/navigation";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

// URL に載らない一時サブ画面。URL 上の画面へ重ねて出し、閉じると下地の画面へ戻る。
type OverlayScreen = Exclude<OuScreen, RoutedScreen>;

// どの画面の上に重ねたかを一緒に持つ。URL 上の画面が変われば自動的に無効になるので、
// 経路変更のたびに state を畳む effect が要らない。
interface Overlay {
  screen: OverlayScreen;
  over: RoutedScreen;
}

const visibleOverlayScreen = (
  overlay: Overlay | null,
  routedScreen: RoutedScreen,
): OverlayScreen | null => (overlay?.over === routedScreen ? overlay.screen : null);

// シート系(character/create)の経路は、アプリ内から開いたときだけ開いた元の画面を下地に残す。
// これでトーク画面がシートの裏で畳まれない。直リンクで来たときは経路表の既定へ落ちる。
const sheetReturnPathOf = (
  route: AppRoute,
  profileReturnPath: string,
  wizardReturnPath: string,
): string | null => {
  if (route.page === "character") return profileReturnPath;
  if (route.page === "create") return wizardReturnPath;
  return null;
};

const baseScreenOf = (route: AppRoute, sheetReturnPath: string | null): RoutedScreen =>
  (sheetReturnPath ? screenForRoute(parseRoute(sheetReturnPath)) : null) ??
  screenForRoute(route) ??
  "home";

const routeCharacterIdOf = (route: AppRoute): string | undefined =>
  route.page === "chat" || route.page === "character" ? route.characterId : undefined;

const routeConversationIdOf = (route: AppRoute): string | undefined =>
  route.page === "chat" ? route.conversationId : undefined;

interface UseOuRoutingInput {
  route: AppRoute;
  characters: Character[];
  charactersReady: boolean;
  activeCharId: string | null;
  currentConversationId: string | null;
  restorePendingRef: RefObject<boolean>;
  restoreConversation: (conversationId: string) => Promise<void>;
}

export interface OuRouting {
  screen: OuScreen;
  navigateScreen: (screen: OuScreen) => void;
  profileOpen: boolean;
  setProfileOpen: (open: boolean, characterId?: string) => void;
  wizardOpen: boolean;
  setWizardOpen: (open: boolean) => void;
  openTalkWithCharacter: (characterId: string) => void;
  openNewConversation: () => void;
  openConversation: (conversationId: string, characterId?: string, focusMessageId?: string) => void;
  isUnknownCharacter: boolean;
}

const matchesRouteCharacter = (character: Character, route: AppRoute): boolean =>
  route.page === "character" &&
  (route.characterId ? character.id === route.characterId : character.slug === route.characterSlug);

const hasUnknownCharacter = (
  route: AppRoute,
  characters: Character[],
  charactersReady: boolean,
): boolean => {
  // 一覧を取れていない間に 404 を出すと、読み込み中が「存在しない」に化ける。
  if (!charactersReady) return false;
  if (route.page === "character") return !characters.some((c) => matchesRouteCharacter(c, route));
  if (route.page === "chat" && route.characterId) {
    return !characters.some((c) => c.id === route.characterId);
  }
  return false;
};

// URL を単一のソースとして OuApp の画面・シート・会話復元を駆動する。
// 画面遷移は「state を変えてから URL へ書き戻す」のではなく pushPath 一本にし、
// パスの解析は app-route.ts の経路表だけが担う。
export const useOuRouting = ({
  route,
  characters,
  charactersReady,
  activeCharId,
  currentConversationId,
  restorePendingRef,
  restoreConversation,
}: UseOuRoutingInput): OuRouting => {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  // シートを閉じたときの戻り先。下地の画面を決めるのに描画中も読むため ref ではなく state で持つ。
  const [profileReturnPath, setProfileReturnPath] = useState(pathForScreen("discover"));
  const [wizardReturnPath, setWizardReturnPath] = useState(pathForScreen("discover"));
  const restoringConversationIdRef = useRef<string | null>(null);
  // store が一度でも追いついた URL 上の会話 id。復元中は書き戻し effect が
  // restorePendingRef で抜けるので、この ref は「アプリ内から開いた会話」の側で立つ。
  const syncedConversationIdRef = useRef<string | null>(null);
  // 復元を試し終えた会話 id。restorePendingRef が下りても再描画は起きんので、
  // 書き戻し effect を走らせ直すために ref ではなく state で持つ。
  const [settledRestoreId, setSettledRestoreId] = useState<string | null>(null);
  const routedScreen = baseScreenOf(
    route,
    sheetReturnPathOf(route, profileReturnPath, wizardReturnPath),
  );
  const overlayScreen = visibleOverlayScreen(overlay, routedScreen);
  const routeCharacterId = routeCharacterIdOf(route);
  const routeConversationId = routeConversationIdOf(route);

  const talkPath = buildPath({
    page: "chat",
    characterId: routeCharacterId ?? activeCharId ?? undefined,
    conversationId: currentConversationId ?? undefined,
  });

  const navigateScreen = useCallback(
    (next: OuScreen) => {
      if (!isRoutedScreen(next)) {
        setOverlay({ screen: next, over: routedScreen });
        return;
      }
      setOverlay(null);
      pushPath(next === "talk" ? talkPath : pathForScreen(next));
    },
    [talkPath, routedScreen],
  );

  const openTalkWithCharacter = useCallback((characterId: string) => {
    setOverlay(null);
    pushPath(buildPath({ page: "chat", characterId }));
  }, []);

  // 新規会話は ?conv= を落とした状態で開く。navigateScreen("talk") だと直前の会話 id を
  // そのまま URL へ載せてしまい、復元 effect が消したはずの会話を open し直す。
  const openNewConversation = useCallback(() => {
    setOverlay(null);
    restoringConversationIdRef.current = null;
    // URL から落とすだけでは戻ってくる。この下の書き戻し effect が
    // conversationId: currentConversationId を無条件で ?conv= へ書くので、store を
    // 手放さん限り「?conv= の無い /chat」は一瞬で前の会話の URL に化ける。
    // 同じキャラで開き直す時は routeCharacterId の effect も早期 return するので、
    // 会話 id を落とす場所がここ以外に無い。
    const chat = useChatStore.getState();
    chat.setConversationId(null);
    chat.setMessages([]);
    pushPath(
      buildPath({ page: "chat", characterId: routeCharacterId ?? activeCharId ?? undefined }),
    );
  }, [routeCharacterId, activeCharId]);

  const openConversation = useCallback(
    // focusMessageId は本文検索から飛んできた時だけ入る。会話を開くだけやと、
    // 探し当てた発言が数十ターン上に埋まっとって結局スクロールで探し直すことになる。
    (conversationId: string, characterId?: string, focusMessageId?: string) => {
      setOverlay(null);
      restoringConversationIdRef.current = conversationId;
      pushPath(
        buildPath({
          page: "chat",
          characterId: characterId ?? activeCharId ?? undefined,
          conversationId,
          focusMessageId,
        }),
      );
    },
    [activeCharId],
  );

  // 開いているキャラと会話を URL へ書き戻す。会話切替で戻る履歴を汚さないため replace。
  useEffect(() => {
    if (route.page !== "chat") return;
    if (restorePendingRef.current) return;
    // store が URL の会話へ追いつくまでは ?conv= を上書きしない。そうしないと
    // リロード時に ?conv= が（永続化されとった）別会話 ID に置き換わってしまう。
    //
    // 追いついた／復元が落ちて決着した後は解除する。ここを恒久の early return に
    // しとったのが「引っ張って更新すると新規セッションに飛ばされる」の正体やった:
    // 復元が落ちて handleHistoryLoadFailure が会話 id を手放すと、store は null／
    // URL は ?conv=<死んだ id> のまま固定される。以後どの conversationId でもここを
    // 抜けられず、次に送って新しい会話がでけても URL は死んだ id を指し続ける。
    // リロードするたび同じ復元が落ちて同じ空のトーク画面に戻る——出口の無い輪になる。
    if (route.conversationId) {
      if (route.conversationId === currentConversationId) {
        syncedConversationIdRef.current = route.conversationId;
      } else if (
        syncedConversationIdRef.current !== route.conversationId &&
        settledRestoreId !== route.conversationId
      ) {
        return;
      }
    }
    replacePath(
      buildPath({
        page: "chat",
        characterId: route.characterId ?? activeCharId ?? undefined,
        conversationId: currentConversationId ?? undefined,
        focusMessageId: route.focusMessageId,
      }),
    );
  }, [route, activeCharId, currentConversationId, restorePendingRef, settledRestoreId]);

  // URL のキャラ id を正とする。直リンクやブラウザ戻る/進むでもそのキャラのトークが開く。
  useEffect(() => {
    if (!routeCharacterId) return;
    const settings = useSettingsStore.getState();
    if (settings.activeCharacterId === routeCharacterId) return;
    settings.setActiveCharacterId(routeCharacterId);
    // ?conv= 付きは会話復元側がメッセージごと差し替えるため、ここでは触らない
    if (routeConversationId) return;
    const chat = useChatStore.getState();
    chat.setActiveCharacterId(routeCharacterId);
    chat.setConversationId(null);
    chat.setMessages([]);
  }, [routeCharacterId, routeConversationId]);

  // URL の会話 id から会話を復元する。初回読み込みとブラウザ戻る/進むを 1 本で賄う。
  useEffect(() => {
    if (!routeConversationId) return;
    if (restoringConversationIdRef.current === routeConversationId) return;
    // 会話 id が一致しても、本文まで手元に在る時しか取り直しを省けん。persist の
    // partialize は currentConversationId だけを localStorage へ残し messages は残さんので、
    // リロード直後は「id は一致・messages は空」になる。id だけで省くと、その空を
    // 「もう読み込み済み」と読み違えて履歴を一度も取りに行かず、開いた会話が白紙になる。
    const chat = useChatStore.getState();
    if (chat.currentConversationId === routeConversationId && chat.messages.length > 0) return;
    restoringConversationIdRef.current = routeConversationId;
    // 決着（成功でも失敗でも）を記録するまでは書き戻しを止めてある。restoreConversation は
    // 中で例外を受けるが、将来漏れても URL が固まらんよう finally で必ず立てる。
    void restoreConversation(routeConversationId).finally(() => {
      setSettledRestoreId(routeConversationId);
    });
  }, [routeConversationId, restoreConversation]);

  // `/c/<slug>` は共有リンク互換の入口。解決できたら正典の `/characters/<id>` へ寄せる。
  useEffect(() => {
    if (route.page !== "character" || !route.characterSlug) return;
    const matched = characters.find((c) => c.slug === route.characterSlug);
    if (!matched) return;
    replacePath(buildPath({ page: "character", characterId: matched.id }));
  }, [route, characters]);

  const setProfileOpen = useCallback(
    (open: boolean, characterId?: string) => {
      if (open) {
        const targetId = characterId ?? activeCharId;
        if (!targetId) return;
        setProfileReturnPath(getRoutePath());
        pushPath(buildPath({ page: "character", characterId: targetId }));
        return;
      }
      // 既に別の経路へ移った後の onOpenChange(false) で、その遷移を巻き戻さない
      if (route.page !== "character") return;
      pushPath(profileReturnPath);
    },
    [activeCharId, route.page, profileReturnPath],
  );

  const setWizardOpen = useCallback(
    (open: boolean) => {
      if (open) {
        if (route.page === "create") return;
        setWizardReturnPath(getRoutePath());
        pushPath(buildPath({ page: "create" }));
        return;
      }
      if (route.page !== "create") return;
      pushPath(wizardReturnPath);
    },
    [route.page, wizardReturnPath],
  );

  return {
    screen: overlayScreen ?? routedScreen,
    navigateScreen,
    profileOpen: route.page === "character",
    setProfileOpen,
    wizardOpen: route.page === "create",
    setWizardOpen,
    openTalkWithCharacter,
    openNewConversation,
    openConversation,
    isUnknownCharacter: hasUnknownCharacter(route, characters, charactersReady),
  };
};
