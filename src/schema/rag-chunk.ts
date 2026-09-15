import { sql } from "drizzle-orm";
import { customType, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { ScenePhase } from "../lib/scene-phase";

const embeddingBlob = customType<{ data: number[]; driverData: unknown }>({
  dataType() {
    return "BLOB";
  },
  fromDriver(val: unknown): number[] {
    if (val instanceof Uint8Array) {
      return Array.from(new Float32Array(val.buffer, val.byteOffset, val.byteLength / 4));
    }
    if (val instanceof ArrayBuffer) {
      return Array.from(new Float32Array(val));
    }
    if (typeof val === "string") {
      const bytes = new Uint8Array(val.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []);
      return Array.from(new Float32Array(bytes.buffer));
    }
    throw new Error(`Unexpected BLOB driver value type: ${typeof val}`);
  },
  toDriver(val: number[]): Uint8Array {
    return new Uint8Array(new Float32Array(val).buffer);
  },
});

export const ragChunkTable = sqliteTable(
  "rag_chunk",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["glossary", "exemplar"] }).notNull(),
    phase: text("phase").$type<ScenePhase>().notNull(),
    characterId: text("character_id"),
    text: text("text").notNull(),
    embedding: embeddingBlob("embedding").notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("rag_chunk_type_phase").on(table.type, table.phase),
    index("rag_chunk_character")
      .on(table.characterId)
      .where(sql`${table.characterId} is not null`),
  ],
);

export type RagChunk = typeof ragChunkTable.$inferSelect;
export type NewRagChunk = typeof ragChunkTable.$inferInsert;
