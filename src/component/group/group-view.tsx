import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { MessageBubble } from "@/component/chat/message-bubble";
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from "@/component/ui/avatar";
import {
  deleteGroup,
  getGroup,
  listGroupMessages,
  sendGroupMessage,
  type GroupCharacter,
} from "@/lib/api";
import { resolveAvatarSrc } from "@/lib/avatar-url";
import { selectRoundRobinSpeaker } from "@/lib/group-turn";
import { createLogger } from "@/lib/logger";
import { queryKey } from "@/lib/query-key";
import { getAvatarFallback } from "@/lib/utils";
import { randomUUID } from "@/lib/uuid";
import {
  isXmlResponse,
  parseXmlResponse,
  stripRememberTags,
  stripXmlTagsStreaming,
} from "@/lib/xml-response-parser";
import { useChatStore, type GroupMessage } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

const logger = createLogger("group-view");

const isAvatarImage = (avatar: string | null): avatar is string =>
  resolveAvatarSrc(avatar) !== null;

type GroupViewProps = {
  groupId: string;
  onRoute: (path: string) => void;
};

// 発言者ラベルは会話本文と別レイヤーで扱うため、キャラ名を宴の subtitle 表記（中黒区切り + あなた）に整形する
const formatMemberSubtitle = (characters: GroupCharacter[]): string =>
  [...characters.map((character) => character.name), "あなた"].join(" ・ ");

// ト書きは（）で囲う表示規約。素の action テキストにも括弧を補って統一する
const formatAction = (action: string): string => {
  const trimmed = action.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("（") && trimmed.endsWith("）")) ||
    (trimmed.startsWith("(") && trimmed.endsWith(")"))
  ) {
    return trimmed;
  }
  return `（${trimmed}）`;
};

const GroupHeader = ({
  title,
  characters,
  onBack,
  onDelete,
}: {
  title: string;
  characters: GroupCharacter[];
  onBack: () => void;
  onDelete?: () => void;
}): JSX.Element => {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="relative bg-[var(--night)]/80 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 text-[22px] leading-none text-[var(--dim)] transition-colors hover:text-[var(--lamp)]"
          aria-label="戻る"
        >
          ‹
        </button>
        <AvatarGroup className="shrink-0">
          {characters.slice(0, 4).map((character) => (
            <Avatar key={character.id} size="sm" className="border-2 border-[var(--ink)]">
              {isAvatarImage(character.avatar) ? (
                <AvatarImage src={resolveAvatarSrc(character.avatar) ?? ""} alt={character.name} />
              ) : null}
              <AvatarFallback>{getAvatarFallback(character.name)}</AvatarFallback>
            </Avatar>
          ))}
        </AvatarGroup>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-narrative text-base font-semibold text-[var(--text)]">
            {title}
          </h1>
          <p className="truncate text-[10.5px] text-[var(--faint)]">
            {formatMemberSubtitle(characters)}
          </p>
        </div>
        {onDelete ? (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="メニュー"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--hairline)] text-sm text-[var(--dim)] transition-colors hover:border-[var(--lamp-45)] hover:text-[var(--lamp)]"
            >
              ⋯
            </button>
            {menuOpen ? (
              <>
                {/* メニュー外クリックで閉じるための透明レイヤー */}
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 top-[50px] z-50 min-w-32 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--ink)] py-1 shadow-[0_18px_42px_rgba(5,3,2,.5)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-[var(--destructive)] transition-colors hover:bg-[var(--lamp-10)]"
                  >
                    宴を削除
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* ヘッダ下の光の帯: transparent→lamp→transparent の hairline */}
      <div className="mx-[22px] h-px bg-gradient-to-r from-transparent via-[var(--lamp-30)] to-transparent" />
    </header>
  );
};

