import { useCallback } from "react";

import {
  isCancelledError,
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  createConversation,
  createConversationMessage,
  deleteAllConversations,
  deleteConversation,
  deleteConversationMessage,
  deleteMessagesAfterMessage,
  listConversationMessages,
  listConversations,
  MessageAlreadyDeletedError,
  updateMessageImage as persistMessageImage,
  updateConversationCharacter,
  updateConversationTitle,
  updateMessageContent,
  type ConversationSummary,
  type PersistedMessage,
} from "@/lib/api";
import { queryKey } from "@/lib/query-key";
import type { ScenePhase } from "@/lib/scene-phase";
import { withDeadline } from "@/lib/with-deadline";
import type { ChatMessage } from "@/store/chat-store";

// 行1件の保存を待つ上限。api.ts の fetch 期限（20秒）＋往復のぶれを覆う長さにして、
// 「一時停止した mutation が返らない」だけをここで切る。
const MESSAGE_PERSIST_DEADLINE_MS = 30_000;

export const useChatQuery = (currentConversationId: string | null) => {
  const queryClient = useQueryClient();

  const {
    data: conversations = [],
    isPending: isConversationListPending,
    isFetching: isConversationListFetching,
  } = useQuery({
    queryKey: queryKey.conversationList,
    queryFn: listConversations,
  });

  const isMessageListFetching =
    useIsFetching({
      queryKey: currentConversationId
        ? queryKey.conversationMessageList(currentConversationId)
        : undefined,
    }) > 0;

  const createConversationMutation = useMutation({
    mutationFn: createConversation,
    onSuccess: (conversation) => {
      queryClient.setQueryData<ConversationSummary[]>(queryKey.conversationList, (previous) =>
        previous ? [conversation, ...previous] : [conversation],
      );
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_, conversationId) => {
      queryClient.setQueryData<ConversationSummary[]>(queryKey.conversationList, (previous) =>
        previous ? previous.filter((c) => c.id !== conversationId) : [],
      );
      queryClient.removeQueries({
        queryKey: queryKey.conversationMessageList(conversationId),
      });
    },
  });

  const deleteAllConversationsMutation = useMutation({
    mutationFn: deleteAllConversations,
    onSuccess: () => {
      queryClient.setQueryData<ConversationSummary[]>(queryKey.conversationList, []);
      queryClient.removeQueries({ queryKey: queryKey.conversationMessageListRoot });
    },
  });

  const updateConversationTitleMutation = useMutation({
    mutationFn: ({ conversationId, title }: { conversationId: string; title: string }) =>
      updateConversationTitle(conversationId, title),
    onSuccess: (_, { conversationId, title }) => {
      queryClient.setQueryData<ConversationSummary[]>(queryKey.conversationList, (previous) =>
        previous ? previous.map((c) => (c.id === conversationId ? { ...c, title } : c)) : [],
      );
    },
  });

  const updateConversationCharacterMutation = useMutation({
    mutationFn: ({
      conversationId,
      characterId,
    }: {
      conversationId: string;
      characterId: string;
    }) => updateConversationCharacter(conversationId, characterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey.conversationList });
    },
  });

  const createConversationMessageMutation = useMutation({
    mutationFn: createConversationMessage,
    // メッセージ作成時にconversationListをinvalidateすると全会話リストのrefetchが走る
    // メッセージリストのinvalidateも不要（Zustandストア側でリアルタイム管理している）
    //
    // 既定の retry: 1 は外す。id は呼び出し側が決めているため、タイムアウト直後に
    // サーバが commit していると、同じ主キーでの自動再送が 500 になる。行は在るのに
    // 「確実に失敗」と見えるので未送達へ戻され、UI からの再送で新しい id の重複行が増える。
    // 再投入は persist-turn.ts が「読み直して absent と確定した時だけ」行う。
    retry: 0,
  });

  const persistMessageImageMutation = useMutation({
    mutationFn: persistMessageImage,
    // メッセージ本体はZustandストアがリアルタイム管理するが、アルバム画面は
    // 別クエリ(queryKey.imageGallery)でサーバー集約結果を見ているためinvalidateが必要
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey.imageGallery });
    },
  });

  const updateMessageContentMutation = useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      updateMessageContent(messageId, content),
    // Zustandストア側でリアルタイム管理しているためinvalidate不要
  });

  const deleteMessagesAfterMutation = useMutation({
    mutationFn: ({ conversationId, messageId }: { conversationId: string; messageId: string }) =>
      deleteMessagesAfterMessage(conversationId, messageId),
    onSuccess: (_, { conversationId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKey.conversationMessageList(conversationId),
      });
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async ({
      conversationId,
      messageId,
    }: {
      conversationId: string;
      messageId: string;
    }) => {
      try {
        await deleteConversationMessage(conversationId, messageId);
      } catch (error) {
        // 既定の mutations.retry: 1 があるため、1回目の DELETE がサーバで commit した後に
        // 応答だけが期限切れになると、自動再送は「もう無い行」を消しに行って 404 を受ける。
        // 行は消えとる＝取り消しは成功しとるので、ここで投げると成功したロールバックを
        // 失敗と読み、画面と D1 の食い違いを残したまま閉じる。
        // 判定を api.ts の型に任せて、この DELETE の 404 だけを成功へ畳む。
        // ステータス番号で握り潰すと、会話が消えとる等の別の 404 まで巻き込む。
        if (!(error instanceof MessageAlreadyDeletedError)) throw error;
      }
    },
    onSuccess: (_, { conversationId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKey.conversationMessageList(conversationId),
      });
    },
  });

  const createConversationEntry = useCallback(
    async (input?: { title?: string; characterId?: string }) =>
      createConversationMutation.mutateAsync(input),
    [createConversationMutation],
  );

  const deleteConversationEntry = useCallback(
    async (conversationId: string) => deleteConversationMutation.mutateAsync(conversationId),
    [deleteConversationMutation],
  );

  const deleteAllConversationsEntry = useCallback(
    async () => deleteAllConversationsMutation.mutateAsync(),
    [deleteAllConversationsMutation],
  );

  const updateConversationTitleEntry = useCallback(
    async (conversationId: string, title: string) =>
      updateConversationTitleMutation.mutateAsync({ conversationId, title }),
    [updateConversationTitleMutation],
  );

  const updateConversationCharacterEntry = useCallback(
    async (conversationId: string, characterId: string) =>
      updateConversationCharacterMutation.mutateAsync({ conversationId, characterId }),
    [updateConversationCharacterMutation],
  );

  const createMessageEntry = useCallback(
    async (input: {
      conversationId: string;
      id: string;
      role: "system" | "user" | "assistant";
      content: string;
      imageUrl?: string;
      imageKey?: string;
      imagePrompt?: string | null;
      imageSeed?: string | null;
      imageLoraModel?: string | null;
      imageLoraWeight?: number | null;
      imageLoraTriggerPrompt?: string | null;
      retryCount?: number;
      refusalDetected?: boolean;
      generationModel?: string;
      generationPhase?: ScenePhase;
    }) => {
      // この mutation は networkMode: "online"。接続が落ちると失敗せずに一時停止し、
      // mutateAsync が解決も棄却もしなくなる。永続化とその入れ直しは送信ロック解除の
      // 手前に居るため、返らなければ入力欄が永久に disabled で残る。
      // とくに入れ直しは「在否を確かめた後」＝接続が既に怪しい場面で走るので、
      // ここで必ず時間を切る。転送の都合なので persist-turn.ts へは持ち込まない。
      // 期限は fetch 自体の期限（api.ts の 20 秒）より長くする。短くすると本来の
      // タイムアウトがこの期限に隠れて、原因が分からなくなる。
      //
      // 待つのをやめるだけでは足りない。期限が勝った後、呼び出し側は
      // 「在否は不明」として読み直し（persist-turn.ts）、行が無ければ画面を
      // そちらへ揃える。その間も一時停止した mutation は待ち行列に残っており、
      // 再接続で走って行を書く。揃え終わったターンの行が後から生えるので、
      // 画面が捨てた発言だけが D1 に残る。だから期限では中断まで行う。
      // react-query には一時停止中の mutation を取り消す API が無い。代わりに
      // signal を先に abort しておくと、再開して mutationFn が走った時点で
      // fetch が即座に落ちる（api.ts で AbortSignal.any に畳んである）。
      // 残る隙は、mutationFn が既に fetch を投げた後にサーバ側が commit する場合。
      // これは中断では消せないので、従来どおり persist-turn.ts の読み直しが受ける。
      const controller = new AbortController();
      try {
        await withDeadline(
          createConversationMessageMutation.mutateAsync({ ...input, signal: controller.signal }),
          MESSAGE_PERSIST_DEADLINE_MS,
          `${input.role} row persist`,
        );
      } catch (error) {
        controller.abort();
        throw error;
      }
    },
    [createConversationMessageMutation],
  );

  const persistMessageImageEntry = useCallback(
    async (input: {
      messageId: string;
      imageUrl?: string;
      imageKey?: string;
      imagePrompt?: string | null;
      imageSeed?: string | null;
      imageLoraModel?: string | null;
      imageLoraWeight?: number | null;
      imageLoraTriggerPrompt?: string | null;
    }) => {
      await persistMessageImageMutation.mutateAsync(input);
    },
    [persistMessageImageMutation],
  );

  const updateMessageContentEntry = useCallback(
    async (messageId: string, content: string) =>
      updateMessageContentMutation.mutateAsync({ messageId, content }),
    [updateMessageContentMutation],
  );

  const deleteMessagesAfterEntry = useCallback(
    async (conversationId: string, messageId: string) =>
      deleteMessagesAfterMutation.mutateAsync({ conversationId, messageId }),
    [deleteMessagesAfterMutation],
  );

  const deleteMessageEntry = useCallback(
    async (conversationId: string, messageId: string) =>
      deleteMessageMutation.mutateAsync({ conversationId, messageId }),
    [deleteMessageMutation],
  );

  // サーバから既に消えとる会話をキャッシュだけから外す。DELETE は投げん（投げると
  // 無い行を消しに行って 404 を受ける）。会話一覧は IndexedDB に24時間残るため、
  // 外さんと同じ死んだカードがリロード後も出続ける。
  const forgetConversation = useCallback(
    (conversationId: string) => {
      queryClient.setQueryData<ConversationSummary[]>(queryKey.conversationList, (previous) =>
        previous ? previous.filter((c) => c.id !== conversationId) : [],
      );
      queryClient.removeQueries({
        queryKey: queryKey.conversationMessageList(conversationId),
      });
    },
    [queryClient],
  );

  const loadMessages = useCallback(
    async (
      conversationId: string,
      options?: { timeoutMs?: number; fresh?: boolean },
    ): Promise<ChatMessage[]> => {
      // 永続化が失敗した後の建て直しから呼ばれる経路があるため、上限を渡せるようにする。
      // 上限が無いと、接続が固まった時にこの await が返らず、送信側の finally に届かない
      // まま入力欄が永久に disabled で残る（永久ロックを直すはずの経路が永久ロックする）。
      //
      // fresh は「キャッシュを返さず必ず取りに行く」ための指定。建て直しは
      // 「画面と D1 が食い違っとる」時に呼ぶので、キャッシュを返されたら
      // 食い違いをそのまま写して意味が無い。
      //
      // 上限つき（timeoutMs）か建て直し（fresh）の読みは fetchQuery を通さない。
      // fetchQuery は同じキーの取得が既に走っていればその promise をそのまま返す
      // （重複除去）ため、こちらが渡した timeoutMs も retry も staleTime も一切効かない。
      // 相乗り先が通常の履歴読み込み（上限なし・既定 retry: 1）だと、建て直しは
      // その最後まで待たされる。上限を足したつもりで永久に返らない
      // ＝ #993 で消したはずの永久ロックそのものになる。
      // 直接呼んで上限を確実に効かせ、結果はキャッシュへ書き戻して後続の読みへ渡す。
      // retry も掛からない＝ 10 秒渡したら最悪でも 10 秒で返る（fetchQuery 経由だと
      // 既定 retry: 1 が上限をリクエスト1本ごとに変えて倍待たせていた）。
      // 通常の履歴読み込みは従来どおり fetchQuery（キャッシュと retry）に任せる。
      // 上限つき・建て直しの読みは、同じキーで既に進行中の通常読み込み(fetchQuery)が
      // 在っても待たない設計にした。だがそれだけでは足りない。その古い読み込みは
      // キャンセルされたわけではないので、こちらが setQueryData した「後」にその古い
      // レスポンスが届くと、react-query は取得完了のたびにキャッシュへ自動で書き込む
      // ため、古い(このターンが確定する前に撮った)行がキャッシュを上書きする。
      // cancelQueries で同じキーの進行中フェッチを先に打ち切っておけば、そのフェッチは
      // 結果が届いても react-query 側でコミットされない(キャンセル済みとして無視される)。
      const key = queryKey.conversationMessageList(conversationId);
      const bounded = options?.timeoutMs !== undefined || options?.fresh === true;
      const rows = bounded
        ? await (async () => {
            await queryClient.cancelQueries({ queryKey: key });
            const fetched = await listConversationMessages(conversationId, options);
            queryClient.setQueryData(key, fetched);
            return fetched;
          })()
        : await queryClient
            .fetchQuery({
              queryKey: key,
              queryFn: () => listConversationMessages(conversationId, options),
            })
            .catch((error: unknown) => {
              // このフェッチが cancelQueries で打ち切られたのは、より新しい建て直しの
              // 読みに割り込まれたから(上の bounded 分岐を参照)。打ち切られた側の
              // 呼び出し元(restoreConversation 等)はエラーとして扱う理由が無い。
              // 割り込んだ側が既に書いた最新のキャッシュ値をそのまま返す。
              if (isCancelledError(error)) {
                return queryClient.getQueryData<PersistedMessage[]>(key) ?? [];
              }
              throw error;
            });
      return rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        // nullはundefinedに変換（ChatMessage型はstring|undefinedのみ許容するため）
        imageUrl: row.imageUrl ?? undefined,
        imageKey: row.imageKey ?? undefined,
        feedbackRating: row.feedbackRating ?? undefined,
        createdAt: row.createdAt,
      }));
    },
    [queryClient],
  );

  return {
    conversations,
    isConversationListLoading: isConversationListPending || isConversationListFetching,
    isMessageListLoading: isMessageListFetching,
    createConversationEntry,
    deleteConversationEntry,
    deleteAllConversationsEntry,
    updateConversationTitleEntry,
    updateConversationCharacterEntry,
    createMessageEntry,
    persistMessageImageEntry,
    updateMessageContentEntry,
    deleteMessagesAfterEntry,
    deleteMessageEntry,
    loadMessages,
    forgetConversation,
  };
};
