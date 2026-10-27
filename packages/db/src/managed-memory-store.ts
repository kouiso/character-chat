import { z } from "zod";

import {
  managedMemorySchema,
  memoryCommandSchema,
  memoryIdSchema,
  memoryKindSchema,
  MemoryAccessError,
  MemoryConflictError,
} from "./memory-contract";

import type { V2Db } from "./client";
import type { ManagedMemory, ManagedMemoryStore, MemoryScope } from "./memory-contract";

const scopeSchema = z.strictObject({
  ownerUserId: memoryIdSchema,
  characterId: memoryIdSchema,
  worldlineId: memoryIdSchema,
  conversationId: memoryIdSchema,
});

const AUTH = `exists (
  select 1 from v2_memory_worldline w
  join v2_memory_context c on c.worldline_id = w.id
  join v2_conversation v on v.id = c.conversation_id
  where w.id = ? and w.owner_user_id = ? and w.character_id = ?
    and v.id = ? and v.user_id = w.owner_user_id and v.character_id = w.character_id
)`;
const authValues = (scope: MemoryScope) => [
  scope.worldlineId,
  scope.ownerUserId,
  scope.characterId,
  scope.conversationId,
];

const LIVE_ANCESTORS = `not exists (
        with recursive ancestors(id) as (select r.memory_id
          union select d.parent_id from v2_memory_dependency d join ancestors a on d.memory_id = a.id where d.worldline_id = r.worldline_id)
        select 1 from ancestors a left join v2_memory_record p on p.memory_id = a.id and p.worldline_id = r.worldline_id
        left join v2_memory pm on pm.id = p.memory_id
        where p.memory_id is null or p.current <> 1 or p.state <> 'active' or p.enabled <> 1 or pm.superseded_by_id is not null
        or (p.source_message_id is not null and not exists (
          select 1 from v2_memory_source s join v2_message sm on sm.id = s.message_id
          join v2_memory_context sc on sc.conversation_id = sm.conversation_id and sc.worldline_id = s.worldline_id
          where s.worldline_id = p.worldline_id and s.message_id = p.source_message_id and s.revision = p.source_revision and s.state = 'active'
          and not exists (select 1 from v2_memory_source newer where newer.worldline_id = s.worldline_id and newer.message_id = s.message_id and (newer.revision > s.revision or newer.state = 'deleted'))))
      )`;

const COLUMNS = `m.id, m.conversation_id as conversationId, m.memory_key as memoryKey,
  m.kind, m.content, m.superseded_by_id as supersededById, m.source_turn as sourceTurn,
  m.created_at as createdAt, r.updated_at as updatedAt, r.state, r.pinned, r.enabled,
  r.source_type as sourceType, r.source_message_id as sourceMessageId,
  r.source_revision as sourceRevision, r.character_version_id as characterVersionId,
  case when r.current = 1 and r.state = 'active' and r.enabled = 1 and m.superseded_by_id is null
  and exists (select 1 from v2_memory_worldline where id = r.worldline_id and enabled = 1)
  and ${LIVE_ANCESTORS} then 1 else 0 end as eligible`;
const FROM = "from v2_memory m join v2_memory_record r on r.memory_id = m.id";
const parseMemory = (row: Record<string, unknown>): ManagedMemory =>
  managedMemorySchema.parse({
    ...row,
    pinned: row.pinned === 1,
    enabled: row.enabled === 1,
    eligible: row.eligible === 1,
    content: row.state === "deleted" ? "" : row.content,
  });

export const resolveMemoryScope = async (
  db: V2Db,
  ownerUserId: string,
  conversationId: string,
): Promise<MemoryScope> => {
  const row = await db.$client
    .prepare(
      `select w.id as worldlineId, w.owner_user_id as ownerUserId,
    w.character_id as characterId, v.id as conversationId
    from v2_memory_context c join v2_memory_worldline w on w.id = c.worldline_id
    join v2_conversation v on v.id = c.conversation_id
    where v.id = ? and w.owner_user_id = ? and v.user_id = w.owner_user_id and v.character_id = w.character_id`,
    )
    .bind(memoryIdSchema.parse(conversationId), memoryIdSchema.parse(ownerUserId))
    .first();
  if (!row) throw new MemoryAccessError();
  return scopeSchema.parse(row);
};

