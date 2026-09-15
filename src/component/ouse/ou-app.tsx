import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { NotFoundView } from "@/component/route/not-found-view";
import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { useCharacterQuery } from "@/hook/use-character-query";
import { useChatQuery } from "@/hook/use-chat-query";
import { useDocumentVisible } from "@/hook/use-document-visible";
import { useNetworkStatus } from "@/hook/use-network-status";
import { useOuRouting } from "@/hook/use-ou-routing";
import {
  ApiResponseError,
  extractMemoryNotes,
  fetchCurrentUser,
  generateImage,
  getImageTaskResult,
  listCharacters,
  listConversationMessages,
  persistImageToR2,
  QUOTA_EXCEEDED_EVENT,
  streamChatWithQualityGuard,
  submitMessageFeedback,
  type Character,
  type CharacterInput,
  type ConversationSummary,
} from "@/lib/api";
import { buildPath, type AppRoute } from "@/lib/app-route";
import { pickAutoRetryTarget } from "@/lib/auto-retry-target";
import { watchBackgrounded } from "@/lib/background-interruption";
import { buildImagePromptFromHistory, detectImageScenePhase } from "@/lib/chat-image-prompt";
import { buildMessagesForApi } from "@/lib/chat-message-adapter";
import {
  DEFAULT_CHARACTER_NAME,
  DEFAULT_SYSTEM_PROMPT,
  IMAGE_POLL_INTERVAL_MS,
  IMAGE_POLL_MAX_ATTEMPTS,
} from "@/lib/config";
import { buildConversationFallbackTitle } from "@/lib/conversation-summary";
import {
  describeImageGenerationError,
  describeImagePersistError,
} from "@/lib/image-generation-error";
import { createLogger } from "@/lib/logger";
import { hasAskedForName } from "@/lib/name-prompt-state";
import { pushPath } from "@/lib/navigation";
import { persistTurn } from "@/lib/persist-turn";
import { buildNaturalCharacterProfileText, parseSystemPrompt } from "@/lib/prompt-builder";
import { queryKey } from "@/lib/query-key";
import { decideRegenerateDisplay } from "@/lib/regenerate-display";
import { detectScenePhase, type ScenePhase } from "@/lib/scene-phase";
import {
  clearStreamProgress,
  getAllStreamProgress,
  saveStreamProgress,
} from "@/lib/stream-session-storage";
import { randomUUID } from "@/lib/uuid";
import { parseXmlResponse } from "@/lib/xml-response-parser";
import { shouldAttachAutoPhoto, useReplySettings } from "@/store/character-settings-store";
import {
  markImageGenerationActive,
  markImageGenerationDone,
  useChatStore,
  type ChatMessage,
} from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";
import { useUiStore } from "@/store/ui-store";

import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import "./chatscope.css";
import { OuAssetsScreen } from "./ou-assets-screen";
import { OuBottomNav } from "./ou-bottom-nav";
import { OuCreateFlowEntry } from "./ou-create-flow-entry";
import { OuDiscoverScreen } from "./ou-discover-screen";
import { OuDrawer } from "./ou-drawer";
import { OuEditScreen } from "./ou-edit-screen";
import { OuFacesSheet } from "./ou-faces-sheet";
import { OuHomeScreen } from "./ou-home-screen";
import { OuLogScreen } from "./ou-log-screen";
import { OuPhotoOverlay, type OuPhotoOverlayItem } from "./ou-media-overlay";
import { OuMemoryScreen } from "./ou-memory-screen";
import { OuseMessageList } from "./ou-message-list";
import { OuMyScreen } from "./ou-my-screen";
import { OuNamePromptSheet } from "./ou-name-prompt-sheet";
import { OuPhotoScreen } from "./ou-photo-screen";
import { OuProfileScreen } from "./ou-profile-screen";
import { OuRail } from "./ou-rail";
import { OuReplySettingsSheet } from "./ou-reply-settings-sheet";
import { OuScenePicker } from "./ou-scene-picker";
import { OuStage } from "./ou-stage";
import { OuUtageScreen } from "./ou-utage-screen";
import { OuseComposer } from "./ouse-composer";
import { TalkHeader } from "./talk-header";

import type { OuScreen } from "./ouse-screen-types";

import "./ouse.css";

const logger = createLogger("ou-app");

const mergeStreamChunk = (accumulated: string, chunk: string): string =>
  chunk.length > accumulated.length + 100 ? chunk : accumulated + chunk;

const addConversationGreetingMessage = (
  conversation: ConversationSummary,
  addMessage: (message: ChatMessage) => void,
): void => {
  if (!conversation.greetingMessageId || !conversation.characterGreeting.trim()) return;
  addMessage({
    id: conversation.greetingMessageId,
    role: "assistant",
    content: conversation.characterGreeting,
  });
};

const getCharDesc = (systemPrompt: string): string => parseSystemPrompt(systemPrompt).personality;

// 保存の在否を読み直す時の上限。保存本体（20秒）より短くする。
// 読み直しは既に失敗した後の後始末なので、ここで長く待つと入力欄の解除が遅れる。
const PERSIST_CONFIRM_TIMEOUT_MS = 10_000;

// ストリームの途中経過を sessionStorage へ書く最短間隔。チャンクは細切れで届くので
// 毎回書くと 1 返信で数百〜数千回の同期書き込みになり、生成中のスクロールが詰まる。
// 落とすのは最大でこの間隔ぶんの文字数だけ。
const STREAM_PROGRESS_SAVE_INTERVAL_MS = 1_000;

// D1 から読んだ履歴へ、生成途中で途切れた返信を足して戻す。
// 同じ id の行が D1 に在る＝そのターンは保存し切れとるので、足さずに捨てる。
// 足すと同じ返信が二重に並ぶうえ、古い途中経過が確定済みの本文を押しのける。
const mergeStreamProgressIntoHistory = (
  conversationId: string,
  persisted: ChatMessage[],
): ChatMessage[] => {
  const entry = getAllStreamProgress().find((e) => e.conversationId === conversationId);
  if (!entry) return persisted;
  // 拾ったか捨てたかに関わらず控えは用済み。復元した側で消さんと、D1 には無いままの
  // 途中経過が保持期限まで残り、開き直すたび同じ幽霊返信が何度も生き返る。
  clearStreamProgress(conversationId);
  if (!entry.content.trim() || persisted.some((m) => m.id === entry.messageId)) return persisted;
  // isStreaming は付けん。生成は既に途切れとって続きは来んので、待っとる見た目にすると
  // 永久に回るインジケータになる。
  return [
    ...persisted,
    {
      id: entry.messageId,
      role: "assistant" as const,
      content: entry.content,
      createdAt: entry.savedAt,
    },
  ];
};

const FULL_SCREEN_COL_SCREENS = new Set<OuScreen>([
  "log",
  "discover",
  "home",
  "my",
  "photo",
  "assets",
  "memory",
  "edit",
  // 宴(utage)は /groups で直接開ける自前chromeの全画面。ここから外れると台本コラム扱いになり、
  // 高さが中身なりの帯として画面下へ寄り、上に無関係な立ち絵背景が残る。
  "utage",
]);
// 各画面が個別に全画面chromeを持ち共有ボトムナビを重ねて出さないための判定。
// !== の連鎖比較だとESLintのcomplexity上限に抵触するためSet参照にしている。
// 宴(utage)は log/assets と同じく URL から直接来られる行き先なので、ここには入れん。
// タブバーが無いと直接開いた人が他の画面へ移れんようになる。
const BOTTOM_NAV_HIDDEN_SCREENS = new Set<OuScreen>(["talk", "scene", "memory", "edit"]);

// PC 3 ペインの右サイドバーはキャラクター文脈の画面でのみ表示する。
const PC_RIGHT_SCREENS = new Set<OuScreen>(["talk", "home", "discover", "log"]);

const getColClass = (screen: OuScreen): string =>
  `ou-col${
    FULL_SCREEN_COL_SCREENS.has(screen)
      ? " is-log"
      : screen === "scene"
        ? " is-scene"
        : screen === "talk"
          ? " is-talk"
          : ""
  }`;

// OuApp本体のcomplexity上限抵触を避けるためモジュール直下に切り出す。
// 案A「燈」ヘッダー用：直近のアシスタント発言の <scene> タグから場面名を拾う（「キャラ名 — 場面名」表示）
const findLatestSceneLabel = (visibleMessages: ChatMessage[]): string | undefined => {
  for (let i = visibleMessages.length - 1; i >= 0; i--) {
    const msg = visibleMessages[i];
    if (msg.role !== "assistant") continue;
    const scene = parseXmlResponse(msg.content)?.scene;
    if (scene) return scene;
  }
  return undefined;
};

// 案A「燈」: talk画面とフルスクリーン系（home/my/discover/photo/log/utage等）はフラット背景。
// 立ち絵背景(photo)はそれ以外（scene等）のみ。フルスクリーン系はavatar 404時代に
// 立ち絵が不可視で潜在化していたが、avatar配信が生きると設計にない全画面立ち絵が
// カードの下に透けるため明示的にflatにする（設計ボード準拠）。
// OuApp本体のESLint complexity上限に抵触しないようモジュール直下に切り出す。
// lamp glow は talk 専用なので "talk" と "flat" を分ける（全画面系は背景だけ共有）。
const getStageVariant = (centerScreen: OuScreen): "talk" | "flat" | "photo" =>
  centerScreen === "talk" ? "talk" : FULL_SCREEN_COL_SCREENS.has(centerScreen) ? "flat" : "photo";

// ?m=<messageId> は talk 経路にだけ載る。OuApp 本体の分岐数を増やさないよう外に出す。
const getRouteFocusMessageId = (route: AppRoute): string | undefined =>
  route.page === "chat" ? route.focusMessageId : undefined;

// キャラ一覧を取り切れた時だけ「存在しないキャラ」判定を許す。読み込み中の空配列で 404 にしない。
const isCharacterListReady = (isPending: boolean, isError: boolean): boolean =>
  !isPending && !isError;

const getCenterScreen = (screen: OuScreen, isPcLayout: boolean): OuScreen =>
  isPcLayout && (screen === "discover" || screen === "log" || screen === "home") ? "talk" : screen;

