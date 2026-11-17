// 旧会話・旧記憶メモ・検索の塊の取り込みを外から流す道具（RIT-77・RIT-78）。
//   run-legacy-migration.mjs <URL> [--mode conversations|memory|corpus] [--source-owner <札>]
//     [--out <確認だけの結果.json>] [--apply --expected-file <確認だけの結果.json>] [--verify] [--search]
// 認証は RIT-80 と同じ名前: V2_BASIC_USER/V2_BASIC_PASSWORD（Basic）か
// CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET（Access）。1ページずつ送る。
// --apply の後に --verify を頼まれた時は、検索箱の反映を待って 60 秒後に流す。
// verify-memory --search で retrievable が偽の物が残れば 60 秒おきに 2 回まで流し直す。
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "conversations" },
    "source-owner": { type: "string" },
    out: { type: "string" },
    apply: { type: "boolean", default: false },
    "expected-file": { type: "string" },
    verify: { type: "boolean", default: false },
    search: { type: "boolean", default: false },
    limit: { type: "string" },
  },
});
const base = positionals[0];
const mode = values.mode;
const sourceOwner = values["source-owner"];
const needOwner = mode === "conversations" || mode === "memory";
if (
  !base ||
  !["conversations", "memory", "corpus"].includes(mode) ||
  (needOwner && !sourceOwner) ||
  (values.apply && !values["expected-file"])
) {
  process.stderr.write(
    "usage: run-legacy-migration.mjs <URL> [--mode conversations|memory|corpus] " +
      "[--source-owner <label>] [--out <inspect.json>] [--apply --expected-file <inspect.json>] " +
      "[--verify] [--search] [--limit N]\n",
  );
  process.exit(1);
}

// 1 ページの既定は 10（最大 20 はサーバー側）。verify-memory --search は 10 が天井なので
// サーバーが 400 を返す前にこちらで 10 に畳む。
const limit = values.limit === undefined ? 10 : Number.parseInt(values.limit, 10);
const headers = { "content-type": "application/json" };
const basicUser = process.env.V2_BASIC_USER ?? "";
const basicPassword = process.env.V2_BASIC_PASSWORD ?? "";
const accessId = process.env.CF_ACCESS_CLIENT_ID ?? "";
const accessSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
if (basicUser && basicPassword) {
  headers.Authorization = `Basic ${Buffer.from(`${basicUser}:${basicPassword}`).toString("base64")}`;
}
if (accessId && accessSecret) {
  headers["CF-Access-Client-Id"] = accessId;
  headers["CF-Access-Client-Secret"] = accessSecret;
}

