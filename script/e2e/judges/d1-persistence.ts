import { execFile } from "node:child_process";

import type { JudgeVerdict } from "../types";

const CONVERSATION_ID_PATTERN = /^[\dA-Za-z-]+$/;
const MESSAGE_CONVERSATION_COLUMN = "conversation_id";

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];
type JsonValue = string | number | boolean | null | JsonObject | JsonArray;

const execFileAsync = (file: string, args: readonly string[]): Promise<ExecFileResult> =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(`wrangler d1 execute failed: ${error.message}${stderr ? `; ${stderr}` : ""}`),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });

const isJsonObject = (value: JsonValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }
  if (typeof value === "object") {
    return Object.values(value).every((entry) => isJsonValue(entry));
  }
  return false;
};

const isCountRow = (value: JsonValue): value is { c: number | string } =>
  isJsonObject(value) && (typeof value.c === "number" || typeof value.c === "string");

const extractCount = (value: JsonValue): number | null => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const extracted = extractCount(entry);
      if (extracted !== null) return extracted;
    }
    return null;
  }

  if (!isJsonObject(value)) return null;

  if (Array.isArray(value.results)) {
    for (const row of value.results) {
      if (isCountRow(row)) {
        const count = Number(row.c);
        if (Number.isFinite(count)) return count;
      }
    }
  }

  for (const nested of Object.values(value)) {
    const extracted = extractCount(nested);
    if (extracted !== null) return extracted;
  }

  return null;
};

export async function fetchPersistedCount(conversationId: string): Promise<number> {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw new Error(`invalid conversationId: ${conversationId}`);
  }

  const command = `SELECT COUNT(*) as c FROM message WHERE ${MESSAGE_CONVERSATION_COLUMN} = '${conversationId}'`;
  const { stdout, stderr } = await execFileAsync("wrangler", [
    "d1",
    "execute",
    "adult-ai-db",
    "--local",
    "--json",
    "--command",
    command,
  ]);

  if (!stdout.trim()) {
    throw new Error(`wrangler d1 execute returned empty stdout${stderr ? `; ${stderr}` : ""}`);
  }

  const parsedUnknown: unknown = JSON.parse(stdout);
  if (!isJsonValue(parsedUnknown)) {
    throw new Error(`wrangler output is not valid JSON value: ${stdout}`);
  }

  const parsed = parsedUnknown;
  const count = extractCount(parsed);
  if (count === null) {
    throw new Error(`could not extract count from wrangler output: ${stdout}`);
  }

  return count;
}

// POST /conversations がグリーティングを永続化する時の message.id と同じ規則。
// この行が D1 に在るかどうかが「描画されたグリーティングが永続化済みか」の唯一の判定材料。
export const buildGreetingMessageId = (conversationId: string): string =>
  `greeting-${conversationId}`;

export type PersistedMessageIdentity = { id?: string | null };

export const countPersistedGreetings = (
  conversationId: string,
  persistedMessages: readonly PersistedMessageIdentity[],
): number => {
  const greetingId = buildGreetingMessageId(conversationId);
  return persistedMessages.filter((message) => message.id === greetingId).length;
};

export async function fetchPersistedGreetingCount(conversationId: string): Promise<number> {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw new Error(`invalid conversationId: ${conversationId}`);
  }

  const greetingId = buildGreetingMessageId(conversationId);
  const command =
    `SELECT COUNT(*) as c FROM message ` +
    `WHERE ${MESSAGE_CONVERSATION_COLUMN} = '${conversationId}' AND id = '${greetingId}'`;
  const { stdout, stderr } = await execFileAsync("wrangler", [
    "d1",
    "execute",
    "adult-ai-db",
    "--local",
    "--json",
    "--command",
    command,
  ]);

  if (!stdout.trim()) {
    throw new Error(`wrangler d1 execute returned empty stdout${stderr ? `; ${stderr}` : ""}`);
  }

  const parsedUnknown: unknown = JSON.parse(stdout);
  if (!isJsonValue(parsedUnknown)) {
    throw new Error(`wrangler output is not valid JSON value: ${stdout}`);
  }

  const count = extractCount(parsedUnknown);
  if (count === null) {
    throw new Error(`could not extract count from wrangler output: ${stdout}`);
  }

  return count;
}

/**
 * 描画件数から D1 に在るべき件数を求める。
 * グリーティングは描画されても永続化されるとは限らん（会話作成時に挿入された行が在る場合は
 * 永続化済み、キャラだけがグリーティング文字列を持つクライアント表示だけの場合は未永続）。
 * どちらかを件数から推測せず、実際に永続化済みグリーティング行が在るかで決める。
 */