// 内心（inner）は台詞と別レイヤーで斜体引用として描くため、本文と分離して取り出す
const parseAssistantContent = (content: string): { body: JSX.Element; inner: string } => {
  const cleaned = stripRememberTags(content);
  const parsed = isXmlResponse(cleaned) ? parseXmlResponse(cleaned) : null;
  if (parsed) {
    // action と dialogue は交互に何組も返ってくる（実測で1応答に10組）。節ごとにまとめると
    // 「地の文まとめ→台詞まとめ」に組み替わって、書かれた場面の時系列が壊れる。
    // blocks は出現順を保っとるので、そのまま並べる。
    const orderedBlocks =
      parsed.blocks.length > 0
        ? parsed.blocks
        : [
            { type: "action" as const, text: parsed.action },
            { type: "dialogue" as const, text: parsed.dialogue },
          ].filter((block) => block.text.trim().length > 0);
    return {
      inner: parsed.inner.trim(),
      body: (
        <>
          {parsed.narration ? (
            <p className="m-0 font-narrative text-[15px] italic leading-[1.85] text-[var(--dim)]">
              {parsed.narration}
            </p>
          ) : null}
          {orderedBlocks.map((block, index) =>
            block.type === "action" ? (
              <p
                key={`${block.type}-${index}`}
                className="m-0 font-narrative text-[14px] italic leading-[1.85] text-[var(--dim)]"
              >
                {formatAction(block.text)}
              </p>
            ) : (
              <p
                key={`${block.type}-${index}`}
                className="m-0 font-narrative text-[16.5px] font-medium leading-[1.85] text-[var(--text)]"
              >
                {block.text}
              </p>
            ),
          )}
        </>
      ),
    };
  }
  return {
    inner: "",
    body: (
      <p className="m-0 whitespace-pre-wrap font-narrative text-[16.5px] leading-[1.85] text-[var(--text)]">
        {cleaned}
      </p>
    ),
  };
};

// 発言者アバター。宴の各発言頭に置く 36px の丸アイコン
const SpeakerAvatar = ({
  speaker,
  avatar,
}: {
  speaker: string;
  avatar: string | null;
}): JSX.Element => (
  <Avatar className="mt-0.5 h-9 w-9 shrink-0 border border-[var(--lamp-45)]">
    {isAvatarImage(avatar) ? (
      <AvatarImage src={resolveAvatarSrc(avatar) ?? ""} alt={speaker} />
    ) : null}
    <AvatarFallback>{getAvatarFallback(speaker)}</AvatarFallback>
  </Avatar>
);

// ストリーミング中の表示。まだ本文が無いときは「◯◯が書いています…」、出始めたら本文 + 明滅キャレット
const StreamingAssistant = ({
  content,
  speaker,
  avatar,
}: {
  content: string;
  speaker: string;
  avatar: string | null;
}): JSX.Element => {
  const streamingText = stripXmlTagsStreaming(content);
  if (!streamingText.trim()) {
    return (
      <div className="mb-4 flex items-center gap-2.5 text-[11.5px] text-[var(--faint)]">
        <Avatar className="h-[26px] w-[26px] opacity-80">
          {isAvatarImage(avatar) ? (
            <AvatarImage src={resolveAvatarSrc(avatar) ?? ""} alt={speaker} />
          ) : null}
          <AvatarFallback>{getAvatarFallback(speaker)}</AvatarFallback>
        </Avatar>
        {speaker}が書いています…
        <span className="inline-block h-3 w-0.5 animate-pulse bg-[var(--lamp)]" />
      </div>
    );
  }
  return (
    <div className="mb-[18px] flex gap-[11px]">
      <SpeakerAvatar speaker={speaker} avatar={avatar} />
      <div className="min-w-0 flex-1">
        <div className="mb-[5px] font-narrative text-[12.5px] text-[var(--lamp)]">{speaker}</div>
        <p className="m-0 whitespace-pre-wrap font-narrative text-[16.5px] leading-[1.85] text-[var(--text)]">
          {streamingText}
          <span className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[2px] animate-pulse bg-[var(--lamp)]" />
        </p>
      </div>
    </div>
  );
};

const AssistantMessage = ({
  message,
  character,
}: {
  message: GroupMessage;
  character: GroupCharacter | undefined;
}): JSX.Element => {
  const speaker = character?.name ?? "AI";
  const avatar = character?.avatar ?? null;

  if (message.isStreaming) {
    return <StreamingAssistant content={message.content} speaker={speaker} avatar={avatar} />;
  }

  const { body, inner } = parseAssistantContent(message.content);
  return (
    <div className="mb-[18px] flex gap-[11px]">
      <SpeakerAvatar speaker={speaker} avatar={avatar} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="font-narrative text-[12.5px] text-[var(--lamp)]">{speaker}</div>
        {body}
        {inner ? (
          <p className="m-0 border-l border-[var(--lamp-30)] pl-3 font-narrative text-[13px] italic leading-[1.9] text-[var(--faint)]">
            {inner}
          </p>
        ) : null}
        {message.error ? (
          <p className="m-0 text-xs font-medium text-[var(--destructive)]">送信に失敗しました</p>
        ) : null}
      </div>
    </div>
  );
};