const post = async (body) => {
  const response = await fetch(`${base.replace(/\/$/, "")}/api/admin/legacy-migration`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 503 は検索箱の束縛が無い印。0 件の成功ではなく利用者へ状況を返して止める。
const failOnStatus = (status, json, label) => {
  if (status === 503) {
    process.stderr.write(
      `${label}: 検索箱が使えません（V2_RAG_ENABLED と束ねを確かめてください）\n`,
    );
    process.exit(1);
  }
  if (status !== 200) {
    process.stderr.write(`${label}: HTTP ${status} ${JSON.stringify(json)}\n`);
    process.exit(1);
  }
};

const addInto = (into, page) => {
  for (const key of Object.keys(into)) into[key] += page[key] ?? 0;
};

const EMPTY_CONVERSATION_PAGE = {
  conversations: 0,
  messages: 0,
  insertedConversations: 0,
  insertedMessages: 0,
  updatedConversations: 0,
  backfilledLedgerRows: 0,
  backfilledImageKeys: 0,
  skippedSystemMessages: 0,
  skippedDeletedConversations: 0,
  skippedDeletedMessages: 0,
  skippedAfterV2Continue: 0,
};

const EMPTY_MEMORY_PAGE = {
  notes: 0,
  insertedMemories: 0,
  indexedMemories: 0,
  alreadyImported: 0,
  skippedNoConversation: 0,
  skippedNoUserMessage: 0,
  skippedTombstoned: 0,
  skippedDeletedInV2: 0,
};

const EMPTY_CORPUS_PAGE = { chunks: 0, indexed: 0 };

// モードごとの「確認だけ」ページを全ページ流し、cursor・件数と合計を集める。
const inspectAll = async () => {
  const pages = [];
  const totals = {
    ...(mode === "conversations"
      ? EMPTY_CONVERSATION_PAGE
      : mode === "memory"
        ? EMPTY_MEMORY_PAGE
        : EMPTY_CORPUS_PAGE),
    failures: 0,
  };
  let cursor;
  for (;;) {
    const body = { mode, ...(needOwner ? { sourceOwner } : {}), cursor, limit };
    const { status, json } = await post(body);
    failOnStatus(status, json, "inspect");
    const page = { cursor: cursor ?? null, nextCursor: json.nextCursor, ...json.page };
    pages.push(page);
    addInto(totals, json.page);
    totals.failures += json.page.failures.length;
    process.stdout.write(
      `page ${pages.length}: cursor=${page.cursor} next=${json.nextCursor} ` +
        `${JSON.stringify(json.page)}\n`,
    );
    if (json.nextCursor === null) break;
    cursor = json.nextCursor;
  }
  return { mode, sourceOwner: sourceOwner ?? null, limit, pages, totals };
};

// apply: --expected-file のページを同じ順・同じ cursor で `apply: true` として送る。
// 途中で書き方が変わってもサーバー側の 409（plan_changed）で止まるので、確認だけからやり直させる。
const applyAll = async (expectedFile) => {
  const expected = JSON.parse(readFileSync(expectedFile, "utf8"));
  const totals = {
    ...(mode === "conversations"
      ? EMPTY_CONVERSATION_PAGE
      : mode === "memory"
        ? EMPTY_MEMORY_PAGE
        : EMPTY_CORPUS_PAGE),
    failures: 0,
  };
  for (const [index, page] of expected.pages.entries()) {
    const expectedCounts =
      mode === "conversations"
        ? {
            insertedConversations: page.insertedConversations,
            insertedMessages: page.insertedMessages,
          }
        : mode === "memory"
          ? { insertedMemories: page.insertedMemories }
          : { chunks: page.chunks };
    const { status, json } = await post({
      mode,
      ...(needOwner ? { sourceOwner } : {}),
      apply: true,
      expected: expectedCounts,
      ...(page.cursor !== null ? { cursor: page.cursor } : {}),
      limit: expected.limit ?? limit,
    });
    if (status === 409) {
      process.stderr.write(
        `page ${index + 1}: HTTP 409 plan_changed ${JSON.stringify(json)} — ` +
          "確認だけからやり直してください（書けたページはそのまま残ります）。\n",
      );
      process.exit(1);
    }
    failOnStatus(status, json, `page ${index + 1}`);
    addInto(totals, json.page);
    totals.failures += json.page.failures.length;
    process.stdout.write(
      `page ${index + 1}/${expected.pages.length}: ${JSON.stringify(json.page)}\n`,
    );
    if (json.nextCursor !== page.nextCursor) {
      process.stderr.write(
        `page ${index + 1}: nextCursor ${json.nextCursor} ≠ expected ${page.nextCursor} — ` +
          "確認だけからやり直してください。\n",
      );
      process.exit(1);
    }
  }
  process.stdout.write(`apply totals: ${JSON.stringify(totals)}\n`);
  return totals;
};

// verify-conversations（mode=conversations の時だけ）。
const verifyConversations = async () => {
  const items = [];
  const totals = { match: 0, not_imported: 0, deleted_in_v2: 0, mismatch: 0 };
  let cursor;
  for (;;) {
    const { status, json } = await post({
      mode: "verify-conversations",
      sourceOwner,
      cursor,
      limit,
    });
    failOnStatus(status, json, "verify");
    for (const item of json.page.items) {
      totals[item.status] += 1;
      if (item.status !== "match") items.push(item);
    }
    if (json.nextCursor === null) break;
    cursor = json.nextCursor;
  }
  process.stdout.write(`verify totals: ${JSON.stringify(totals)}\n`);
  for (const item of items) {
    process.stdout.write(
      `  ${item.conversationId}: ${item.status}${item.code ? ` (${item.code})` : ""}\n`,
    );
  }
  return { totals, unretrievable: [] };
};

// verify-memory。--search の時は retrievable が偽の match 記憶を拾う。
const verifyMemory = async () => {
  const items = [];
  const totals = {
    match: 0,
    edited_in_v2: 0,
    deleted_in_v2: 0,
    not_imported: 0,
    skipped: 0,
    source_changed: 0,
    not_indexed: 0,
  };
  const unretrievable = [];
  let cursor;
  const search = values.search === true;
  for (;;) {
    const { status, json } = await post({
      mode: "verify-memory",
      sourceOwner,
      cursor,
      limit: search && limit > 10 ? 10 : limit,
      ...(search ? { search: true } : {}),
    });
    failOnStatus(status, json, "verify");
    for (const item of json.page.items) {
      totals[item.status] += 1;
      if (item.status !== "match") items.push(item);
      if (item.retrievable === false) unretrievable.push(item.noteId);
    }
    if (json.nextCursor === null) break;
    cursor = json.nextCursor;
  }
  process.stdout.write(`verify totals: ${JSON.stringify(totals)}\n`);
  for (const item of items) {
    process.stdout.write(`  ${item.noteId}: ${item.status}\n`);
  }
  return { totals, unretrievable };
};

// verify-corpus。検索箱に無い id が 1 件でも在れば終了コード 1。
const verifyCorpus = async () => {
  const totals = { chunks: 0, present: 0, missing: 0 };
  const missingIds = [];
  let cursor;
  for (;;) {
    const { status, json } = await post({ mode: "verify-corpus", cursor, limit });
    failOnStatus(status, json, "verify");
    totals.chunks += json.page.chunks;
    totals.present += json.page.present;
    totals.missing += json.page.missingIds.length;
    missingIds.push(...json.page.missingIds);
    if (json.nextCursor === null) break;
    cursor = json.nextCursor;
  }
  process.stdout.write(`verify totals: ${JSON.stringify(totals)}\n`);
  for (const id of missingIds) process.stdout.write(`  missing: ${id}\n`);
  return { totals, unretrievable: missingIds };
};

const verify = () =>
  mode === "conversations"
    ? verifyConversations()
    : mode === "memory"
      ? verifyMemory()
      : verifyCorpus();

// 照合結果から失敗判定: 会話は not_imported・mismatch、記憶は not_imported・source_changed・
// not_indexed・retrievable 偽、塊は missing が残れば失敗。skipped・deleted_in_v2・edited_in_v2 は
// あり得る正常な状態なので失敗にしない。
const verifyFailed = ({ totals, unretrievable }) =>
  (totals.not_imported ?? 0) > 0 ||
  (totals.mismatch ?? 0) > 0 ||
  (totals.source_changed ?? 0) > 0 ||
  (totals.not_indexed ?? 0) > 0 ||
  (totals.missing ?? 0) > 0 ||
  unretrievable.length > 0;

let failed = false;
if (values.verify && !values.apply) {
  failed = verifyFailed(await verify());
} else if (values.apply) {
  const totals = await applyAll(values["expected-file"]);
  failed = totals.failures > 0;
  if (values.verify && !failed) {
    // 検索箱への書き込みは反映まで数秒かかる。60 秒待ってから照合する。
    process.stdout.write("apply done — waiting 60s for the index to settle before verify\n");
    await sleep(60_000);
    let result = await verify();
    // retrievable が偽のまま残る時は 60 秒おきに 2 回まで流し直す。
    for (let attempt = 0; result.unretrievable.length > 0 && attempt < 2; attempt += 1) {
      process.stdout.write(
        `${result.unretrievable.length} not retrievable — retry verify in 60s\n`,
      );
      await sleep(60_000);
      result = await verify();
    }
    failed = verifyFailed(result);
  }
} else {
  const result = await inspectAll();
  failed = result.totals.failures > 0;
  if (values.out) writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`inspect totals: ${JSON.stringify(result.totals)}\n`);
}
process.exit(failed ? 1 : 0);
