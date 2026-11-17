// 記憶ジョブ 1 件分の処理（抜き出し→索引）を本番と同じ順で回す共通部品。
// apps/v2 の Queue 受け手（consumeMemoryJobs）と RIT-99 のベンチの両方から呼ぶ。
// モデルは「必要になった時だけ組み立てる」工場で注入する。抜き出しが要らん配送
// （抜き出し済みの再索引・種類全カットの方針）や、実モデルの生成が鍵不足で
// 例外になる環境でも、索引だけの再配送が生きるよう遅延にする（本番の元実装と同じ）。
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  completeMemoryExtraction,
  listActiveSubjects,
  loadMemoryExtractionPolicy,
  loadMemoryExtractionSource,
  type MemoryExtractionSource,
  type V2Db,
} from "@v2/db";

import { extractMemories } from "./memory-extractor";
import { indexMemoryJob } from "./memory-rag";
import { memoryVectorReady, type MemoryVectorBindings } from "./memory-vector";

type MemoryExtractionPolicy = Awaited<ReturnType<typeof loadMemoryExtractionPolicy>>;

// policy が読めた時の抜き出し→保存。knownSubjects は同じ題の記憶を新旧で繋ぐ目印（RIT-86 系）。
const extractAndComplete = async (
  db: V2Db,
  source: MemoryExtractionSource,
  policy: MemoryExtractionPolicy,
  models: readonly BaseChatModel[],
): Promise<void> => {
  const knownSubjects = await listActiveSubjects(db, source);
  const extracted = await extractMemories(models, source.content, {
    instruction: policy?.memoryInstruction,
    knownSubjects,
  });
  // 指示どおりの種類だけ残す契約。方針を読めん会話は全種類を通す。
  const memories = policy
    ? extracted.filter((memory) => policy.memoryKinds.includes(memory.kind))
    : extracted;
  await completeMemoryExtraction(db, source, memories);
};

// source 済みの 1 件を抜き出して保存する（apps/v2 の runMemoryExtraction が試験口として使う）。
export const extractMemorySource = async (
  db: V2Db,
  source: MemoryExtractionSource,
  models: readonly BaseChatModel[],
): Promise<void> => {
  const policy = await loadMemoryExtractionPolicy(db, source.conversationId);
  // 種類を全部切った版では呼んでも全て捨てるだけなので、モデルを呼ばず完了にする。
  if (policy && policy.memoryKinds.length === 0) {
    await completeMemoryExtraction(db, source, []);
    return;
  }
  await extractAndComplete(db, source, policy, models);
};

export const runMemoryJob = async (
  db: V2Db,
  env: MemoryVectorBindings,
  jobId: string,
  modelFactory: (source: MemoryExtractionSource) => Promise<readonly BaseChatModel[]>,
): Promise<void> => {
  const source = await loadMemoryExtractionSource(db, jobId);
  if (source) {
    const policy = await loadMemoryExtractionPolicy(db, source.conversationId);
    // 種類を全部切った版では呼んでも全て捨てるだけなので、モデルを呼ばず完了にする。
    if (policy && policy.memoryKinds.length === 0) {
      await completeMemoryExtraction(db, source, []);
    } else {
      await extractAndComplete(db, source, policy, await modelFactory(source));
    }
  }
  if (memoryVectorReady(env)) {
    await indexMemoryJob(db, env, jobId);
  }
};
