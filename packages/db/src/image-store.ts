// 会話起点の画像生成（RIT-182）の D1 実装。生成は Novita の非同期タスクと 1:1 で、
// poll が状態を進める（running → succeeded/failed）。成功時は v2_message に画像行を足す。
import { desc, eq, and, max } from "drizzle-orm";

import {
  v2ConversationTable,
  v2ImageGenerationTable,
  v2LedgerTable,
  v2MessageTable,
} from "./v2-schema";

import type { V2Db } from "./client";

export type ImageGenerationRow = typeof v2ImageGenerationTable.$inferSelect;

export type CreateImageGenerationInput = {
  id: string;
  conversationId: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  seed: number | null;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  sampler: string;
  costEstimateUsd: number | null;
  now: number;
};

export const createImageGeneration = async (
  db: V2Db,
  input: CreateImageGenerationInput,
): Promise<void> => {
  await db.insert(v2ImageGenerationTable).values({
    id: input.id,
    conversationId: input.conversationId,
    status: "running",
    model: input.model,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    seed: input.seed,
    width: input.width,
    height: input.height,
    steps: input.steps,
    guidanceScale: input.guidanceScale,
    sampler: input.sampler,
    costEstimateUsd: input.costEstimateUsd,
    createdAt: input.now,
  });
};

// 上流タスク id は init 応答が返ってから書く（生成行は受付時点で先に作る）。
export const markImageTaskStarted = async (db: V2Db, id: string, taskId: string): Promise<void> => {
  await db.update(v2ImageGenerationTable).set({ taskId }).where(eq(v2ImageGenerationTable.id, id));
};

// 生成記録は会話経由で所有者へ辿る。他人の会話・存在しない生成は null。
export const readOwnedImageGeneration = async (
  db: V2Db,
  userId: string,
  id: string,
): Promise<ImageGenerationRow | null> => {
  const [row] = await db
    .select({ generation: v2ImageGenerationTable })
    .from(v2ImageGenerationTable)
    .innerJoin(
      v2ConversationTable,
      eq(v2ConversationTable.id, v2ImageGenerationTable.conversationId),
    )
    .where(and(eq(v2ImageGenerationTable.id, id), eq(v2ConversationTable.userId, userId)));
  return row?.generation ?? null;
};

// 会話の存在・所有者・紐づくキャラを確認する。画像生成は会話が先にある前提（会話未作成は null）。
export const readOwnedConversation = async (
  db: V2Db,
  userId: string,
  conversationId: string,
): Promise<{ characterId: string; characterVersionId: string | null } | null> => {
  const [row] = await db
    .select({
      characterId: v2ConversationTable.characterId,
      characterVersionId: v2ConversationTable.characterVersionId,
    })
    .from(v2ConversationTable)
    .where(and(eq(v2ConversationTable.id, conversationId), eq(v2ConversationTable.userId, userId)));
  return row ?? null;
};

export const completeImageGeneration = async (
  db: V2Db,
  input: { id: string; r2Key: string; messageId: string; now: number },
): Promise<void> => {
  await db
    .update(v2ImageGenerationTable)
    .set({
      status: "succeeded",
      r2Key: input.r2Key,
      messageId: input.messageId,
      completedAt: input.now,
    })
    .where(eq(v2ImageGenerationTable.id, input.id));
};

export const failImageGeneration = async (
  db: V2Db,
  input: { id: string; failureJson: string; now: number },
): Promise<void> => {
  await db
    .update(v2ImageGenerationTable)
    .set({ status: "failed", failureJson: input.failureJson, completedAt: input.now })
    .where(eq(v2ImageGenerationTable.id, input.id));
};

// 画像メッセージは専用ターン（最大 turn+1）に置く。失敗ターンと同じ番号を使うと、
// そのターンが「生きた」扱いになり伏せた本文まで画面へ戻ってしまうため、番号の再利用はせん。
export const insertImageMessage = async (
  db: V2Db,
  input: { conversationId: string; content: string; imageKey: string; now: number },
): Promise<{ id: string; turn: number }> => {
  const [row] = await db
    .select({ maxTurn: max(v2MessageTable.turn) })
    .from(v2MessageTable)
    .where(eq(v2MessageTable.conversationId, input.conversationId));
  const turn = (row?.maxTurn ?? 0) + 1;
  const id = crypto.randomUUID();
  await db.insert(v2MessageTable).values({
    id,
    conversationId: input.conversationId,
    turn,
    role: "assistant",
    content: input.content,
    imageKey: input.imageKey,
    createdAt: input.now,
  });
  return { id, turn };
};

// 直近シーンの素（場所・行為）を台帳から読む。無ければ空。
export const readLatestLedgerJson = async (
  db: V2Db,
  conversationId: string,
): Promise<string | null> => {
  const [row] = await db
    .select({ ledgerJson: v2LedgerTable.ledgerJson })
    .from(v2LedgerTable)
    .where(eq(v2LedgerTable.conversationId, conversationId))
    .orderBy(desc(v2LedgerTable.turn))
    .limit(1);
  return row?.ledgerJson ?? null;
};
