import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { cors } from "hono/cors";
import { z } from "zod/v4";

import { ALL_FIRST_PERSONS, extractFirstPerson } from "../../src/lib/chat-message-adapter";
import { imageGenTaskResultSchema, ImageGenProviderError } from "../../src/lib/image-gen/provider";
// エラーコードはクライアントの文言変換と同じ定数を使う。片側だけ書き換わると
// UI が原因不明の汎用メッセージへ落ちるため、型で結び付けておく。
import { IMAGE_IDENTITY_MISSING_CODE } from "../../src/lib/image-generation-error";
import { resolveLateTurnStrategy } from "../../src/lib/late-turn-strategy";
import {
  selectRelevantMemories,
  type MemoryNoteInput,
  type MemoryRelevanceContext,
} from "../../src/lib/memory-relevance";
import { buildPostureDirective } from "../../src/lib/posture-map";
import {
  MAX_RESPONSE_PLAIN_CHARS,
  categorizeQualityFailure,
  runQualityChecks,
} from "../../src/lib/quality-guard";
import { getPhaseTonePreservationDirective } from "../../src/lib/response-length-directive";
import {
  detectScenePhase,
  detectScenePhaseCandidates,
  hasSustainedForeplay,
  SUSTAINED_FOREPLAY_TURNS,
} from "../../src/lib/scene-phase";
import { characterTable, conversationTable, memoryNoteTable, messageTable } from "../../src/schema";

import {
  buildCharacterGenerationMessages,
  parseCharacterJsonFromLLM,
} from "./lib/character-generation";
import { buildIdentityPrompt } from "./lib/identity-prompt-builder";
import { detectExplicitContent } from "./lib/image-explicit-tags";
import { resolveCharacterImageIdentity } from "./lib/image-identity-context";
import {
  PHASE_GUARDRAILS,
  sanitizeImageTagsForPhase,
  stripConflictingLocationTags,
} from "./lib/image-phase-guardrails";
import {
  buildVisualAnchorPrompt,
  dedupePromptTags,
  hasUsableIdentityAnchor,
  NOVITA_HAIR_COLOR_NEGATIVE_TAGS,
  resolveVisualAnchorWeight,
  stripFloatingCumTags,
} from "./lib/image-prompt-anchors";
import { containsApologyLeak, shouldRetryWithPhase } from "./lib/persona-break-detect";
import {
  classifyPhaseDeEscalation,
  resolvePhaseAfterDeEscalation,
  resolveClientScenePhaseOverride,
  shouldAskPhaseDeEscalation,
  type PhaseDeEscalationResult,
} from "./lib/phase-de-escalation-classifier";
import {
  buildQualityIssuePayload,
  createQualityIssue,
  shouldReportQualityIssue,
} from "./lib/quality-report";
import { containsEroticEscalationCue, hardRefusalDetect, isInfraError } from "./lib/refusal-detect";
import {
  REPLY_SUGGESTION_COUNT,
  REPLY_SUGGESTION_HISTORY_TURNS,
  REPLY_SUGGESTION_MODEL,
  requestReplySuggestions,
  toReplySuggestionTurn,
  type ReplySuggestionTurn,
} from "./lib/reply-suggestion";
import {
  AUTO_MEMORY_PREFIX,
  CHAT_HISTORY_MAX_TURNS,
  CHAT_IMAGE_MODEL_BY_PHASE,
  CHAT_TRANSPORT_MAX_CHARS,
  CLAUDE_JUDGE_MODEL,
  COST_ESTIMATES,
  DEFAULT_CHARACTER_GENERATION_MODEL,
  GRACEFUL_REFUSAL_FALLBACK_TEXT,
  IMAGE_TASK_MAX_WAIT_MS,
  LORA_PINNED_RECIPE,
  MEMORY_EXTRACTION_MODEL,
  POV_USER_BODY_PATTERN,
  RESPONSE_LENGTH_PRESETS,
  SUGGESTION_MODEL,
  S_TIER_NEGATIVE_INJECTION,
  TASK_ID_PATTERN,
  TURN_GENERATION_HARD_CAP,
  resolveTurnWallClockCapMs,
  announceRegenerating,
  applyPhaseFloor,
  authMiddleware,
  applySelectedMemoryNotesToMessages,
  applyVlmLikenessGate,
  augmentMessages,
  branchConversationSchema,
  buildCreatedConversationResponse,
  buildOpenAISseChunks,
  buildRecentMessagesText,
  buildSceneDriftTelemetry,
  buildServerQualityContext,
  chatSchema,
  checkContentFilter,
  checkMessagesContent,
  claudeJudgeQuality,
  coercePostClimaxToAfterglow,
  conversationUpdateCharacterSchema,
  conversationUpdateTitleSchema,
  createDeferredSseSink,
  createImageRouterForEnv,
  enforceIdentitySourceGate,
  enforceRateLimit,
  ensureUser,
  extractCharacterAddress,
  extractCharacterEroticAnchor,
  extractCharacterName,
  extractScenePrefixFromPrompt,
  extractVisualAnchors,
  fetchAccountDisplayName,
  fetchCharacterForConversation,
  getVeryLongMaxTokensForPhase,
  countTrailingForeplayTurns,
  fetchLastAssistantGenerationPhase,
  fetchRecentAssistantGenerationPhases,
  fetchOwnedCharacterForSuggestions,
  fetchRecentMemoryNotes,
  resolveUserDisplayName,
  buildUserNameAndRoleGuard,
  resolveParticipantRoles,
  formatSuggestionHistory,
  generateCharacterSchema,
  generateTitleSchema,
  getCharacterReferenceImageBase64,
  getMessageContentLength,
  getUserEmail,
  httpStatusForChatUpstreamErrorCode,
  idSchema,
  imageSchema,
  insertSystemDirectiveBeforeLastUser,
  isClaudeSessionExpiredError,
  judgeSchema,
  loadVisualMeta,
  logUsage,
  markUsedMemoryNotes,
  memoryExtractSchema,
  messageCreateSchema,
  messageUpdateContentSchema,
  normalizeAutoMemoryContent,
  overrideUserPersonaMessage,
  persistServedQualityMeasurement,
  pickNonRepeatingTag,
  prepareAssistantContent,
  selectUnsavedMemoryNotes,
  type DatabaseClient,
  readImageTaskStartedAt,
  readVlmLikenessGateContext,
  renderChunksAsRelayableSse,
  requestContextualSuggestions,
  rejectAndRelease,
  requestMemoryExtractionFacts,
  requestQualityCheckedChat,
  resolveChatRouting,
  resolvePhaseSampling,
  resolveJudgeSceneName,
  resolveMemoryFactSourceIds,
  resolvePhaseAwareResponseLength,
  resolveSceneConstraintMemo,
  respondClaudeSessionExpired,
  runShadowVariantMeasurement,
  replySuggestionsSchema,
  selectQualityRetryModel,
  suggestionsSchema,
  toMemoryExtractionTurn,
  translatePromptToImageTags,
  trimChatMessagesToBudget,
  validateCharacterOwnership,
  validateImageGenerationOwnership,
  writeImageTaskStartedAt,
  writeVlmLikenessGateContext,
  type Bindings,
  type ChatGenerationParams,
  type ImageInput,
  type LiveChatRelay,
  type QualityCheckedChat,
  type SceneConstraintMemo,
  type ScenePhase,
  type TranslatedImageTags,
} from "./lib/route-context";
import { escapeNameForPromptQuote, sanitizeUserRoleContent } from "./lib/sanitize-injection";
import {
  resolveSceneBackground,
  updateConversationSceneState,
} from "./lib/scene-background-resolver";
import { notifySlackError } from "./lib/slack-error-notifier";
import {
  classifySubtextEscalation,
  resolveSubtextEscalationRequest,
} from "./lib/subtext-escalation-classifier";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { avatarRoutes } from "./routes/avatar";
import { characterRoutes } from "./routes/characters";
import { conversationRoutes } from "./routes/conversations";
import { groupRoutes } from "./routes/groups";
import { imageRoutes } from "./routes/images";
import { memoryRoutes } from "./routes/memory";
import { sceneBookmarkRoutes } from "./routes/scene-bookmarks";
import { shareRoutes } from "./routes/share";

import type { ImageMetaAnchors } from "./lib/image-meta-anchor";

// [[route]].ts は他ファイル(functions/api/__tests__/*, src/lib/*, chat-graph/*)から
// 個別 export を直接 import される公開境界でもあるため、route-context.ts の全量を再輸出する。
export * from "./lib/route-context";

// very_long erotic/climax でキャラ固有情報を再掲する対象キャラ。
const TARGET_VERY_LONG_CHARACTER_IDS = new Set([
  "char-koharu-ex",
  "import-charap-ダウナーお姉さんに拾われる話",
]);

// <remember> 由来のノートを、既に保存済みの分を除いてから入れる。
// fetchRecentMemoryNotes は直近 20 行しか引かんので、重複が入ると本物の古い事実が
// 窓から押し出される。メッセージ作成と更新の 2 経路で同じことをするので 1 箇所に置く。
const insertUnsavedRememberNotes = async (input: {
  database: DatabaseClient;
  userId: string;
  characterId: string;
  notes: readonly string[];
  sourceMessageId: string;
  createdAt: number;
}): Promise<void> => {
  if (input.notes.length === 0) return;
  const alreadySaved = await input.database
    .select({ content: memoryNoteTable.content })
    .from(memoryNoteTable)
    .where(
      and(
        eq(memoryNoteTable.userId, input.userId),
        eq(memoryNoteTable.characterId, input.characterId),
      ),
    );
  const unsaved = selectUnsavedMemoryNotes(
    alreadySaved.map((row: { content: string }) => row.content),
    input.notes,
  );
  if (unsaved.length === 0) return;
  // D1 local では drizzle transaction が BEGIN を発行して失敗するため逐次実行する
  await input.database.insert(memoryNoteTable).values(
    unsaved.map((note) => ({
      id: crypto.randomUUID(),
      userId: input.userId,
      characterId: input.characterId,
      content: note,
      sourceMessageId: input.sourceMessageId,
      createdAt: input.createdAt,
    })),
  );
};

