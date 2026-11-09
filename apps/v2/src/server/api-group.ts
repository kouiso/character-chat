import {
  addGroupMember,
  createDb,
  createGroup,
  listGroupHistory,
  listGroupMembers,
  updateGroupMessageProvider,
} from "@v2/db";
import { createOpenRouterModel } from "@v2/engine";
import { PROMPT_VERSION } from "@v2/prompt";
import { ctx } from "cloudflare:workers";
import { z } from "zod";

import { readCharacter } from "./character-data.server";
import { postUserToGroup, runGroupTurn } from "./group-turn";
import { LOCAL_USER_ID } from "./identity";
import { createProviderLookup, retryProviderLookup } from "./openrouter-lookup";
import { getPlatform } from "./platform";

import type { V2Db } from "@v2/db";

const CreateGroupBody = z.object({
  title: z.string().min(1).max(80),
  // 同じ場は2人以上で意味を持つ。1人場は通常の会話で足りる。
  characterIds: z.array(z.string().min(1)).min(2).max(8),
});

const PostMessageBody = z.object({
  content: z.string().min(1).max(4000),
  // ユーザーの一言に全員が一度ずつ応えるのが自然な既定。上限は暴走防止。
  replyCount: z.number().int().min(1).max(8).optional(),
});

const loadGroupCharacter = async (characterId: string) => {
  const { ok } = await readCharacter(characterId);
  return ok ? { name: ok.name, systemPrompt: ok.systemPrompt } : null;
};

export const handleCreateGroup = async (request: Request): Promise<Response> => {
  const parsed = CreateGroupBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ message: "場の作成には2人以上のキャラが要ります。" }, { status: 400 });
  }
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  for (const characterId of parsed.data.characterIds) {
    if (!(await readCharacter(characterId)).ok) {
      return Response.json({ message: "存在しないキャラが含まれています。" }, { status: 404 });
    }
  }
  const now = Date.now();
  const groupId = await createGroup(db, {
    userId: LOCAL_USER_ID,
    title: parsed.data.title,
    promptVersion: PROMPT_VERSION,
    now,
  });
  for (const [position, characterId] of parsed.data.characterIds.entries()) {
    await addGroupMember(db, { groupId, characterId, position, now });
  }
  return Response.json({ id: groupId }, { status: 201 });
};

// /generation の索引待ちで引けんかった実行先は、応答を返した後で引き直して書き戻す。
const deferProviderResolution = (
  db: V2Db,
  lookup: (upstreamId: string) => Promise<string | null>,
  replies: { messageId?: string; upstreamId?: string }[],
): void => {
  for (const reply of replies) {
    if (!reply.messageId || !reply.upstreamId) continue;
    const messageId = reply.messageId;
    const upstreamId = reply.upstreamId;
    ctx.waitUntil(
      (async () => {
        const provider = await retryProviderLookup(lookup, upstreamId);
        if (provider) await updateGroupMessageProvider(db, messageId, provider);
      })(),
    );
  }
};

export const handleGroupMessages = async (request: Request, groupId: string): Promise<Response> => {
  const { env } = await getPlatform();
  const db = createDb(env.DB);
  const members = await listGroupMembers(db, groupId);
  if (members.length === 0) {
    return Response.json({ message: "場が見つかりません。" }, { status: 404 });
  }

  if (request.method === "GET") {
    const names = new Map<string, string>();
    for (const member of members) {
      const { ok } = await readCharacter(member.characterId);
      names.set(member.characterId, ok?.name ?? member.characterId);
    }
    const history = await listGroupHistory(db, groupId);
    return Response.json({
      members: members.map((m) => ({ characterId: m.characterId, name: names.get(m.characterId) })),
      messages: history.map((row) => ({
        ...row,
        speakerName: row.speakerCharacterId ? (names.get(row.speakerCharacterId) ?? null) : null,
      })),
    });
  }

  const parsed = PostMessageBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ message: "発言の本文が要ります。" }, { status: 400 });
  }
  await postUserToGroup(db, { groupId, content: parsed.data.content, now: Date.now() });

  const deps = {
    db,
    model: createOpenRouterModel(env),
    loadCharacter: loadGroupCharacter,
    providerLookup: createProviderLookup(env),
  };
  const replyCount = Math.min(parsed.data.replyCount ?? members.length, members.length);
  const replies = [];
  for (let i = 0; i < replyCount; i++) {
    const result = await runGroupTurn(deps, { groupId });
    if (!result) break;
    replies.push(result);
  }
  deferProviderResolution(db, deps.providerLookup, replies);
  return Response.json({ replies });
};
