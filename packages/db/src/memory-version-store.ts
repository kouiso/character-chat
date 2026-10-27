import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { v2MemoryTable } from "./v2-schema";

import type { V2Db } from "./client";

const identifier = z.string().trim().min(1);
const memoryKind = z.enum(["fact", "summary", "preference"]);
const historyQuery = z.object({ key: identifier, kind: memoryKind });
const writeInput = historyQuery.extend({
  content: z.string().refine((value) => value.trim().length > 0, "content must not be blank"),
  sourceTurn: z.number().int().positive().optional(),
});

export type MemoryKind = z.infer<typeof memoryKind>;
export type MemoryHistoryQuery = z.infer<typeof historyQuery>;
export type WriteMemoryVersionInput = z.infer<typeof writeInput>;
export type MemoryVersion = Omit<typeof v2MemoryTable.$inferSelect, "embedding">;

export type MemoryVersionStore = {
  write: (input: WriteMemoryVersionInput) => Promise<MemoryVersion>;
  listCurrent: (query?: { kind?: MemoryKind }) => Promise<MemoryVersion[]>;
  listHistory: (query: MemoryHistoryQuery) => Promise<MemoryVersion[]>;
};

const columns = {
  id: v2MemoryTable.id,
  conversationId: v2MemoryTable.conversationId,
  kind: v2MemoryTable.kind,
  content: v2MemoryTable.content,
  sourceTurn: v2MemoryTable.sourceTurn,
  memoryKey: v2MemoryTable.memoryKey,
  supersededById: v2MemoryTable.supersededById,
  createdAt: v2MemoryTable.createdAt,
};

// 会話の認可は呼び出し側で済ませる。key は抽出側が付ける事実の識別子で、本文の類似度で推測せん。
// 新旧は write が確定した順。sourceTurn は来歴であり、同じターンの手修正も新しい版として残す。
export const createMemoryVersionStore = (db: V2Db, conversationId: string): MemoryVersionStore => {
  const scopedId = identifier.parse(conversationId);
  const scope = eq(v2MemoryTable.conversationId, scopedId);

  return {
    write: async (input) => {
      const parsed = writeInput.parse(input);
      const memory: MemoryVersion = {
        id: crypto.randomUUID(),
        conversationId: scopedId,
        kind: parsed.kind,
        content: parsed.content,
        sourceTurn: parsed.sourceTurn ?? null,
        memoryKey: parsed.key,
        supersededById: null,
        createdAt: Date.now(),
      };

      // read→write を分離すると並行抽出で現在値が二つ残るため、退役と新規保存を D1 の一取引にする。
      // INSERT が失敗した場合は旧行の印も巻き戻り、旧本文・埋め込み・来歴は常にそのまま残る。
      await db.batch([
        db
          .update(v2MemoryTable)
          .set({ supersededById: memory.id })
          .where(
            and(
              scope,
              eq(v2MemoryTable.kind, parsed.kind),
              eq(v2MemoryTable.memoryKey, parsed.key),
              isNull(v2MemoryTable.supersededById),
            ),
          ),
        db.insert(v2MemoryTable).values(memory),
      ]);
      return memory;
    },

    listCurrent: async (query = {}) => {
      const kind = memoryKind.optional().parse(query.kind);
      return db
        .select(columns)
        .from(v2MemoryTable)
        .where(
          and(
            scope,
            isNull(v2MemoryTable.supersededById),
            kind === undefined ? undefined : eq(v2MemoryTable.kind, kind),
          ),
        )
        .orderBy(desc(v2MemoryTable.createdAt), asc(v2MemoryTable.id));
    },

    listHistory: async (query) => {
      const parsed = historyQuery.parse(query);
      return db
        .select(columns)
        .from(v2MemoryTable)
        .where(
          and(scope, eq(v2MemoryTable.kind, parsed.kind), eq(v2MemoryTable.memoryKey, parsed.key)),
        )
        .orderBy(desc(v2MemoryTable.createdAt), asc(v2MemoryTable.id));
    },
  };
};