const wrapPollingError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

const pollForImageUrl = async (taskId: string): Promise<string | null> => {
  let lastError: Error | undefined;
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, IMAGE_POLL_INTERVAL_MS));
    try {
      const taskResult = await getImageTaskResult(taskId);
      const status = taskResult.task?.status;
      const firstImage = taskResult.images?.[0];
      if (status === "TASK_STATUS_SUCCEED" && firstImage?.image_url) {
        return firstImage.image_url;
      }
      if (status === "TASK_STATUS_FAILED") return null;
    } catch (err) {
      // 上流の 429/5xx 等でも継続してポーリングする。最後まで復帰しなければ例外を再送出。
      lastError = wrapPollingError(err);
    }
  }
  if (lastError) throw lastError;
  return null;
};

interface RunImageTaskOptions {
  prompt: string;
  charDesc: string;
  phase: ScenePhase;
  characterId: string;
  messageId: string;
  // これが無いと resolveSceneBackground が conversation_scene_state を読む分岐へ
  // 一度も入れず、舞台は直近 3 往復のテキストからの推測だけで決まる。
  conversationId: string | null;
}

interface EditScreenBranchProps {
  characters: Character[];
  editCharacterId: string | null;
  updateCharacterEntry: (id: string, input: CharacterInput) => Promise<unknown>;
  deleteCharacterEntry: (id: string) => Promise<unknown>;
  setScreen: (screen: OuScreen) => void;
}

// 編集対象の解決(find)と保存/削除ハンドラ生成を分離し、CenterScreenContent の complexity 上限(10)超過を避ける。
const EditScreenBranch = ({
  characters,
  editCharacterId,
  updateCharacterEntry,
  deleteCharacterEntry,
  setScreen,
}: EditScreenBranchProps) => {
  const found = characters.find((c) => c.id === editCharacterId);
  // 対象が消えている(削除直後等)場合は render 中に setScreen せず何も出さない。
  if (!found) return null;
  // 保存/削除は成功を待ってから遷移する。失敗時は画面に留め世界観のことばで知らせる（黙って成功に見せない）。
  const handleSave = async (input: CharacterInput) => {
    try {
      await updateCharacterEntry(found.id, input);
      setScreen("my");
    } catch {
      toast.error("うまく残せませんでした。もう一度お願いします");
    }
  };
  const handleDelete = async () => {
    try {
      await deleteCharacterEntry(found.id);
      setScreen("my");
    } catch {
      toast.error("うまくお別れできませんでした。もう一度お願いします");
    }
  };
  return (
    <OuEditScreen
      character={found}
      onSave={(input) => void handleSave(input)}
      onDelete={() => void handleDelete()}
      onBack={() => setScreen("my")}
    />
  );
};

interface StageBodyProps {
  characters: Character[];
  activeCharId: string | null;
  handleSelectCharacter: (charId: string) => void;
  handleShowCharacterProfile: (charId: string) => void;
  handleAddCharacter: (assetSrc?: string | null) => void;
  setScreen: (screen: OuScreen) => void;
  openSettings: () => void;
  activeCharacter: Character | null;
  setDrawerOpen: (open: boolean) => void;
  setProfileOpen: (open: boolean) => void;
  setFacesOpen: (open: boolean) => void;
  centerScreen: OuScreen;
  colClass: string;
  visibleMessages: ChatMessage[];
  closeScenePicker: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  handleScrollTouchStart: () => void;
  handleScrollTouchEnd: () => void;
  greetingContent: string | null;
  // 履歴を取りに行っとる間は true。messages の空を「まだ何も交わしてへん」と読ませんため。
  historyPending: boolean;
  handleSend: (text: string) => Promise<void>;
  handleSendDirective: (directive: string) => Promise<void>;
  handleImageGenerate: () => Promise<void>;
  handleFeedback: (messageId: string, rating: "good" | "bad", reason?: string) => Promise<void>;
  handleRegenerate: (messageId: string) => Promise<void>;
  handleRetrySend: (messageId: string) => void;
  isOnline: boolean;
  imageGeneratingMessageIds: Set<string>;
  isLoading: boolean;
  characterName: string;
  currentConversationId: string | null;
  handleSelectConversation: (convId: string, characterId?: string, focusMessageId?: string) => void;
  onOpenMemory: () => void;
  editCharacterId: string | null;
  setEditCharacterId: (id: string | null) => void;
  updateCharacterEntry: (id: string, input: CharacterInput) => Promise<unknown>;
  deleteCharacterEntry: (id: string) => Promise<unknown>;
  // null→undefined 変換と avatar 参照を親で 1 回だけ解決し、CenterScreenContent 内の条件分岐を増やさない
  bubbleCharacter: Character | undefined;
  activeCharacterAvatar: string | null | undefined;
  facesOpen: boolean;
  drawerOpen: boolean;
  profileOpen: boolean;
  replySettingsOpen: boolean;
  setReplySettingsOpen: (open: boolean) => void;
  openNewConversation: () => void;
  wizardOpen: boolean;
  setWizardOpen: (open: boolean) => void;
  // 素材管理で選んだ画像。作成フローのアップロード欄へ引き継ぐ（#823）
  createFromAssetSrc: string | null;
  sceneLabel?: string;
  isPcLayout?: boolean;
}

// アルバム ⇄ 素材管理。素材管理からキャラ作成へ抜ける導線を持つ(#823)。
// 呼び出し側で `a || b` にすると complexity 上限に触れるため Set で受ける
// (FULL_SCREEN_COL_SCREENS と同じ理由)。
const GALLERY_SCREENS = new Set<OuScreen>(["photo", "assets"]);

const GalleryStage = ({
  screen,
  messages,
  setScreen,
  onCreate,
}: {
  screen: OuScreen;
  messages: ChatMessage[];
  setScreen: (screen: OuScreen) => void;
  onCreate: (assetSrc: string | null) => void;
}) =>
  screen === "assets" ? (
    <OuAssetsScreen
      onBack={() => setScreen("photo")}
      onCreateFromAsset={(asset) => onCreate(asset?.src ?? null)}
    />
  ) : (
    <OuPhotoScreen
      messages={messages}
      mode="gallery"
      onBack={() => setScreen("home")}
      onAssets={() => setScreen("assets")}
    />
  );

// StageBodyProps をそのまま受けると、シートの開閉 state のように中央画面が読まんものまで
// 型が要求し、呼び出し側が惰性で渡し続ける。実際に読む分だけを取り出して受け口を閉じる。
// handleImageClick は StageBody が自分の state(selectedPhotoId)から作るので
// StageBodyProps には無い。ここで直接宣言し、親の props バッグから流れ込めんようにする。
type CenterScreenContentProps = Pick<
  StageBodyProps,
  | "characters"
  | "activeCharId"
  | "handleSelectCharacter"
  | "handleShowCharacterProfile"
  | "handleAddCharacter"
  | "setScreen"
  | "openSettings"
  | "centerScreen"
  | "visibleMessages"
  | "closeScenePicker"
  | "scrollRef"
  | "handleScroll"
  | "handleScrollTouchStart"
  | "handleScrollTouchEnd"
  | "greetingContent"
  | "handleSend"
  | "handleSendDirective"
  | "handleImageGenerate"
  | "handleFeedback"
  | "handleRegenerate"
  | "handleRetrySend"
  | "isOnline"
  | "imageGeneratingMessageIds"
  | "isLoading"
  | "characterName"
  | "currentConversationId"
  | "handleSelectConversation"
  | "onOpenMemory"
  | "bubbleCharacter"
  | "activeCharacterAvatar"
  | "editCharacterId"
  | "setEditCharacterId"
  | "updateCharacterEntry"
  | "deleteCharacterEntry"
> & {
  handleImageClick: (messageId: string) => void;
};

