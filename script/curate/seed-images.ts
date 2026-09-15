import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);

const DATABASE_NAME = "adult-ai-db";
const OUTPUT_DIR = ".work/seeds/images";
const CONTEXT_LENGTH = 200;

const QUERY = `SELECT m.id, m.image_url, m.image_key, m.image_prompt, m.image_seed, m.created_at, m.conversation_id, m.character_id, c.name AS character_name, prev.content AS prev_content FROM message m LEFT JOIN character c ON c.id = m.character_id LEFT JOIN message prev ON prev.conversation_id = m.conversation_id AND prev.created_at = (SELECT MAX(created_at) FROM message m2 WHERE m2.conversation_id = m.conversation_id AND m2.created_at < m.created_at) WHERE m.image_url IS NOT NULL AND m.image_url != '' ORDER BY m.created_at ASC`;
const WORKTREE_MARKERS = ["/.codex/worktrees/", "/.claude/worktrees/"] as const;

const nullableStringSchema = z.union([z.string(), z.null()]).optional();
const rowSchema = z.object({
  id: z.string(),
  image_url: z.string(),
  image_key: nullableStringSchema,
  image_prompt: nullableStringSchema,
  image_seed: nullableStringSchema,
  created_at: z.union([z.number(), z.string()]),
  conversation_id: nullableStringSchema,
  character_id: nullableStringSchema,
  character_name: nullableStringSchema,
  prev_content: nullableStringSchema,
});

const wranglerResultSchema = z.array(
  z.object({
    results: z.array(rowSchema),
  }),
);

type ImageSeedRow = z.infer<typeof rowSchema>;

const toDate = (createdAt: string | number): Date => {
  const timestamp = typeof createdAt === "number" ? createdAt : Number(createdAt);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid created_at: ${createdAt}`);
  return date;
};

const pad2 = (value: number): string => value.toString().padStart(2, "0");

const formatDatePart = (date: Date): string =>
  `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;

const formatTimePart = (date: Date): string =>
  `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;

const toSlug = (value: string | null | undefined): string => {
  const source = value?.trim() || "unknown";
  const asciiSlug = source
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\da-z]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  if (asciiSlug) return asciiSlug;

  return source
    .replace(/[\s"#*/:<>?\\|]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
};

const buildFilename = (row: ImageSeedRow): string => {
  const date = toDate(row.created_at);
  const shortId = row.id.replace(/[^\dA-Za-z]/g, "").slice(0, 8) || "message";
  const shortSlug = `${formatTimePart(date)}-${toSlug(row.character_name)}-${shortId}`;
  return `${formatDatePart(date)}-${shortSlug}.md`;
};

const findWranglerCwd = (): string | null => {
  const cwd = process.cwd();
  const checkoutRoot = WORKTREE_MARKERS.map((marker) => {
    const markerIndex = cwd.indexOf(marker);
    return markerIndex >= 0 ? cwd.slice(0, markerIndex) : null;
  }).find((candidate) => candidate !== null && existsSync(join(candidate, "wrangler.toml")));

  return checkoutRoot ?? null;
};

const renderSeedCard = (row: ImageSeedRow): string => {
  const date = toDate(row.created_at);
  const characterName = row.character_name ?? "unknown";
  const imageKey = row.image_key ?? "(unknown)";
  const imagePrompt = row.image_prompt ?? "(not recorded — generated before 0009 migration)";
  const imageSeed = row.image_seed ?? "(not recorded — generated before 0009 migration)";
  const context = row.prev_content?.slice(0, CONTEXT_LENGTH) ?? "(no preceding message)";

  return `# 種別: image
# キャラ: ${characterName}
# 生成日時: ${date.toISOString()}
# message_id: ${row.id}

## R2 URL
${row.image_url}

## R2 key
${imageKey}

## Prompt (Novita 入力)
${imagePrompt}

## Seed
${imageSeed}

## シーン文脈 (直前 assistant メッセージ抜粋, 200字)
${context}
`;
};

const readRows = async (): Promise<ImageSeedRow[]> => {
  const wranglerCwd = findWranglerCwd();
  const cwdArgs = wranglerCwd === null ? [] : ["--cwd", wranglerCwd];
  const { stdout } = await execFileAsync("wrangler", [
    ...cwdArgs,
    "d1",
    "execute",
    DATABASE_NAME,
    "--local",
    "--json",
    "--command",
    QUERY,
  ]);
  const parsedJson: unknown = JSON.parse(stdout);
  const parsed = wranglerResultSchema.parse(parsedJson);
  return parsed[0]?.results ?? [];
};

const writeSeedCards = async (
  rows: ImageSeedRow[],
): Promise<{ wrote: number; skipped: number }> => {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const results = await Promise.all(
    rows.map(async (row) => {
      const outputPath = join(OUTPUT_DIR, buildFilename(row));
      if (existsSync(outputPath)) return "skipped" as const;
      await writeFile(outputPath, renderSeedCard(row), "utf8");
      return "wrote" as const;
    }),
  );

  return {
    wrote: results.filter((result) => result === "wrote").length,
    skipped: results.filter((result) => result === "skipped").length,
  };
};

const main = async (): Promise<void> => {
  const rows = await readRows();
  const { wrote, skipped } = await writeSeedCards(rows);
  console.info(`wrote ${wrote} new seed cards, skipped ${skipped} existing`);
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