// worldline は認証済み session 作成処理だけが登録する。ブラウザの申告をこの関数へ直結させん。
export const registerMemoryConversation = async (db: V2Db, input: MemoryScope): Promise<void> => {
  const scope = scopeSchema.parse(input);
  const validConversation =
    "exists (select 1 from v2_conversation where id = ? and user_id = ? and character_id = ?)";
  await db.$client.batch([
    db.$client
      .prepare(
        `insert into v2_memory_worldline (id, owner_user_id, character_id, updated_at)
      select ?, ?, ?, ? where ${validConversation}
      and not exists (select 1 from v2_memory_context where conversation_id = ? and worldline_id <> ?)
      on conflict(id) do nothing`,
      )
      .bind(
        scope.worldlineId,
        scope.ownerUserId,
        scope.characterId,
        Date.now(),
        scope.conversationId,
        scope.ownerUserId,
        scope.characterId,
        scope.conversationId,
        scope.worldlineId,
      ),
    db.$client
      .prepare(
        `insert into v2_memory_context (conversation_id, worldline_id)
      select ?, ? where ${validConversation} and exists
      (select 1 from v2_memory_worldline where id = ? and owner_user_id = ? and character_id = ?)
      on conflict(conversation_id) do nothing`,
      )
      .bind(
        scope.conversationId,
        scope.worldlineId,
        scope.conversationId,
        scope.ownerUserId,
        scope.characterId,
        scope.worldlineId,
        scope.ownerUserId,
        scope.characterId,
      ),
  ]);
  const resolved = await resolveMemoryScope(db, scope.ownerUserId, scope.conversationId);
  if (resolved.worldlineId !== scope.worldlineId || resolved.characterId !== scope.characterId)
    throw new MemoryAccessError();
};

const extractedSchema = z
  .strictObject({
    requestKey: memoryIdSchema,
    key: memoryIdSchema,
    kind: memoryKindSchema,
    content: z.string().refine((value) => value.trim().length > 0),
    expectedCurrentId: memoryIdSchema.nullable(),
    scopeEpoch: z.number().int().nonnegative(),
    source: z
      .strictObject({ messageId: memoryIdSchema, revision: z.number().int().positive() })
      .optional(),
    parents: z.array(memoryIdSchema).default([]),
  })
  .refine((value) =>
    value.kind === "summary"
      ? value.parents.length > 0 && value.source === undefined
      : value.source !== undefined && value.parents.length === 0,
  )
  .refine((value) => new Set(value.parents).size === value.parents.length);
export type ExtractedMemoryInput = z.input<typeof extractedSchema>;
export type ExtractedMemoryResult =
  | { status: "stored"; memory: ManagedMemory }
  | { status: "blocked" };

export type ManagedMemoryEngineStore = ManagedMemoryStore & {
  adoptLegacyMemory: (id: string) => Promise<ManagedMemory>;
  extractionEpoch: () => Promise<number>;
  registerCommittedSource: (input: {
    messageId: string;
    revision: number;
    characterVersionId: string;
  }) => Promise<void>;
  invalidateSource: (input: {
    messageId: string;
    revision: number;
    deleted?: boolean;
  }) => Promise<void>;
  recordExtracted: (input: ExtractedMemoryInput) => Promise<ExtractedMemoryResult>;
  selectForGeneration: (ids: string[]) => Promise<ManagedMemory[]>;
};

const fingerprint = async (input: unknown): Promise<string> => {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(input)),
  );
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
};