const CenterScreenContent = ({
  characters,
  handleSelectCharacter,
  handleShowCharacterProfile,
  handleAddCharacter,
  setScreen,
  openSettings,
  centerScreen,
  visibleMessages,
  closeScenePicker,
  greetingContent,
  handleSend,
  handleSendDirective,
  handleImageGenerate,
  handleFeedback,
  handleRegenerate,
  handleRetrySend,
  handleImageClick,
  isOnline,
  imageGeneratingMessageIds,
  scrollRef,
  handleScroll,
  handleScrollTouchStart,
  handleScrollTouchEnd,
  isLoading,
  characterName,
  activeCharId,
  currentConversationId,
  handleSelectConversation,
  onOpenMemory,
  bubbleCharacter,
  activeCharacterAvatar,
  editCharacterId,
  setEditCharacterId,
  updateCharacterEntry,
  deleteCharacterEntry,
}: CenterScreenContentProps) => {
  if (centerScreen === "home") {
    return (
      <OuHomeScreen
        characters={characters}
        activeCharacterId={activeCharId}
        activeConversationId={currentConversationId}
        onSelectCharacter={handleShowCharacterProfile}
        onSelectConversation={handleSelectConversation}
        onDiscover={() => setScreen("discover")}
        onCreate={handleAddCharacter}
      />
    );
  }
  if (centerScreen === "discover") {
    return (
      <OuDiscoverScreen
        characters={characters}
        activeCharacterId={activeCharId}
        onSelectCharacter={handleShowCharacterProfile}
        onAddCharacter={handleAddCharacter}
      />
    );
  }
  if (centerScreen === "scene") {
    return (
      <OuScenePicker
        characterId={activeCharId}
        characterName={characterName}
        onBack={closeScenePicker}
        onSelect={(firstMessage) => {
          setScreen("talk");
          void handleSend(firstMessage);
        }}
      />
    );
  }
  // アルバムと素材管理は一続きの導線なので1つの分岐にまとめる。
  // 別々の if にすると CenterScreenContent が ESLint の complexity 上限を超える。
  if (GALLERY_SCREENS.has(centerScreen)) {
    return (
      <GalleryStage
        screen={centerScreen}
        messages={visibleMessages}
        setScreen={setScreen}
        onCreate={handleAddCharacter}
      />
    );
  }
  if (centerScreen === "my") {
    return (
      <OuMyScreen
        characters={characters}
        onCreate={handleAddCharacter}
        onSettings={openSettings}
        onTalk={handleSelectCharacter}
        onEdit={(id) => {
          setEditCharacterId(id);
          setScreen("edit");
        }}
        onMemory={onOpenMemory}
        onLog={() => setScreen("log")}
        onUtage={() => setScreen("utage")}
      />
    );
  }
  if (centerScreen === "memory") {
    // 記憶(D-3)はドロワーではなく独立プッシュ画面。戻り先は入口のマイ画面。
    return (
      <OuMemoryScreen
        characterId={activeCharId}
        characterName={characterName}
        characterAvatar={activeCharacterAvatar}
        onBack={() => setScreen("my")}
      />
    );
  }
  if (centerScreen === "edit") {
    // 編集(D-5)は独立プッシュ画面。マイ画面の ✎ から開き、保存/削除/戻るでマイ画面へ戻る。
    return (
      <EditScreenBranch
        characters={characters}
        editCharacterId={editCharacterId}
        updateCharacterEntry={updateCharacterEntry}
        deleteCharacterEntry={deleteCharacterEntry}
        setScreen={setScreen}
      />
    );
  }
  if (centerScreen === "utage")
    return (
      <OuUtageScreen
        onBack={() => setScreen("my")}
        onOpenGroup={(groupId) => pushPath(buildPath({ page: "group", groupId }))}
        characters={characters.map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }))}
      />
    );
  if (centerScreen === "log") {
    return <OuLogScreen onSelectConversation={handleSelectConversation} />;
  }

  return (
    <>
      <div
        className="chatscope-integrated"
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <OuseMessageList
          greetingContent={greetingContent}
          bubbleCharacter={bubbleCharacter}
          visibleMessages={visibleMessages}
          handleFeedback={handleFeedback}
          handleRegenerate={handleRegenerate}
          handleRetrySend={handleRetrySend}
          handleImageClick={handleImageClick}
          imageGeneratingMessageIds={imageGeneratingMessageIds}
          activeCharId={activeCharId}
          isOnline={isOnline}
          scrollRef={scrollRef}
          onScroll={handleScroll}
          onScrollTouchStart={handleScrollTouchStart}
          onScrollTouchEnd={handleScrollTouchEnd}
        />
      </div>
      <OuseComposer
        onSend={(text) => {
          void handleSend(text);
        }}
        onSendDirective={(directive) => {
          void handleSendDirective(directive);
        }}
        onImageGenerate={() => {
          void handleImageGenerate();
        }}
        isLoading={isLoading}
        isImageGenerating={imageGeneratingMessageIds.size > 0}
        characterName={characterName}
        characterId={activeCharId}
        conversationId={currentConversationId}
      />
    </>
  );
};

const StageBody = ({
  characters,
  activeCharId,
  isPcLayout,
  handleSelectCharacter,
  handleShowCharacterProfile,
  handleAddCharacter,
  setScreen,
  openSettings,
  activeCharacter,
  setFacesOpen,
  centerScreen,
  setDrawerOpen,
  setProfileOpen,
  colClass,
  visibleMessages,
  closeScenePicker,
  scrollRef,
  handleScroll,
  handleScrollTouchStart,
  handleScrollTouchEnd,
  greetingContent,
  historyPending,
  handleSend,
  handleSendDirective,
  handleImageGenerate,
  handleFeedback,
  handleRegenerate,
  handleRetrySend,
  isOnline,
  imageGeneratingMessageIds,
  isLoading,
  characterName,
  currentConversationId,
  handleSelectConversation,
  onOpenMemory,
  bubbleCharacter,
  activeCharacterAvatar,
  editCharacterId,
  setEditCharacterId,
  updateCharacterEntry,
  deleteCharacterEntry,
  facesOpen,
  drawerOpen,
  profileOpen,
  replySettingsOpen,
  setReplySettingsOpen,
  openNewConversation,
  wizardOpen,
  setWizardOpen,
  createFromAssetSrc,
  sceneLabel,
}: StageBodyProps) => {
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  // 名前を尋ねる導線: キャラとの会話が始まった瞬間（挨拶だけが出ている状態）に一度だけ、
  // まだ呼び方が何も分かっていない時だけ出す。既に読み込み済みの["me"]キャッシュを
  // 再利用し、新たな取得経路を増やさない（SettingsPanelと同じqueryKey）。
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000,
  });
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  useEffect(() => {
    // setState をeffect本体で同期的に呼ばずasyncへ逃がす
    // （react-hooks/set-state-in-effect対策。shared-conversation-view.tsxと同じ扱い）。
    void (async () => {
      if (centerScreen !== "talk" || !greetingContent) return;
      // 会話カードや直リンクから開くと talk 画面が先に出て履歴は後から届く。その窓では
      // messages が空なので、話し込んどる会話まで「まだ何も交わしてへん」と読めてまう。
      // 開いた瞬間にシートが載ると、履歴が届いても閉じる契機が無いまま居座る。
      if (historyPending) return;
      // まだ一言も打っとらん時だけ。greetingContent は会話が進んでも残るので、
      // これが無いと場面の途中で開いた talk 画面にシートが割り込む。
      if (visibleMessages.some((message) => message.role === "user")) return;
      if (hasAskedForName()) return;
      // 取得中(undefined)を「未設定」と早合点すると、既に名前がある人にも出してしまう。
      if (me === undefined) return;
      if (me.displayName || activeCharacter?.userPersonaName) return;
      setNamePromptOpen(true);
    })();
  }, [centerScreen, greetingContent, historyPending, me, activeCharacter, visibleMessages]);

  // 会話内の画像を拡大表示する。visibleMessages の画像 URL を OuPhotoOverlay の item 形式に整える。
  const photoItems = useMemo<OuPhotoOverlayItem[]>(
    () =>
      visibleMessages
        .filter((message) => message.imageUrl)
        .map((message) => ({
          id: message.id,
          src: message.imageUrl,
          characterId: activeCharId,
          characterName: activeCharacter?.name ?? null,
          characterAvatar: activeCharacter?.avatar ?? null,
          createdAt: message.createdAt ?? null,
        })),
    [visibleMessages, activeCharId, activeCharacter],
  );

  const selectedPhoto = useMemo(
    () => photoItems.find((item) => item.id === selectedPhotoId) ?? null,
    [photoItems, selectedPhotoId],
  );

  const handleImageClick = useCallback((messageId: string) => {
    setSelectedPhotoId(messageId);
  }, []);

  return (
    <>
      <OuRail
        characters={characters}
        activeCharacterId={activeCharId}
        onSelectCharacter={handleShowCharacterProfile}
        onAddCharacter={handleAddCharacter}
        onUtage={() => setScreen("utage")}
        onSettings={openSettings}
      />
      {/* キャラ名表示は talk 画面の TalkHeader が（アバター無しで）専任する。設計上ここに名札は出さない */}
      {centerScreen === "talk" && (
        <TalkHeader
          character={activeCharacter}
          onMenuOpen={() => setReplySettingsOpen(true)}
          onPersonOpen={() => setProfileOpen(true)}
          onBackToHome={() => setScreen("home")}
          sceneLabel={sceneLabel}
        />
      )}
      <div className={colClass}>
        <CenterScreenContent
          characters={characters}
          activeCharId={activeCharId}
          handleSelectCharacter={handleSelectCharacter}
          handleShowCharacterProfile={handleShowCharacterProfile}
          handleAddCharacter={handleAddCharacter}
          setScreen={setScreen}
          openSettings={openSettings}
          centerScreen={centerScreen}
          visibleMessages={visibleMessages}
          closeScenePicker={closeScenePicker}
          scrollRef={scrollRef}
          handleScroll={handleScroll}
          handleScrollTouchStart={handleScrollTouchStart}
          handleScrollTouchEnd={handleScrollTouchEnd}
          greetingContent={greetingContent}
          handleSend={handleSend}
          handleSendDirective={handleSendDirective}
          handleImageGenerate={handleImageGenerate}
          handleFeedback={handleFeedback}
          handleRegenerate={handleRegenerate}
          handleRetrySend={handleRetrySend}
          handleImageClick={handleImageClick}
          isOnline={isOnline}
          imageGeneratingMessageIds={imageGeneratingMessageIds}
          isLoading={isLoading}
          characterName={characterName}
          currentConversationId={currentConversationId}
          handleSelectConversation={handleSelectConversation}
          onOpenMemory={onOpenMemory}
          bubbleCharacter={bubbleCharacter}
          activeCharacterAvatar={activeCharacterAvatar}
          editCharacterId={editCharacterId}
          setEditCharacterId={setEditCharacterId}
          updateCharacterEntry={updateCharacterEntry}
          deleteCharacterEntry={deleteCharacterEntry}
        />
      </div>
      {!isPcLayout && !BOTTOM_NAV_HIDDEN_SCREENS.has(centerScreen) && (
        <OuBottomNav screen={centerScreen} onScreen={setScreen} />
      )}
      <OuFacesSheet
        open={facesOpen}
        onOpenChange={setFacesOpen}
        characters={characters}
        activeCharacterId={activeCharId}
        onSelectCharacter={handleSelectCharacter}
        onAddCharacter={handleAddCharacter}
      />
      <OuReplySettingsSheet
        open={replySettingsOpen}
        onOpenChange={setReplySettingsOpen}
        characterId={activeCharId}
        characterName={activeCharacter?.name ?? ""}
        onOpenRecords={() => {
          setReplySettingsOpen(false);
          setDrawerOpen(true);
        }}
        onStartNewConversation={() => {
          setReplySettingsOpen(false);
          openNewConversation();
        }}
      />
      <OuNamePromptSheet
        open={namePromptOpen}
        onOpenChange={setNamePromptOpen}
        characterName={activeCharacter?.name ?? ""}
      />
      {/* OuDrawer の導線は設定シート内「ふたりの記録」から開く（#757 で復元） */}
      <OuDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        messages={visibleMessages}
        characterId={activeCharId}
        characterName={characterName}
        conversationId={currentConversationId}
        onOpenConversation={handleSelectConversation}
      />

      <OuProfileScreen
        character={activeCharacter}
        open={profileOpen}
        onOpenChange={setProfileOpen}
        onStartTalk={() => {
          // talk への遷移がそのままシートを閉じる（シートの開閉は URL が決める）
          setScreen("talk");
        }}
        onStartNewConversation={() => {
          // プロフィールの主 CTA は続きを開くだけやったので、初めから話す道がここに無かった（#1484）
          setProfileOpen(false);
          setScreen("talk");
          openNewConversation();
        }}
      />
      <OuCreateFlowEntry
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={handleSelectCharacter}
        initialUploadedImage={createFromAssetSrc}
      />
      <OuPhotoOverlay
        photo={selectedPhoto}
        photos={photoItems}
        onClose={() => setSelectedPhotoId(null)}
        onPick={(id) => setSelectedPhotoId(id)}
      />
    </>
  );
};