export const computeExpectedPersistedCount = (args: {
  renderedMessageCount: number;
  greetingMessageCount: number;
  persistedGreetingCount: number;
}): number => {
  const renderedWithoutGreeting = Math.max(
    0,
    args.renderedMessageCount - args.greetingMessageCount,
  );
  // 描画されていないグリーティング行まで足さんよう、描画件数を上限にする。
  const persistedGreetingAllowance = Math.min(
    args.greetingMessageCount,
    args.persistedGreetingCount,
  );
  // 画像は行を増やさん。PATCH /messages/:messageId/image が既存 assistant 行の
  // imageUrl を UPDATE するだけで、その行は既に renderedMessageCount に入っとる。
  return Math.max(0, renderedWithoutGreeting + persistedGreetingAllowance);
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function waitForD1Durability(args: {
  userEmail: string;
  conversationId: string;
  expectedCount: number;
  timeoutMs?: number;
  intervalMs?: number;
  // HTTP 経由でカウントを取得するコールバック。未指定時は wrangler d1 execute CLI を使う。
  // 並列シナリオ実行時に SQLITE_BUSY 競合を避けるため、HTTP API 版を渡すことを推奨。
  fetchCountFn?: (conversationId: string) => Promise<number>;
}): Promise<{ settled: boolean; lastCount: number; elapsedMs: number }> {
  const {
    userEmail,
    conversationId,
    expectedCount,
    timeoutMs = 2_000,
    intervalMs = 100,
    fetchCountFn,
  } = args;
  void userEmail;

  const doFetch = fetchCountFn ?? fetchPersistedCount;
  const startedAt = Date.now();
  let lastCount = -1;

  while (true) {
    let elapsedMs = Date.now() - startedAt;
    try {
      lastCount = await doFetch(conversationId);
      elapsedMs = Date.now() - startedAt;
    } catch (error) {
      elapsedMs = Date.now() - startedAt;
      console.warn("[d1-persistence] transient count fetch failed", error);
      if (elapsedMs >= timeoutMs) {
        return {
          settled: false,
          lastCount,
          elapsedMs,
        };
      }
      await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - elapsedMs)));
      continue;
    }

    if (lastCount >= expectedCount) {
      return {
        settled: true,
        lastCount,
        elapsedMs,
      };
    }

    if (elapsedMs >= timeoutMs) {
      return {
        settled: false,
        lastCount,
        elapsedMs,
      };
    }

    await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - elapsedMs)));
  }
}

const resolvePersistedGreetingCount = async (args: {
  conversationId: string;
  greetingMessageCount: number;
  persistedMessages?: readonly PersistedMessageIdentity[];
  persistedCountProvided: boolean;
}): Promise<number> => {
  if (args.greetingMessageCount === 0) return 0;
  if (args.persistedMessages) {
    return countPersistedGreetings(args.conversationId, args.persistedMessages);
  }
  if (args.persistedCountProvided) return 0;
  return fetchPersistedGreetingCount(args.conversationId);
};

export async function runD1PersistenceJudge(input: {
  conversationId: string;
  renderedMessageCount: number;
  greetingMessageCount?: number;
  imageMessageCount?: number;
  persistedCount?: number;
  // id を含む永続化済みメッセージ一覧。渡されると D1 への追加問い合わせなしで
  // グリーティング行の有無を判定できる。
  persistedMessages?: readonly PersistedMessageIdentity[];
  uiReason?: string | null;
}): Promise<JudgeVerdict> {
  const persistedCount = input.persistedCount ?? (await fetchPersistedCount(input.conversationId));
  const greetingMessageCount = input.greetingMessageCount ?? 0;
  const imageMessageCount = input.imageMessageCount ?? 0;
  // persistedCount だけを渡された場合は行の中身が分からんので、グリーティング行は無い前提に倒す。
  // 実在を確かめずに期待値を 1 件増やすと、逆向きの誤判定（永続化漏れの見逃し）になるため。
  const persistedGreetingCount = await resolvePersistedGreetingCount({
    conversationId: input.conversationId,
    greetingMessageCount,
    persistedMessages: input.persistedMessages,
    persistedCountProvided: input.persistedCount !== undefined,
  });
  const renderedWithoutGreeting = Math.max(0, input.renderedMessageCount - greetingMessageCount);
  const persistedGreetingAllowance = Math.min(greetingMessageCount, persistedGreetingCount);
  const expectedPersistedCount = computeExpectedPersistedCount({
    renderedMessageCount: input.renderedMessageCount,
    greetingMessageCount,
    persistedGreetingCount,
  });
  // 旧モデルは画像1件につき D1 行が1件増えると仮定していた。実際は既存 assistant 行の
  // UPDATE なので増えん。旧期待値にだけ依存していた救済文言を壊さんため比較対象として残す。
  const legacyImageExpectedPersistedCount = expectedPersistedCount + imageMessageCount;
  const adjustedForMissingDoneSignal =
    input.uiReason === "stream done signal missing" &&
    imageMessageCount > 0 &&
    persistedCount === legacyImageExpectedPersistedCount - 1 &&
    persistedCount === expectedPersistedCount;

  const breakdown =
    `(renderedWithoutGreeting ${renderedWithoutGreeting} + persistedGreeting ${persistedGreetingAllowance}` +
    ` [imageMessageCount ${imageMessageCount} adds no row]` +
    (adjustedForMissingDoneSignal ? " - 1 missing stream-done persist allowance)" : ")");

  if (persistedCount !== expectedPersistedCount) {
    return {
      pass: false,
      reason: `persistedCount ${persistedCount} != expectedPersistedCount ${expectedPersistedCount} ${breakdown}`,
    };
  }

  return {
    pass: true,
    reason: `persistedCount ${persistedCount} matches expectedPersistedCount ${expectedPersistedCount} ${breakdown}`,
  };
}