const UserMessage = ({ content }: { content: string }): JSX.Element => (
  <div className="mb-[18px]">
    <div className="mb-1.5 text-right text-[11px] tracking-[0.14em] text-[var(--faint)]">
      あなた
    </div>
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-[20px_20px_7px_20px] border border-[var(--lamp-30)] bg-gradient-to-br from-[var(--lamp-22)] to-[var(--lamp-14)] px-[17px] py-3 text-sm leading-[1.7] text-[var(--text)]">
        {content}
      </div>
    </div>
  </div>
);

const GroupMessageItem = ({
  message,
  characterById,
}: {
  message: GroupMessage;
  characterById: Map<string, GroupCharacter>;
}): JSX.Element => {
  const nsfwBlur = useSettingsStore((s) => s.nsfwBlur);
  const character = message.speakerCharacterId
    ? characterById.get(message.speakerCharacterId)
    : undefined;

  // 画像付きメッセージ（履歴由来）は認証取得・ぼかし・ビューワーを備えた MessageBubble に委譲し、既存挙動を保つ
  if (message.imageUrl) {
    return (
      <MessageBubble
        id={message.id}
        role={message.role}
        content={message.content}
        imageUrl={message.imageUrl}
        isStreaming={message.isStreaming}
        error={message.error}
        warningLevel={message.warningLevel}
        characterName={message.role === "assistant" ? (character?.name ?? "AI") : undefined}
        characterAvatar={message.role === "assistant" ? (character?.avatar ?? null) : undefined}
        showLabel={message.role === "assistant"}
        nsfwBlur={nsfwBlur}
      />
    );
  }

  if (message.role === "user") {
    return <UserMessage content={message.content} />;
  }
  return <AssistantMessage message={message} character={character} />;
};

// 「誰に振る」チップ: 会話停滞を避けるため、対象キャラ指定や成り行きを既存 send 経路に流し込む
const DirectionChips = ({
  characters,
  disabled,
  onPick,
}: {
  characters: GroupCharacter[];
  disabled: boolean;
  onPick: (hint: string) => void;
}): JSX.Element | null => {
  if (characters.length === 0) return null;
  return (
    <div className="flex justify-center px-4 pb-2">
      <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-[15px] border border-[var(--lamp-30)] px-3.5 py-[7px] text-[11px] text-[var(--dim)]">
        <span aria-hidden className="text-[var(--lamp)]">
          ◇
        </span>
        {characters.map((character, index) => (
          <span key={character.id} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-[var(--faint)]">・</span> : null}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(`（${character.name}に話を振って）`)}
              className="transition-colors hover:text-[var(--lamp)] disabled:opacity-50"
            >
              {character.name}に振る
            </button>
          </span>
        ))}
        <span className="text-[var(--faint)]">・</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick("（成り行きにまかせて）")}
          className="transition-colors hover:text-[var(--lamp)] disabled:opacity-50"
        >
          成り行きにまかせる
        </button>
      </div>
    </div>
  );
};