interface PcRightProps {
  activeCharacter: Character | null;
  screen: OuScreen;
  openScenePicker: () => void;
  setProfileOpen: (open: boolean) => void;
  openSettings: () => void;
  onMyPage: () => void;
}

const PcRight = ({
  activeCharacter,
  screen,
  openScenePicker,
  setProfileOpen,
  openSettings,
  onMyPage,
}: PcRightProps) => {
  // キャラクター文脈以外、または active キャラが無い画面では右カラムごと非表示にする。
  if (!PC_RIGHT_SCREENS.has(screen) || !activeCharacter) return null;
  // 表示用: 「年齢: 18歳成人」等のボイラープレートや【設定】等の生マーカーを漏らさないため自然文に整形する
  const personality = buildNaturalCharacterProfileText(
    parseSystemPrompt(activeCharacter.systemPrompt).personality,
  );
  return (
    <div className="ou-pc-right">
      <div className="ou-pc-char-panel">
        {activeCharacter.avatar ? (
          <AuthenticatedImage
            src={activeCharacter.avatar}
            alt={activeCharacter.name}
            className="ou-pc-char-avatar"
            fallback={
              <div className="ou-pc-char-avatar-placeholder">{activeCharacter.name[0]}</div>
            }
          />
        ) : (
          <div className="ou-pc-char-avatar-placeholder">{activeCharacter.name[0]}</div>
        )}
        <p className="ou-pc-char-name">{activeCharacter.name}</p>
        {personality && (
          <p className="ou-pc-char-desc">
            {personality.slice(0, 120)}
            {personality.length > 120 ? "…" : ""}
          </p>
        )}
        <div className="ou-pc-char-actions">
          <button type="button" className="ou-pc-char-btn primary" onClick={openScenePicker}>
            今夜のはじまり
          </button>
          <button
            type="button"
            className="ou-pc-char-btn secondary"
            onClick={() => setProfileOpen(true)}
          >
            その人について
          </button>
          <button type="button" className="ou-pc-char-btn secondary" onClick={openSettings}>
            しつらえ
          </button>
          <button type="button" className="ou-pc-char-btn secondary" onClick={onMyPage}>
            マイページ
          </button>
        </div>
      </div>
    </div>
  );
};

