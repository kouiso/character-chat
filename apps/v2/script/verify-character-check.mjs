#!/usr/bin/env node
// 使い方: node apps/v2/script/verify-character-check.mjs <新アプリの URL>
// /api/admin/character-check と /api/admin/image-check を最後のページまで呼び、
// 合計と不合格の一覧を出して報告の Markdown を .work/report/ へ書く。
// 不合格が 1 件でも在れば終了コード 1。
// 認証: V2_BASIC_USER・V2_BASIC_PASSWORD（Basic）または
//       CF_ACCESS_CLIENT_ID・CF_ACCESS_CLIENT_SECRET（Access サービストークン）。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2];
if (!base) {
  console.error("usage: node apps/v2/script/verify-character-check.mjs <url>");
  process.exit(1);
}

const headers = {};
if (process.env.V2_BASIC_USER && process.env.V2_BASIC_PASSWORD) {
  headers.authorization = `Basic ${Buffer.from(
    `${process.env.V2_BASIC_USER}:${process.env.V2_BASIC_PASSWORD}`,
  ).toString("base64")}`;
} else if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
} else {
  console.error("V2_BASIC_USER/V2_BASIC_PASSWORD か CF_ACCESS_CLIENT_ID/SECRET を設定してください");
  process.exit(1);
}

// 同じページを 2 回まで呼び直す（502 等の一時的な失敗を「不合格」にしない）。
const fetchPage = async (path, label) => {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(new URL(path, base), { headers });
      if (response.status === 401 || response.status === 403) {
        console.error("認証の値を確かめてください（" + response.status + "）");
        process.exit(1);
      }
      if (response.status !== 200) {
        lastError = new Error(`${label}: HTTP ${response.status}`);
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  console.error(`${label}: 2 回呼んでも取れませんでした: ${lastError?.message ?? lastError}`);
  process.exit(1);
};

const fetchAll = async (endpoint, label) => {
  const items = [];
  let cursor = null;
  let total = null;
  let extra = {};
  for (let guard = 0; guard < 1000; guard += 1) {
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) query.set("cursor", cursor);
    const page = await fetchPage(`${endpoint}?${query}`, `${label} page`);
    items.push(...page.items);
    total = page.total;
    extra = {
      ...extra,
      ...Object.fromEntries(
        Object.entries(page).filter(([key]) => !["items", "nextCursor", "total"].includes(key)),
      ),
    };
    if (!page.nextCursor) return { items, total, extra };
    cursor = page.nextCursor;
  }
  console.error(`${label}: ページ数が多すぎます（1000 超）`);
  process.exit(1);
};

const characterResult = await fetchAll("/api/admin/character-check", "character-check");
const imageResult = await fetchAll("/api/admin/image-check", "image-check");

// 不合格の条件（票 FR-7）: 見えるキャラで zod 不合格 / 見えるキャラで顔の絵が
// missing・not_image・bad_key / 画像が ok でない。
const characterFailures = characterResult.items
  .filter(
    (item) =>
      item.visible &&
      (!item.zod.ok || ["missing", "not_image", "bad_key"].includes(item.avatar.status)),
  )
  .map((item) => ({
    id: item.id,
    reasons: [
      ...(item.zod.ok
        ? []
        : [`zod: ${item.zod.issues.map((issue) => `${issue.path} ${issue.message}`).join(", ")}`]),
      ...(["missing", "not_image", "bad_key"].includes(item.avatar.status)
        ? [`avatar: ${item.avatar.status}`]
        : []),
    ],
  }));
const imageFailures = imageResult.items
  .filter((item) => item.status !== "ok")
  .map((item) => ({ id: item.messageId, reasons: [`image: ${item.status}`] }));

const countBy = (items, pick) =>
  items.reduce((acc, item) => {
    const key = pick(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const avatarCounts = countBy(characterResult.items, (item) => item.avatar.status);
const zodFailCount = characterResult.items.filter((item) => !item.zod.ok).length;
const imageCounts = countBy(imageResult.items, (item) => item.status);
const visibleCount = characterResult.items.filter((item) => item.visible).length;

const failures = [
  ...characterFailures.map((f) => ({ kind: "character", ...f })),
  ...imageFailures.map((f) => ({ kind: "image", ...f })),
];

const lines = [
  `# character-check 報告`,
  ``,
  `- 対象: ${base}`,
  `- 実測日時: ${new Date().toISOString()}`,
  ``,
  `## 合計`,
  ``,
  `| 対象 | 件数 |`,
  `| -- | -- |`,
  `| キャラ全件 | ${characterResult.total} |`,
  `| うち見える | ${visibleCount} |`,
  `| zod 不合格 | ${zodFailCount} |`,
  `| 会話の中の画像 | ${imageResult.total} |`,
  `| うち v2 で作った画像 | ${imageResult.extra.createdInV2 ?? "?"} |`,
  ``,
  `## 顔の絵の状態ごとの件数`,
  ``,
  `| status | 件数 |`,
  `| -- | -- |`,
  ...Object.entries(avatarCounts).map(([status, n]) => `| ${status} | ${n} |`),
  ``,
  `## 会話の中の画像の状態ごとの件数`,
  ``,
  `| status | 件数 |`,
  `| -- | -- |`,
  ...Object.entries(imageCounts).map(([status, n]) => `| ${status} | ${n} |`),
];

if (characterResult.extra.legacyLinked) {
  lines.push(
    ``,
    `## 旧表 7 つの行数`,
    ``,
    `| table | rows | missing |`,
    `| -- | -- | -- |`,
    ...characterResult.extra.legacyLinked.map(
      (row) => `| ${row.table} | ${row.rows ?? "null"} | ${row.missing} |`,
    ),
  );
}

lines.push(``, `## 不合格`, ``);
if (failures.length === 0) {
  lines.push(`なし`);
} else {
  lines.push(`| kind | id | 理由 |`);
  lines.push(`| -- | -- | -- |`);
  for (const failure of failures) {
    lines.push(`| ${failure.kind} | ${failure.id} | ${failure.reasons.join("; ")} |`);
  }
}
// 直した後の再検査の欄は空のまま残す（持ち主が直した後の結果を書く場所）。
lines.push(``, `## 直した後の再検査`, ``, ``);

const reportDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.work/report",
);
await mkdir(reportDir, { recursive: true });
const reportPath = path.join(
  reportDir,
  `character-check-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
);
await writeFile(reportPath, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\n報告を書きました: ${reportPath}`);
console.log(
  `キャラ ${characterResult.total} 件（見える ${visibleCount}・zod 不合格 ${zodFailCount}） / 画像 ${imageResult.total} 件 / 不合格 ${failures.length} 件`,
);
process.exit(failures.length > 0 ? 1 : 0);