export const app = new Hono<{ Bindings: Bindings }>()
  .basePath("/api")
  .use(
    "*",
    cors({
      origin: (origin, c) => {
        const appOrigin = c.env.APP_ORIGIN;
        const allowed = [
          "http://localhost:5173",
          "http://localhost:4173",
          "http://localhost:8788",
          ...(appOrigin ? [appOrigin] : []),
        ];
        return allowed.includes(origin) || !origin ? origin : null;
      },
    }),
  )
  .get("/health", (c) => c.json({ ok: true }))
  .use("*", authMiddleware)
  .use("*", async (c, next) => {
    await next();
    if (c.res.status >= 500) {
      await notifySlackError({
        context: c,
        source: "status",
        statusCode: c.res.status,
        error: "HTTP " + c.res.status + " response",
        labels: { kind: "http_response" },
      });
    }
  })
  .onError(async (error, c) => {
    await notifySlackError({
      context: c,
      source: "api",
      statusCode: 500,
      error,
      labels: { kind: "unhandled_exception" },
    });
    return c.json({ error: "internal_error" }, 500);
  })

  .route("/", authRoutes)

  .post("/suggestions", zValidator("json", suggestionsSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const payload = c.req.valid("json");
    const rl = await enforceRateLimit(c, drizzle(c.env.DB), userEmail, "suggestions");
    if (!rl.ok) return c.json({ error: `rate_limited: ${rl.reason}` }, 429);
    const { database, userId } = rl.ctx;

    const character = await fetchOwnedCharacterForSuggestions(
      database,
      payload.characterId,
      userId,
    );
    if (!character) {
      return rejectAndRelease(c, rl, "suggestions", { error: "character not found" }, 404);
    }

    const recentMessagesText = formatSuggestionHistory(payload.recentMessages);
    const allNotes = await fetchRecentMemoryNotes(
      database,
      userId,
      payload.characterId,
      recentMessagesText,
    );
    const relevanceContext: MemoryRelevanceContext = {
      recentMessagesText,
      scenePhase: payload.scenePhase,
      characterName: character.name,
      now: Date.now(),
    };
    const memoryNotes = selectRelevantMemories(allNotes, relevanceContext, 5);

    const suggestions = await requestContextualSuggestions({
      sessionToken: c.env.CLAUDE_SESSION_TOKEN,
      characterName: character.name,
      scenePhase: payload.scenePhase,
      recentMessages: payload.recentMessages,
      memoryNotes,
    });
    if (!suggestions || suggestions.length < 3) {
      return rejectAndRelease(c, rl, "suggestions", { error: "suggestion_unavailable" }, 503);
    }

    c.executionCtx.waitUntil(logUsage(database, userId, "suggestions", SUGGESTION_MODEL));
    return c.json({ suggestions });
  })

  // ── 返信候補 ──────────────────────────────────────────────────────────────
  // 「次のメッセージなんて送ればいいか迷う」時に、プレイヤー側の発言候補を3件返す
  // （局長 2026-08-17）。履歴はクライアントから受け取らず、conversationId で引く。
  // 送信済みの本文とキャラシートはサーバが持っとるので、チャット本線と同じ土台で組める。
  .post("/reply-suggestions", zValidator("json", replySuggestionsSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const payload = c.req.valid("json");
    if (!idSchema.safeParse(payload.conversationId).success) {
      return c.json({ error: "invalid conversation id" }, 400);
    }

    const rl = await enforceRateLimit(c, drizzle(c.env.DB), userEmail, "reply-suggestions");
    if (!rl.ok) return c.json({ error: `rate_limited: ${rl.reason}` }, 429);
    const { database, userId } = rl.ctx;

    const character = await fetchCharacterForConversation(database, userId, payload.characterId);
    if (!character) {
      return rejectAndRelease(c, rl, "reply-suggestions", { error: "character not found" }, 404);
    }

    const conversationId = payload.conversationId;
    if (conversationId !== undefined) {
      const conversationRows = await database
        .select({ characterId: conversationTable.characterId })
        .from(conversationTable)
        .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)))
        .limit(1);
      const conversation = conversationRows[0];
      if (!conversation) {
        return rejectAndRelease(
          c,
          rl,
          "reply-suggestions",
          { error: "conversation not found" },
          404,
        );
      }
      if (conversation.characterId !== payload.characterId) {
        return rejectAndRelease(c, rl, "reply-suggestions", { error: "character mismatch" }, 400);
      }
    }

    const recentRows =
      conversationId === undefined
        ? []
        : await database
            .select({ role: messageTable.role, content: messageTable.content })
            .from(messageTable)
            .where(
              and(
                eq(messageTable.userId, userId),
                eq(messageTable.conversationId, conversationId),
                inArray(messageTable.role, ["user", "assistant"]),
              ),
            )
            .orderBy(desc(messageTable.createdAt))
            .limit(REPLY_SUGGESTION_HISTORY_TURNS * 2);
    const turns = [...recentRows]
      .reverse()
      .map(toReplySuggestionTurn)
      .filter((turn): turn is ReplySuggestionTurn => turn !== null);

    // 段階は本線チャットが書き残した generation_phase を最優先で使う。キーワード判定へ
    // 落ちるのは AI 応答が1手も無い会話だけ——そこは判定材料自体が無い。
    const recordedPhase =
      conversationId === undefined
        ? null
        : await fetchLastAssistantGenerationPhase(database, userId, conversationId);
    const accountDisplayName = await fetchAccountDisplayName(database, userId);
    const suggestions = await requestReplySuggestions({
      apiKey: c.env.OPENROUTER_API_KEY,
      appOrigin: c.env.APP_ORIGIN ?? "https://ai-chat.app",
      apiBase: c.env.MOCK_API_BASE,
      context: {
        characterName: character.name,
        characterSheet: character.systemPrompt,
        persona: {
          // 呼び名の解決順はチャット本線と同じ。ここだけ別やと、候補の中の一人称と
          // 実際にキャラが呼ぶ名前が食い違う。
          name:
            resolveUserDisplayName(character.userPersonaName?.trim() ?? null, accountDisplayName) ??
            null,
          gender: character.userPersonaGender,
          personality: character.userPersonaPersonality,
        },
        scenePhase: recordedPhase ?? (turns.length > 0 ? detectScenePhase(turns) : null),
        turns,
        greeting: character.greeting,
      },
    });

    if (suggestions.length < REPLY_SUGGESTION_COUNT) {
      return rejectAndRelease(c, rl, "reply-suggestions", { error: "suggestion_unavailable" }, 503);
    }

    c.executionCtx.waitUntil(
      logUsage(database, userId, "reply-suggestions", REPLY_SUGGESTION_MODEL),
    );
    return c.json({ suggestions });
  })

  .post(
    "/conversations/:conversationId/branch",
    zValidator("json", branchConversationSchema),
    async (c) => {
      const userEmail = await getUserEmail(c);
      if (!userEmail) return c.json({ error: "unauthorized" }, 401);

      const conversationId = c.req.param("conversationId");
      if (!idSchema.safeParse(conversationId).success) {
        return c.json({ error: "invalid conversation id" }, 400);
      }

      const { messageId, title } = c.req.valid("json");
      const database = drizzle(c.env.DB);
      const userId = await ensureUser(database, userEmail);

      const conversationRows = await database
        .select({
          title: conversationTable.title,
          characterId: conversationTable.characterId,
        })
        .from(conversationTable)
        .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)))
        .limit(1);
      const sourceConversation = conversationRows[0];
      if (!sourceConversation) return c.json({ error: "conversation not found" }, 404);

      const pivotRows = await database
        .select({ createdAt: messageTable.createdAt, rowid: sql<number>`rowid` })
        .from(messageTable)
        .where(
          and(
            eq(messageTable.id, messageId),
            eq(messageTable.conversationId, conversationId),
            eq(messageTable.userId, userId),
          ),
        )
        .limit(1);
      const pivot = pivotRows[0];
      if (!pivot) return c.json({ error: "message not found" }, 404);

      const now = Date.now();
      const newConversationId = crypto.randomUUID();
      await database.insert(conversationTable).values({
        id: newConversationId,
        userId,
        characterId: sourceConversation.characterId,
        title: title ?? `分岐: ${sourceConversation.title}`.slice(0, 200),
        parentConversationId: conversationId,
        branchedFromMessageId: messageId,
        createdAt: now,
        updatedAt: now,
      });

      try {
        const sourceMessages = await database
          .select({
            id: messageTable.id,
            role: messageTable.role,
            content: messageTable.content,
            imageUrl: messageTable.imageUrl,
            imageKey: messageTable.imageKey,
            imagePrompt: messageTable.imagePrompt,
            imageSeed: messageTable.imageSeed,
            createdAt: messageTable.createdAt,
            rowid: sql<number>`rowid`,
          })
          .from(messageTable)
          .where(
            and(
              eq(messageTable.conversationId, conversationId),
              eq(messageTable.userId, userId),
              sql`(${messageTable.createdAt} < ${pivot.createdAt} OR (${messageTable.createdAt} = ${pivot.createdAt} AND rowid <= ${pivot.rowid}))`,
            ),
          )
          .orderBy(asc(messageTable.createdAt), asc(sql<number>`rowid`));

        const pivotIndex = sourceMessages.findIndex((message) => message.id === messageId);
        if (pivotIndex < 0) throw new Error("branch pivot disappeared during copy");
        const messagesToCopy = sourceMessages.slice(0, pivotIndex + 1);

        if (messagesToCopy.length > 0) {
          await database.insert(messageTable).values(
            messagesToCopy.map((message, index) => ({
              id: crypto.randomUUID(),
              userId,
              conversationId: newConversationId,
              characterId: sourceConversation.characterId,
              role: message.role,
              content: message.content,
              imageUrl: message.imageUrl,
              imageKey: message.imageKey,
              imagePrompt: message.imagePrompt,
              imageSeed: message.imageSeed,
              createdAt: now + index + 1,
            })),
          );
        }
      } catch (copyError) {
        await database
          .delete(messageTable)
          .where(
            and(
              eq(messageTable.conversationId, newConversationId),
              eq(messageTable.userId, userId),
            ),
          );
        await database
          .delete(conversationTable)
          .where(
            and(eq(conversationTable.id, newConversationId), eq(conversationTable.userId, userId)),
          );
        throw copyError;
      }

      const conversation = await buildCreatedConversationResponse(
        database,
        userId,
        newConversationId,
        title ?? `分岐: ${sourceConversation.title}`.slice(0, 200),
        now,
        sourceConversation.characterId,
        {
          parentConversationId: conversationId,
          branchedFromMessageId: messageId,
          parentTitle: sourceConversation.title,
        },
      );

      return c.json({ conversation }, 201);
    },
  )

  // ── 会話タイトル更新 ────────────────────────────────────────────────────
  .patch(
    "/conversations/:conversationId/title",
    zValidator("json", conversationUpdateTitleSchema),
    async (c) => {
      const userEmail = await getUserEmail(c);
      if (!userEmail) return c.json({ error: "unauthorized" }, 401);

      const conversationId = c.req.param("conversationId");
      if (!idSchema.safeParse(conversationId).success) {
        return c.json({ error: "invalid conversation id" }, 400);
      }

      const { title } = c.req.valid("json");
      const database = drizzle(c.env.DB);
      const userId = await ensureUser(database, userEmail);

      await database
        .update(conversationTable)
        .set({ title, updatedAt: Date.now() })
        .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)));

      return c.json({ ok: true });
    },
  )

  // ── 会話キャラクター変更 ────────────────────────────────────────────────
  .patch(
    "/conversations/:conversationId/character",
    zValidator("json", conversationUpdateCharacterSchema),
    async (c) => {
      const userEmail = await getUserEmail(c);
      if (!userEmail) return c.json({ error: "unauthorized" }, 401);

      const conversationId = c.req.param("conversationId");
      if (!idSchema.safeParse(conversationId).success) {
        return c.json({ error: "invalid conversation id" }, 400);
      }

      const { characterId } = c.req.valid("json");
      const database = drizzle(c.env.DB);
      const userId = await ensureUser(database, userEmail);
      const fallbackCharacterId = (
        await database
          .select({ id: characterTable.id })
          .from(characterTable)
          .where(eq(characterTable.userId, userId))
          .orderBy(asc(characterTable.displayOrder), desc(characterTable.createdAt))
          .limit(1)
      )[0]?.id;
      if (!characterId && !fallbackCharacterId) {
        return c.json(
          {
            error: "character required",
            message: "Please create your first character before starting a conversation.",
          },
          400,
        );
      }

      const resolvedCharacterId = characterId ?? fallbackCharacterId;
      if (!resolvedCharacterId) {
        return c.json({ error: "no_character" }, 400);
      }

      const charExists = await database
        .select({ id: characterTable.id })
        .from(characterTable)
        .where(and(eq(characterTable.id, resolvedCharacterId), eq(characterTable.userId, userId)))
        .limit(1);

      if (charExists.length === 0) {
        return c.json({ error: "character not found" }, 404);
      }

      await database
        .update(conversationTable)
        .set({ characterId: resolvedCharacterId, updatedAt: Date.now() })
        .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)));

      return c.json({ ok: true });
    },
  )

  // ── 会話タイトル自動生成 ────────────────────────────────────────────────
  .post(
    "/conversations/:conversationId/generate-title",
    zValidator("json", generateTitleSchema),
    async (c) => {
      const userEmail = await getUserEmail(c);
      if (!userEmail) return c.json({ error: "unauthorized" }, 401);

      const conversationId = c.req.param("conversationId");
      if (!idSchema.safeParse(conversationId).success) {
        return c.json({ error: "invalid conversation id" }, 400);
      }

      const { messages, model } = c.req.valid("json");

      const rl = await enforceRateLimit(c, drizzle(c.env.DB), userEmail, "generate-title");
      if (!rl.ok) {
        return c.json({ error: `rate_limited: ${rl.reason}` }, 429);
      }
      const { database, userId } = rl.ctx;

      // ユーザーとAI最初の応答からタイトルを生成
      const titleMessages = [
        {
          role: "system" as const,
          content:
            "会話内容から日本語の短いタイトルを生成してください。タイトルは20文字以内で、会話の主題を表すものにしてください。タイトルのテキストのみを出力してください（説明や引用符は不要）。",
        },
        ...messages.slice(0, 4),
        {
          role: "user" as const,
          content: "上記の会話のタイトルを20文字以内の日本語で生成してください。",
        },
      ];

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": c.env.APP_ORIGIN ?? "https://ai-chat.app",
        },
        body: JSON.stringify({
          model,
          messages: titleMessages,
          stream: false,
          max_tokens: 50,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        console.error("title generation error:", response.status);
        return c.json({ title: null });
      }

      const titleResponseSchema = z.object({
        choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
      });
      const parsed = titleResponseSchema.safeParse(await response.json());
      const title = parsed.success
        ? parsed.data.choices[0].message.content.trim().slice(0, 30)
        : null;

      if (title) {
        await database
          .update(conversationTable)
          .set({ title, updatedAt: Date.now() })
          .where(
            and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)),
          );
      }

      c.executionCtx.waitUntil(logUsage(database, userId, "generate-title", model));
      return c.json({ title });
    },
  )

  .route("/memory-notes", memoryRoutes)

  .post("/memory/extract", zValidator("json", memoryExtractSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const payload = c.req.valid("json");
    const rl = await enforceRateLimit(c, drizzle(c.env.DB), userEmail, "memory-extract");
    if (!rl.ok) return c.json({ error: `rate_limited: ${rl.reason}` }, 429);
    const { database, userId } = rl.ctx;
    const now = Date.now();

    const owned = await validateCharacterOwnership(database, payload.characterId, userId);
    if (!owned) {
      return rejectAndRelease(c, rl, "memory-extract", { error: "character not found" }, 404);
    }

    const conversationRows = await database
      .select({ id: conversationTable.id, characterId: conversationTable.characterId })
      .from(conversationTable)
      .where(
        and(eq(conversationTable.id, payload.conversationId), eq(conversationTable.userId, userId)),
      )
      .limit(1);
    const conversation = conversationRows[0];
    if (!conversation) {
      return rejectAndRelease(c, rl, "memory-extract", { error: "conversation not found" }, 404);
    }
    if (conversation.characterId !== payload.characterId) {
      return rejectAndRelease(c, rl, "memory-extract", { error: "character mismatch" }, 400);
    }

    const recentRows = await database
      .select({
        id: messageTable.id,
        role: messageTable.role,
        content: messageTable.content,
        createdAt: messageTable.createdAt,
      })
      .from(messageTable)
      .where(
        and(
          eq(messageTable.userId, userId),
          eq(messageTable.conversationId, payload.conversationId),
          eq(messageTable.characterId, payload.characterId),
          inArray(messageTable.role, ["user", "assistant"]),
          payload.since === undefined ? undefined : gt(messageTable.createdAt, payload.since),
        ),
      )
      .orderBy(desc(messageTable.createdAt))
      .limit(50);

    const turns = [...recentRows]
      .reverse()
      .map(toMemoryExtractionTurn)
      .filter((turn) => turn !== null);

    if (turns.length < 2) {
      return rejectAndRelease(c, rl, "memory-extract", { inserted: 0, facts: [] }, 200);
    }

    const character = await fetchCharacterForConversation(database, userId, payload.characterId);
    const characterName = character?.name ?? "AI";
    const extractedFacts = await requestMemoryExtractionFacts(c.env, characterName, turns);
    const validMessageIds = new Set(turns.map((turn) => turn.id));
    const fallbackMessageId = turns.at(-1)?.id ?? null;
    const returnedFacts: Array<{
      characterId: string;
      content: string;
      importance: number;
      sourceMessageIds: string[];
    }> = [];
    const seenContents = new Set<string>();

    for (const fact of extractedFacts) {
      const content = normalizeAutoMemoryContent(fact.content);
      const dedupeKey = content.toLowerCase();
      if (!content || seenContents.has(dedupeKey)) continue;
      seenContents.add(dedupeKey);

      const storedContent = `${AUTO_MEMORY_PREFIX}${content}`;
      const existing = await database
        .select({ id: memoryNoteTable.id })
        .from(memoryNoteTable)
        .where(
          and(
            eq(memoryNoteTable.userId, userId),
            eq(memoryNoteTable.characterId, payload.characterId),
            or(eq(memoryNoteTable.content, content), eq(memoryNoteTable.content, storedContent)),
          ),
        )
        .limit(1);

      if (existing.length > 0) continue;

      const sourceMessageIds = resolveMemoryFactSourceIds(fact, validMessageIds, fallbackMessageId);
      await database.insert(memoryNoteTable).values({
        id: crypto.randomUUID(),
        userId,
        characterId: payload.characterId,
        content: storedContent,
        sourceMessageId: sourceMessageIds[0] ?? null,
        createdAt: now,
        lastUsedAt: null,
        usageCount: 0,
      });

      returnedFacts.push({
        characterId: payload.characterId,
        content,
        importance: fact.importance,
        sourceMessageIds,
      });
    }

    c.executionCtx.waitUntil(logUsage(database, userId, "memory-extract", MEMORY_EXTRACTION_MODEL));
    // 抽出済みの境界をクライアントへ返す。次回はこれを since として送ってもらう。
    // 返さんかったら毎ターン直近50件を読み直すことになり、同じ往復を何度も 8B へ食わせる。
    // 抽出が走らんかった早期 return では返さん（読んだだけの往復を未抽出のまま飛ばすため）。
    const nextSince = recentRows[0]?.createdAt;
    return c.json({ inserted: returnedFacts.length, facts: returnedFacts, nextSince });
  })

  .route("/scene-bookmarks", sceneBookmarkRoutes)

  .post(
    "/conversations/:conversationId/messages",
    zValidator("json", messageCreateSchema),
    async (c) => {
      const userEmail = await getUserEmail(c);
      if (!userEmail) {
        return c.json({ error: "unauthorized" }, 401);
      }

      const conversationId = c.req.param("conversationId");
      if (!idSchema.safeParse(conversationId).success) {
        return c.json({ error: "invalid conversation id" }, 400);
      }

      const database = drizzle(c.env.DB);
      const userId = await ensureUser(database, userEmail);
      const payload = c.req.valid("json");

      const conversation = await database
        .select({ id: conversationTable.id, characterId: conversationTable.characterId })
        .from(conversationTable)
        .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)))
        .limit(1);

      const currentConversation = conversation[0];
      if (!currentConversation) {
        return c.json({ error: "conversation not found" }, 404);
      }

      const now = Date.now();
      const assistantContent =
        payload.role === "assistant"
          ? prepareAssistantContent(payload.content)
          : { rememberNotes: [], visibleContent: payload.content };

      try {
        await database.insert(messageTable).values({
          id: payload.id,
          userId,
          conversationId,
          characterId: currentConversation.characterId,
          role: payload.role,
          content: assistantContent.visibleContent,
          imageUrl: payload.imageUrl,
          imageKey: payload.imageKey,
          imagePrompt: payload.imagePrompt,
          imageSeed: payload.imageSeed,
          imageLoraModel: payload.imageLoraModel ?? null,
          imageLoraWeight: payload.imageLoraWeight ?? null,
          imageLoraTriggerPrompt: payload.imageLoraTriggerPrompt ?? null,
          retryCount: payload.retryCount ?? null,
          refusalDetected:
            payload.refusalDetected !== null ? (payload.refusalDetected ? 1 : 0) : null,
          generationModel: payload.generationModel ?? null,
          generationPhase: payload.generationPhase ?? null,
          createdAt: now,
        });

        await insertUnsavedRememberNotes({
          database,
          userId,
          characterId: currentConversation.characterId,
          notes: assistantContent.rememberNotes,
          sourceMessageId: payload.id,
          createdAt: now,
        });

        await database
          .update(conversationTable)
          .set({ updatedAt: now })
          .where(
            and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)),
          );

        // #444: 会話の舞台を永続化して、後続の画像生成がシーンに連続するようにする。
        await updateConversationSceneState(
          database,
          conversationId,
          assistantContent.visibleContent,
          now,
        );
      } catch (error) {
        console.error("failed to persist message and memory_note", error);
        return c.json({ error: "failed to persist message" }, 500);
      }

      return c.json({ ok: true }, 201);
    },
  )

  // ── メッセージ本文更新（再生成用） ─────────────────────────────────────
  .patch(
    "/messages/:messageId/content",
    zValidator("json", messageUpdateContentSchema),
    async (c) => {
      const userEmail = await getUserEmail(c);
      if (!userEmail) return c.json({ error: "unauthorized" }, 401);

      const messageId = c.req.param("messageId");
      if (!idSchema.safeParse(messageId).success) {
        return c.json({ error: "invalid message id" }, 400);
      }

      const { content } = c.req.valid("json");
      const database = drizzle(c.env.DB);
      const userId = await ensureUser(database, userEmail);
      const messageRows = await database
        .select({ role: messageTable.role, characterId: messageTable.characterId })
        .from(messageTable)
        .where(and(eq(messageTable.id, messageId), eq(messageTable.userId, userId)))
        .limit(1);

      const currentMessage = messageRows[0];
      if (!currentMessage) {
        return c.json({ error: "message not found" }, 404);
      }

      const assistantContent =
        currentMessage.role === "assistant"
          ? prepareAssistantContent(content)
          : { rememberNotes: [], visibleContent: content };

      try {
        await database
          .update(messageTable)
          .set({ content: assistantContent.visibleContent })
          .where(and(eq(messageTable.id, messageId), eq(messageTable.userId, userId)));

        if (currentMessage.role === "assistant") {
          // 手編集済みノートは source_message_id が NULL になっており、元メッセージの
          // 再生成によって巻き戻らないように保護する。
          await database
            .delete(memoryNoteTable)
            .where(
              and(
                eq(memoryNoteTable.userId, userId),
                eq(memoryNoteTable.sourceMessageId, messageId),
                isNull(memoryNoteTable.editedAt),
              ),
            );

          await insertUnsavedRememberNotes({
            database,
            userId,
            characterId: currentMessage.characterId,
            notes: assistantContent.rememberNotes,
            sourceMessageId: messageId,
            createdAt: Date.now(),
          });
        }
      } catch (error) {
        console.error("failed to update message and memory_note", error);
        return c.json({ error: "failed to update message" }, 500);
      }

      return c.json({ ok: true });
    },
  )

  // SSE ストリームの途中復帰用。streaming_chunk への書き込みが未実装のため、
  // 現状クライアントから呼ばれない（resume 機能は scaffold）。
  .get("/chat/stream", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.text("unauthorized", 401);

    const messageId = c.req.query("messageId");
    if (!messageId) return c.text("messageId required", 400);

    const rows = await c.env.DB.prepare(
      `SELECT raw_data, seq, is_done
       FROM streaming_chunk
       WHERE stream_id = ? AND (user_id = ? OR user_id IS NULL)
       ORDER BY seq ASC`,
    )
      .bind(messageId, userEmail)
      .all<{ raw_data: string; seq: number; is_done: number }>();

    if (rows.results.length === 0) return c.text("stream not found", 404);
    if (!rows.results.some((row) => row.is_done === 1)) {
      return c.text("stream not complete", 409);
    }

    return new Response(rows.results.map((row) => row.raw_data).join(""), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  })

  .post("/chat", zValidator("json", chatSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const {
      messages: rawMessages,
      model,
      safeMode,
      characterId,
      responseLength,
      scenePhase,
    } = c.req.valid("json");
    // 件数 cap は 25ターン(50件)に再導入。直近13ターン以上離れた重複検知を維持しつつ、
    // 長尺会話で augment 後の入力肥大化を抑える (#1093)。
    // char budget も従来どおり適用し、system 注入分を残すため古い turn は予算超過で break。
    let messages = trimChatMessagesToBudget(
      rawMessages.map((message) =>
        message.role === "user"
          ? { ...message, content: sanitizeUserRoleContent(message.content) }
          : message,
      ),
      CHAT_TRANSPORT_MAX_CHARS,
      CHAT_HISTORY_MAX_TURNS,
    );

    // NSFWガードレール: 未成年示唆・実在人物をサーバー側でブロック
    const filterResult = checkMessagesContent(messages);
    if (filterResult.blocked) {
      return c.json({ error: `content_blocked: ${filterResult.reason}` }, 403);
    }

    // コスト上限・レート制限チェック
    const rl = await enforceRateLimit(c, drizzle(c.env.DB), userEmail, "chat");
    if (!rl.ok) {
      return c.json({ error: `rate_limited: ${rl.reason}` }, 429);
    }
    const { database, userId } = rl.ctx;
    const accountDisplayName = await fetchAccountDisplayName(database, userId);

    const rawConversationId = c.req.header("x-conversation-id");
    const conversationId =
      rawConversationId && idSchema.safeParse(rawConversationId).success ? rawConversationId : null;
    // 品質測定を配信本文へ紐づけるためだけに受け取る。応答の中身には一切使わん。
    // 外部入力なので conversationId と同じく検証してから使う。
    const rawAssistantMessageId = c.req.header("x-assistant-message-id");
    const assistantMessageId =
      rawAssistantMessageId && idSchema.safeParse(rawAssistantMessageId).success
        ? rawAssistantMessageId
        : null;
    // 1 件やと「今どこか」しか分からん。「どれだけそこに留まっとるか」も要るので窓で取る。
    const recentAssistantPhasesPromise = conversationId
      ? fetchRecentAssistantGenerationPhases(database, userId, conversationId)
      : Promise.resolve([] as ScenePhase[]);

    // セーフモード ON: conversation フェーズに固定してエロコンテンツを抑制
    // クライアントが scenePhase を明示した場合はそれを優先し、自動判定によるフェーズ自動昇格を防ぐ
    // ——ただし「conversation」はクライアント側も同じキーワード一致の detectScenePhase で
    // 算出しているだけなので、意図的な現状維持指定とは区別できない。conversation 明示時は
    // 「未指定」と同様に扱い、下の昇格チェックを素通りさせない（intimate/erotic/climax/afterglow
    // の明示指定はクライアントの意図的な指定として引き続き最優先する）。
    const { phase: heuristicPhase, ambiguousFallbackPhase } = detectScenePhaseCandidates(messages);
    const effectiveClientScenePhase = resolveClientScenePhaseOverride({
      clientScenePhase: scenePhase,
      keywordPhase: heuristicPhase,
      ambiguousFallbackPhase,
    });
    const clientForcedNonConversationPhase =
      effectiveClientScenePhase && effectiveClientScenePhase !== "conversation"
        ? effectiveClientScenePhase
        : null;
    // detectScenePhase はキーワード一致式のため、「二人だけの空間に行きたい」のような婉曲な誘いを
    // conversation のまま見逃す（実測: S9/S10で isSubtextProbe 5/5ミスマッチ）。conversation と
    // 判定されたターンだけ、軽量モデルに本当に intimate 昇格すべきか問い直す。この後の
    // 記憶読み込み等の準備作業と並行に投げておき、待ち時間をほぼ隠す。
    //
    // 同じ取りこぼしが intimate→erotic にもある。実測(2026-08-16): 同じ意図を実ユーザーが
    // 打ちそうな 13 通りで書くと、erotic へ上がるのは 3 通りだけで「抱いて」も上がらんかった。
    // 前戯まで来とる場面では、conversation への昇格を聞いても意味が無いので、同じ 1 回の
    // 呼び出しを erotic 昇格の判定へ振り替える。呼び出し回数は増えん。
    //
    // どの段を狙うかは resolveSubtextEscalationRequest が決める。ここで前ターンの配信
    // フェーズを見て erotic へ振り替えとったのが A5「まだ胸の段やのに手マンに入る」の機構で、
    // 判断材料は今ターンのメッセージ列だけで足りる（＝D1 の読みを待たん）。
    // 場面の実際の位置と、そこに留まっとるターン数。含みだけで書く人はユーザー発言に
    // キーワードが一語も当たらんので、この 2 つが無いと erotic の門が一度も開かん。
    // 引き金やのうて継続時間として使う（A5 との違いはそこ）。
    const recentAssistantPhases = await recentAssistantPhasesPromise;
    const lastAssistantPhase = recentAssistantPhases[0] ?? null;
    const servedForeplayTurns = countTrailingForeplayTurns(recentAssistantPhases);
    const escalationRequest =
      safeMode || clientForcedNonConversationPhase
        ? null
        : resolveSubtextEscalationRequest({
            keywordPhase: heuristicPhase,
            hasSustainedForeplay:
              hasSustainedForeplay(messages) || servedForeplayTurns >= SUSTAINED_FOREPLAY_TURNS,
            servedPhase: lastAssistantPhase,
          });
    const subtextEscalationPromise = escalationRequest
      ? classifySubtextEscalation({
          messages,
          apiKey: c.env.OPENROUTER_API_KEY,
          appOrigin: c.env.APP_ORIGIN ?? "https://ai-chat.app",
          apiBase: c.env.MOCK_API_BASE,
          judgeTarget: escalationRequest.judgeTarget,
        }).then((result) => ({ ...result, target: escalationRequest.target }) as const)
      : null;
    // 逆向きの経路。曖昧語（いく／出して／果て）1個だけで erotic/climax が立ったターンは、
    // 「いくつか聞きたい」「元気出して」のような日常語でも同じ形になる。正規表現では
    // 日常語と絶頂表現を分けきれんかったので（3回試して3回とも戻した）、ここで LLM に問い直す。
    // escalation とは排他——あちらは conversation のターンだけが対象なので同時には走らん。
    const shouldAskDeEscalation =
      !safeMode &&
      !clientForcedNonConversationPhase &&
      shouldAskPhaseDeEscalation({ keywordPhase: heuristicPhase, ambiguousFallbackPhase });
    const phaseDeEscalationPromise =
      shouldAskDeEscalation && ambiguousFallbackPhase !== null
        ? classifyPhaseDeEscalation({
            messages,
            keywordPhase: heuristicPhase,
            fallbackPhase: ambiguousFallbackPhase,
            apiKey: c.env.OPENROUTER_API_KEY,
            appOrigin: c.env.APP_ORIGIN ?? "https://ai-chat.app",
          })
        : null;
    // 問い直しの結果は「記憶の採点」と「生成フェーズの確定」の2箇所で要る。
    // どちらが先に来ても1回しか待たんように、ここで一度だけ解決する。
    let deEscalationOutcome: {
      decision: PhaseDeEscalationResult | null;
      phase: ScenePhase;
    } | null = null;
    const resolveDeEscalation = async (): Promise<NonNullable<typeof deEscalationOutcome>> => {
      if (deEscalationOutcome !== null) return deEscalationOutcome;
      const decision = phaseDeEscalationPromise ? await phaseDeEscalationPromise : null;
      deEscalationOutcome = {
        decision,
        phase: resolvePhaseAfterDeEscalation({
          keywordPhase: heuristicPhase,
          ambiguousFallbackPhase,
          decision,
        }),
      };
      return deEscalationOutcome;
    };
    const now = Date.now();
    let selectedMemoryNotes: MemoryNoteInput[] = [];
    let memoryAwareMessages = messages;
    let sceneConstraintMemo: SceneConstraintMemo | null = null;
    let character: NonNullable<Awaited<ReturnType<typeof fetchCharacterForConversation>>> | null =
      null;

    if (characterId) {
      const owned = await validateCharacterOwnership(database, characterId, userId);
      if (!owned) return c.json({ error: "character not found" }, 404);

      character = await fetchCharacterForConversation(database, userId, characterId);
      messages = overrideUserPersonaMessage(
        messages,
        {
          name: character?.userPersonaName,
          gender: character?.userPersonaGender,
          personality: character?.userPersonaPersonality,
        },
        accountDisplayName,
        character?.systemPrompt,
      );
      const recentMessagesText = buildRecentMessagesText(messages);
      const allNotes = await fetchRecentMemoryNotes(
        database,
        userId,
        characterId,
        recentMessagesText,
      );
      // 記憶の採点は降格後のフェーズで行う。取得(D1)は問い直しと並行のままで、
      // 採点だけを待たせる。ここが降格前のフェーズやと、climax 寄りの記憶が
      // 8件の枠を埋めて、実際に生成へ使うフェーズと食い違う（2026-07-26 敵対レビュー）。
      const relevanceContext: MemoryRelevanceContext = {
        recentMessagesText,
        scenePhase: (await resolveDeEscalation()).phase,
        characterName: character?.name ?? extractCharacterName(messages[0]?.content ?? "") ?? "AI",
        now,
      };
      selectedMemoryNotes = selectRelevantMemories(allNotes, relevanceContext, 8);
      memoryAwareMessages = applySelectedMemoryNotesToMessages(
        messages,
        relevanceContext.characterName,
        selectedMemoryNotes,
      );
      sceneConstraintMemo = resolveSceneConstraintMemo(messages, character?.systemPrompt);
    } else {
      sceneConstraintMemo = resolveSceneConstraintMemo(messages);
    }

    const subtextEscalation = subtextEscalationPromise ? await subtextEscalationPromise : null;
    // 降格が認められた時だけ曖昧語抜きの判定へ落とす。失敗・タイムアウト・パース不能は
    // classifyPhaseDeEscalation 側が deEscalate:false を返すので、キーワード判定が残る。
    const { decision: phaseDeEscalation, phase: keywordResolvedPhase } =
      await resolveDeEscalation();
    const resolvedPhase = safeMode
      ? "conversation"
      : (clientForcedNonConversationPhase ??
        (subtextEscalation?.escalate
          ? subtextEscalation.target
          : (effectiveClientScenePhase ?? keywordResolvedPhase)));
    const phase = safeMode
      ? "conversation"
      : applyPhaseFloor(
          coercePostClimaxToAfterglow(resolvedPhase, lastAssistantPhase, keywordResolvedPhase),
          lastAssistantPhase,
        );
    if (phaseDeEscalation) {
      console.warn(
        "[telemetry] phase_de_escalation_classifier",
        JSON.stringify({
          keywordPhase: heuristicPhase,
          fallbackPhase: ambiguousFallbackPhase,
          deEscalate: phaseDeEscalation.deEscalate,
          source: phaseDeEscalation.source,
          reason: phaseDeEscalation.reason,
          latencyMs: phaseDeEscalation.latencyMs,
        }),
      );
    }
    if (subtextEscalation) {
      console.warn(
        "[telemetry] subtext_escalation_classifier",
        JSON.stringify({
          target: subtextEscalation.target,
          escalate: subtextEscalation.escalate,
          source: subtextEscalation.source,
          reason: subtextEscalation.reason,
          latencyMs: subtextEscalation.latencyMs,
        }),
      );
    }

    const usedMemoryIds = selectedMemoryNotes.map((note) => note.id);
    const { messages: finalMessages, variants: championVariantRefs } = await augmentMessages(
      database,
      memoryAwareMessages,
      phase,
      sceneConstraintMemo,
    );
    const lengthPreset = RESPONSE_LENGTH_PRESETS[responseLength];
    // ちょうどいい長さは毎ターン変わる。一言の促しに 1300 字の壁が返るのも、
    // 情景を書き込んだのに 3 行で返るのも冷める。相手のターンの熱量に追従させる。
    const lastUserTurnChars =
      memoryAwareMessages.findLast((message) => message.role === "user")?.content.length ?? 0;
    const {
      eroticLongformHint,
      intimateLongformHint,
      afterglowLongformHint,
      isLongResponse,
      longResponseMinChars,
      minChars: resolvedMinChars,
      maxChars: resolvedMaxChars,
      maxTokens: resolvedMaxTokens,
    } = resolvePhaseAwareResponseLength(phase, responseLength, lastUserTurnChars);
    const isVeryLongResponse = responseLength === "very_long";
    const qualityContext = buildServerQualityContext(
      memoryAwareMessages,
      phase,
      isVeryLongResponse,
      resolveJudgeSceneName(sceneConstraintMemo),
    );
    // #1339: very_long は全フェーズで deepseek 一本に切り替え。Euryale は Cloudflare 30s 制限で
    // 途中打ち切り・人称ドリフトが頻発するため、長さと POV 安定性を優先する。
    // erotic/climax は体液まで含む高密度長文。intimate は scene contract（キス/愛撫/脱衣まで・
    // 体液/性器エスカレーションは checkIntimateEscalation が拒否）を守るため別の非体液 hint にする。
    qualityContext.longResponseMinChars = longResponseMinChars;
    // 上限も依頼された responseLength で変える。very_long なら 1800、long なら 2200、
    // short/medium なら 1200。erotic/climax 底上げ時も、対応する上限が min を下回らない。
    const maxResponseChars = resolvedMaxChars;
    qualityContext.maxResponseChars = maxResponseChars;
    // #1268: very_long で max_tokens=4096 だと 2200 字上限を大きく超える長文が生成され、
    // 中継後の切り詰めで文字数水増しが残りやすい。上限文字数＋余裕分で token 天井を抑える。
    // #1401: 1792 token では erotic/climax の 1300+ visible chars 描画に token 不足で continuation
    // が wall-clock 内に収まらない。getVeryLongMaxTokensForPhase でフェーズ別に 2048/2304 を使い、
    // 上限 1800 を超えた分は collectRoutedChatResponse の truncateOverlongFallback で正規化する。
    const veryLongMaxTokens = getVeryLongMaxTokensForPhase(phase);
    const safeMaxResponseChars = maxResponseChars ?? MAX_RESPONSE_PLAIN_CHARS;
    // 非 very_long から phaseMaxTokens を外した。Math.max(phaseMaxTokens, preset.tokens) は
    // 一番小さいフェーズ予算(conversation 1024)でも short の 600 と medium の 1000 を
    // 上回るため、short/medium のトークン設定は全フェーズで到達不能な死にコードやった。
    const maxTokens = isVeryLongResponse
      ? Math.min(veryLongMaxTokens, safeMaxResponseChars + 1024)
      : resolvedMaxTokens;
    const effectiveMinChars = resolvedMinChars;
    // 段落数・文数・段落あたり字数のノルマは撤去した（AGENTS.md CHAT-5）。
    // 「16段落・各5文・各120字」は何を書くかを一つも与えんまま量だけ要求するので、
    // モデルは手近な小道具で埋める。実測(2026-08-16): climax ターンの13段落が
    // 鞄の紐・コーヒーカップ・栞・靴の中・窓の外の雲で、同じ文が2回そのまま出た。
    // 何を書くかは buildPhaseBeatSheet がキャラ自身のエスカレート連鎖から出す。
    // 長さは promptMinChars の overshoot 1箇所だけが担保する。
    const VERY_LONG_PROMPT_OVERSHOOT = phase === "erotic" || phase === "climax" ? 400 : 300;
    // very_long ではモデルが字数を見失って最低フロアを下回ることがあるため、
    // プロンプト上の目標を最低フロアより余裕を持たせて掲げる。品質判定は effectiveMinChars のまま。
    // 目標を上限と同値にしてはならん。「1800字前後」を狙わせて 1800 字で切れば、
    // 前後の「後」に落ちた分は必ず truncateOverlongFallback に当たる。実測(2026-08-16):
    // 霜月鈴 t7/t8 が action・dialogue・inner の三節とも「…」で途中切れした。
    // 上限との差を残して、超過分が切り詰めやのうて余白に収まるようにする。
    const PROMPT_TARGET_CEILING_RATIO = 0.9;
    // 目標をフロアちょうどに置くと必ず下振れる。very_long だけが overshoot を持っとって、
    // 他の段は `effectiveMinChars` そのものやった。実測(2026-08-18 phase18, medium):
    // erotic のフロア 960 に対して 571 / 776 字。
    // very_long の +400 をそのまま他の段へ持ってくると、フロアが小さい段で効きすぎる
    // （short の会話はフロア 182 字なので 582 字＝3 倍になり「短め」が短くなくなる）。
    // 比率で置いて、上限が頭を押さえる形にする。
    const PROMPT_TARGET_OVERSHOOT_RATIO = 1.3;
    const promptMinChars = isVeryLongResponse
      ? Math.min(
          Math.round(safeMaxResponseChars * PROMPT_TARGET_CEILING_RATIO),
          effectiveMinChars + VERY_LONG_PROMPT_OVERSHOOT,
        )
      : Math.min(
          Math.round(safeMaxResponseChars * PROMPT_TARGET_CEILING_RATIO),
          Math.round(effectiveMinChars * PROMPT_TARGET_OVERSHOOT_RATIO),
        );
    // hint は頼まれた段のものをそのまま使う。従来は erotic/climax/intimate で short の
    // 「2-4 文の簡潔な返答に留める」を「最低でも600字…長めの返答にする」へ差し替えとった。
    // 「短め」を選んだ人へ届く文が「2-4 文に留める。最低文字数は600字。複数段落で書き…」
    // という自己矛盾になっとったのがこれ。数値は lengthDirective に 1 箇所だけ出す。
    const effectiveHint = lengthPreset.hint;
    // ラベルも書き換えん。短めを頼んだのに responseLength=long と名乗るのは、
    // 差し替えたヒントと同じ経路で「設定が効かん」を作っとった。
    const effectiveResponseLengthLabel = responseLength;
    const userTurnCount = rawMessages.filter((message) => message.role === "user").length;
    const lateTurnStrategy = resolveLateTurnStrategy(userTurnCount, phase);
    const phaseToneDirective = getPhaseTonePreservationDirective(phase);
    // #1225: ユーザーが今ターンで明示した体位を、直近ターンへ差し込む
    const postureDirective = buildPostureDirective(qualityContext.requestedPostures ?? []);
    // #1224/#1228: キャラ個別の呼ばれ方が最優先。無ければアカウント既定値、それも無ければ
    // キャラカードの address（例：あなた / きみ）を初期二人称として使う。
    const resolvedUserNameForGuard =
      resolveUserDisplayName(character?.userPersonaName, accountDisplayName) ??
      extractCharacterAddress(character?.systemPrompt);
    // #1236 敵対レビュー9巡目: characterId 無しの経路は overrideUserPersonaMessage を
    // 通らんため、qualityContext.userName（extractUserNameFromMessages 由来）が未設定の
    // まま残る。直後のuserNameGuardがアカウント名（ローマ字を含みうる）を呼び方として
    // 指示している以上、checkNoEnglishの登録名除外にも同じ値を渡さんと、指示どおりの
    // 正しい応答が英語混入と誤判定されて不要な再生成に入る。
    if (resolvedUserNameForGuard) {
      qualityContext.userName = escapeNameForPromptQuote(resolvedUserNameForGuard);
    }
    // #1279: 性別から参加者役割を導出し、射精/中出し描写のPOVを一致させる。
    const roles = resolveParticipantRoles({
      userGender: character?.userPersonaGender,
      characterGender: character?.gender,
    });
    qualityContext.userRole = roles.userRole;
    qualityContext.characterRole = roles.characterRole;
    const userNameGuard = buildUserNameAndRoleGuard({
      userName: resolvedUserNameForGuard,
      userGender: character?.userPersonaGender,
      characterGender: character?.gender,
      userRole: roles.userRole,
      characterRole: roles.characterRole,
    });
    // #1337: 一人称・二人称・POV を最終指示で再掲し、Euryale 等での彼/私/三人称ドリフトを抑える。
    // systemPrompt に埋まった「名前: 実名」があればそれを優先し、カード名（import タイトル等）を使わない。
    const characterName =
      (character ? extractCharacterName(character.systemPrompt ?? "") : undefined) ??
      character?.name ??
      "AI";
    const characterFirstPerson = character
      ? (extractFirstPerson(character.systemPrompt ?? "") ?? "わたし")
      : "わたし";
    const characterAddress = resolvedUserNameForGuard ?? "あなた";
    // 他の一人称候補を列挙し、LLM が読み飛ばしにくい形で禁止する。
    const wrongFirstPersons = characterFirstPerson
      ? ALL_FIRST_PERSONS.filter((candidate) => candidate !== characterFirstPerson)
      : [];
    const personaPovGuard = character
      ? `\n【視点・人称ガード】${characterName}として直接体験する一人称視点で書く。一人称は「${characterFirstPerson}」に固定し、${wrongFirstPersons.slice(0, 8).join("、")}など他の一人称は絶対に使わない。自分のことを「${characterName}」や三人称で呼ばず、ユーザーのことは二人称「${characterAddress}」で直接呼びかける。三人称（彼/彼女/あいつ/人名）や客観的な小説調の語り、舞台監督のような俯瞰表現は使わない。<action>には自分の感覚・仕草・周囲の変化を、<dialogue>には自分の台詞のみを入れる。`
      : "";
    // very_long erotic/climax のみ、Sakura/Downer のキャラ固有情報を最後に再掲する。
    // 長さ指示や汎用例に流されてキャラ崩壊するのを防ぐ。
    const shouldInjectEroticAnchor =
      isVeryLongResponse &&
      (phase === "erotic" || phase === "climax") &&
      typeof characterId === "string" &&
      TARGET_VERY_LONG_CHARACTER_IDS.has(characterId);
    const characterEroticAnchor = shouldInjectEroticAnchor
      ? extractCharacterEroticAnchor(character?.systemPrompt)
      : "";
    // #1226: 長文フロアだけ末尾でも再掲する。長い指示文の先頭にある数値がテンプレ末尾で
    // 薄まるのを防ぐ(AC「最終指示の位置・優先度を調整」)。
    const lengthReinforcement = isLongResponse
      ? isVeryLongResponse
        ? `\n【文字数の最終確認】\n- 目標に届くまで同じ<response>ブロック内に<action>と<dialogue>を追加し続ける\n- 段落を足す時は、必ず新しい身体の出来事を一つ足す。周囲の物・小道具・天候で字数を埋めない\n- <inner>は非表示なので1つだけ・最低80字以上120字以内で、本音・欲望・羞恥・執着を込めた内面独白にする。可視文字数には含めない\n- </response>は最低文字数を超えてから最後に1回だけ出力する\n- 途中で要約や「もうすぐ」「これで終わり」で止めない`
        : `\n【文字数の最終確認】画面に出る文字数（XMLタグと空白と<inner>を除く）で最低${effectiveMinChars}字。出力後に数え直し、足りなければ追加の情景・仕草・台詞を必ず書き足して最低を超える。`
      : "";
    // very_long のフロアの数値は lengthDirective 本体とユーザー発言末尾の2箇所だけに置く。
    // 4箇所へ散らすと、どこかを直した時に別の場所と食い違う（#1431 の再発）。
    // very_long では最後に文字数を絶対条件として簡潔に再掲し、モデルが POV ガードや
    // 段落構成に気を取られて長さを見失うのを防ぐ。具体例で見たように、簡潔かつ強い
    // 文字数ルールを「ユーザー発言の末尾」に置くと、システム指示よりも優先されて
    // 1300字フロアを安定して超える（#1344）。
    const lengthUserReinforcement = isVeryLongResponse
      ? `【very_long 最終確認】${characterEroticAnchor}\n- 可視文字数が最低${effectiveMinChars}字（XMLタグ除く、空白除く）を超えるまで、目標は${promptMinChars}字前後として同じ<response>ブロック内に<action>と<dialogue>を追加し続ける\n- <action>と<dialogue>を交互に置く。1つのタグに行を積み上げん——台詞が2つ続くなら、間に<action>を1つ挟んで何が起きたかを書く\n- 字数を足す時は段落やのうて<action>と<dialogue>のやりとりを 1 往復足す。1 往復ごとに新しい身体の出来事を一つ進める。周囲の物・小道具・天候・服の外側で字数を埋めない\n- <inner>は非表示なので1つだけ・最低80字以上120字以内で、キャラの本音・欲望・羞恥・執着を詰めた内面独白にする。可視文字数には含めない\n- 同じ感覚語（「熱い」「じんわり」「ぞくっと」等）、同じ擬音（「んっ」「あっ」「だめ」等）、同じ身体反応（「痙攣」「震え」「涙」等）は本文全体で連続して繰り返さない。一度使った表現は最低3段落経てから再使用し、各段落で新しい部位・感覚・擬音・声を選ぶ\n- 段落ごとに、感情が動いた一語だけを *アスタリスク* で囲む（圏点で表示される）。部位の名前そのもの（胸・首筋・膝）は選ばん——そこは既に書いてある。選ぶのは、こらえきれんかった動詞、途切れた音、その子が普段言わん一語。文をまるごと囲まん\n- 段落の長さを揃えん。厚い段落の次に短い一行を置いて息を作る\n- 地の文には自分の感情・思考・反応を混ぜ、内面を深掘りする${phase === "erotic" ? "\n- eroticフェーズは、すでに奥深くまで挿入された状態から描く。焦らし・前戯・着衣・キス・指の愛撫は一切禁止。「これから入れる」「もうすぐ」「寸前」も禁止。腰を打ちつける・奥を突く・締めつける・膣・子宮口・乳首・腰・結合部の刺激・愛液や水音・精液を遠慮せずに描く。同じ部位や感覚語を連続で使わず、体位や角度を少しずつ変えながら場面を進める。クライマックス寸前まで強く高め、今ターンで高めきる。絶頂そのもの（射精、頭が真っ白、意識が遠のく）はclimaxフェーズまで先送りする" : phase === "climax" ? "\n- climaxフェーズは絶頂の瞬間（収縮・視界のフラッシュ・声の変化・体液の迸出）と、その直後の余韻（ぐったりとした脱力・荒い呼吸・汗・満足と羞恥の混ざった吐息・体内や肌に残る温かさ）をshowingで明確に描く。1回目・2回目・3回目の射精・中出しでは、初熱→追加で溢れ→止まらない流れと、回数ごとに異なる部位感覚・量感・反応を描き、同じ「子宮」「お腹の奥」「熱い」「脈打つ」「注がれる」を連続して使わない" : ""}\n- </response>は最低文字数を超えてから最後に1回だけ出力する\n- 途中で要約や「もうすぐ」「これで終わり」で止めない`
      : `【長さの最終確認】可視文字数（XMLタグと空白を除く）が最低${effectiveMinChars}字を超えるまで、同じ<response>ブロック内に<action>と<dialogue>を足し続ける。<action>と<dialogue>は交互に置き、1つのタグに行を積み上げん——台詞が2つ続くなら、間に<action>を1つ挟んで何が起きたかを書く。段落を足す時は、新しい身体の出来事か新しい台詞を一つ足す。周囲の物・小道具・天候で字数を埋めん。${maxResponseChars}字は超えん。`;
    // #1373: very_long では終了タグをモデルに出力させず、後処理で閉じる。
    // これによりモデルが「そろそろ終わり」と自主的に閉じて短くなるのを防ぐ。
    const lengthClosingRule = isVeryLongResponse
      ? `1つの<response>ブロックのみ出力すること。形は<response><action>...</action><dialogue>...</dialogue><action>...</action><dialogue>...</dialogue><inner>...</inner></response>で、<action>と<dialogue>を目標に達するまで交互に必要なだけ繰り返す。<inner>は非表示なので1つだけ・最低80字以上120字以内で、本音・欲望・羞恥・執着を詰めた内面独白にし、可視文字数には含めない。<action>と<dialogue>を交互に置き、1つのタグに行を積み上げない。台詞が2つ続くなら間に<action>を1つ挟む。段落を足す時は必ず新しい身体の出来事を一つ足し、周囲の物・小道具・天候で字数を埋めない。同じ感覚語・擬音・身体反応を連続して繰り返さず、一度使った表現は最低3段落経てから再使用し、各段落で新しい語彙と感覚を選ぶ。各XMLタグは必ず閉じ、</response>は最低文字数を超えてから最後の1回だけ出力する。途中で要約したり、終了タグを早めに出力したりしない。`
      : `1つの<response>ブロックのみ出力すること。形は<response><action>...</action><dialogue>...</dialogue><action>...</action><dialogue>...</dialogue><inner>...</inner></response>で、<action>と<dialogue>を交互に必要なだけ繰り返し、<inner>は最後に1つだけ置く。1つのタグに行を積み上げん——台詞が2つ続くなら、間に<action>を1つ挟んで何が起きたかを書く。外枠と中の各タグは最後まで必ず閉じること。${
          isLongResponse
            ? `ただし</response>は最低${effectiveMinChars}字（画面に出る文字数）を超えてから最後に1回だけ出力する。届いてへんうちは<action>と<dialogue>を足し続ける。`
            : ""
        }`;
    // 「複数段落で書き…短い一瞬の反応だけで完結させない」を無条件に出しとったため、
    // short の会話へ届く文が「2-4 文に留める。最低文字数は180字。複数段落で書き…
    // 短い一瞬の反応だけで完結させない。」となり、4 文中 2 文が最初の文の逆を命じとった。
    // どの段にも上限の指示が一度も無かったことも、短い段が短くならん原因やった。
    const lengthShapeRule = `${
      isLongResponse
        ? "複数段落で書き、途中で要約して終わらせない。短い一瞬の反応だけで完結させない。"
        : ""
    }${maxResponseChars}字を超えない。`;
    // personaPovGuard を最後に置き、モデルが読み飛ばしやすい人称/視点を最終再確認させる。
    const lengthDirective = `【応答長さ最終指示】responseLength=${effectiveResponseLengthLabel}。${effectiveHint}。最低文字数は${effectiveMinChars}字（目標は${promptMinChars}字前後）。${lengthShapeRule}直前の応答と似た表現や構造を繰り返さないこと。${lengthClosingRule}※この指示文には一切言及・復唱・返答せず、キャラ本人として直接描写する。${phaseToneDirective}${eroticLongformHint}${intimateLongformHint}${afterglowLongformHint}${postureDirective}${lateTurnStrategy.diversityDirective ? `\n${lateTurnStrategy.diversityDirective}` : ""}${userNameGuard}${lengthReinforcement}${personaPovGuard}`;
    const lengthInjectedMessages = insertSystemDirectiveBeforeLastUser(
      finalMessages,
      lengthDirective,
    );
    let lengthAwareMessages = trimChatMessagesToBudget(
      lengthInjectedMessages,
      CHAT_TRANSPORT_MAX_CHARS,
      CHAT_HISTORY_MAX_TURNS,
    );
    // 長さ指示をユーザー発言の末尾に追加し、モデルが最後に読む場所に置く。
    // #1344 はここへ置くとシステム指示より優先されると測っとるのに、差し込み自体が
    // `isVeryLongResponse` で閉じられとった。出荷既定は medium（`settings-store.ts:26,80`）
    // なので、実際に長さを保っとる唯一の経路が局長のターンへ一度も掛かっとらんかった。
    // 実測(2026-08-18 phase17, medium 20 ターン): erotic のフロア 960 字に対して
    // さくら t7=172 字 / t8=176 字 / climax t9=200 字。フロアの値やのうて置き場所の問題。
    {
      const lastUserIdx = lengthAwareMessages.findLastIndex((message) => message.role === "user");
      if (lastUserIdx >= 0) {
        const userMessage = lengthAwareMessages[lastUserIdx];
        lengthAwareMessages = [
          ...lengthAwareMessages.slice(0, lastUserIdx),
          {
            ...userMessage,
            content: `${userMessage.content}\n\n${lengthUserReinforcement}`,
          },
          ...lengthAwareMessages.slice(lastUserIdx + 1),
        ];
      }
    }
    // #1362: very_long では 1300 字フロア超えを最優先する。
    // ただし penalty=0 だと同じ文末やフレーズをループしがちで、かえて長さと品質を損なう実測が出た。
    // #1392: erotic/climax の高い frequency_penalty (0.3/0.4) は、語彙が少ない官能文で早期終了を誘発する。
    // 反復は後段の quality-guard で抑制するため、very_long では frequency_penalty を0にして長さを最優先する。
    // 2026-08-21: この表は very_long だけに当たっとった。それ以外の段は下の else で
    // temperature 0.7 固定・penalty 一切無しになり、**出荷既定(medium)では反復を抑える
    // 仕組みがモデル側に一つも無い**状態やった（罠 §5-5「very_long だけ守られて medium が
    // 無防備」の 4 件目）。phase66 の通読で 20 ターン中 16 が反復で落ちとる。
    // 段ごとの値はこのまま使う。src/lib/scene-phase.ts の getSamplingForPhase が持っとった
    // 0.3/0.4 は #1392 で「語彙の少ない官能文で早期終了を誘発する」と実測で否定されとる。
    const phaseSampling = resolvePhaseSampling(phase);
    const lengthGenParams: ChatGenerationParams = {
      temperature: phaseSampling.temperature,
      max_tokens: maxTokens,
      frequency_penalty: phaseSampling.frequency_penalty,
      presence_penalty: phaseSampling.presence_penalty,
      // stop の解除は very_long のまま。あれは 1300 字フロアへ届く前に停止語で
      // 切られるのを防ぐためのもので、他の段には要らん（#1362）。
      ...(isVeryLongResponse ? { stop: [] } : {}),
    };
    const assembledInputChars = getMessageContentLength(lengthAwareMessages);

    // 2026-07-12: 7/9 の euryale 排除は「合計生成時間」だけを判断材料にしていた。品質最強の euryale を
    // 外すと官能描写が退行するため、long/short の erotic/climax ではプライマリを維持する。
    // #1386: very_long は deepseek-chat/streamlake ルートで CPU/時間制限に抵触しやすく、
    // 会話は qwen、官能・絶頂は euryale を使う phase-aware ルーティングに戻した。
    // #1392: 本場検証で euryale の upstream トランジェントが続き、qwen フォールバックが短尺になるため、
    // very_long の erotic/climax は deepseek-chat/streamlake ルートをプライマリに戻す。品質は retry と長さ指示で担保する。
    // isLongEroticPrimaryPath は resolveChatRouting 内部の判定とは別に、この後の
    // requestQualityCheckedChat 呼び出し（リトライ経路含む）へもフラグとして渡すため、ここでも保持する。
    const isLongEroticPrimaryPath = isLongResponse && (phase === "erotic" || phase === "climax");
    const {
      model: chatModel,
      requestBudgetMs,
      fallbackLimit,
    } = resolveChatRouting({
      isLongResponse,
      isVeryLongResponse,
      phase,
      isLateTurn: lateTurnStrategy.isLateTurn,
      requestedModel: model,
      forceRequestedModel: c.env.TEST_FORCE_CHAT_MODEL === "1",
    });

    // 締切を回数と同じ箱へ入れる。今までウォールクロックの起点は
    // requestQualityCheckedChat のローカル変数やったので、拒否リカバリで
    // 2 度目を呼ぶと窓がもう一本立ち直っとった（回数だけが正しく減っとった）。
    const turnGenerationBudget = {
      remaining: TURN_GENERATION_HARD_CAP,
      deadlineAt: Date.now() + resolveTurnWallClockCapMs(isVeryLongResponse, longResponseMinChars),
    };
    // 生成が終わるのを待たずに配信する。ヘッダは1トークン目が出た時点で確定させ、
    // それまでに上流が落ちた場合だけ従来どおり HTTP ステータス付きで返す。
    const sink = createDeferredSseSink();
    let liveUsedModel: string = chatModel;
    let lastRelayedText = "";
    const live: LiveChatRelay = {
      push: (text) => sink.push(text),
      noteModel: (usedModel) => {
        liveUsedModel = usedModel;
      },
      noteRelayedText: (text) => {
        lastRelayedText = text;
      },
      noteRegenerating: () => {
        lastRelayedText = "";
      },
      hasStarted: () => sink.hasStarted(),
    };
    // 配信を始めた後はステータスを変えられんので、失敗は error イベントで伝える。
    const bail = (response: Response, reason: string): Response | null => {
      if (!sink.hasStarted()) return response;
      sink.push(`event: error\ndata: ${JSON.stringify({ reason })}\n\n`);
      return null;
    };

    const runDelivery = async (): Promise<Response | null> => {
      let qualityResult: QualityCheckedChat;
      let refusalRetryCount = 0;
      // 品質の撮り直し回数。拒否リカバリの再呼び出しも同じ入れ物へ積む。
      // これが無いと、床が発火したのかどうかがダンプからも D1 からも読めん。
      const attemptCounter = { generations: 0 };
      try {
        qualityResult = await requestQualityCheckedChat(
          c.env,
          chatModel,
          phase,
          lengthAwareMessages,
          qualityContext,
          c.req.raw.signal,
          lengthGenParams,
          assembledInputChars,
          requestBudgetMs,
          fallbackLimit,
          turnGenerationBudget,
          championVariantRefs,
          live,
          isLongEroticPrimaryPath && !isVeryLongResponse,
          isVeryLongResponse,
          attemptCounter,
        );
      } catch (error) {
        if (isClaudeSessionExpiredError(error)) {
          return bail(respondClaudeSessionExpired(c), "claude session expired");
        }
        throw error;
      }

      if (!qualityResult.ok) {
        const code = qualityResult.errorCode ?? "upstream_error";
        const httpStatus = httpStatusForChatUpstreamErrorCode(code);
        // 構造化ログ: 本番Cloudflareログで status 分布(402 / 5xx / timeout)を集計する。
        console.warn(
          "chat handler upstream failure",
          JSON.stringify({
            code,
            upstreamStatus: qualityResult.status ?? null,
            httpStatus,
            phase,
          }),
        );
        return bail(c.json({ error: qualityResult.error, code }, httpStatus), code);
      }

      const latestUserMessage =
        [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      // 拒否検知は hard 拒否だけ。soft 拒否（特定の台詞の一覧）はここから外した。
      //
      // #1495: 一覧の中身は「待って」「やだ」「無理」「困る」「落ち着く」で、抜き所の
      // 真ん中で出る声と区別が付かん。実測 2026-08-21 の 6 アーム 120 ターンでは
      // 「待って」が 28 回出て、中身は全部場面の中の声やった（ci6-2 Sakura-08
      // 「待って、そんなに強く押さないで…。でも、離さないで」）。相手の「もっと」1 語で
      // cue が立つので、抜き所ほど当たりやすい。撮り直しは generationCount を 4〜5 まで
      // 押し上げて repetition として跳ね返っとった。
      //
      // prompt/instructions/no-injected-ai-filter.md が「特定の台詞を禁止語として
      // 指定する（例:「待って」）」と、その例に「待って」を挙げて禁じとる。品質判定で
      // 落とすとプロンプトへ足すのと同じ結果になる、とも同じ文書に書いてある。
      // キャラが本当に断った時は [ADVANCE — MANDATORY] がプロンプト側で受け持つ。
      //
      // cue はリトライ時の directive 選択にのみ使う。
      const hasEroticEscalationCue = containsEroticEscalationCue(latestUserMessage);
      const isRefusalRetryCandidate =
        !safeMode &&
        !isInfraError(qualityResult.responseText) &&
        hardRefusalDetect(qualityResult.responseText);
      // scenePhase はクライアント指定を許容するため retry 閾値には使わず、バックエンド確定 phase のみを使う
      // safeMode 時は同意確認・謝罪漏れ retry も含め refusal recovery 全体を無効化する
      // 降格が認められたターンは降格後の phase で閾値を見る。生成に使った phase と閾値がズレると、
      // 日常語のターンが climax の下限（600字）を満たせずリトライを焼き切る——直そうとした症状そのもの。
      const retryPhase = keywordResolvedPhase;
      const hasApologyLeak = !safeMode && containsApologyLeak(qualityResult.responseText);
      const hasExcessiveConsent =
        !safeMode &&
        !hasApologyLeak &&
        shouldRetryWithPhase(qualityResult.responseText, retryPhase);

      if (
        c.env.TEST_DISABLE_REFUSAL_RECOVERY !== "1" &&
        (isRefusalRetryCandidate || hasExcessiveConsent || hasApologyLeak)
      ) {
        refusalRetryCount = 1;
        const retryDirective = hasApologyLeak
          ? "(直前の応答に AI assistant の謝罪文が混入した。キャラとして謝らず、キャラの言葉で応答せよ:)"
          : hasExcessiveConsent
            ? "(直前の応答は同意確認が過剰でキャラ性を損ねた。確認台詞を 1 つだけに抑え、キャラとして自然に応答せよ:)"
            : hasEroticEscalationCue
              ? "(直前の応答は同じ紋切り型の描写で足踏みしている。ユーザーの直近行動に正面から反応し、キャラ設定どおりの反応を身体感覚まで具体的に書いて場面を進めよ:)"
              : "(直前の応答は AI アシスタントの定型拒否文になっている。拒否や説教をせず、キャラ本人として直前のユーザー発言に自然に応答せよ:)";
        // 拒否は同一モデル再試行では逐語一致で再発する実測があるため、fallback chain の
        // 別モデルへ切り替えて再試行する。very_long では consent/apology リトライも
        // erotic-capable モデルから外れないよう selectQualityRetryModel で選定する。
        //
        // #1495: 抜き所も very_long と同じ扱いにする。ここは 5 つ目の isEroticPhase が
        // 抜けとって、出荷既定(medium)の erotic/climax が謝罪・同意過剰の撮り直しで
        // qwen へ降りとった（f7b37d3 / 6eb4b32 と同じ穴の 3 箇所目）。しかも三項の else 側は
        // `model`＝リクエストの既定値で、抜き所を実際に書いたモデルやない。
        const isEroticPhase = phase === "erotic" || phase === "climax";
        const refusalRetryModel =
          isRefusalRetryCandidate || isVeryLongResponse || isEroticPhase
            ? selectQualityRetryModel(
                model,
                qualityResult.usedModel,
                undefined,
                isVeryLongResponse,
                isEroticPhase,
              )
            : model;
        console.warn(
          "[telemetry] persona_refusal_retry",
          JSON.stringify({
            retryCount: refusalRetryCount,
            phase,
            // model はリクエストの既定値で、実際に書いたモデルやない。very_long は
            // resolveChatRouting が別のモデルへ回すので、両方出さんとログを読み違える。
            requestedModel: model,
            usedModel: qualityResult.usedModel,
            retryModel: refusalRetryModel,
            eroticCue: hasEroticEscalationCue,
            trigger: {
              refusal: isRefusalRetryCandidate,
              excessiveConsent: hasExcessiveConsent,
              apologyLeak: hasApologyLeak,
            },
          }),
        );
        const retryMessages = insertSystemDirectiveBeforeLastUser(
          lengthAwareMessages,
          retryDirective,
        );
        try {
          // 拒否リカバリの作り直しも regenerating で伝える。この再呼び出しは attempt 0 から
          // 始まるため requestQualityCheckedChat 内の「2回目以降」判定では出せず、放っとくと
          // クライアントが拒否文の後ろに差し替え本文を連結してしまう。
          announceRegenerating(live);
          const retriedResult = await requestQualityCheckedChat(
            c.env,
            refusalRetryModel,
            phase,
            retryMessages,
            qualityContext,
            c.req.raw.signal,
            lengthGenParams,
            getMessageContentLength(retryMessages),
            undefined,
            undefined,
            turnGenerationBudget,
            championVariantRefs,
            live,
            // #971: 拒否リカバリの生成も中継が始まったら同じ扱いにする。ここだけ既定の
            // false のままやと、撮り直しの14秒が拒否リカバリ経由で復活する。
            // #1435: very_long は 1300 字フロアを最優先するため、長さ不足時は継続を許可する。
            isLongEroticPrimaryPath && !isVeryLongResponse,
            isVeryLongResponse,
            attemptCounter,
          );
          if (retriedResult.ok) {
            qualityResult = retriedResult;
          }
        } catch (error) {
          if (isClaudeSessionExpiredError(error)) {
            return bail(respondClaudeSessionExpired(c), "claude session expired");
          }
          // retry が他理由で失敗しても初回 qualityResult はそのまま返却する。
          console.error("refusal retry failed", error);
        }
      }

      // リトライ後（またはリトライ不能時）も生の拒否文・空応答は絶対にユーザーへ出さない。
      // hardRefusalDetect はここ（最終出力）に対してのみ最終判定として実行する。
      if (
        !safeMode &&
        c.env.TEST_DISABLE_REFUSAL_RECOVERY !== "1" &&
        !isInfraError(qualityResult.responseText) &&
        hardRefusalDetect(qualityResult.responseText)
      ) {
        console.warn(
          "[telemetry] refusal_graceful_fallback",
          JSON.stringify({ phase, model: qualityResult.usedModel, retried: refusalRetryCount }),
        );
        qualityResult = {
          ...qualityResult,
          chunks: buildOpenAISseChunks(GRACEFUL_REFUSAL_FALLBACK_TEXT),
          responseText: GRACEFUL_REFUSAL_FALLBACK_TEXT,
          warningLevel: true,
          // 汎用フォールバック文言に差し替えたので、元の生成文に対するjudge/deterministic verdictは
          // もはやservedコンテンツを代表しない。stale verdictをchampion/candidate実績に混入させない。
          qualityMeasurement: undefined,
        };
      }

      try {
        await markUsedMemoryNotes(database, userId, usedMemoryIds, now);
      } catch (error) {
        console.error("failed to update memory_note usage", error);
      }

      if (sceneConstraintMemo) {
        const prohibitedWords = buildSceneDriftTelemetry(
          sceneConstraintMemo.sceneName,
          qualityResult.responseText,
        );
        if (prohibitedWords.length > 0) {
          console.warn(
            "[telemetry] scene_setting_drift_detected",
            JSON.stringify({
              scene: sceneConstraintMemo.sceneName,
              source: sceneConstraintMemo.source,
              prohibitedWords,
              phase,
              model: qualityResult.usedModel,
            }),
          );
        }
      }

      // 使用量記録（レスポンス配信と並行、失敗しても応答は返す）
      c.executionCtx.waitUntil(logUsage(database, userId, "chat", qualityResult.usedModel));

      if (qualityResult.qualityMeasurement) {
        c.executionCtx.waitUntil(
          persistServedQualityMeasurement(
            database,
            qualityResult.qualityMeasurement,
            qualityResult.responseText,
            qualityResult.usedModel,
            assistantMessageId,
          ),
        );
      }

      // shadow A/B(P3): served応答とは独立に、候補prompt本文の実力をバックグラウンドで測定する
      // very_long は生成コストが高く、並列で2回目の長文生成を走らせると Cloudflare isolate の
      // CPU/メモリ制限を圧迫し 1102 503 が増えるため、very_long ではスキップする。
      if (!isVeryLongResponse) {
        c.executionCtx.waitUntil(
          runShadowVariantMeasurement(
            c.env,
            database,
            phase,
            memoryAwareMessages,
            sceneConstraintMemo,
            qualityResult.usedModel,
            lengthDirective,
            lengthGenParams,
            longResponseMinChars,
            resolvedUserNameForGuard,
            character?.userPersonaGender,
            character?.gender,
          ),
        );
      }

      // 配る本文と、その本文へ付ける印は同じものを見とらなあかん。
      // repairCollectedQualityFallback は applyRetryExhaustionFallback で本文を作り替える
      // のに、印は渡された failureReason（修復前の、呼び出し箇所によっては別の試行の値）の
      // まま warningLevel: true を無条件で立てて返す。
      //
      // 実測 2026-08-21 CI run #6 (ci6-1): 20 ターン中 10 本が非 null のカテゴリで配られ、
      // うち 4 本は続き書きを合流してフロアを跨いだ抜き所（可視 987 / 1048 / 1132 / 1109 字。
      // erotic / climax のフロアは相手のターン長込みでも最大 960）。ハーネスで再現した時は
      // さらに悪く、可視 832 字の合流本文を配りながら、印は別の試行（可視 131 字）の
      // too_short やった。本文の本当の欠陥が、別物のラベルの裏に隠れる。
      //
      // これは記録の綺麗さの話やない。warningLevel は message-bubble.tsx の
      // QualityWarningBadge をそのまま吹き出しへ出すので、抜き所の返信に品質警告が乗る。
      // L1-3 の欠陥数もこの印を数えとるので水増しになる。
      const servedText = qualityResult.responseText;
      const servedQuality = runQualityChecks(servedText, qualityContext);
      // 拒否が尽きた時の差し替えだけは、測り直しの対象にせん。あれは生成物やのうて
      // 定型の非回答で、上で warningLevel を**意図的に**立てとる（refusal_graceful_fallback）。
      // 定型文は短いだけで決定的チェックを全部通るので、素直に AND すると警告が消えて、
      // 読み手には「キャラが答えた」ように見える。conversation では checkSceneMinLength も
      // 素通しなので実際に通り抜ける（敵対レビュー 2026-08-21 が実ハンドラで再現）。
      const servedIsCannedNonAnswer = servedText === GRACEFUL_REFUSAL_FALLBACK_TEXT;
      const servedWarningLevel =
        servedIsCannedNonAnswer || (!!qualityResult.warningLevel && !servedQuality.passed);
      const servedQualityCategory = servedQuality.passed
        ? null
        : categorizeQualityFailure(servedQuality.failedCheck);

      if (servedWarningLevel) {
        // x-conversation-id は外部入力なので検証する。
        const reportConversationId = conversationId ?? "unknown";
        c.executionCtx.waitUntil(
          (async () => {
            try {
              if (reportConversationId !== "unknown") {
                const shouldReport = await shouldReportQualityIssue(
                  database,
                  reportConversationId,
                  now,
                );
                if (!shouldReport) return;
              }

              const assistantCount = messages.filter(
                (message) => message.role === "assistant",
              ).length;
              const issuePayload = buildQualityIssuePayload({
                characterName: extractCharacterName(messages[0]?.content ?? "") ?? "unknown",
                assistantCount,
                phase,
                model,
                usedModel: qualityResult.usedModel,
                responseText: qualityResult.responseText,
                messages,
                conversationId: conversationId ?? "unknown",
                characterId,
                timestamp: now,
              });

              const hasLinear = Boolean(c.env.LINEAR_API_KEY && c.env.LINEAR_TEAM_ID);
              const hasGitHubApp = Boolean(
                c.env.GH_APP_ID && c.env.GH_APP_PRIVATE_KEY && c.env.GH_APP_INSTALLATION_ID,
              );
              if (!hasLinear && !hasGitHubApp) {
                console.warn("quality-report destination env missing (LINEAR_* or GH_APP_*)");
                return;
              }
              await createQualityIssue(
                {
                  linearApiKey: c.env.LINEAR_API_KEY,
                  linearTeamId: c.env.LINEAR_TEAM_ID,
                  appId: c.env.GH_APP_ID,
                  appPrivateKey: c.env.GH_APP_PRIVATE_KEY,
                  appInstallationId: c.env.GH_APP_INSTALLATION_ID,
                },
                issuePayload,
              );
            } catch (error) {
              console.warn("quality-report failed", error);
            }
          })(),
        );
      }

      // 中継済みの本文と、実際に採用した本文が食い違う時だけ差し替える。
      // （末尾の切り詰め、リトライ枯渇時の修復、前の試行の採用が起きた場合）
      if (lastRelayedText !== servedText) {
        sink.push("event: regenerating\ndata: {}\n\n");
        sink.push(renderChunksAsRelayableSse(qualityResult.chunks));
      }
      sink.push(`event: meta\ndata: ${JSON.stringify({ usedMemoryIds })}\n\n`);
      sink.push(
        `event: quality-meta\ndata: ${JSON.stringify({
          retryCount: refusalRetryCount,
          refusalDetected: refusalRetryCount > 0,
          usedModel: qualityResult.usedModel,
          warningLevel: servedWarningLevel,
          refusalRetryCount,
          // 生成を何回走らせたか。1 なら撮り直しゼロ。床や品質チェックが実際に
          // 効いたかを、あとから本文だけ見て判定するための唯一の手掛かりになる。
          generationCount: attemptCounter.generations,
          // どのカテゴリで落ちたか。回数だけやと「撮り直したのに伸びてへん」のか
          // 「長さ以外で落ちて続き書きへ入れんかった」のかが見分けられん。
          deterministicCategory: servedQualityCategory,
        })}\n\n`,
      );
      sink.push("data: [DONE]\n\n");
      return null;
    };

    // 配信を始めた後に落ちたらステータスは変えられん。ストリームを error で閉じる。
    const deliver = runDelivery()
      .then((response) => {
        sink.close();
        return response;
      })
      .catch((error: unknown) => {
        if (!sink.hasStarted()) {
          sink.close();
          throw error;
        }
        console.error("chat live stream failed after first token", error);
        sink.fail(error);
        return null;
      });

    // 1トークン目が出るか、生成が決着するかのどちらか早い方まで待つ。
    await Promise.race([sink.started, deliver]);
    if (!sink.hasStarted()) {
      const early = await deliver;
      if (early) return early;
    }
    c.executionCtx.waitUntil(deliver);

    return new Response(sink.stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // 1トークン目を出したモデル。ヘッダは配信開始時に確定するので、作り直しで
        // モデルが切り替わっても追随せん。実際に採用した本文のモデルは
        // event: quality-meta の usedModel を見ること。
        "x-model-used": liveUsedModel,
        // E2E 判定のために実際に採用した会話フェーズをヘッダで返す
        "x-scene-phase": phase,
      },
    });
  })

  .post("/judge", zValidator("json", judgeSchema), async (c) => {
    // CF-Access または Bearer トークンによる認証を要求（Anthropic API quota 保護）
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const input = c.req.valid("json");

    // judge は本線チャットと同じ OPENROUTER_API_KEY を使う有料呼び出し。計上せんと
    // 評価ループが日次・月次カウンタを素通りしてチャット用のクレジットを食い潰す。
    const judgeRl = await enforceRateLimit(c, drizzle(c.env.DB), userEmail, "judge");
    if (!judgeRl.ok) return c.json({ error: `rate_limited: ${judgeRl.reason}` }, 429);
    const { database: judgeDb, userId: judgeUserId } = judgeRl.ctx;

    // judge の API キーは Workers 環境変数からだけ読む。
    const result = await claudeJudgeQuality(
      input.response,
      input.previousResponse,
      input.phase,
      c.env.OPENROUTER_API_KEY,
      c.env.APP_ORIGIN,
    );

    // ran===true の時だけ OpenRouter を実際に叩いとる。skip/障害を課金実績として残さん。
    // 予約(enforceRateLimit)は済んどるので、記録の失敗で判定結果を落とさん。ここで throw すると
    // 500 になり、クライアント側は fail-open して判定を pass 扱いにしてしまう。
    if (result.ran === true) {
      try {
        await logUsage(judgeDb, judgeUserId, "judge", CLAUDE_JUDGE_MODEL);
      } catch (err) {
        console.error("[quality] judge usage log failed", err);
      }
    }

    return c.json(result);
  })

  .post("/image", zValidator("json", imageSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const input = c.req.valid("json");

    // NSFWガードレール: 画像プロンプトにも未成年示唆チェック
    const imgFilter = checkContentFilter(input.prompt);
    if (imgFilter.blocked) {
      return c.json({ error: `content_blocked: ${imgFilter.reason}` }, 403);
    }
    if (input.characterDescription) {
      const descFilter = checkContentFilter(input.characterDescription);
      if (descFilter.blocked) {
        return c.json({ error: `content_blocked: ${descFilter.reason}` }, 403);
      }
    }

    // コスト上限・レート制限チェック
    const imgRl = await enforceRateLimit(c, drizzle(c.env.DB), userEmail, "image");
    if (!imgRl.ok) {
      return c.json({ error: `rate_limited: ${imgRl.reason}` }, 429);
    }
    const { database: imgDb, userId: imgUserId, reservedPeriods: imgPeriods } = imgRl.ctx;

    const ownsImageContext = await validateImageGenerationOwnership(imgDb, imgUserId, input);
    if (!ownsImageContext) return c.json({ error: "image context not found" }, 404);

    // プロフィールで承認された image_meta をチャット画像にも不変アンカーとして渡す。
    // characterId がある場合は所有者条件を同じ SELECT に含め、他ユーザーの正典を読まない。
    let profileImageAnchors: ImageMetaAnchors | null = null;
    let hasAuthoritativeIdentitySource = false;
    let effectiveCharacterDescription = input.characterDescription;
    let characterImageSeed = -1;
    if (input.characterId) {
      const visualRows = await imgDb
        .select({
          visualPrompt: characterTable.visualPrompt,
          imageMeta: characterTable.imageMeta,
          seed: characterTable.seed,
        })
        .from(characterTable)
        .where(and(eq(characterTable.id, input.characterId), eq(characterTable.userId, imgUserId)))
        .limit(1);
      const characterVisual = visualRows[0];
      if (!characterVisual) return c.json({ error: "character not found" }, 404);

      const identity = resolveCharacterImageIdentity({
        characterId: input.characterId,
        imageMeta: characterVisual.imageMeta,
        visualPrompt: characterVisual.visualPrompt,
        requestedDescription: input.characterDescription,
        seed: characterVisual.seed,
      });
      profileImageAnchors = identity.imageMetaAnchors;
      hasAuthoritativeIdentitySource = identity.hasAuthoritativeSource;
      effectiveCharacterDescription = identity.description;
      characterImageSeed = identity.seed;
      if (!effectiveCharacterDescription) {
        // visualPrompt も無い場合は空タグで突入する直前に一次証拠を残す。
        console.error("image gen empty visual snapshot", {
          characterId: input.characterId,
          phase: input.phase,
        });
      }
    }
    const imageInput: ImageInput = {
      prompt: input.prompt,
      characterDescription: effectiveCharacterDescription,
      negative_prompt: input.negative_prompt,
      width: input.width,
      height: input.height,
      phase: input.phase,
    };

    // #444: 明示コンテンツ(中出し/お腹パンパン等)を prompt から検知。検知時は phase が
    // pre-climax でも climax タグを剥がさず、対応する explicit タグを後段で付与する。
    const explicitContent = detectExplicitContent(input.prompt);
    // #444: 背景は scene_state → character_default → keyword → none の順で解決する。
    const resolvedBackground = await resolveSceneBackground(imgDb, {
      conversationId: input.conversationId ?? null,
      characterId: input.characterId ?? null,
      prompt: input.prompt,
      phase: input.phase,
    });
    // #444: 解決済み背景タグをヒントに混ぜ、prompt 内の最新場所ヒントがあればそちらを優先する。
    const scenePrefix = extractScenePrefixFromPrompt(
      input.prompt,
      input.phase,
      resolvedBackground.tag,
    );
    const backgroundConstraint = scenePrefix;

    const phaseTranslationHints: Record<ScenePhase, string> = {
      conversation:
        "Focus on: clothed, casual pose, safe for work framing, atmosphere, facial expression",
      intimate:
        "Focus on: partial undress, soft_lighting. " +
        "Include an expression tag that matches the character sheet, not a fixed one. " +
        "Show the undressing state concretely.",
      erotic:
        "MANDATORY tags: sex, vaginal, penetration, completely_nude, spread_legs or missionary or doggystyle or cowgirl. " +
        "MANDATORY body detail: sweat_drops, pussy_juice, nipples. " +
        "MANDATORY expression: open_mouth, blush, heavy_breathing, pleasure, half-closed_eyes. " +
        "CAMERA: Include a camera angle tag (from_below, from_above, from_side, pov). " +
        "FORBIDDEN: clothed, fully_clothed, censored, mosaic_censoring, bar_censor. " +
        "Show active intercourse with visible arousal. Be explicit about penetration state and body fluids.",
      climax:
        "MANDATORY tags: sex, orgasm, creampie, cum, trembling, arched_back, completely_nude. " +
        "MANDATORY expression: ahegao, rolling_eyes, tongue_out, tears, drooling, mind_break. " +
        "CAMERA: Include a camera angle tag (from_below, from_above, close-up). " +
        "FORBIDDEN: calm, neutral, clothed, standing, annoyed, censored, mosaic_censoring, bar_censor. " +
        "Show the peak moment of climax. Emphasize body fluids (cum, pussy_juice, sweat), involuntary muscle tension, and overwhelmed facial expression.",
      afterglow:
        "Focus on: post-climax tenderness, resting together, gentle embrace, peaceful expression, soft lighting. " +
        "FLUID tags: cum_drip, cum_on_thighs, cum_pool, after_sex, messy, wet.",
    };

    const poseDiversityPool: Record<ScenePhase, readonly string[]> = {
      conversation: [
        "sitting, looking_at_viewer",
        "standing, hand_on_hip",
        "leaning_forward, smile",
        "arms_behind_back, looking_away",
        "chin_rest, elbow_on_table",
        "crossed_arms, smirk",
        "waving, tilted_head",
      ],
      intimate: [
        "lying_on_bed, looking_up",
        "sitting_on_lap, face_to_face",
        "against_wall, arms_around_neck",
        "kneeling, hand_on_chest",
        "from_behind, looking_over_shoulder",
        "straddling, hands_on_shoulders",
        "side_lying, intertwined",
      ],
      erotic: [
        "missionary, legs_spread",
        "doggystyle, arched_back",
        "cowgirl, hands_on_chest",
        "from_side, leg_lifted",
        "bent_over, gripping_sheets",
        "reverse_cowgirl, looking_back",
        "standing_sex, against_wall",
        "mating_press, pinned",
        "lying, face_down, ass_up",
        "legs_up, missionary",
        "standing_sex, lifted_by_another",
      ],
      climax: [
        "arched_back, head_tilted_back",
        "trembling, eyes_rolled_back",
        "collapsed, afterglow",
        "clinging, nails_digging",
        "legs_locked, full_body_tension",
        "on_back, spread_legs, convulsing",
        "face_down, gripping_pillow",
        "toes_curled, arched_back",
        "trembling, drooling, pillow",
        "spread_legs, spread_arms, restrained",
      ],
      afterglow: [
        "lying_together, cuddling",
        "head_on_chest, peaceful",
        "spooning, eyes_closed",
        "sitting_up, wrapped_in_sheet",
        "forehead_touch, gentle_smile",
        "intertwined_fingers, resting",
        "back_embrace, sleepy",
      ],
    };

    const posePool = poseDiversityPool[input.phase];
    const diversityCacheKey = `${imgUserId}:${input.phase}`;
    const randomPose = pickNonRepeatingTag(diversityCacheKey, posePool, input.prompt);

    const cfgByPhase: Record<ScenePhase, number> = {
      conversation: 7.0,
      intimate: 7.5,
      erotic: 8.5,
      climax: 9.0,
      afterglow: 7.0,
    };

    // フェーズ別ガードレールは functions/api/lib/image-phase-guardrails.ts に集約済み。
    // route 側は subject タグ等の route 固有ロジックのみを残す。
    const phaseGuardrail = PHASE_GUARDRAILS[input.phase];

    const phaseExpressionTags: Record<ScenePhase, string[]> = {
      conversation: [""],
      // intimate の表情はキャラ設定が決める。ここで固定タグを足すと翻訳ヒント側の
      // 「設定に合う表情タグを入れる」指示が最終プロンプトで打ち消される。
      intimate: [""],
      erotic: [
        "(open_mouth:1.2), blush, sweat, pussy_juice, saliva_trail",
        "half_closed_eyes, flushed_face, parted_lips, heavy_breathing",
        "lovestruck, needy_expression, wet_lips, blushing",
        "lustful_eyes, moaning, drool, body_flush",
      ],
      climax: [
        // 顔・髪まみれホラー対策(2026-06-24 本番再現+目視N=2): generic floating cum((cum:1.3)/semen/cum_drip)は
        // close-up で顔に集中し bukkake 化する。中出し(creampie)+内部射精に限定し、顔へ飛ばさない。
        // rolling_eyes/fucked_silly は顔崩壊の主因のため外し、ahegao は 1.2 に抑えて表情の崩れを防ぐ(強度は維持)。
        "(ahegao:1.2), tongue_out, half_closed_eyes, full_body_blush, (creampie:1.3), cum_in_pussy, cum_overflow, cum_dripping_from_pussy",
      ],
      afterglow: [
        "peaceful, closed_eyes, gentle_smile, afterglow, exhausted, cum_drip, cum_on_thighs, messy, wet",
      ],
    };

    const phaseForbiddenExpressions: Record<ScenePhase, string> = {
      conversation: "",
      intimate: "angry, annoyed, disinterest, bored",
      erotic: "angry, annoyed, disinterest, bored, calm, neutral_expression, frown, fully_clothed",
      climax: "angry, annoyed, calm, neutral_expression, fully_clothed, standing, bored, frown",
      afterglow: "angry, annoyed, penetration",
    };

    // conversation は女性キャラ単独。intimate 以降は相手との場面として描く。
    const isSoloPhase = input.phase === "conversation";
    const subjectTags = isSoloPhase ? "1girl, solo" : "1girl, 1boy, hetero, couple";

    const guidanceScale = cfgByPhase[input.phase];
    const extraNegative = phaseGuardrail.negativeExtra;
    const phaseExpressionOptions = phaseExpressionTags[input.phase];
    const phaseExpression =
      input.phase === "erotic"
        ? pickNonRepeatingTag(
            `${diversityCacheKey}:expression`,
            phaseExpressionOptions,
            input.prompt,
          )
        : (phaseExpressionOptions[0] ?? "");
    const forbiddenExpression = phaseForbiddenExpressions[input.phase];

    // LoRA ゲート: キャラに LoRA が登録済みなら全 phase で Runware LoRA 経路で生成する。
    // 身元は LoRA の重みが運ぶため、visual anchor / img2img 参照 / 長 negative は使わない。
    // phase 別の positive/negative/expression はそのまま適用される。
    let loraGate: { model: string; weight: number; triggerPrompt: string } | null = null;
    if (input.characterId) {
      const loraRows = await imgDb
        .select({
          loraModel: characterTable.loraModel,
          loraWeight: characterTable.loraWeight,
          loraTriggerPrompt: characterTable.loraTriggerPrompt,
        })
        .from(characterTable)
        .where(and(eq(characterTable.id, input.characterId), eq(characterTable.userId, imgUserId)))
        .limit(1);
      const loraRow = loraRows[0];
      // weight 0 以下は「LoRA 無効」扱い: 発火させると anchor も参照も外れたまま身元の担い手が消える。
      const loraWeight = loraRow?.loraWeight ?? 0.85;
      if (loraRow?.loraModel && loraWeight > 0) {
        loraGate = {
          model: loraRow.loraModel,
          weight: loraWeight,
          triggerPrompt: loraRow.loraTriggerPrompt ?? "",
        };
        if (!loraGate.triggerPrompt) {
          // trigger 無しでも LoRA は効くが身元タグが薄くなる。運用ミス検知用に一次証拠を残す。
          console.warn("lora gate active without trigger prompt", {
            characterId: input.characterId,
            phase: input.phase,
          });
        }
      }
    }

    // #634: character_visual テーブルの正規化済み VisualMeta からアイデンティティタグを導出し、
    // テキスト正規表現ベースの extractVisualAnchors とマージする。
    // VisualMeta が存在すれば skinTone 等の正規化タグが確実に入り、テキスト抽出の取りこぼしを補う。
    let identityPositive = "";
    let identityNegative = "";
    // LoRA 経路は trigger prompt が anchor を置換し negative もピン留め短文になるため、
    // ここで導出しても全量捨てられる。D1 読みを節約してスキップする。
    if (profileImageAnchors) {
      identityPositive = profileImageAnchors.positive;
      identityNegative = profileImageAnchors.negative;
    } else if (input.characterId && !loraGate) {
      const visualMeta = await loadVisualMeta(imgDb, input.characterId);
      if (visualMeta) {
        const identity = buildIdentityPrompt(visualMeta);
        identityPositive = identity.positive;
        identityNegative = identity.negative;
        hasAuthoritativeIdentitySource = hasUsableIdentityAnchor(identityPositive);
      }
    }
    const textAnchors = extractVisualAnchors(imageInput.characterDescription);
    // image_meta は承認済みの不変ブロックなので、存在時は抽出・再解釈せずそのまま使う。
    const visualAnchors = profileImageAnchors
      ? profileImageAnchors.positive
      : [identityPositive, textAnchors].filter(Boolean).join(", ");
    // 身元タグが空のまま生成すると「プロフと別人の匿名女性」が返る。従来は console.error を
    // 残すだけで生成を続行していたため、破綻画像がユーザーに届いていた。生成前に止める。
    // ただし止めるのは身元の出所が1つも無い時だけ。visual_prompt に自由文の外見説明があって
    // アンカー抽出だけ失敗したケースまで塞ぐと、そのキャラは恒久的に生成でけへんようになる。
    if (input.characterId && !loraGate) {
      const identityGate = await enforceIdentitySourceGate({
        env: c.env,
        userId: imgUserId,
        costCents: COST_ESTIMATES["image"] ?? 1,
        reservedPeriods: imgPeriods,
        visualAnchors,
        hasAuthoritativeSource: hasAuthoritativeIdentitySource,
      });
      if (identityGate.blocked) {
        console.error("image gen blocked: no identity source", {
          characterId: input.characterId,
          phase: input.phase,
        });
        return c.json({ error: IMAGE_IDENTITY_MISSING_CODE }, 422);
      }
      if (identityGate.degraded) {
        // アンカー抽出だけ失敗。劣化の一次証拠を残す。
        console.warn("image gen anchor extraction degraded", {
          characterId: input.characterId,
          phase: input.phase,
        });
      }
    }
    // POV 判定はユーザー側の prompt のみ。キャラ description に「私の手」等の自己描写が
    // あっても POV タグは付けない (false positive 回避)。
    const isPovRequested = POV_USER_BODY_PATTERN.test(input.prompt.toLowerCase());
    const povTags = isPovRequested
      ? "pov, first_person_view, viewer_pov, user_body_visible, viewer_hands, viewer_lap, user_torso, masc_hands, foreshortening"
      : "";
    // #445: 翻訳 LLM が遅いと画像生成全体が詰まるため上限を設ける。タイムアウト時は
    // 翻訳失敗として扱い、後段の degraded ログで観測できるようにする。
    // deepseek/deepseek-chat は qwen 経由で NSFW が reject されたため切り替え、
    // タイムアウトも少し余裕を持たせる。
    const TRANSLATE_TIMEOUT_MS = 15_000;
    const translated = await Promise.race<TranslatedImageTags>([
      translatePromptToImageTags(
        c.env.OPENROUTER_API_KEY,
        imageInput,
        randomPose,
        phaseTranslationHints[input.phase],
        explicitContent.detected,
        backgroundConstraint,
      ),
      new Promise<TranslatedImageTags>((resolve) =>
        setTimeout(
          () => resolve({ tags: imageInput.characterDescription, translationFailed: true }),
          TRANSLATE_TIMEOUT_MS,
        ),
      ),
    ]);
    if (translated.translationFailed) {
      // 翻訳が落ちると日本語タグが SD モデルへ渡り画質が崩れる。一次証拠を残す。
      console.error("image prompt translation degraded", {
        phase: input.phase,
        characterId: input.characterId ?? null,
      });
    }
    let imagePromptRaw = translated.tags;
    // #444: 会話履歴で解決済みの背景がある場合、翻訳LLMが勝手に足した汎用背景タグを除去する。
    if (backgroundConstraint) {
      imagePromptRaw = stripConflictingLocationTags(imagePromptRaw, backgroundConstraint);
    }
    // #444: 解決した背景タグと明示コンテンツタグを prompt 先頭側へ合流させ、シーン忠実度を上げる。
    const explicitTags = explicitContent.detected ? explicitContent.tags.join(", ") : "";
    const imagePrompt = sanitizeImageTagsForPhase(
      input.phase,
      [scenePrefix, explicitTags, imagePromptRaw].filter(Boolean).join(", "),
    );

    const fullNegativePrompt = [
      input.negative_prompt,
      S_TIER_NEGATIVE_INJECTION,
      NOVITA_HAIR_COLOR_NEGATIVE_TAGS,
      identityNegative,
      extraNegative,
      forbiddenExpression,
    ]
      .filter(Boolean)
      .join(", ");
    // visual_anchors を冒頭側で強調する。重みの決定は image-prompt-anchors 側の正典に寄せる。
    const anchorWeight = resolveVisualAnchorWeight(input.phase);
    // LoRA 経路では trigger prompt が anchor ブロックを丸ごと置換する(重み付きタグと二重化しない)。
    const visualAnchorPrompt = loraGate
      ? loraGate.triggerPrompt
      : buildVisualAnchorPrompt(visualAnchors, anchorWeight);
    const phasePositiveHint = phaseGuardrail.positiveHint;
    // 10点実証レシピ(20260717-sakura-lora-ero-10ten.md)では身元ブロックを最前列に置く。
    // 品質タグ・表情タグより先に trigger/キャラタグとシーンタグを置くことで、
    // 過激なフェーズでも構図が崩れずにキャラ身元を保持できる。
    // phasePositiveHint は重み付き nude/fully_clothed 等を含むため、ユーザー入力より先に置くことで
    // 重み付き表現が dedupe で生き残る。
    const assembledPrompt = dedupePromptTags(
      [
        visualAnchorPrompt,
        subjectTags,
        phasePositiveHint,
        povTags,
        imagePrompt,
        phaseExpression,
        "masterpiece, best quality, anatomically_correct_hands, five_fingers",
      ]
        .filter(Boolean)
        .join(", "),
    );
    // 翻訳 LLM が climax/afterglow で吐く汎用 cum/ejaculation は close-up で顔・髪に集中しホラー化する。
    // 中出し(creampie/cum_in_pussy 等の局所タグ)は残し、顔へ飛ぶ汎用タグだけ除去する(2026-06-24 目視確定)。
    const novitaPrompt =
      input.phase === "climax" || input.phase === "afterglow"
        ? stripFloatingCumTags(assembledPrompt)
        : assembledPrompt;

    const modelByPhase = CHAT_IMAGE_MODEL_BY_PHASE;
    // 32: R23確定値（局長採点90点・2026-07-13）。#445の26-30では髪の質感が粗く、
    // 40はT&Eで過剰と判明。品質と生成時間の釣り合い点として32に統一。
    const stepsByPhase: Record<ScenePhase, number> = {
      conversation: 32,
      intimate: 32,
      erotic: 32,
      climax: 32,
      afterglow: 32,
    };

    // #445: DPM++ 2M Karras 固定をやめ、phase 別に sampler を選べるようにする。
    // 収束の速い 2M SDE Karras を会話/前戯に当てて step 減でも品質を保つ。
    const samplerByPhase: Record<ScenePhase, string> = {
      conversation: "DPM++ 2M SDE Karras",
      intimate: "DPM++ 2M SDE Karras",
      erotic: "DPM++ 2M Karras",
      climax: "DPM++ 2M Karras",
      afterglow: "DPM++ 2M SDE Karras",
    };

    const novitaRequest = {
      model_name: modelByPhase[input.phase],
      prompt: novitaPrompt,
      negative_prompt: dedupePromptTags(
        `${fullNegativePrompt}, monochrome, grayscale, greyscale, multiple girls, 2girls, group, crowd, realistic, photorealistic, 3d, western, text, watermark, bad anatomy, bad hands, extra hands, three hands, disembodied hand, duplicate arms, extra fingers, fewer fingers, missing fingers, extra_fingers, fused_hands, malformed_hands, mutated_hands, poorly drawn hands, malformed_feet, three_legs, missing_limbs, worst quality, low quality, normal quality, cropped${isSoloPhase ? ", male, man, boy, 2boys, multiple boys" : ", 3boys, 3girls, multiple girls"}`,
      ),
      width: input.width,
      height: input.height,
      sampler_name: samplerByPhase[input.phase],
      steps: stepsByPhase[input.phase],
      guidance_scale: guidanceScale,
      image_num: 1,
      seed: characterImageSeed,
    };

    let referenceImageBase64: string | null = null;
    if (input.characterId) {
      // 他ユーザーのキャラクター由来の参照画像を読ませないため。
      const owned = await validateCharacterOwnership(imgDb, input.characterId, imgUserId);
      if (!owned) return c.json({ error: "character not found" }, 404);

      // LoRA 経路は txt2img 固定(参照画素は色被りを運ぶ・身元は LoRA が保証する)ため参照を読まない。
      if (!loraGate) {
        referenceImageBase64 = await getCharacterReferenceImageBase64(
          imgDb,
          c.env.BUCKET,
          c.env,
          c.req.url,
          input.characterId,
          imgUserId,
        );
      }
    }

    const novitaImg2ImgRequest = {
      ...novitaRequest,
      // 0.45: 局長採点90点のR23確定値（2026-07-13）。元絵の同一性保持を優先し、
      // waiNSFWの自然な描き方でシーンを差し替える釣り合い点。
      strength: input.strength ?? 0.45,
    };
    // 10点実証レシピのピン留め値はトップレベル定数 LORA_PINNED_RECIPE から使う。
    const imageRouter = createImageRouterForEnv(c.env);
    try {
      // LoRA でもフェーズ別ネガティブは適用する。conversation では nudity 抑制、
      // climax/afterglow では顔・髪への流体タグ抑制等、フェーズ意図を維持するため。
      const loraNegativePrompt = loraGate
        ? dedupePromptTags(`${LORA_PINNED_RECIPE.negativePrompt}, ${phaseGuardrail.negativeExtra}`)
        : novitaRequest.negative_prompt;
      const generated = await imageRouter.generate({
        prompt: novitaPrompt,
        negativePrompt: loraNegativePrompt,
        width: loraGate ? LORA_PINNED_RECIPE.width : novitaRequest.width,
        height: loraGate ? LORA_PINNED_RECIPE.height : novitaRequest.height,
        model: novitaRequest.model_name,
        steps: loraGate ? LORA_PINNED_RECIPE.steps : novitaRequest.steps,
        guidanceScale: loraGate
          ? input.phase === "conversation" || input.phase === "intimate"
            ? cfgByPhase[input.phase]
            : LORA_PINNED_RECIPE.guidanceScale
          : novitaRequest.guidance_scale,
        seed: novitaRequest.seed,
        imageNum: novitaRequest.image_num,
        samplerName: novitaRequest.sampler_name,
        loras: loraGate ? [{ model: loraGate.model, weight: loraGate.weight }] : undefined,
        imageBase64: referenceImageBase64 ?? undefined,
        strength: referenceImageBase64 ? novitaImg2ImgRequest.strength : undefined,
      });

      c.executionCtx.waitUntil(logUsage(imgDb, imgUserId, "image", null));
      // タスク開始時刻を残し、poll 側が滞留タイムアウトを判定できるようにする。
      c.executionCtx.waitUntil(
        writeImageTaskStartedAt(c.env.BUCKET, generated.taskId).catch((error) => {
          console.warn("image task start marker write failed", error);
        }),
      );
      if (generated.provider === "novita" && input.characterId && referenceImageBase64) {
        c.executionCtx.waitUntil(
          writeVlmLikenessGateContext(c.env.BUCKET, generated.taskId, {
            characterId: input.characterId,
            novitaRequest: novitaImg2ImgRequest,
            phase: input.phase,
            attempt: 0,
            userId: imgUserId,
          }).catch((error) => {
            // ctx欠損時は従来のpoll結果をそのまま返すため。
            console.warn("vlm likeness gate context write failed", error);
          }),
        );
      }
      return c.json({
        task_id: generated.taskId,
        provider: generated.provider,
        model: novitaRequest.model_name,
        prompt: novitaPrompt,
        loraModel: loraGate?.model ?? null,
        loraWeight: loraGate?.weight ?? null,
        loraTriggerPrompt: loraGate?.triggerPrompt ?? null,
      });
    } catch (error) {
      // prod は失敗時の実送信内容を残していなかった。上流の実 status・provider・応答本文・送信プロンプト・
      // 参照画像バイト長を構造化して残し、再現に頼らず一次証拠で 400(内容拒否)/429(レート)/壊れ payload を切り分ける。
      const upstream =
        error instanceof ImageGenProviderError
          ? {
              provider: error.provider ?? null,
              status: error.status,
              reason: error.detail ?? error.message,
            }
          : { provider: null, status: null, reason: String(error) };
      const loraAttempt = loraGate
        ? { model: loraGate.model, weight: loraGate.weight, triggerPrompt: loraGate.triggerPrompt }
        : null;
      console.error(
        "Image init upstream error:",
        JSON.stringify({
          upstream,
          phase: input.phase,
          model: novitaRequest.model_name,
          configuredProvider: input.provider ?? null,
          novitaPrompt,
          promptChars: novitaPrompt.length,
          refImageBytes: referenceImageBase64 ? referenceImageBase64.length : 0,
          lora: loraAttempt,
        }),
      );
      return c.json(
        {
          error: "upstream service error",
          upstream: {
            provider: upstream.provider,
            status: upstream.status,
            reason:
              typeof upstream.reason === "string" ? upstream.reason.slice(0, 500) : upstream.reason,
          },
          phase: input.phase,
          promptChars: novitaPrompt.length,
          refImageBytes: referenceImageBase64 ? referenceImageBase64.length : 0,
          lora: loraAttempt,
        },
        502,
      );
    }
  })

  .get("/image/task/:taskId", async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) return c.json({ error: "unauthorized" }, 401);

    const taskId = c.req.param("taskId");

    if (!TASK_ID_PATTERN.test(taskId)) {
      return c.json({ error: "invalid task_id format" }, 400);
    }

    try {
      const rawResult = await createImageRouterForEnv(c.env).getTaskResult(taskId);
      const parsed = imageGenTaskResultSchema.safeParse(rawResult);
      if (!parsed.success) {
        // 旧実装は parse 失敗時に rawResult を 200 で返して握り潰していた。一次証拠を残し 500 で返す。
        console.error(
          "Image task parse error:",
          JSON.stringify({ taskId, issues: parsed.error.issues }),
        );
        return c.json({ error: "invalid_upstream_task_result" }, 500);
      }
      // 上流がいつまでも QUEUED/PROCESSING のまま返す滞留を打ち切る。生成時刻マーカーと比較する。
      const stillPending =
        parsed.data.task.status === "TASK_STATUS_QUEUED" ||
        parsed.data.task.status === "TASK_STATUS_PROCESSING";
      if (stillPending) {
        const startedAt = await readImageTaskStartedAt(c.env.BUCKET, taskId);
        if (startedAt !== null && Date.now() - startedAt > IMAGE_TASK_MAX_WAIT_MS) {
          console.error(
            "Image task timed out:",
            JSON.stringify({
              taskId,
              elapsedMs: Date.now() - startedAt,
              status: parsed.data.task.status,
            }),
          );
          return c.json({ error: "image_task_timeout", taskId }, 504);
        }
      }
      if (parsed.data.task.status === "TASK_STATUS_SUCCEED") {
        const gateContext = await readVlmLikenessGateContext(c.env.BUCKET, taskId);
        if (!gateContext) return c.json(parsed.data);
        const database = drizzle(c.env.DB);
        const userId = await ensureUser(database, userEmail);
        const gatedResult = await applyVlmLikenessGate(
          c.env,
          c.req.url,
          database,
          taskId,
          parsed.data,
          gateContext,
          userId,
        );
        return c.json(gatedResult);
      }
      return c.json(parsed.data);
    } catch (error) {
      console.error("Image task upstream error:", error);
      return c.json({ error: "upstream service error" }, 502);
    }
  })

  .route("/", characterRoutes)

  .route("/", conversationRoutes)

  .route("/", imageRoutes)

  .post("/generate-character", zValidator("json", generateCharacterSchema), async (c) => {
    const userEmail = await getUserEmail(c);
    if (!userEmail) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // コスト上限・レート制限チェック
    const genRl = await enforceRateLimit(c, drizzle(c.env.DB), userEmail, "generate-character");
    if (!genRl.ok) {
      return c.json({ error: `rate_limited: ${genRl.reason}` }, 429);
    }
    const { database: genCharDb, userId: genCharUserId } = genRl.ctx;

    const { selections, situation, details, previousResult, feedback } = c.req.valid("json");
    const generationMessages = buildCharacterGenerationMessages(
      selections,
      situation,
      details,
      previousResult,
      feedback,
    );

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": c.env.APP_ORIGIN ?? "https://ai-chat.app",
        "X-Title": "Adult Fiction Roleplay",
      },
      body: JSON.stringify({
        model: DEFAULT_CHARACTER_GENERATION_MODEL,
        messages: generationMessages,
        stream: false,
        temperature: 0.9,
        top_p: 0.95,
        max_tokens: 2500,
        response_format: { type: "json_object" },
        provider: {
          allow_fallbacks: true,
        },
      }),
    });

    if (!response.ok) {
      console.error("OpenRouter generate-character error:", response.status);
      return c.json({ error: "upstream service error" }, 502);
    }

    const raw: { choices?: Array<{ message?: { content?: string } }> } = await response.json();
    const content = raw.choices?.[0]?.message?.content ?? "";

    const characterResult = parseCharacterJsonFromLLM(content);
    if (!characterResult) {
      return c.json({ error: "failed to parse character JSON from model response" }, 502);
    }

    c.executionCtx.waitUntil(
      logUsage(genCharDb, genCharUserId, "generate-character", DEFAULT_CHARACTER_GENERATION_MODEL),
    );
    return c.json(characterResult);
  })

  .route("/", avatarRoutes)

  .route("/groups", groupRoutes)

  .route("/", shareRoutes);

app.route("/admin", adminRoutes);

export const onRequest = handle(app);
export type AppType = typeof app;