export const OuApp = ({ route }: { route: AppRoute }) => {
  const {
    data: characters = [],
    isPending: charactersPending,
    isError: charactersFailed,
  } = useQuery({
    queryKey: queryKey.characterList,
    queryFn: listCharacters,
  });
  const focusMessageId = getRouteFocusMessageId(route);

  const activeCharacterId = useSettingsStore((s) => s.activeCharacterId);
  const model = useSettingsStore((s) => s.model);
  const userProfile = useSettingsStore((s) => s.userProfile);
  const userRole = useSettingsStore((s) => s.userRole);
  const autoExtractMemories = useSettingsStore((s) => s.autoExtractMemories);

  const [editCharacterId, setEditCharacterId] = useState<string | null>(null);
  const [facesOpen, setFacesOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [replySettingsOpen, setReplySettingsOpen] = useState(false);
  const [isPcLayout, setIsPcLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [pcLeftPane, setPcLeftPane] = useState<"discover" | "log">("discover");
  const [imageGeneratingMessageIds, setImageGeneratingMessageIds] = useState<Set<string>>(
    new Set(),
  );

  // 返信設定シート・記録ドロワーは URL に載らない一時シート。
  // ルート遷移（別画面・ブラウザ戻る/進む）で開いたまま残らんよう閉じる。
  useEffect(() => {
    setReplySettingsOpen(false);
    setDrawerOpen(false);
  }, [route]);

  const openSettings = useUiStore((s) => s.openSettings);

  const { updateCharacterEntry, deleteCharacterEntry } = useCharacterQuery();

  const {
    messages,
    isLoading,
    currentConversationId,
    addMessage,
    removeMessage,
    updateMessage,
    markMessageError,
    setSendFailed,
    setMessageFeedback,
    setLoading,
    setConversationId,
    setMessages,
    clearMessages,
    updateMessageImage,
  } = useChatStore();

  const {
    conversations,
    createConversationEntry,
    createMessageEntry,
    deleteMessageEntry,
    persistMessageImageEntry,
    updateMessageContentEntry,
    loadMessages,
    forgetConversation,
  } = useChatQuery(currentConversationId);

  const activeCharacter = useMemo(() => {
    // 会話を開いている間は会話に紐づくキャラを優先する。
    // そうしないと activeCharacter（レール選択/設定）が会話と違うキャラのときに、
    // 返信・画像生成が別キャラのペルソナ・LoRA で走って「サクラ会話にダウナーが混ざる」になる。
    if (currentConversationId) {
      const conv = conversations.find((c) => c.id === currentConversationId);
      const convChar = conv?.characterId
        ? characters.find((c) => c.id === conv.characterId)
        : undefined;
      if (convChar) return convChar;
    }
    return characters.find((c) => c.id === activeCharacterId) ?? characters[0] ?? null;
  }, [characters, activeCharacterId, currentConversationId, conversations]);

  const { systemPrompt, characterName } = useMemo(
    () => ({
      systemPrompt: activeCharacter?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      characterName: activeCharacter?.name ?? DEFAULT_CHARACTER_NAME,
    }),
    [activeCharacter],
  );

  const activeCharId = useMemo(() => activeCharacter?.id ?? null, [activeCharacter]);

  const { responseLength, autoGenerateImages, photoFrequency } = useReplySettings(activeCharId);

  const isOnline = useNetworkStatus();
  const isDocumentVisible = useDocumentVisible();

  const scrollRef = useRef<HTMLDivElement>(null);
  const suppressScrollRef = useRef(false);
  // 返信が長いと、生成中に届く新着チャンクのたびにこの下の effect が最下部への強制
  // scrollTop を撃つ。指がまだ画面に触れている(スクロールジェスチャー中)瞬間にそれをやると
  // ネイティブのタッチスクロールを割り込みで潰し、「スクロールできなくなった」ように見える
  // (D14)。指を置いてから離すまでの間だけ、その強制スクロールを止める。
  const isScrollTouchingRef = useRef(false);
  const pendingAutoImageRef = useRef<Set<string>>(new Set());
  const streamCounterRef = useRef(0);
  // 設計 C-3: 未送達発言の再送を直列化する同期ロック。handleSend は会話生成 await の後に
  // setLoading(true) するため isLoading だけでは再入場を塞げず、複数キューが並行送信・
  // 会話重複を起こしうる。ロックは再送開始〜完了まで保持し、自動再送 effect の再突入を防ぐ。
  const retryLockRef = useRef(false);

  const handleScrollTouchStart = useCallback(() => {
    isScrollTouchingRef.current = true;
  }, []);

  const handleScrollTouchEnd = useCallback(() => {
    isScrollTouchingRef.current = false;
    // タッチ中に来た新着チャンクは最下部への追従を見送っとる。指を離した後も次のチャンクが
    // 来ん(そのチャンクが最後だった)と、見送った分がそのまま取り残されて追いつかん。
    // ユーザーが自分で上へスクロールし切っとる(suppressScrollRef)場合を除き、ここで拾う。
    if (suppressScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (suppressScrollRef.current || isScrollTouchingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsPcLayout(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsPcLayout(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ?m=<id> の直リンクは、対象へ一度センタリングすれば役目を終える。だが依存に messages を
  // 持つため、ストリーミング中の新着チャンクで messages が更新されるたびにこの effect が
  // 再実行され、同じ対象へ scrollIntoView({block:"center"}) を撃ち続けて、読んでいる最中の
  // 画面を古い発言へ引き戻していた(D15)。scrolledFocusIdRef で「この focusMessageId へは
  // 既に合わせた」を覚え、同じ id の間は再発火させない。
  const scrolledFocusIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focusMessageId) {
      scrolledFocusIdRef.current = undefined;
      return;
    }
    if (!messages.length) return;
    if (scrolledFocusIdRef.current === focusMessageId) return;
    const target = document.querySelector(`[data-message-id="${CSS.escape(focusMessageId)}"]`);
    if (!target) return;
    scrolledFocusIdRef.current = focusMessageId;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("ou-message-highlight");
    const timer = window.setTimeout(() => target.classList.remove("ou-message-highlight"), 2000);
    return () => window.clearTimeout(timer);
  }, [focusMessageId, messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    suppressScrollRef.current = distFromBottom > 120;
  }, []);

  // 復元(await)中は URL 書き出しを止め、currentConversationId 反映前に ?conv= を
  // 落としてしまう競合を防ぐ。
  const restorePendingRef = useRef(false);

  // 履歴を取りに行っとる間だけ立てる。会話を開く時は画面を先に出す（遷移を読み込みの
  // 後ろに置くとカードが無反応で死ぬ）ため、messages が空のまま talk 画面が見える窓が
  // ある。その空を「まだ何も交わしてへん会話」と読む側が早合点せんように渡す。
  const [historyPending, setHistoryPending] = useState(false);

  // 履歴の読み込みが落ちた後の後始末。落ちたまま黙って抜けると、開こうとした操作が
  // 何も起きんかったように見える（トーストも遷移も無し）。
  // 会話が D1 から消えとる(404)なら、握っとる会話 id とキャッシュのカードを手放す。
  // 手放さんと、一覧は IndexedDB に24時間残るので同じ無反応のカードが出続け、
  // 次の送信も返事だけ届いて保存で 404 になる。
  const handleHistoryLoadFailure = useCallback(
    (convId: string, error: unknown) => {
      logger.error("history load failed", { convId, error });
      if (error instanceof ApiResponseError && error.status === 404) {
        forgetConversation(convId);
        // D1 を触ったわけやないので「削除した」とは言わん。一覧から外しただけ。
        toast.error("この会話は見つかりませんでした。一覧から外しました");
        // 読んどる間に別の会話へ移っとることがある。今開いとる会話だけを手放す。
        if (useChatStore.getState().currentConversationId === convId) setConversationId(null);
        return;
      }
      toast.error("履歴を読み込めませんでした。通信を確かめてもう一度お試しください");
    },
    [forgetConversation, setConversationId],
  );

  // URL の会話 id から会話を復元する。リロード時とブラウザ戻る/進む時に使う。
  // キャラは会話一覧から解決して active に同期する（未取得なら永続化済みの active を使う）。
  const restoreConversation = useCallback(
    async (convId: string) => {
      restorePendingRef.current = true;
      try {
        const summary = conversations.find((c) => c.id === convId);
        if (summary?.characterId) {
          useSettingsStore.getState().setActiveCharacterId(summary.characterId);
          useChatStore.getState().setActiveCharacterId(summary.characterId);
        }
        setConversationId(convId);
        // handleSelectConversation と同じ理由(#1000 レビュー指摘)。URL からの復元
        // (リロード/ブラウザ戻る進む)も conversationId と messages を同じ tick で
        // 揃えないと、前の会話の写真IDが新しい会話の既読として誤確定する。
        clearMessages();
        // リロード/ブラウザ戻るでは stale キャッシュが画像未含む状態を返し、
        // 後から届いた画像を新着と誤判定するため、必ず最新を取り直す。
        // 呼び出し元は `void restoreConversation(...)` なので、ここで受けんと
        // 消えた会話への直リンクが unhandled rejection だけ出して黙って終わる。
        setHistoryPending(true);
        try {
          setMessages(
            mergeStreamProgressIntoHistory(convId, await loadMessages(convId, { fresh: true })),
          );
        } catch (error) {
          handleHistoryLoadFailure(convId, error);
        } finally {
          setHistoryPending(false);
        }
      } finally {
        restorePendingRef.current = false;
      }
    },
    [
      conversations,
      setConversationId,
      clearMessages,
      loadMessages,
      setMessages,
      handleHistoryLoadFailure,
    ],
  );

  // 画面・シート・会話復元はすべて URL から導出する。App 側の parseRoute が唯一の解析地点。
  const {
    screen,
    navigateScreen: setScreen,
    profileOpen,
    setProfileOpen,
    wizardOpen,
    setWizardOpen,
    openTalkWithCharacter,
    openConversation,
    openNewConversation,
    isUnknownCharacter,
  } = useOuRouting({
    route,
    characters,
    charactersReady: isCharacterListReady(charactersPending, charactersFailed),
    activeCharId,
    currentConversationId,
    restorePendingRef,
    restoreConversation,
  });

  // PC レイアウトでは /history に来たとき左ペインを「記録」に、それ以外は「出会い」に同期する。
  // キャラクターに関係しない画面（my/album 等）から log の stale 表示を防ぐため、
  // URL を正として「log 以外は discover」にフォールバックする。
  useEffect(() => {
    if (!isPcLayout) return;
    setPcLeftPane(screen === "log" ? "log" : "discover");
  }, [isPcLayout, screen, setPcLeftPane]);

  const sceneReturnScreenRef = useRef<OuScreen>("talk");

  const openScenePicker = useCallback(() => {
    if (screen !== "scene") {
      sceneReturnScreenRef.current = screen;
    }
    setScreen("scene");
  }, [screen, setScreen]);

  const closeScenePicker = useCallback(() => {
    setScreen(sceneReturnScreenRef.current);
  }, [setScreen]);

  // 素材管理から来た場合はその画像を作成フローへ引き継ぐ（#823）
  const [createFromAssetSrc, setCreateFromAssetSrc] = useState<string | null>(null);
  const handleAddCharacter = useCallback(
    (assetSrc?: string | null) => {
      // onAddCharacter は受け側で `() => void` と宣言されとるため、onClick へ直接渡すと
      // 型検査を素通りして React の合成イベントが assetSrc に入る。そのまま
      // initialUploadedImage → 画像の data URL として使われて素材が壊れる。
      // 呼び出し側を直した上で、ここでも文字列以外は素材として扱わん。
      setCreateFromAssetSrc(typeof assetSrc === "string" ? assetSrc : null);
      setWizardOpen(true);
    },
    [setWizardOpen],
  );

  const handleSelectCharacter = useCallback(
    (charId: string) => {
      useSettingsStore.getState().setActiveCharacterId(charId);
      clearMessages();
      setConversationId(null);
      openTalkWithCharacter(charId);
    },
    [clearMessages, setConversationId, openTalkWithCharacter],
  );

  // キャラ一覧からは中間のプロフィールシートを経由させ、いきなりトークに飛ばさない。
  const handleShowCharacterProfile = useCallback(
    (charId: string) => {
      useSettingsStore.getState().setActiveCharacterId(charId);
      clearMessages();
      setConversationId(null);
      setProfileOpen(true, charId);
    },
    [clearMessages, setConversationId, setProfileOpen],
  );

  // apiFetch は 429 でこのイベントを投げとるのに、購読しとる場所が本番に 1 つも無かった
  // （購読しとったのはテストだけ）。利用制限に当たると、押しても何も起きん画面だけが残る。
  useEffect(() => {
    const onQuotaExceeded = (event: Event) => {
      const detail = (event as CustomEvent<{ error?: string }>).detail;
      toast.error(detail?.error ?? "今日はここまで。しばらく待ってからもう一度どうぞ");
    };
    window.addEventListener(QUOTA_EXCEEDED_EVENT, onQuotaExceeded);
    return () => window.removeEventListener(QUOTA_EXCEEDED_EVENT, onQuotaExceeded);
  }, []);

  const handleSelectConversation = useCallback(
    // 外側の focusMessageId は URL 由来。こっちは本文検索から飛んできた時だけ入る。
    (convId: string, characterId?: string, jumpToMessageId?: string) => {
      // 会話に紐づくキャラへ activeCharacterId を同期しないと、talk 画面と
      // 返信生成が直前の active キャラ（初期値=先頭キャラ）のペルソナで走る
      if (characterId) {
        useSettingsStore.getState().setActiveCharacterId(characterId);
        useChatStore.getState().setActiveCharacterId(characterId);
      }
      setConversationId(convId);
      // conversationId と messages を同じ tick で切り替えないと、fetch が終わるまでの
      // 一瞬「新しい conversationId なのに前の会話の messages」という組が観測できる。
      // 新着判定はこの組を「新しい会話に元々あった写真」と区別できん(#1000 レビュー指摘)。
      clearMessages();
      // 遷移を履歴の読み込みより後ろに置くと、会話が D1 から消えとる(404)時に
      // openConversation まで届かず、カードが無反応で死ぬ。先に画面を開く。
      openConversation(convId, characterId, jumpToMessageId);
      setHistoryPending(true);
      void (async () => {
        // 履歴一覧やキャッシュの stale データを使うと、後から画像付きメッセージが
        // 差し替わって新着扱いされるため、必ず最新を取り直す。
        try {
          setMessages(
            mergeStreamProgressIntoHistory(convId, await loadMessages(convId, { fresh: true })),
          );
        } catch (error) {
          handleHistoryLoadFailure(convId, error);
        } finally {
          setHistoryPending(false);
        }
      })();
    },
    [
      setConversationId,
      clearMessages,
      loadMessages,
      setMessages,
      openConversation,
      handleHistoryLoadFailure,
    ],
  );

  const runImageGenerationTask = useCallback(
    async ({
      prompt,
      charDesc,
      phase,
      characterId,
      messageId,
      conversationId,
    }: RunImageTaskOptions) => {
      markImageGenerationActive(messageId);
      setImageGeneratingMessageIds((prev) => new Set([...prev, messageId]));
      try {
        const result = await generateImage(
          prompt,
          charDesc,
          phase,
          characterId,
          conversationId ?? undefined,
        );
        if ("error" in result) {
          logger.warn("image gen failed", { error: result.error });
          // 失敗を握り潰すと placeholder が黙って消えるだけになり、ユーザーには
          // 「ボタンが壊れている」としか見えない。原因を日本語で明示する。
          toast.error(describeImageGenerationError(result.error));
          return;
        }
        const imageUrl = await pollForImageUrl(result.task_id);
        if (!imageUrl) {
          logger.warn("image gen produced no url", { taskId: result.task_id });
          toast.error(describeImageGenerationError(""));
          return;
        }
        const persisted = await persistImageToR2(imageUrl, messageId, result.task_id);
        const loraModel = "loraModel" in result ? result.loraModel : undefined;
        const loraWeight = "loraWeight" in result ? result.loraWeight : undefined;
        const loraTriggerPrompt =
          "loraTriggerPrompt" in result ? result.loraTriggerPrompt : undefined;
        // 生成に成功した画像は表示するが、R2 永続化に失敗した場合は
        // 期限切れになる上流 URL を D1 / IndexedDB に黙って保存しない。
        if ("imageKey" in persisted) {
          updateMessageImage(messageId, persisted.imageKey);
          // アルバム画面(サーバー集約クエリ)はimage_urlをNOT NULLで絞り込むため、
          // R2キーだけでなくchat-store.updateMessageImageと同じ解決済みURLも送る。
          try {
            await persistMessageImageEntry({
              messageId,
              imageKey: persisted.imageKey,
              imageUrl: `/api/image/r2/${persisted.imageKey}`,
              imageLoraModel: loraModel,
              imageLoraWeight: loraWeight,
              imageLoraTriggerPrompt: loraTriggerPrompt,
            });
          } catch (persistError) {
            logger.error("image persist failed", { persistError });
            toast.error(describeImagePersistError());
          }
        } else {
          logger.warn("R2 persist returned error; keeping ephemeral display only", {
            messageId,
            error: persisted.error,
          });
          updateMessageImage(messageId, imageUrl);
          toast.error(describeImagePersistError());
        }
      } catch (err) {
        logger.error("image task error", { err });
        // getImageTaskResult は非2xx・スキーマ不一致で throw するため、ポーリング失敗は
        // null 返却ではなく例外でここへ来る。この経路にも出さんと placeholder が黙って消える。
        toast.error(describeImageGenerationError(err));
      } finally {
        markImageGenerationDone(messageId);
        setImageGeneratingMessageIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [updateMessageImage, persistMessageImageEntry],
  );

  useEffect(() => {
    if (!autoGenerateImages || !activeCharacter) return;
    const justCompleted = messages.filter(
      (m) =>
        m.role === "assistant" &&
        !m.isStreaming &&
        !m.imageUrl &&
        !m.imageKey &&
        pendingAutoImageRef.current.has(m.id),
    );
    if (justCompleted.length === 0) return;

    for (const msg of justCompleted) {
      pendingAutoImageRef.current.delete(msg.id);
      const allMsgs = useChatStore.getState().messages;
      const prompt = buildImagePromptFromHistory(allMsgs);
      const phase = detectImageScenePhase(allMsgs, prompt) ?? detectScenePhase(allMsgs);
      const charDesc = getCharDesc(activeCharacter.systemPrompt);
      setTimeout(() => {
        void runImageGenerationTask({
          prompt,
          charDesc,
          phase,
          characterId: activeCharacter.id,
          messageId: msg.id,
          conversationId: currentConversationId,
        });
      }, 700);
    }
  }, [
    messages,
    autoGenerateImages,
    activeCharacter,
    runImageGenerationTask,
    currentConversationId,
  ]);

  // 会話が無ければ生成して id を返す。handleSend の complexity を抑えるため分離。
  const ensureConversation = useCallback(
    async (text: string, charId: string | undefined): Promise<string> => {
      if (currentConversationId) return currentConversationId;
      // slice はコードユニットで切るので、40 文字目が絵文字やとサロゲートペアが割れて
      // 一覧のタイトルが「�」で終わる。改行や連続スペースもそのまま残る。
      const conv = await createConversationEntry({
        title: buildConversationFallbackTitle(text),
        characterId: charId,
      });
      setConversationId(conv.id);
      addConversationGreetingMessage(conv, addMessage);
      return conv.id;
    },
    [currentConversationId, createConversationEntry, setConversationId, addMessage],
  );

  // 中断で保存の結果が不明になった行が D1 に在るかを読み直す。
  // 在れば "present"、無ければ "absent"、読み取り自体が失敗したら "unknown"。
  // 読み取りにも上限を掛ける。掛けないと接続が固まった時にここで止まり、
  // 呼び出し側の finally に届かず入力欄が永久に disabled で残る。
  const confirmPersisted = useCallback(
    async (convId: string, messageId: string): Promise<"present" | "absent" | "unknown"> => {
      try {
        const persisted = await listConversationMessages(convId, {
          timeoutMs: PERSIST_CONFIRM_TIMEOUT_MS,
        });
        return persisted.some((row) => row.id === messageId) ? "present" : "absent";
      } catch (confirmErr) {
        logger.error("persist confirm error", { confirmErr });
        return "unknown";
      }
    },
    [],
  );

  // 保存の結果が確定できなかったターンの後始末。画面に出ているものと D1 の中身が
  // 食い違ったまま成功として閉じると、再読込で片側だけ消えて理由が分からなくなる。
  // 権威側（D1）を読み直して画面をそちらへ揃える。読み直せなければ触らない。
  // 揃えられたかどうかを返す。飲み込むと、揃っていないのに完了したターンとして閉じる。
  const resyncFromPersisted = useCallback(
    async (convId: string): Promise<boolean> => {
      try {
        const persisted = await loadMessages(convId, {
          timeoutMs: PERSIST_CONFIRM_TIMEOUT_MS,
          fresh: true,
        });
        // 読んどる間に別の会話へ切り替わっとることがある。そのまま入れると、
        // いま開いとる会話の画面を別会話の履歴で上書きしてまう。
        // 揃えずに抜けるので、揃えられた扱いにはせん。
        if (useChatStore.getState().currentConversationId !== convId) return false;
        // 未送達（設計 C-3 のキュー）は D1 にまだ無いのが正しい状態で、
        // D1 の中身で丸ごと置き換えると再送待ちの発言ごと消える。書き戻す。
        const persistedIds = new Set(persisted.map((message) => message.id));
        const queued = useChatStore
          .getState()
          .messages.filter(
            (message) => message.sendFailed === true && !persistedIds.has(message.id),
          );
        setMessages([...persisted, ...queued]);
        return true;
      } catch (resyncErr) {
        logger.error("history resync error", { resyncErr });
        return false;
      }
    },
    [loadMessages, setMessages],
  );

  // 送信成功後の永続化。分岐の本体は persist-turn.ts（テスト付き）。
  // ここは D1 と画面を触る手だけを渡す。
  const persistCompletedTurn = useCallback(
    async (params: {
      convId: string;
      characterId?: string;
      userMsg: ChatMessage;
      assistantId: string;
      content: string;
      retryCount?: number;
      refusalDetected?: boolean;
      usedModel?: string;
      generationPhase?: ScenePhase;
    }) => {
      const { convId, userMsg, assistantId, content } = params;
      const outcome = await persistTurn({
        createRow: (kind) =>
          kind === "user"
            ? createMessageEntry({ ...userMsg, conversationId: convId })
            : createMessageEntry({
                conversationId: convId,
                id: assistantId,
                role: "assistant",
                content,
                retryCount: params.retryCount,
                refusalDetected: params.refusalDetected,
                generationModel: params.usedModel,
                generationPhase: params.generationPhase,
              }),
        confirmPersisted: (kind) =>
          confirmPersisted(convId, kind === "user" ? userMsg.id : assistantId),
        deleteUserRow: () => deleteMessageEntry(convId, userMsg.id),
        resyncFromPersisted: () => resyncFromPersisted(convId),
        removeAssistantBubble: () => removeMessage(assistantId),
        // assistantId も引き継ぐ。理由は userId 側と対称(#997 レビュー再指摘):
        // 元の assistant POST がクライアント側の期限切れ後にサーバへ着地していると、
        // 再送が新しい id で書いた応答と別行として重複する。
        markUserRetryable: () => setSendFailed(userMsg.id, true, assistantId),
        logError: (message, error) => logger.error(message, { error }),
      });
      // 保存も揃え直しも確定できんかった。画面は完了したターンに見えるが D1 が
      // それを持っとる保証はない。黙って閉じると、再読込で初めて消えたことに気づく。
      if (outcome === "unreconciled") {
        toast.error("履歴を確認できませんでした。ページを再読み込みしてください");
      }
      // A2: サーバ側の抽出・重複除去・挿入は動いとったのに呼ぶ側が 0 件で、
      // memory_note が 1 行も増えんかった。ここが唯一の呼び出し口。
      //
      // 確定した(persisted)ターンだけを渡す。unreconciled や user_retryable は
      // その往復が D1 に在る保証が無く、抽出元のメッセージごと消える／入れ直される
      // ので、消えた発言から覚えたノートだけが残る。
      //
      // await せんのは、呼び出し側の finally が送信ロックを解くまでにモデル1往復ぶん
      // 挟まると入力欄が固まるから。失敗しても確定済みのターンは巻き戻さん
      // (覚え損ねるだけで、会話そのものは残る)。
      if (outcome === "persisted" && params.characterId && autoExtractMemories) {
        void extractMemoryNotes({
          conversationId: convId,
          characterId: params.characterId,
        }).catch((extractErr) => logger.error("memory extract error", { extractErr }));
      }
    },
    [
      createMessageEntry,
      deleteMessageEntry,
      removeMessage,
      setSendFailed,
      confirmPersisted,
      resyncFromPersisted,
      autoExtractMemories,
    ],
  );

  // 手動再送(reuseUserId 有り)は元の id を引き継ぐ。分岐を handleSend の外へ出して
  // 複雑度を上げない(呼び出し側 1 個で済む)。
  const resolveSendUserId = (reuseUserId?: string): string => reuseUserId ?? randomUUID();
  const resolveSendAssistantId = (reuseAssistantId?: string): string =>
    reuseAssistantId ?? randomUUID();

  const handleSend = useCallback(
    // reuseUserId / reuseAssistantId: 手動再送で使う。ensureRow は同じ id での入れ直しを
    // 二重化させない設計なので(persist-turn.ts)、元の POST が期限を跨いでサーバ側で
    // 生き残っていた場合でも、新しい id で送り直すと別行として重複する。
    // 再送は必ず元の id を引き継ぐ(user・assistant の両方)。
    async (text: string, asDirective = false, reuseUserId?: string, reuseAssistantId?: string) => {
      if (!text.trim() || isLoading) return;

      const charId = activeCharacter?.id;

      // 設計 C-3: オフライン時は送信を試みず、自分の発言をキューに積む（未送達＝D1未永続）。
      // 再接続で自動再送し、会話生成もその再送経路（オンライン）で行う。
      // 再送経路から呼ばれた時は id（user・assistant 両方）を引き継ぐ。
      if (!isOnline) {
        addMessage({
          id: resolveSendUserId(reuseUserId),
          role: "user",
          content: text,
          createdAt: Date.now(),
          sendFailed: true,
          offlineQueued: true,
          retryAssistantId: resolveSendAssistantId(reuseAssistantId),
          characterId: charId,
          conversationId: currentConversationId,
        });
        return;
      }

      // 会話生成 await の前に送信ロックを立てる。ここより後で isLoading を上げると、await 中は
      // まだ false のままで、再接続の自動再送 effect が次の offlineQueued を拾い createConversationEntry を
      // 二重実行しうる（会話重複・並行送信）。失敗時は必ず解除する。
      setLoading(true);

      // 背面へ回るとブラウザが通信を止める。止められた中断は「未送達のまま放置」やのうて
      // 戻ってきた時に自動で送り直す（局長 2026-08-19「他のアプリに移動すると失敗します」）。
      const backgroundWatch = watchBackgrounded();

      let convId: string;
      try {
        convId = await ensureConversation(text, charId);
      } catch (err) {
        // 会話生成失敗時は stuck loading を防ぐため解除し、呼び出し元（retry の .catch）へ委ねる
        backgroundWatch.stop();
        setLoading(false);
        throw err;
      }

      const userId = resolveSendUserId(reuseUserId);
      const assistantId = resolveSendAssistantId(reuseAssistantId);

      const sentAt = Date.now();
      const userMsg = { id: userId, role: "user" as const, content: text, createdAt: sentAt };
      addMessage(userMsg);
      // 送信成功（onComplete）まで D1 には書かない。失敗/オフラインの未送達発言を履歴に残さないため。

      const assistantMsg = {
        id: assistantId,
        role: "assistant" as const,
        content: "",
        createdAt: sentAt,
        isStreaming: true,
      };
      suppressScrollRef.current = false;
      addMessage(assistantMsg);
      // 「写真の頻度」スライダーはこれまで誰にも読まれておらず、返事のたびに毎回
      // 生成しとった。ひかえめ側へ寄せた人にも課金が乗り続けるので、ここで引く。
      if (shouldAttachAutoPhoto(autoGenerateImages, photoFrequency, Math.random())) {
        pendingAutoImageRef.current.add(assistantId);
      }

      const streamId = ++streamCounterRef.current;
      let accumulated = "";
      // 撮り直し中に画面へ出したままにする旧本文。null は「撮り直しをしとらん」。
      let heldText: string | null = null;
      // 途中経過を最後に sessionStorage へ書いた時刻。0 なので最初のチャンクは必ず書く
      // （すぐ離脱された時に 1 文字も残らんのを防ぐ）。
      let progressSavedAt = 0;

      // 未送達（sendFailed／オフラインキュー）の発言は「まだ相手に言っていない」ため文脈から除く。
      // これで複数キューの再送時も、送信中の発言より後ろに積まれた未送達分が文脈順を乱さない。
      const currentMsgs = useChatStore.getState().messages.filter((m) => !m.sendFailed);
      const phase = detectScenePhase(currentMsgs);
      const apiMessages = buildMessagesForApi(
        currentMsgs,
        systemPrompt,
        characterName,
        userProfile,
        userRole,
      );

      try {
        await streamChatWithQualityGuard(
          apiMessages,
          model,
          (chunk) => {
            if (streamId !== streamCounterRef.current) return;
            accumulated = mergeStreamChunk(accumulated, chunk);
            const decision = decideRegenerateDisplay(heldText, accumulated);
            // 旧本文を出したままの間は、控えも画面と同じ旧本文で取る。控えだけ新しいと
            // 離脱して開き直した時に、画面より短い本文が復元される。逆に控えを一切
            // 取らんかったら、追いつかんまま離脱したターンが丸ごと消える。
            if (decision.kind === "hold") {
              saveStreamProgress(convId, {
                messageId: assistantId,
                streamId: String(streamId),
                content: heldText ?? "",
              });
              return;
            }
            heldText = null;
            updateMessage(assistantId, decision.text, true);
            // 完了(onComplete)まで D1 には 1 行も書かんので、ここで落ちた返信は
            // どこにも残らん。開き直した時に拾えるよう途中経過を控える。
            const now = Date.now();
            if (now - progressSavedAt >= STREAM_PROGRESS_SAVE_INTERVAL_MS) {
              progressSavedAt = now;
              saveStreamProgress(convId, {
                messageId: assistantId,
                streamId: String(streamId),
                content: accumulated,
              });
            }
          },
          (result) => {
            void (async () => {
              if (streamId !== streamCounterRef.current) return;
              const content = result.content || accumulated;
              const wasRegenerated = (result.refusalRetryCount ?? 0) > 0;
              updateMessage(
                assistantId,
                content,
                false,
                result.warningLevel ?? false,
                wasRegenerated,
              );
              // 送信成功が確定した時点で自分の発言と返信を永続化する（部分永続の後始末込み）。
              // loading は永続化の確定（成功 or 失敗ロールバック）まで保持する。先に false にすると、
              // 再接続の自動再送 effect が次の offlineQueued を送ってしまい、この turn が後でロールバック
              // されると D1 の会話が文脈順を欠いた状態になる（Codex P2）。
              // 以前はここが素の await で、永続化が失敗すると setLoading(false) へ到達せず
              // 入力欄と送信ボタンが永久に disabled のまま残った（エラー表示も無く以後1通も
              // 送れない。#993 の e2e 300 秒サイレントストールの発生源）。
              // 往復自体は api.ts 側で期限を切ってあるので、ここは finally で必ず解除する。
              // 背景に逃がさないのは、ロールバックまで終えてから次の送信を許すため。
              try {
                await persistCompletedTurn({
                  convId,
                  characterId: charId,
                  userMsg,
                  assistantId,
                  content,
                  retryCount: result.retryCount,
                  refusalDetected: result.refusalDetected,
                  usedModel: result.usedModel,
                  generationPhase: result.scenePhase,
                });
              } catch (persistErr) {
                logger.error("persist completed turn error", { persistErr });
              } finally {
                // 返信は出切っとる。ここから先の在否は persist-turn.ts が受け持つので、
                // 途中経過は必ず捨てる。残すと、確定済みの返信の写しが次に開いた時
                // D1 に無い幽霊として生き返る。
                clearStreamProgress(convId);
                backgroundWatch.stop();
                setLoading(false);
              }
            })();
          },
          (err) => {
            if (streamId !== streamCounterRef.current) return;
            logger.error("stream error", { err });
            // 撮り直しの最中に落ちた場合、画面には旧本文が出たままになっとる。
            // 吹き出しごと消すと、読んどる途中の本文が上流の都合で失われる。
            if (heldText !== null && heldText.length > 0) {
              updateMessage(assistantId, heldText, false);
              backgroundWatch.stop();
              setLoading(false);
              return;
            }
            // 設計 C-3: 技術用語を出さず、自分の発言を「未送達」として残す（タップ再送/長押し削除）。
            // 空の返信プレースホルダは撤去する。
            // assistant id も引き継ぐ。再送時に同じ id で入れ直さんと別行として重複する。
            removeMessage(assistantId);
            setSendFailed(userId, true, assistantId);
            // 背面で止められた送信は本人が諦めたわけやない。前面へ戻った時に自動で送り直す。
            if (backgroundWatch.wasBackgrounded())
              useChatStore.getState().setRetryRequested(userId, true);
            backgroundWatch.stop();
            // 吹き出しを撤去した以上、途中経過も一緒に捨てる。残すと再送で消したはずの
            // 半端な返信が開き直しで戻る。
            clearStreamProgress(convId);
            setLoading(false);
          },
          { phase, characterName, userText: asDirective ? text : undefined },
          charId,
          responseLength,
          String(streamId),
          convId,
          () => {
            accumulated = "";
            // 品質ガードのやり直し。捨てた本文の控えを残すと、次のチャンクで上書き
            // されるまでの間に離脱した時、破棄済みの返信が復元される。
            clearStreamProgress(convId);
            progressSavedAt = 0;
            suppressScrollRef.current = false;
            // 読んどる最中に本文を消さん。撮り直しは数十秒かかるので、消すと故障に見える。
            // 新しい本文が同じ長さに届くまで今の本文を出したままにする。
            heldText =
              useChatStore.getState().messages.find((m) => m.id === assistantId)?.content ?? "";
            updateMessage(assistantId, heldText, true, false, true);
          },
          assistantId,
        );
      } catch (err) {
        logger.error("send error", { err });
        clearStreamProgress(convId);
        backgroundWatch.stop();
        setLoading(false);
      }
    },
    [
      isLoading,
      activeCharacter,
      ensureConversation,
      addMessage,
      persistCompletedTurn,
      autoGenerateImages,
      photoFrequency,
      setLoading,
      systemPrompt,
      characterName,
      userProfile,
      userRole,
      model,
      responseLength,
      updateMessage,
      removeMessage,
      setSendFailed,
      isOnline,
      currentConversationId,
    ],
  );

  const handleRetrySend = useCallback(
    (messageId: string) => {
      const target = useChatStore.getState().messages.find((m) => m.id === messageId);
      if (!target || target.role !== "user") return;
      // 別の送信が進行中/再送セットアップ中なら何もしない。ロックは同期的に取り、会話生成 await の
      // 隙間でも自動再送 effect の並行実行（複数キューの同時送信・会話重複）を防ぐ。
      if (retryLockRef.current || useChatStore.getState().isLoading) {
        // 黙って返すと「押しても何も起きんボタン」になる。理由を出すだけでも足りん——
        // 押した人の目的は「送り直す」ことで、待てば送れるんやから待つ役をこっちが持つ。
        // 局長 2026-08-19「押しても再送信しない」。オフラインキューと同じ機構が拾う。
        useChatStore.getState().setRetryRequested(messageId, true);
        toast.success("返事が届いたら、この発言を送り直します");
        return;
      }
      retryLockRef.current = true;
      // 拾われた時点で意思は果たされる。ここで降ろさんと、失敗するたび永久に再送し続ける。
      useChatStore.getState().setRetryRequested(messageId, false);
      // 未送達の発言を取り除いてから、通常の送信経路でまっさらに送り直す。
      // id は元の発言・元の応答のものを引き継ぐ(target.id / target.retryAssistantId)。
      // 新しい id を振ると、元の POST がクライアント側の期限切れ後にサーバへ着地して
      // いた場合、どちらの側も別行として重複する。
      removeMessage(messageId);
      void handleSend(target.content, false, target.id, target.retryAssistantId)
        .catch(() => {
          // 会話生成など再送セットアップが失敗したら、入力を失わせず未送達として戻す。
          // 元の id・assistant id・offlineQueued の状態を引き継ぐ。
          // offlineQueued が true のものは再接続後に自動再送の対象になる。
          addMessage({
            id: target.id,
            role: "user",
            content: target.content,
            createdAt: target.createdAt ?? Date.now(),
            sendFailed: true,
            offlineQueued: target.offlineQueued,
            retryAssistantId: target.retryAssistantId,
            characterId: target.characterId ?? activeCharacter?.id,
            conversationId: target.conversationId ?? currentConversationId,
          });
        })
        .finally(() => {
          retryLockRef.current = false;
        });
    },
    [handleSend, removeMessage, addMessage, activeCharacter, currentConversationId],
  );

  // 設計 C-3: 再接続したら、オフラインで積んだ未送達の発言を古い順に1件ずつ自動再送する。
  // 拾うのは「オフラインで積んだもの」と「返事待ちの最中に再送を押されたもの」。
  // 押されてへんサーバエラーは今までどおり手動タップ再送に委ね、無限再送ループを防ぐ。
  // isLoading を挟むことで多重送信を防ぎ、1件完了ごとにこの effect が次の1件を拾う。
  // 背面のまま送り直しても同じ理由で止められるだけなので、前面に戻るまで待つ。
  useEffect(() => {
    if (!isOnline || isLoading || !isDocumentVisible) return;
    const queued = pickAutoRetryTarget(messages);
    if (queued) handleRetrySend(queued.id);
  }, [isOnline, isLoading, isDocumentVisible, messages, handleRetrySend]);

  const handleFeedback = useCallback(
    async (messageId: string, rating: "good" | "bad", reason?: string) => {
      setMessageFeedback(messageId, rating);
      try {
        await submitMessageFeedback(messageId, rating, reason);
      } catch (err) {
        logger.error("feedback submit failed", { err });
        toast.error("評価の送信に失敗しました");
      }
    },
    [setMessageFeedback],
  );

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (isLoading) return;
      const currentMsgs = useChatStore.getState().messages;
      const idx = currentMsgs.findIndex((message) => message.id === messageId);
      const targetMessage = idx >= 0 ? currentMsgs[idx] : undefined;
      if (!targetMessage || targetMessage.role !== "assistant") return;

      setLoading(true);
      // 作り直しを始めた時点で前の控えは用済み。残すと、この生成が途中で切れた時に
      // 古い本文が復元されて新しい返事に混ざる。
      if (currentConversationId) clearStreamProgress(currentConversationId);
      suppressScrollRef.current = false;
      updateMessage(messageId, "", true);
      const streamId = ++streamCounterRef.current;
      let accumulated = "";
      // サーバ側の撮り直し中に画面へ出したままにする本文。null は「撮り直しをしとらん」。
      let heldText: string | null = null;

      const priorMessages = currentMsgs.slice(0, idx);
      const phase = detectScenePhase(priorMessages);
      const lastUserMessage = [...priorMessages]
        .reverse()
        .find((message) => message.role === "user");
      const apiMessages = buildMessagesForApi(
        priorMessages,
        systemPrompt,
        characterName,
        userProfile,
        userRole,
      );

      try {
        await streamChatWithQualityGuard(
          apiMessages,
          model,
          (chunk) => {
            if (streamId !== streamCounterRef.current) return;
            accumulated = mergeStreamChunk(accumulated, chunk);
            const decision = decideRegenerateDisplay(heldText, accumulated);
            if (decision.kind === "hold") return;
            heldText = null;
            updateMessage(messageId, decision.text, true);
          },
          (result) => {
            void (async () => {
              if (streamId !== streamCounterRef.current) return;
              const content = result.content || accumulated;
              updateMessage(messageId, content, false, result.warningLevel ?? false, true);
              // 送信ロックは PATCH の手前で解く。handleSend は永続化の確定まで保持するが、
              // あちらは createMessageEntry が期限を持っとる。この PATCH は期限が無く、
              // mutations の networkMode:"online" で回線が落ちると一時停止して解決も棄却も
              // せんため、ここで待つと composer が二度と開かない(#993 と同じ形)。
              setLoading(false);
              // 以前はここが素の await で、PATCH が落ちても誰も受けんかった。画面は新しい
              // 返事、D1 は古い返事のままになり、再読込で初めて消えたことに気づく。
              // 送信経路(persistCompletedTurn)と同じく、揃わんかったことを必ず知らせる。
              try {
                await updateMessageContentEntry(messageId, content);
              } catch (persistErr) {
                logger.error("regenerate persist error", { persistErr });
                toast.error("再生成した返信を保存できませんでした。ページを再読み込みしてください");
              }
            })();
          },
          (err) => {
            if (streamId !== streamCounterRef.current) return;
            logger.error("regenerate stream error", { err });
            toast.error("再生成に失敗しました");
            // 撮り直しの最中に落ちても、画面へ出とる本文は残す。
            if (heldText !== null && heldText.length > 0) {
              updateMessage(messageId, heldText, false);
              setLoading(false);
              return;
            }
            markMessageError(messageId);
            setLoading(false);
          },
          { phase, characterName, userText: lastUserMessage?.content },
          activeCharacter?.id,
          responseLength,
          String(streamId),
          currentConversationId ?? undefined,
          () => {
            accumulated = "";
            suppressScrollRef.current = false;
            // ここはユーザーが押した撮り直しやのうてサーバ側の作り直し。画面に出とる分を
            // 消さずに残す（消えると読んどる最中に故障したように見える）。
            heldText =
              useChatStore.getState().messages.find((m) => m.id === messageId)?.content ?? "";
            updateMessage(messageId, heldText, true, false, true);
          },
        );
      } catch (err) {
        logger.error("regenerate error", { err });
        toast.error("再生成に失敗しました");
        markMessageError(messageId);
        setLoading(false);
      }
    },
    [
      isLoading,
      setLoading,
      updateMessage,
      currentConversationId,
      systemPrompt,
      characterName,
      userProfile,
      userRole,
      model,
      activeCharacter,
      responseLength,
      updateMessageContentEntry,
      markMessageError,
    ],
  );

  const handleSendDirective = useCallback(
    (directive: string) => handleSend(directive, true),
    [handleSend],
  );

  const handleImageGenerate = useCallback(async () => {
    if (!activeCharacter) return;
    const allMsgs = useChatStore.getState().messages;
    const lastAssistant = [...allMsgs].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) {
      toast.error("まだ会話がありません。まずは話しかけてから画像を生成できます");
      return;
    }
    const prompt = buildImagePromptFromHistory(allMsgs);
    const phase = detectImageScenePhase(allMsgs, prompt) ?? detectScenePhase(allMsgs);
    const charDesc = getCharDesc(activeCharacter.systemPrompt);
    await runImageGenerationTask({
      prompt,
      charDesc,
      phase,
      characterId: activeCharacter.id,
      messageId: lastAssistant.id,
      conversationId: currentConversationId,
    });
  }, [activeCharacter, runImageGenerationTask, currentConversationId]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role === "user" || m.role === "assistant"),
    [messages],
  );

  const greetingContent = useMemo(() => {
    if (activeCharacter?.greeting && visibleMessages.length === 0) {
      return activeCharacter.greeting;
    }
    return null;
  }, [activeCharacter, visibleMessages]);

  const sceneLabel = useMemo(() => findLatestSceneLabel(visibleMessages), [visibleMessages]);

  const centerScreen = getCenterScreen(screen, isPcLayout);
  const stageVariant = getStageVariant(centerScreen);
  const colClass = getColClass(centerScreen);

  const stageBodyProps: StageBodyProps = {
    characters,
    activeCharId,
    handleSelectCharacter,
    handleShowCharacterProfile,
    handleAddCharacter,
    setScreen,
    openSettings,
    activeCharacter,
    setFacesOpen,
    centerScreen,
    setDrawerOpen,
    setProfileOpen,
    colClass,
    visibleMessages,
    closeScenePicker,
    scrollRef,
    handleScroll,
    handleScrollTouchStart,
    handleScrollTouchEnd,
    greetingContent,
    historyPending,
    handleSend,
    handleSendDirective,
    handleImageGenerate,
    handleFeedback,
    handleRegenerate,
    handleRetrySend,
    isOnline,
    imageGeneratingMessageIds,
    isLoading,
    characterName,
    currentConversationId,
    handleSelectConversation,
    onOpenMemory: () => setScreen("memory"),
    bubbleCharacter: activeCharacter ?? undefined,
    activeCharacterAvatar: activeCharacter?.avatar,
    editCharacterId,
    setEditCharacterId,
    updateCharacterEntry,
    deleteCharacterEntry,
    facesOpen,
    drawerOpen,
    profileOpen,
    replySettingsOpen,
    setReplySettingsOpen,
    openNewConversation,
    wizardOpen,
    setWizardOpen,
    createFromAssetSrc,
    sceneLabel,
    isPcLayout,
  };

  const pcRightProps: PcRightProps = {
    activeCharacter,
    screen: centerScreen,
    openScenePicker,
    setProfileOpen,
    openSettings,
    onMyPage: () => setScreen("my"),
  };

  // 存在しないキャラ id/slug のディープリンクは、黙ってホームへ落とさず 404 を出す
  if (isUnknownCharacter) return <NotFoundView path={buildPath(route)} />;

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      {isPcLayout ? (
        <div className="ou-pc-shell">
          {/* 左サイドバー: 出会い / 記録 */}
          <div className="ou-pc-left">
            <div className="ou-pc-left-tabs">
              <button
                type="button"
                className={`ou-pc-left-tab${pcLeftPane === "discover" ? " is-active" : ""}`}
                onClick={() => setPcLeftPane("discover")}
              >
                出会い
              </button>
              <button
                type="button"
                className={`ou-pc-left-tab${pcLeftPane === "log" ? " is-active" : ""}`}
                onClick={() => setPcLeftPane("log")}
              >
                記録
              </button>
            </div>
            <div className="ou-pc-left-body">
              {pcLeftPane === "discover" && (
                <OuDiscoverScreen
                  characters={characters}
                  activeCharacterId={activeCharId}
                  onSelectCharacter={handleSelectCharacter}
                  onAddCharacter={handleAddCharacter}
                />
              )}
              {pcLeftPane === "log" && (
                <OuLogScreen onSelectConversation={handleSelectConversation} />
              )}
            </div>
          </div>

          {/* 中央: 会話ステージ */}
          <div className="ou-pc-center">
            <OuStage character={activeCharacter} variant={stageVariant}>
              <StageBody {...stageBodyProps} />
            </OuStage>
          </div>

          {/* 右サイドバー: キャラクター情報 */}
          <PcRight {...pcRightProps} />
        </div>
      ) : (
        <OuStage character={activeCharacter} variant={stageVariant}>
          <StageBody {...stageBodyProps} />
        </OuStage>
      )}
    </div>
  );
};