export const createManagedMemoryStore = (
  db: V2Db,
  input: MemoryScope,
): ManagedMemoryEngineStore => {
  const scope = scopeSchema.parse(input);
  const client = db.$client;
  const auth = authValues(scope);
  const prepare = (query: string, values: unknown[] = []) => client.prepare(query).bind(...values);

  const authorize = async () => {
    const row = await prepare(
      `select enabled, extraction_epoch as epoch from v2_memory_worldline where id = ? and ${AUTH}`,
      [scope.worldlineId, ...auth],
    ).first<{ enabled: number; epoch: number }>();
    if (!row) throw new MemoryAccessError();
    return row;
  };
  const rows = async (condition: string, values: unknown[] = []) => {
    await authorize();
    const result = await prepare(
      `select ${COLUMNS} ${FROM} where r.worldline_id = ? and ${condition}
      order by m.created_at desc, m.id`,
      [scope.worldlineId, ...values],
    ).all<Record<string, unknown>>();
    return result.results.map(parseMemory);
  };
  const find = async (id: string) => {
    const [row] = await rows("m.id = ?", [memoryIdSchema.parse(id)]);
    if (!row) throw new MemoryAccessError();
    return row;
  };
  const children = (root: string, gate: string, bindings: unknown[]) =>
    prepare(
      `with recursive affected(id) as (
      select memory_id from v2_memory_dependency where worldline_id = ? and parent_id = ?
      union select d.memory_id from v2_memory_dependency d join affected a on d.parent_id = a.id where d.worldline_id = ?
    ) update v2_memory_record set state = 'invalidated', updated_at = ?
    where worldline_id = ? and state <> 'deleted' and memory_id in (select id from affected) and ${gate}`,
      [scope.worldlineId, root, scope.worldlineId, Date.now(), scope.worldlineId, ...bindings],
    );

  type VersionInput = {
    requestKey: string;
    key: string;
    kind: ManagedMemory["kind"];
    content: string;
    expectedId: string | null;
    sourceType: ManagedMemory["sourceType"];
    sourceMessageId: string | null;
    sourceRevision: number | null;
    sourceTurn: number | null;
    characterVersionId: string | null;
    parents: string[];
    extraGuard?: string;
    guardValues?: unknown[];
    correction?: boolean;
  };
  const version = async (value: VersionInput, digest: string): Promise<ManagedMemory | null> => {
    await authorize();
    const id = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const now = Date.now();
    const head =
      "select memory_id from v2_memory_record where worldline_id = ? and kind = ? and memory_key = ? and current = 1";
    const headValues = [scope.worldlineId, value.kind, value.key];
    const operationGate = "exists (select 1 from v2_memory_operation where id = ?)";
    const statements = [
      prepare(
        `insert into v2_memory_operation (id, worldline_id, request_key, fingerprint, memory_id)
      select ?, ?, ?, ?, ? where ${AUTH} and
      ((? is null and not exists (${head})) or ? = (${head})) and (${value.extraGuard ?? "1"})
      on conflict(worldline_id, request_key) do nothing`,
        [
          operationId,
          scope.worldlineId,
          value.requestKey,
          digest,
          id,
          ...auth,
          value.expectedId,
          ...headValues,
          value.expectedId,
          ...headValues,
          ...(value.guardValues ?? []),
        ],
      ),
    ];
    if (value.expectedId) {
      statements.push(children(value.expectedId, operationGate, [operationId]));
      if (value.correction)
        statements.push(
          prepare(
            `with recursive lineage(id) as (
          select memory_id from v2_memory_record where worldline_id = ? and memory_key = ? and kind = ?
          union select d.parent_id from v2_memory_dependency d join lineage l on d.memory_id = l.id where d.worldline_id = ?)
        insert into v2_memory_tombstone
        (worldline_id, memory_key, kind, source_message_id, source_revision, reason, created_at)
        select worldline_id, '', kind, source_message_id, source_revision, 'corrected', ?
        from v2_memory_record where memory_id in (select id from lineage)
        and source_message_id is not null and ${operationGate}
        on conflict do nothing`,
            [scope.worldlineId, value.key, value.kind, scope.worldlineId, now, operationId],
          ),
        );
      statements.push(
        prepare(`update v2_memory set superseded_by_id = ? where id = ? and ${operationGate}`, [
          id,
          value.expectedId,
          operationId,
        ]),
      );
      statements.push(
        prepare(
          `update v2_memory_record set current = 0, state = 'invalidated', updated_at = ? where memory_id = ? and ${operationGate}`,
          [now, value.expectedId, operationId],
        ),
      );
    }
    statements.push(
      prepare(
        `insert into v2_memory (id, conversation_id, kind, content, source_turn, memory_key, created_at)
      select ?, ?, ?, ?, ?, ?, ? where ${operationGate}`,
        [
          id,
          scope.conversationId,
          value.kind,
          value.content,
          value.sourceTurn,
          value.key,
          now,
          operationId,
        ],
      ),
    );
    statements.push(
      prepare(
        `insert into v2_memory_record
      (memory_id, worldline_id, memory_key, kind, source_type, source_message_id, source_revision, character_version_id, updated_at, pinned, enabled, source_sequence)
      select ?, ?, ?, ?, ?, ?, ?, ?, ?,
        coalesce((select pinned from v2_memory_record where memory_id = ?), 0),
        coalesce((select enabled from v2_memory_record where memory_id = ?), 1),
        coalesce((select sequence from v2_memory_source where worldline_id = ? and message_id = ? and revision = ?),
          (select max(source_sequence) from v2_memory_record where memory_id in (${value.parents.map(() => "?").join(",") || "null"})),
          (select source_sequence from v2_memory_record where memory_id = ?))
      where ${operationGate}`,
        [
          id,
          scope.worldlineId,
          value.key,
          value.kind,
          value.sourceType,
          value.sourceMessageId,
          value.sourceRevision,
          value.characterVersionId,
          now,
          value.expectedId,
          value.expectedId,
          scope.worldlineId,
          value.sourceMessageId,
          value.sourceRevision,
          ...value.parents,
          value.expectedId,
          operationId,
        ],
      ),
    );
    for (const parentId of value.parents) {
      if (parentId === value.expectedId) {
        statements.push(
          prepare(
            `insert into v2_memory_dependency (worldline_id, memory_id, parent_id)
          select ?, ?, parent_id from v2_memory_dependency where worldline_id = ? and memory_id = ? and ${operationGate}
          on conflict do nothing`,
            [scope.worldlineId, id, scope.worldlineId, parentId, operationId],
          ),
        );
      } else {
        statements.push(
          prepare(
            `insert into v2_memory_dependency (worldline_id, memory_id, parent_id)
          select ?, ?, ? where ${operationGate} on conflict do nothing`,
            [scope.worldlineId, id, parentId, operationId],
          ),
        );
      }
    }
    await client.batch(statements);
    const operation = await prepare(
      "select fingerprint, memory_id as memoryId from v2_memory_operation where worldline_id = ? and request_key = ?",
      [scope.worldlineId, value.requestKey],
    ).first<{ fingerprint: string; memoryId: string }>();
    if (!operation) return null;
    if (operation.fingerprint !== digest) throw new MemoryConflictError();
    return find(operation.memoryId);
  };

  const current = async () => {
    const settings = await authorize();
    if (settings.enabled !== 1) return [];
    return rows(`r.current = 1 and r.state = 'active' and r.enabled = 1 and m.superseded_by_id is null
      and exists (select 1 from v2_memory_worldline where id = r.worldline_id and enabled = 1)
      and ${LIVE_ANCESTORS}`);
  };
  const setFlag = async (id: string, flag: "pinned" | "enabled", value: boolean) => {
    await find(id);
    const query =
      flag === "pinned"
        ? "update v2_memory_record set pinned = ?, updated_at = ? where memory_id = ? and worldline_id = ? and current = 1 and state <> 'deleted'"
        : "update v2_memory_record set enabled = ?, updated_at = ? where memory_id = ? and worldline_id = ? and current = 1 and state <> 'deleted'";
    const statements = [
      prepare(`${query} and ${AUTH}`, [value ? 1 : 0, Date.now(), id, scope.worldlineId, ...auth]),
    ];
    if (flag === "enabled" && !value) statements.push(children(id, AUTH, auth));
    const [result] = await client.batch(statements);
    if (result.meta.changes === 0) throw new MemoryConflictError();
  };

  const extractionGuards = (parsed: z.output<typeof extractedSchema>) => {
    const origin = parsed.source ?? { messageId: "", revision: 0 };
    const guards = [
      "exists (select 1 from v2_memory_worldline where id = ? and enabled = 1 and extraction_epoch = ?)",
      "not exists (select 1 from v2_memory_tombstone where worldline_id = ? and ((memory_key = ? and kind = ?) or memory_key = '') and (source_message_id = '' or (source_message_id = ? and source_revision = ?)))",
    ];
    const values: unknown[] = [
      scope.worldlineId,
      parsed.scopeEpoch,
      scope.worldlineId,
      parsed.key,
      parsed.kind,
      origin.messageId,
      origin.revision,
    ];
    if (parsed.source) {
      guards.push(
        "exists (select 1 from v2_memory_source s join v2_message m on m.id = s.message_id join v2_memory_context c on c.conversation_id = m.conversation_id and c.worldline_id = s.worldline_id where s.worldline_id = ? and s.message_id = ? and s.revision = ? and s.state = 'active') and not exists (select 1 from v2_memory_source where worldline_id = ? and message_id = ? and (revision > ? or state = 'deleted'))",
      );
      values.push(
        scope.worldlineId,
        origin.messageId,
        origin.revision,
        scope.worldlineId,
        origin.messageId,
        origin.revision,
      );
      guards.push(`not exists (select 1 from v2_memory_record r join v2_memory m on m.id = r.memory_id
        join v2_message s on s.id = ? join v2_memory_source source on source.message_id = s.id and source.worldline_id = ? and source.revision = ?
        where r.worldline_id = ? and r.memory_key = ? and r.kind = ? and r.current = 1
        and m.conversation_id = s.conversation_id and m.source_turn > source.source_turn)`);
      values.push(
        origin.messageId,
        scope.worldlineId,
        origin.revision,
        scope.worldlineId,
        parsed.key,
        parsed.kind,
      );
      guards.push(`exists (select 1 from v2_memory_source s where s.worldline_id = ? and s.message_id = ? and s.revision = ?
        and s.sequence >= coalesce((select source_sequence from v2_memory_record where worldline_id = ? and memory_key = ? and kind = ? and current = 1), 0))`);
      values.push(
        scope.worldlineId,
        origin.messageId,
        origin.revision,
        scope.worldlineId,
        parsed.key,
        parsed.kind,
      );
    }
    if (parsed.parents.includes(parsed.expectedCurrentId ?? "")) {
      guards.push(
        "exists (select 1 from v2_memory_dependency where worldline_id = ? and memory_id = ?)",
      );
      values.push(scope.worldlineId, parsed.expectedCurrentId);
    }
    if (parsed.expectedCurrentId !== null) {
      const independent = parsed.parents.filter((id) => id !== parsed.expectedCurrentId);
      guards.push(`not exists (with recursive ancestors(id) as (
        select memory_id from v2_memory_record where worldline_id = ? and memory_id in (${independent.map(() => "?").join(",") || "null"})
        union select d.parent_id from v2_memory_dependency d join ancestors a on d.memory_id = a.id where d.worldline_id = ?)
        select 1 from ancestors where id = ?)`);
      values.push(scope.worldlineId, ...independent, scope.worldlineId, parsed.expectedCurrentId);
    }
    for (const parentId of parsed.parents) {
      guards.push(
        `exists (select 1 from v2_memory_record r where memory_id = ? and worldline_id = ? and current = 1 and state = 'active' and enabled = 1 and ${LIVE_ANCESTORS})`,
      );
      values.push(parentId, scope.worldlineId);
      if (parsed.kind === "summary") {
        // 削除済み要約を別キーへ再抽出する経路も、元の派生関係で止める。
        guards.push(
          `not exists (select 1 from v2_memory_dependency d join v2_memory_record r on r.memory_id = d.memory_id
          join v2_memory m on m.id = r.memory_id where d.worldline_id = ? and d.parent_id = ?
          and (r.state = 'deleted' or exists (select 1 from v2_memory_record correction where correction.memory_id = m.superseded_by_id and correction.source_type = 'user')))`,
        );
        values.push(scope.worldlineId, parentId);
        guards.push(`not exists (with recursive lineage(id) as (select ?
          union select d.parent_id from v2_memory_dependency d join lineage l on d.memory_id = l.id where d.worldline_id = ?)
          select 1 from v2_memory_record p join v2_memory_tombstone t on t.worldline_id = p.worldline_id
          and t.memory_key = '' and t.source_message_id = p.source_message_id and t.source_revision = p.source_revision
          where p.memory_id in (select id from lineage) and p.worldline_id = ?)`);
        values.push(parentId, scope.worldlineId, scope.worldlineId);
      }
    }
    return { query: guards.join(" and "), values };
  };

  return {
    adoptLegacyMemory: async (id) => {
      await authorize();
      await client.batch([
        prepare(
          `insert into v2_memory_record (memory_id, worldline_id, memory_key, kind, state, source_type, updated_at)
          select m.id, ?, coalesce(m.memory_key, 'legacy:' || m.id), m.kind, 'invalidated', 'extracted', ?
          from v2_memory m where m.id = ? and m.conversation_id = ? and ${AUTH}
          and not exists (select 1 from v2_memory_record where memory_id = m.id)`,
          [scope.worldlineId, Date.now(), memoryIdSchema.parse(id), scope.conversationId, ...auth],
        ),
        prepare(
          `update v2_memory set memory_key = 'legacy:' || id where id = ? and conversation_id = ? and memory_key is null
          and exists (select 1 from v2_memory_record where memory_id = ? and worldline_id = ?) and ${AUTH}`,
          [id, scope.conversationId, id, scope.worldlineId, ...auth],
        ),
      ]);
      return find(id);
    },
    snapshot: async () => ({
      enabled: (await authorize()).enabled === 1,
      memories: await rows("r.current = 1"),
    }),
    listCurrent: current,
    selectForGeneration: async (ids) => {
      const allowed = new Set(ids.map((id) => memoryIdSchema.parse(id)));
      return (await current()).filter((memory) => allowed.has(memory.id));
    },
    history: async (id) => {
      const memory = await find(id);
      return rows("r.memory_key = ? and r.kind = ?", [memory.memoryKey, memory.kind]);
    },
    add: async (inputValue) => {
      const parsed = memoryCommandSchema.parse({ action: "add", ...inputValue });
      if (parsed.action !== "add") throw new MemoryConflictError();
      const memory = await version(
        {
          ...parsed,
          key: `user:${crypto.randomUUID()}`,
          expectedId: null,
          sourceType: "user",
          sourceMessageId: null,
          sourceRevision: null,
          sourceTurn: null,
          characterVersionId: null,
          parents: [],
        },
        await fingerprint(parsed),
      );
      if (!memory) throw new MemoryConflictError();
      return memory;
    },
    edit: async (inputValue) => {
      const parsed = memoryCommandSchema.parse({ action: "edit", ...inputValue });
      if (parsed.action !== "edit") throw new MemoryConflictError();
      const old = await find(parsed.id);
      const memory = await version(
        {
          ...parsed,
          key: old.memoryKey,
          kind: old.kind,
          expectedId: old.id,
          sourceType: "user",
          sourceMessageId: null,
          sourceRevision: null,
          sourceTurn: old.sourceTurn,
          characterVersionId: old.characterVersionId,
          parents: [],
          correction: true,
          extraGuard:
            "exists (select 1 from v2_memory_record where memory_id = ? and state <> 'deleted')",
          guardValues: [old.id],
        },
        await fingerprint(parsed),
      );
      if (!memory) throw new MemoryConflictError();
      return memory;
    },
    delete: async (id) => {
      const memory = await find(id);
      const guard = `exists (select 1 from v2_memory_record where memory_id = ? and current = 1 and worldline_id = ?) and ${AUTH}`;
      const values = [id, scope.worldlineId, ...auth];
      await client.batch([
        prepare(
          `insert into v2_memory_tombstone (worldline_id, memory_key, kind, reason, created_at)
          select ?, ?, ?, 'deleted', ? where ${guard} on conflict do nothing`,
          [scope.worldlineId, memory.memoryKey, memory.kind, Date.now(), ...values],
        ),
        prepare(
          `with recursive lineage(id) as (
          select memory_id from v2_memory_record where worldline_id = ? and memory_key = ? and kind = ?
          union select d.parent_id from v2_memory_dependency d join lineage l on d.memory_id = l.id where d.worldline_id = ?)
          insert into v2_memory_tombstone
          (worldline_id, memory_key, kind, source_message_id, source_revision, reason, created_at)
          select worldline_id, '', kind, source_message_id, source_revision, 'deleted', ?
          from v2_memory_record where memory_id in (select id from lineage)
          and source_message_id is not null and ${guard}
          on conflict do nothing`,
          [
            scope.worldlineId,
            memory.memoryKey,
            memory.kind,
            scope.worldlineId,
            Date.now(),
            ...values,
          ],
        ),
        children(id, guard, values),
        prepare(
          `update v2_memory_record set state = 'deleted', enabled = 0, updated_at = ?
          where worldline_id = ? and memory_key = ? and kind = ? and ${guard}`,
          [Date.now(), scope.worldlineId, memory.memoryKey, memory.kind, ...values],
        ),
      ]);
      if ((await find(id)).state !== "deleted") throw new MemoryConflictError();
    },
    setPinned: (id, pinned) => setFlag(id, "pinned", z.boolean().parse(pinned)),
    setMemoryEnabled: (id, enabled) => setFlag(id, "enabled", z.boolean().parse(enabled)),
    setEnabled: async (enabled) => {
      await authorize();
      const flag = z.boolean().parse(enabled) ? 1 : 0;
      await prepare(
        `update v2_memory_worldline set enabled = ?, extraction_epoch = extraction_epoch + 1, updated_at = ? where id = ? and enabled <> ? and ${AUTH}`,
        [flag, Date.now(), scope.worldlineId, flag, ...auth],
      ).run();
    },
    extractionEpoch: async () => (await authorize()).epoch,
    registerCommittedSource: async (value) => {
      await authorize();
      const parsed = z
        .strictObject({
          messageId: memoryIdSchema,
          revision: z.number().int().positive(),
          characterVersionId: memoryIdSchema,
        })
        .parse(value);
      const registered = prepare(
        `insert into v2_memory_source (worldline_id, message_id, revision, source_turn, character_version_id, sequence)
        select ?, m.id, ?, m.turn, ?, (select coalesce(max(sequence), 0) + 1 from v2_memory_source where worldline_id = ?) from v2_message m join v2_memory_context c on c.conversation_id = m.conversation_id
        where m.id = ? and c.worldline_id = ? and ${AUTH}
        and not exists (select 1 from v2_memory_source where worldline_id = ? and message_id = ? and (state = 'deleted' or revision > ?))
        on conflict do nothing`,
        [
          scope.worldlineId,
          parsed.revision,
          parsed.characterVersionId,
          scope.worldlineId,
          parsed.messageId,
          scope.worldlineId,
          ...auth,
          scope.worldlineId,
          parsed.messageId,
          parsed.revision,
        ],
      );
      const registrationGate = `exists (select 1 from v2_memory_source where worldline_id = ? and message_id = ? and revision = ? and state = 'active' and character_version_id = ?)`;
      const registrationValues = [
        scope.worldlineId,
        parsed.messageId,
        parsed.revision,
        parsed.characterVersionId,
      ];
      await client.batch([
        registered,
        prepare(
          `update v2_memory_source set state = 'invalidated' where worldline_id = ? and message_id = ? and revision < ? and state = 'active' and ${registrationGate}`,
          [scope.worldlineId, parsed.messageId, parsed.revision, ...registrationValues],
        ),
        prepare(
          `with recursive affected(id) as (
          select memory_id from v2_memory_record where worldline_id = ? and source_message_id = ? and source_revision < ?
          union select d.memory_id from v2_memory_dependency d join affected a on d.parent_id = a.id where d.worldline_id = ?)
          update v2_memory_record set state = 'invalidated', updated_at = ? where worldline_id = ? and state <> 'deleted'
          and memory_id in (select id from affected) and ${registrationGate}`,
          [
            scope.worldlineId,
            parsed.messageId,
            parsed.revision,
            scope.worldlineId,
            Date.now(),
            scope.worldlineId,
            ...registrationValues,
          ],
        ),
      ]);
      const source = await prepare(
        "select state, character_version_id as version from v2_memory_source where worldline_id = ? and message_id = ? and revision = ?",
        [scope.worldlineId, parsed.messageId, parsed.revision],
      ).first<{ state: string; version: string }>();
      if (!source || source.state !== "active" || source.version !== parsed.characterVersionId)
        throw new MemoryConflictError();
    },
    invalidateSource: async (value) => {
      await authorize();
      const parsed = z
        .strictObject({
          messageId: memoryIdSchema,
          revision: z.number().int().positive(),
          deleted: z.boolean().optional(),
        })
        .parse(value);
      const affected = `with recursive affected(id) as (
        select memory_id from v2_memory_record where worldline_id = ? and source_message_id = ? and (source_revision = ? or ? = 1)
        union select d.memory_id from v2_memory_dependency d join affected a on d.parent_id = a.id where d.worldline_id = ?)
        update v2_memory_record set state = 'invalidated', updated_at = ? where worldline_id = ? and state <> 'deleted' and memory_id in (select id from affected) and ${AUTH}`;
      await client.batch([
        prepare(
          `insert into v2_memory_source (worldline_id, message_id, revision, state, source_turn, character_version_id, sequence)
          select ?, ?, ?, ?, coalesce((select turn from v2_message where id = ?), 0), '', (select coalesce(max(sequence), 0) + 1 from v2_memory_source where worldline_id = ?) where ${AUTH}
          on conflict do nothing`,
          [
            scope.worldlineId,
            parsed.messageId,
            parsed.revision,
            parsed.deleted ? "deleted" : "invalidated",
            parsed.messageId,
            scope.worldlineId,
            ...auth,
          ],
        ),
        prepare(
          `update v2_memory_source set state = case when state = 'deleted' then 'deleted' else ? end where worldline_id = ? and message_id = ? and (revision = ? or ? = 1) and ${AUTH}`,
          [
            parsed.deleted ? "deleted" : "invalidated",
            scope.worldlineId,
            parsed.messageId,
            parsed.revision,
            parsed.deleted ? 1 : 0,
            ...auth,
          ],
        ),
        prepare(affected, [
          scope.worldlineId,
          parsed.messageId,
          parsed.revision,
          parsed.deleted ? 1 : 0,
          scope.worldlineId,
          Date.now(),
          scope.worldlineId,
          ...auth,
        ]),
      ]);
    },
    recordExtracted: async (value) => {
      const parsed = extractedSchema.parse(value);
      await authorize();
      const source = parsed.source
        ? await prepare(
            "select source_turn as turn, character_version_id as version from v2_memory_source where worldline_id = ? and message_id = ? and revision = ?",
            [scope.worldlineId, parsed.source.messageId, parsed.source.revision],
          ).first<{ turn: number; version: string }>()
        : null;
      const guard = extractionGuards(parsed);
      const origin = parsed.source ?? { messageId: null, revision: null };
      const details = source ?? { turn: null, version: null };
      const memory = await version(
        {
          requestKey: parsed.requestKey,
          key: parsed.key,
          kind: parsed.kind,
          content: parsed.content,
          expectedId: parsed.expectedCurrentId,
          sourceType: parsed.kind === "summary" ? "summary" : "extracted",
          sourceMessageId: origin.messageId,
          sourceRevision: origin.revision,
          sourceTurn: details.turn,
          characterVersionId: details.version,
          parents: parsed.parents,
          extraGuard: guard.query,
          guardValues: guard.values,
        },
        await fingerprint(parsed),
      );
      return memory ? { status: "stored", memory } : { status: "blocked" };
    },
  };
};