export const GroupView = ({ groupId, onRoute }: GroupViewProps): JSX.Element => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const groupMessages = useChatStore((state) => state.groupMessages);
  const isLoading = useChatStore((state) => state.isLoading);
  const setLoading = useChatStore((state) => state.setLoading);
  const setActiveGroupId = useChatStore((state) => state.setActiveGroupId);
  const setGroupMessages = useChatStore((state) => state.setGroupMessages);
  const addGroupMessage = useChatStore((state) => state.addGroupMessage);
  const updateGroupMessage = useChatStore((state) => state.updateGroupMessage);
  const markGroupMessageError = useChatStore((state) => state.markGroupMessageError);

  const groupQuery = useQuery({
    queryKey: queryKey.group(groupId),
    queryFn: () => getGroup(groupId),
  });
  const messageQuery = useQuery({
    queryKey: queryKey.groupMessages(groupId),
    queryFn: () => listGroupMessages(groupId),
  });
  const characters = useMemo(() => groupQuery.data?.characters ?? [], [groupQuery.data]);
  const characterById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );

  useEffect(() => {
    setActiveGroupId(groupId);
    return () => setActiveGroupId(null);
  }, [groupId, setActiveGroupId]);

  useEffect(() => {
    if (!messageQuery.data) return;
    setGroupMessages(messageQuery.data.messages);
  }, [messageQuery.data, setGroupMessages]);

  // draft 送信・チップ送信で共通の送信パイプライン。ラウンドロビンで発言者を1人選び順に返答させる
  const sendContent = async (content: string): Promise<void> => {
    const trimmed = content.trim();
    // 二重送信ガードは render 時の closure ではなく最新 store 値で判定する
    if (!trimmed || !groupQuery.data || useChatStore.getState().isLoading) return;

    const now = Date.now();
    const assistantCount = groupMessages.filter((message) => message.role === "assistant").length;
    const speakerId = selectRoundRobinSpeaker(groupQuery.data.characterIds, assistantCount);
    const assistantId = `group-assistant-${randomUUID()}`;
    addGroupMessage({
      id: `group-user-${randomUUID()}`,
      groupId,
      role: "user",
      speakerCharacterId: null,
      content: trimmed,
      createdAt: now,
    });
    addGroupMessage({
      id: assistantId,
      groupId,
      role: "assistant",
      speakerCharacterId: speakerId,
      content: "",
      isStreaming: true,
      createdAt: now + 1,
    });
    setLoading(true);

    await sendGroupMessage(
      groupId,
      { content: trimmed },
      (chunk) => {
        const current = useChatStore
          .getState()
          .groupMessages.find((message) => message.id === assistantId);
        updateGroupMessage(assistantId, `${current?.content ?? ""}${chunk}`, true);
      },
      (result) => {
        updateGroupMessage(assistantId, result.content, false, result.warningLevel);
        setLoading(false);
        void queryClient.invalidateQueries({ queryKey: queryKey.groupMessages(groupId) });
      },
      (error) => {
        markGroupMessageError(assistantId);
        setLoading(false);
        toast.error("送信に失敗しました");
        logger.error("Group message send failed", { error });
      },
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    // isLoading 中は draft を消さずに早期 return し、入力中テキストの消失を防ぐ。
    // sendContent と同様に render closure ではなく最新 store 値で判定し、再 render 前の window での draft 消失を防ぐ
    const content = draft.trim();
    if (!content || useChatStore.getState().isLoading) return;
    setDraft("");
    await sendContent(content);
  };

  const removeGroup = async (): Promise<void> => {
    if (!groupQuery.data) return;
    try {
      await deleteGroup(groupId);
      toast.success("グループを削除しました");
      await queryClient.invalidateQueries({ queryKey: queryKey.groupList });
      onRoute("/groups");
    } catch (error) {
      toast.error("削除に失敗しました");
      logger.error("Group deletion failed", { error });
    }
  };

  if (groupQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--night)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--lamp)]" />
      </div>
    );
  }

  if (!groupQuery.data) {
    return (
      <div className="flex h-full flex-col bg-[var(--night)] text-[var(--text)]">
        <GroupHeader title="グループ" characters={[]} onBack={() => onRoute("/groups")} />
        <div className="p-4 text-sm text-[var(--dim)]">グループが見つかりません。</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--night)] text-[var(--text)]">
      <GroupHeader
        title={groupQuery.data.name}
        characters={characters}
        onBack={() => onRoute("/groups")}
        onDelete={() => {
          void removeGroup();
        }}
      />
      <div className="flex-1 overflow-y-auto px-[26px] pt-5">
        {groupQuery.data.scenario ? (
          <p className="mb-5 font-narrative text-sm leading-8 text-[var(--dim)]">
            {groupQuery.data.scenario}
          </p>
        ) : null}
        {messageQuery.isPending ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--lamp)]" />
          </div>
        ) : null}
        {groupMessages.length === 0 && !messageQuery.isPending ? (
          <p className="py-6 text-center text-sm text-[var(--faint)]">
            最初のメッセージを送ると、キャラクターが順番に返答します。
          </p>
        ) : null}
        <div className="pb-4">
          {groupMessages.map((message) => (
            <GroupMessageItem key={message.id} message={message} characterById={characterById} />
          ))}
        </div>
      </div>
      <div className="border-t border-[var(--hairline)] bg-[var(--night)]/90 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <DirectionChips
          characters={characters}
          disabled={isLoading}
          onPick={(hint) => {
            void sendContent(hint);
          }}
        />
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="px-4"
        >
          <div className="flex items-end gap-[11px]">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={1}
              className="max-h-32 min-h-11 flex-1 resize-none rounded-3xl border border-[var(--hairline)] bg-[var(--night)]/70 px-[17px] py-3 font-narrative text-[15px] leading-[1.7] text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus-visible:border-[var(--lamp-45)]"
              placeholder="みんなに話しかける…"
              aria-label="メッセージを入力"
            />
            <button
              type="submit"
              disabled={!draft.trim() || isLoading}
              aria-label="送信"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-[var(--night)] transition-opacity disabled:opacity-40"
              style={{ background: "linear-gradient(145deg, var(--gold-cta), var(--lamp))" }}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "↑"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
