#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function normalizeAvatarKey(value: string): string {
  return value.startsWith("/avatars/") ? value.slice("/avatars/".length) : value;
}

export function buildCharacterAvatarUpdateQuery(
  charId: string,
  avatarKey: string,
  prompt: string,
): string {
  const normalizedAvatarKey = normalizeAvatarKey(avatarKey);
  if (normalizedAvatarKey.startsWith("/") || normalizedAvatarKey.includes("/")) {
    throw new Error(`avatar must be a bare R2 key filename: ${avatarKey}`);
  }
  const id = escapeSqlString(charId);
  const av = escapeSqlString(normalizedAvatarKey);
  const pr = escapeSqlString(prompt);
  return `UPDATE character SET avatar = '${av}', visual_prompt = '${pr}' WHERE id = '${id}'`;
}

export function main(argv: string[]): number {
  const charId = argv[2];
  const avatarPath = argv[3];
  const prompt = argv[4];
  if (!charId || !avatarPath || !prompt) {
    console.error("Usage: d1_update.ts <char_id> <avatar_path> <prompt>");
    return 1;
  }
  try {
    const query = buildCharacterAvatarUpdateQuery(charId, avatarPath, prompt);
    execFileSync(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "adult-ai-db", "--remote", "--command", query],
      {
        encoding: "utf8",
      },
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`d1_update failed: ${message}`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
