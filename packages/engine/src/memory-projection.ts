import { createManagedMemoryStore, MemoryAccessError } from "@v2/db";

import type { ManagedMemory, ManagedMemoryEngineStore, MemoryScope, V2Db } from "@v2/db";

export type MemoryProjectionInput = { characterId: string; query: string; maxChars: number };
export type MemoryProjectionResult = { context: string[]; usedMemoryIds: string[] };
export type MemoryProjectionSource = (
  input: MemoryProjectionInput,
) => Promise<MemoryProjectionResult>;

type ProjectionStore = Pick<ManagedMemoryEngineStore, "listCurrent" | "selectForGeneration">;
const FRAME = "【記憶】\n";

const boundedLength = (text: string, maxChars: number): number => {
  let length = 0;
  const points = text[Symbol.iterator]();
  while (length <= maxChars && !points.next().done) length++;
  return length;
};

const isUsable = (memory: ManagedMemory, requested: Set<string>, used: Set<string>): boolean =>
  requested.has(memory.id) &&
  !used.has(memory.id) &&
  memory.eligible &&
  memory.enabled &&
  memory.state === "active" &&
  memory.supersededById === null;

const snapshotScope = (scope: MemoryScope): Readonly<MemoryScope> => {
  const copy = {
    ownerUserId: scope.ownerUserId,
    characterId: scope.characterId,
    worldlineId: scope.worldlineId,
    conversationId: scope.conversationId,
  };
  if (Object.values(copy).some((value) => typeof value !== "string" || !value.trim()))
    throw new MemoryAccessError();
  return Object.freeze(copy);
};

const packMemories = (
  fresh: readonly ManagedMemory[],
  requested: Set<string>,
  maxChars: number,
): MemoryProjectionResult => {
  const lines: string[] = [];
  const usedMemoryIds: string[] = [];
  const used = new Set<string>();
  let remaining = maxChars - FRAME.length;
  for (const memory of fresh) {
    if (!isUsable(memory, requested, used)) continue;
    const line = `${lines.length ? "\n" : ""}- ${memory.content}`;
    const chars = boundedLength(line, remaining);
    // 記憶の末尾条件を落とすと意味が変わるため、本文を切らず入る版だけを使う。
    if (chars > remaining) continue;
    lines.push(line);
    usedMemoryIds.push(memory.id);
    used.add(memory.id);
    remaining -= chars;
  }
  return { context: lines.length ? [FRAME + lines.join("")] : [], usedMemoryIds };
};

export const createMemoryProjectionSource = (
  mappedScope: MemoryScope,
  store: ProjectionStore,
): MemoryProjectionSource => {
  const scope = snapshotScope(mappedScope);
  return async ({ characterId, maxChars }) => {
    if (characterId !== scope.characterId) throw new MemoryAccessError();
    if (!Number.isSafeInteger(maxChars) || maxChars < 0)
      throw new RangeError("記憶の字数予算は0以上の整数で指定してください");
    if (maxChars <= FRAME.length) return { context: [], usedMemoryIds: [] };
    const candidates = await store.listCurrent();
    const requested = new Set(candidates.map((memory) => memory.id));
    if (requested.size === 0) return { context: [], usedMemoryIds: [] };
    // 候補本文は使わず、compose直前に状態と出典を再検査した版だけを採用する。
    const fresh = await store.selectForGeneration([...requested]);
    return packMemories(fresh, requested, maxChars);
  };
};

export const createScopedMemoryProjection = (
  db: V2Db,
  mappedScope: MemoryScope,
): MemoryProjectionSource => {
  const scope = snapshotScope(mappedScope);
  return createMemoryProjectionSource(scope, createManagedMemoryStore(db, scope));
};
