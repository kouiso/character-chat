#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';

interface D1Row {
  id: string;
  name: string;
  system_prompt?: string;
  visual_prompt?: string;
}

interface D1Result {
  results?: D1Row[];
}

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function runWrangler(args: string[]): string {
  return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'adult-ai-db', '--remote', '--json', ...args], {
    encoding: 'utf8',
  });
}

function isD1Result(value: unknown): value is D1Result {
  return typeof value === 'object' && value !== null;
}

export function parseRow(raw: string): D1Row {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Empty D1 response');
  }
  const first: unknown = parsed[0];
  if (!isD1Result(first)) {
    throw new Error('Unexpected D1 response shape');
  }
  const rows = first.results;
  if (!rows || rows.length === 0) {
    throw new Error('Character not found');
  }
  return rows[0];
}

export function main(argv: string[]): number {
  const charId = argv[2];
  if (!charId) {
    console.error('Usage: d1_fetch.ts <char_id>');
    return 1;
  }
  try {
    const escaped = escapeSqlString(charId);
    const query = `SELECT id, name, system_prompt, visual_prompt FROM character WHERE id = '${escaped}' LIMIT 1`;
    const output = runWrangler(['--command', query]);
    const row = parseRow(output);
    process.stdout.write(
      JSON.stringify({
        name: row.name,
        system_prompt: row.system_prompt ?? '',
        visualPrompt: row.visual_prompt ?? '',
      }),
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`d1_fetch failed: ${message}`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
