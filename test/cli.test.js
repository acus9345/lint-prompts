import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (...args) => spawnSync(process.execPath, ['bin/lint-prompts.js', ...args], { cwd: root, encoding: 'utf8' });

test('lints the examples and exits 1', () => {
  const r = run('examples', '--config', 'examples/lint-prompts.config.json');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /examples\/prompts\/support\.md\n {2}line 4 {3}error {4}\{\{customer_name\}\} is never filled in by any caller/);
  assert.match(r.stdout, /~\d+ tokens, over the 40 budget/);
});

test('json and github formats', () => {
  const json = JSON.parse(run('examples', '-c', 'examples/lint-prompts.config.json', '--format', 'json').stdout);
  assert.ok(json.some((r) => r.file === 'examples/prompts/support.md' && r.messages.length > 0));
  const gh = run('examples', '-c', 'examples/lint-prompts.config.json', '--format=github').stdout;
  assert.match(gh, /^::error file=examples\/prompts\/support\.md,line=4,title=lint-prompts \(unfilled-variable\)::/m);
});

test('clean file exits 0', () => {
  const r = run('test/fixtures/clean.md', '--vars', 'topic', '--max-warnings', '0', '-c', 'test/fixtures/empty.json');
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /no problems found/);
  assert.equal(r.status, 0);
});

test('usage errors exit 2', () => {
  assert.equal(run('--nope').status, 2);
  assert.equal(run('missing-folder').status, 2);
  assert.equal(run('test/fixtures/clean.md', '--syntax', 'mustache').status, 2);
  assert.equal(run('test/fixtures/clean.md', '--budget', '').status, 2);
  assert.equal(run('test/fixtures/clean.md', '--budget', '0').status, 2);
  assert.equal(run('test/fixtures/clean.md', '--max-warnings', '').status, 2);
  assert.equal(run('--vars', 'topic', '-c', 'test/fixtures/empty.json', '--', 'test/fixtures/clean.md').status, 0);
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+/);
  assert.match(run('--help').stdout, /Usage: lint-prompts/);
});
