#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

export const normalizeAvatarKey = (filename) => {
  const key = filename.startsWith('/avatars/') ? filename.slice('/avatars/'.length) : basename(filename);
  if (key.startsWith('/') || key.includes('/')) throw new Error(`avatar must be a bare key: ${filename}`);
  return key;
};

export const uploadAvatarToR2 = ({ filePath, filename, execFile = execFileSync, env = process.env }) => {
  const bareKey = normalizeAvatarKey(filename);
  const objectKey = `avatars/${bareKey}`;
  const command = env.R2_UPLOAD_CMD;
  const bucket = env.R2_BUCKET_NAME;
  if (command) {
    const [bin, ...args] = command.split(/\s+/).filter(Boolean);
    execFile(bin, [...args, filePath, objectKey], { encoding: 'utf8' });
    return { avatar: bareKey, objectKey };
  }
  if (!bucket) {
    console.warn(`Skipping avatar R2 upload for ${objectKey}: set R2_BUCKET_NAME or R2_UPLOAD_CMD.`);
    return { avatar: bareKey, objectKey };
  }
  execFile('pnpm', ['exec', 'wrangler', 'r2', 'object', 'put', `${bucket}/${objectKey}`, '--file', filePath], { encoding: 'utf8' });
  return { avatar: bareKey, objectKey };
};

export const buildImportCharacter = ({ id, name, imagePath, filename = `${id}.png`, upload = uploadAvatarToR2 }) => {
  const { avatar, objectKey } = upload({ filePath: imagePath, filename });
  return { id, name, avatar, r2ObjectKey: objectKey };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, name, imagePath, outputPath] = process.argv.slice(2);
  if (!id || !name || !imagePath || !outputPath) {
    console.error('Usage: generate_adult_character_import.mjs <id> <name> <image_path> <output_json>');
    process.exit(1);
  }
  const character = buildImportCharacter({ id, name, imagePath });
  writeFileSync(outputPath, `${JSON.stringify(character, null, 2)}\n`, 'utf8');
}
