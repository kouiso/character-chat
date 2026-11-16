// 旧会話の取り込みを外から流す道具（RIT-77）。
//   run-legacy-migration.mjs <URL> --source-owner <札>
//     [--out <確認だけの結果.json>] [--apply --expected-file <確認だけの結果.json>] [--verify]
// 認証は RIT-80 と同じ名前: V2_BASIC_USER/V2_BASIC_PASSWORD（Basic）か
// CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET（Access）。1ページずつ送る。
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "source-owner": { type: "string" },
    out: { type: "string" },
    apply: { type: "boolean", default: false },
    "expected-file": { type: "string" },
    verify: { type: "boolean", default: false },
    limit: { type: "string" },
  },
});
const base = positionals[0];
const sourceOwner = values["source-owner"];
if (!base || !sourceOwner || (values.apply && !values["expected-file"])) {
  process.stderr.write(
    "usage: run-legacy-migration.mjs <URL> --source-owner <label> " +
      "[--out <inspect.json>] [--apply --expected-file <inspect.json>] [--verify] [--limit N]\n",
  );
  process.exit(1);
}

const limit = values.limit === undefined ? 5 : Number.parseInt(values.limit, 10);
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

const EMPTY_PAGE = {
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

const addInto = (into, page) => {
  for (const key of Object.keys(into)) into[key] += page[key] ?? 0;
};

// 確認だけを全ページ流し、ページごとの cursor・件数と合計を集める。
const inspectAll = async () => {
  const pages = [];
  const totals = { ...EMPTY_PAGE, failures: 0 };
  let cursor;
  for (;;) {
    const { status, json } = await post({
      mode: "conversations",
      sourceOwner,
      cursor,
      limit,
    });
    if (status !== 200) {
      process.stderr.write(`inspect failed: HTTP ${status} ${JSON.stringify(json)}\n`);
      process.exit(1);
    }
    const page = { cursor: cursor ?? null, nextCursor: json.nextCursor, ...json.page };
    pages.push(page);
    addInto(totals, json.page);
    totals.failures += json.page.failures.length;
    process.stdout.write(
      `page ${pages.length}: cursor=${page.cursor} next=${json.nextCursor} ` +
        `+${json.page.insertedConversations}c/${json.page.insertedMessages}m\n`,
    );
    if (json.nextCursor === null) break;
    cursor = json.nextCursor;
  }
  return { mode: "conversations", sourceOwner, limit, pages, totals };
};

// --apply: --expected-file のページを同じ順・同じ cursor で `apply: true` として送る。
// 途中で書き方が変わってもサーバー側の 409（plan_changed）で止まるので、確認だけからやり直させる。
const applyAll = async (expectedFile) => {
  const expected = JSON.parse(readFileSync(expectedFile, "utf8"));
  const totals = { ...EMPTY_PAGE, failures: 0 };
  for (const [index, page] of expected.pages.entries()) {
    const expectedCounts = {
      insertedConversations: page.insertedConversations,
      insertedMessages: page.insertedMessages,
    };
    const { status, json } = await post({
      mode: "conversations",
      sourceOwner,
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
    if (status !== 200) {
      process.stderr.write(`page ${index + 1}: HTTP ${status} ${JSON.stringify(json)}\n`);
      process.exit(1);
    }
    addInto(totals, json.page);
    totals.failures += json.page.failures.length;
    process.stdout.write(
      `page ${index + 1}/${expected.pages.length}: +${json.page.insertedConversations}c/` +
        `${json.page.insertedMessages}m failures=${json.page.failures.length}\n`,
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

const verifyAll = async () => {
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
    if (status !== 200) {
      process.stderr.write(`verify failed: HTTP ${status} ${JSON.stringify(json)}\n`);
      process.exit(1);
    }
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
  return totals;
};

let failed = false;
if (values.verify) {
  const totals = await verifyAll();
  failed = totals.not_imported > 0 || totals.mismatch > 0;
} else if (values.apply) {
  const totals = await applyAll(values["expected-file"]);
  failed = totals.failures > 0;
} else {
  const result = await inspectAll();
  failed = result.totals.failures > 0;
  if (values.out) writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`inspect totals: ${JSON.stringify(result.totals)}\n`);
}
process.exit(failed ? 1 : 0);
