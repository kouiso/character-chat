import {
  listGroupHistory,
  listGroupMembers,
  listGroupMemories,
  rememberGroupEvent,
  saveGroupMessage,
} from "@v2/db";
import { extractVoice, voiceCheck } from "@v2/judge";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { GroupMessage } from "@v2/db";
import type { V2Db } from "@v2/db";

const HISTORY_TAIL = 12;
const MEMORY_LIMIT = 8;

// 次に話すキャラを選ぶ節: 直前の発言者は外し、話した回数が一番少ない人を取る。
// 2人以上いれば同じ人が連続で話すこと自体が起きんので「5回連続」は構造上ありえん。
export const pickNextSpeaker = (
  members: string[],
  history: Pick<GroupMessage, "speakerCharacterId">[],
): string | null => {
  const candidates = members.filter((id) => history.at(-1)?.speakerCharacterId !== id);
  if (candidates.length === 0) return members[0] ?? null;
  const counts = new Map<string, number>(candidates.map((id) => [id, 0]));
  for (const row of history) {
    if (row.speakerCharacterId && counts.has(row.speakerCharacterId)) {
      counts.set(row.speakerCharacterId, (counts.get(row.speakerCharacterId) ?? 0) + 1);
    }
  }
  // candidates は members 順に保たれてるので、最小回数の先頭が決定的に選ばれる
  return candidates.reduce((a, b) => ((counts.get(a) ?? 0) <= (counts.get(b) ?? 0) ? a : b));
};

export type GroupCharacter = { name: string; systemPrompt: string };

export type GroupTurnDeps = {
  db: V2Db;
  model: BaseChatModel;
  loadCharacter: (characterId: string) => Promise<GroupCharacter | null>;
  now?: () => number;
};

const stripTags = (raw: string): string =>
  raw
    .replace(/<\/?(?:response|action|dialogue|inner|think)[^>]*>/g, "")
    .trim()
    .slice(0, 2000);

// 表示名の解決は発言ラベルのためだけに使う（混ざらんよう speaker 名を明示）
const resolveNames = async (
  deps: GroupTurnDeps,
  memberIds: string[],
  speakerId: string,
  speaker: GroupCharacter,
): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  for (const id of memberIds) {
    const c = id === speakerId ? speaker : await deps.loadCharacter(id);
    names.set(id, c?.name ?? id);
  }
  return names;
};

const buildGroupPrompt = (
  speaker: GroupCharacter,
  memberIds: string[],
  names: Map<string, string>,
  memories: string[],
  history: GroupMessage[],
): string => {
  const historyText = history
    .slice(-HISTORY_TAIL)
    .map((row) =>
      row.speakerCharacterId === null
        ? `ユーザー: ${row.content}`
        : `${names.get(row.speakerCharacterId) ?? row.speakerCharacterId}: ${row.content}`,
    )
    .join("\n");
  return [
    speaker.systemPrompt,
    "",
    `【指示】あなたは${speaker.name}として、複数人の場で会話に参加しています。`,
    `同じ場のメンバー: ${memberIds.map((id) => names.get(id) ?? id).join("、")}`,
    "自分の番が来たので一言から数文で発言してください。他のキャラの発言や口調を真似せず、自分の話し方を保ってください。",
    memories.length ? `この場で覚えていること:\n${memories.map((m) => `- ${m}`).join("\n")}` : "",
    historyText ? `場の流れ:\n${historyText}` : "",
    "",
    "発言だけを出力してください。",
  ]
    .filter((line) => line !== "")
    .join("\n");
};

// 1ターン回す: 話者選定→生成→声検査→保存→メンバー全員の記憶へ。
export const runGroupTurn = async (
  deps: GroupTurnDeps,
  input: { groupId: string; generationId?: string },
): Promise<{
  speakerCharacterId: string;
  text: string;
  voiceMismatch: number;
} | null> => {
  const members = await listGroupMembers(deps.db, input.groupId);
  const memberIds = members.map((m) => m.characterId);
  const history = await listGroupHistory(deps.db, input.groupId);
  const speakerId = pickNextSpeaker(memberIds, history);
  if (!speakerId) return null;
  const speaker = await deps.loadCharacter(speakerId);
  if (!speaker) return null;

  const names = await resolveNames(deps, memberIds, speakerId, speaker);
  const memories = await listGroupMemories(deps.db, {
    groupId: input.groupId,
    characterId: speakerId,
    limit: MEMORY_LIMIT,
  });
  const prompt = buildGroupPrompt(speaker, memberIds, names, memories, history);

  const response = await deps.model.invoke([{ role: "user", content: prompt }]);
  const text = stripTags(typeof response.content === "string" ? response.content : "");
  if (!text) return null;

  const voice = extractVoice(speaker.systemPrompt);
  const result = voiceCheck(text, voice, speaker.name);
  // 混ざり記録は一人称・呼称・三人称の違反に語尾の不一致も数える（RIT-112 の検査対象）。
  const voiceMismatch = result.ok && !result.endingsMismatch ? 0 : 1;

  const now = deps.now?.() ?? Date.now();
  await saveGroupMessage(deps.db, {
    groupId: input.groupId,
    speakerCharacterId: speakerId,
    content: text,
    voiceMismatch,
    generationId: input.generationId,
    now,
  });
  // 決まり: その場にいる全員がその場の出来事を覚える。不参加者には何も書かれん。
  await rememberGroupEvent(deps.db, {
    groupId: input.groupId,
    characterIds: memberIds,
    content: `${speaker.name}: ${text}`,
    now,
  });
  return { speakerCharacterId: speakerId, text, voiceMismatch };
};

// ユーザーの発言を場へ積む（話者 NULL）。保存だけして次ターンは runGroupTurn が回す。
export const postUserToGroup = async (
  db: V2Db,
  input: { groupId: string; content: string; now?: number },
): Promise<void> => {
  const now = input.now ?? Date.now();
  await saveGroupMessage(db, {
    groupId: input.groupId,
    speakerCharacterId: null,
    content: input.content,
    now,
  });
  const members = await listGroupMembers(db, input.groupId);
  await rememberGroupEvent(db, {
    groupId: input.groupId,
    characterIds: members.map((m) => m.characterId),
    content: `ユーザー: ${input.content}`,
    now,
  });
};
