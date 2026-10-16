import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = join(root, '.github/ci/run.mjs');
function trace(profile, fail = '') {
  const dir = mkdtempSync(join(tmpdir(), 'character-ci-contract-'));
  try {
    for (const name of ['pnpm', 'node', 'bash']) {
      const path = join(dir, name);
      writeFileSync(path, `#!${process.execPath}\nconst fs=require('node:fs'); const cmd=[${JSON.stringify(name)},...process.argv.slice(2)]; fs.appendFileSync(process.env.TRACE,JSON.stringify(cmd)+'\\n'); if(cmd.join(' ')===process.env.FAIL) process.exit(37);\n`);
      chmodSync(path, 0o700);
    }
    const result = spawnSync(process.execPath, [entry, profile], { cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TRACE: join(dir, 'trace'), FAIL: fail }, encoding: 'utf8' });
    const commands = (() => { try { return readFileSync(join(dir, 'trace'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } })();
    return { ...result, commands };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('fast preserves lint/typecheck and enforces cloud coverage', () => {
  const r = trace('fast'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.commands, [['pnpm','run','lint'],['pnpm','run','typecheck'],['pnpm','run','test:coverage']]);
});
test('full retains every cloud check and builds once before browser boot', () => {
  const r = trace('full'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.commands, [['pnpm','run','lint'],['pnpm','run','typecheck'],['pnpm','run','test:coverage'],['pnpm','run','build'],['pnpm','run','db:migrate:local'],['pnpm','run','test:e2e'],['node','scripts/boot-smoke.mjs'],['pnpm','verify:no-github-actions-deploy'],['bash','./.github/script/check-runner-hardcode.sh']]);
});
test('first failure propagates without later checks/build', () => {
  for (const fail of ['pnpm run lint', 'pnpm run typecheck', 'pnpm run test:coverage']) {
    const r = trace('full', fail); assert.equal(r.status, 37); assert.equal(r.commands.at(-1).join(' '), fail);
  }
});
test('single cloud phases use exactly the shared commands', () => {
  for (const [profile, cmd] of Object.entries({ lint:['pnpm','run','lint'], test:['pnpm','run','test:coverage'], build:['pnpm','run','build'], migrations:['pnpm','run','db:migrate:local'], e2e:['pnpm','run','test:e2e'], 'boot-smoke':['node','scripts/boot-smoke.mjs'] })) {
    const r=trace(profile); assert.equal(r.status,0,r.stderr); assert.deepEqual(r.commands,[cmd]);
  }
  assert.equal(trace('typo').status, 2);
});
test('cloud keeps matrix and uses only the current-run complete build artifact', () => {
  const w=readFileSync(join(root,'.github/workflows/ci.yml'),'utf8');
  assert.match(w,/check-type: \[lint, test, build\]/);
  for(const phase of ['lint','test','build','migrations','e2e','boot-smoke']) assert.ok(w.includes(`node .github/ci/run.mjs ${phase}`));
  assert.match(w,/boot-smoke:\n[\s\S]*?needs: \[ci\]/);
  assert.equal(w.match(/name: ci-build-\$\{\{ github.sha \}\}/g)?.length,2);
  assert.match(w,/path: dist/); assert.match(w,/if-no-files-found: error/); assert.match(w,/include-hidden-files: true/); assert.match(w,/retention-days: 1/);
  assert.ok(!w.includes('run: pnpm smoke'));
});
test('Task aliases share the same entry and local-only deploy safety remains',()=>{
  const t=readFileSync(join(root,'Taskfile.yml'),'utf8');
  assert.ok(t.includes('node .github/ci/run.mjs full')); assert.ok(t.includes('node .github/ci/run.mjs fast'));
  const p=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  assert.match(p.scripts['db:migrate:local'],/--local$/); assert.ok(!p.scripts['db:migrate:local'].includes('--remote'));
});
