import { describe, expect, it } from 'vitest';
import { parseRow, escapeSqlString } from './d1_fetch';

describe('d1_fetch utilities', () => {
  it('escapes single quotes for SQL inline values', () => {
    expect(escapeSqlString("a'b")).toBe("a''b");
    expect(escapeSqlString("noquote")).toBe('noquote');
  });

  it('parseRow extracts first row from wrangler JSON envelope', () => {
    const row = parseRow(
      JSON.stringify([{ results: [{ id: 'c1', name: 'N', system_prompt: 'S', visual_prompt: 'V' }] }]),
    );
    expect(row.name).toBe('N');
    expect(row.visual_prompt).toBe('V');
  });

  it('parseRow throws on empty results', () => {
    expect(() => parseRow(JSON.stringify([{ results: [] }]))).toThrow();
  });
});
