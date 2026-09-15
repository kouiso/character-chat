#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";

const BUCKET_NAME = "adult-ai-images";
const AVATAR_PREFIX = "avatars";
const repoRoot = join(import.meta.dirname, "..");
const avatarDir = join(repoRoot, "public", "avatars");
const manifestPath = join(
  repoRoot,
  ".work",
  "avatar-migration",
  "uploaded-manifest.json",
);
const localR2ObjectDir = join(
  repoRoot,
  ".wrangler",
  "state",
  "v3",
  "r2",
  "miniflare-R2BucketObject",
);

type UploadMode = "remote" | "local";

type UploadedAvatar = {
  filename: string;
  key: string;
  bytes: number;
  contentType: string;
  sha256: string;
};

const contentTypes = new Map<string, string>([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function parseMode(): UploadMode {
  const mode = process.argv[2];
  if (mode === "--remote") return "remote";
  if (mode === "--local") return "local";

  console.error("Usage: pnpm exec tsx script/avatar-upload-r2.ts --remote|--local");
  process.exit(1);
}

function requireRemoteAuth(mode: UploadMode): void {
  if (mode !== "remote") return;

  const missing = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    console.error(
      `Missing required environment variables for remote R2 upload: ${missing.join(", ")}`,
    );
    console.error("Run: set -a; source .dev.vars; set +a");
    process.exit(1);
  }
}

async function listAvatarFiles(): Promise<string[]> {
  const entries = await readdir(avatarDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function buildManifestEntry(filename: string): Promise<UploadedAvatar> {
  const extension = extname(filename).toLowerCase();
  const contentType = contentTypes.get(extension);
  if (!contentType) {
    throw new Error(`Unsupported avatar file extension: ${filename}`);
  }

  const filePath = join(avatarDir, filename);
  const [fileStat, bytes] = await Promise.all([stat(filePath), readFile(filePath)]);

  return {
    filename,
    key: `${AVATAR_PREFIX}/${filename}`,
    bytes: fileStat.size,
    contentType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function uploadAvatar(mode: UploadMode, avatar: UploadedAvatar): void {
  const filePath = join(avatarDir, avatar.filename);
  const modeFlag = mode === "remote" ? "--remote" : "--local";
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      `${BUCKET_NAME}/${avatar.key}`,
      "--file",
      filePath,
      "--content-type",
      avatar.contentType,
      modeFlag,
    ],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    const details = [
      `Failed to upload ${avatar.key} (${mode})`,
      `Exit code: ${result.status ?? "signal " + String(result.signal)}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(details);
  }
}

function sqlQuote(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

async function findLocalR2Databases(): Promise<string[]> {
  if (!existsSync(localR2ObjectDir)) return [];

  const entries = await readdir(localR2ObjectDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => join(localR2ObjectDir, entry.name));
}

async function normalizeLocalR2Keys(): Promise<void> {
  const dbPaths = await findLocalR2Databases();
  if (dbPaths.length === 0) {
    console.warn("No local Miniflare R2 metadata database found; skipped key normalization");
    return;
  }

  for (const dbPath of dbPaths) {
    const select = spawnSync(
      "sqlite3",
      [
        "-json",
        dbPath,
        `SELECT key FROM _mf_objects WHERE key LIKE '${AVATAR_PREFIX}/%' AND key LIKE '%\\%%' ESCAPE '\\';`,
      ],
      { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );

    if (select.status !== 0) {
      throw new Error(
        [
          `Failed to inspect local R2 metadata database: ${dbPath}`,
          select.stdout.trim(),
          select.stderr.trim(),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const rows = JSON.parse(select.stdout || "[]") as Array<{ key: string }>;
    const updates = rows
      .map(({ key }) => {
        try {
          const decodedKey = decodeURIComponent(key);
          return decodedKey === key ? null : { key, decodedKey };
        } catch {
          return null;
        }
      })
      .filter((row): row is { key: string; decodedKey: string } => row !== null);

    if (updates.length === 0) continue;

    // Wrangler local R2 がUnicodeパスをpercent-encodeするため、Miniflareの実キーへ戻す
    const sql = [
      "BEGIN;",
      ...updates.map(
        ({ key, decodedKey }) =>
          `UPDATE _mf_objects SET key = ${sqlQuote(decodedKey)} WHERE key = ${sqlQuote(key)};`,
      ),
      "COMMIT;",
    ].join("\n");
    const update = spawnSync("sqlite3", [dbPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (update.status !== 0) {
      throw new Error(
        [
          `Failed to normalize local R2 Unicode keys: ${dbPath}`,
          update.stdout.trim(),
          update.stderr.trim(),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    console.log(`Normalized ${updates.length} local R2 Unicode avatar keys in ${dbPath}`);
  }
}

async function main(): Promise<void> {
  const mode = parseMode();
  requireRemoteAuth(mode);

  const filenames = await listAvatarFiles();
  const manifest: UploadedAvatar[] = [];

  console.log(`Uploading ${filenames.length} avatars to ${mode} R2 bucket ${BUCKET_NAME}`);

  for (const [index, filename] of filenames.entries()) {
    const avatar = await buildManifestEntry(filename);
    uploadAvatar(mode, avatar);
    manifest.push(avatar);
    console.log(
      `[${index + 1}/${filenames.length}] ${avatar.key} ${avatar.bytes} bytes ${avatar.contentType}`,
    );
  }

  if (mode === "local") {
    await normalizeLocalR2Keys();
  }

  await mkdir(join(repoRoot, ".work", "avatar-migration"), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const totalBytes = manifest.reduce((sum, avatar) => sum + avatar.bytes, 0);
  console.log(
    `Manifest written: ${manifestPath} count=${manifest.length} totalBytes=${totalBytes}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
