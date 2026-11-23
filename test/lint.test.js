import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText, lintFiles, collectFiles, scanVariables, typeKeys, optionsFor, format } from '../src/index.js';

const rules = (messages) => messages.map((m) => `${m.line ?? '-'} ${m.rule}`);

test('unfilled and unused variables, with a suggestion', () => {
  const messages = lintText('Hi {{custmer}}, about {{order}}.', { vars: ['customer', 'order', 'extra'] });
  assert.deepEqual(rules(messages), ['1 unfilled-variable', '- unused-variable', '- unused-variable']);
  assert.match(messages[0].message, /did you mean \{\{customer\}\}/);
});

test('misspelled variable without a vars list', () => {
  const messages = lintText('{{customer_name}} {{customer_name}} {{custome_name}}');
  assert.deepEqual(rules(messages), ['1 misspelled-variable']);
  assert.match(messages[0].message, /\{\{custome_name\}\} looks like a typo of \{\{customer_name\}\}/);
});

test('numbered names are not typos', () => {
  assert.deepEqual(lintText('{{item1}} {{item1}} {{item2}}'), []);
});

test('jinja loops, filters and sets', () => {
  const text = [
    '{% set greeting = "hi" %}{{ greeting }}',
    '{% for doc in documents if doc.ok %}{{ doc.title | upper }} {{ loop.index }}{% endfor %}',
    '{{ name | default("anon") }} {% if is_admin and not banned %}x{% endif %}',
  ].join('\n');
  const scan = scanVariables(text);
  assert.equal(scan.syntax, 'double');
  assert.deepEqual([...new Set(scan.uses.map((u) => u.name))].sort(), ['banned', 'documents', 'is_admin', 'name']);
  assert.deepEqual(lintText(text, { vars: ['documents', 'name', 'is_admin', 'banned'] }), []);
});

test('jinja loops catch unfilled variables and raw blocks ignore literal endraw text', () => {
  const loop = '{% for doc in documents %}{{ doc.title }} {{ missing }}{% endfor %}';
  assert.deepEqual(rules(lintText(loop, { vars: ['documents'] })), ['1 unfilled-variable']);
  const raw = '{% raw %}mention endraw and {{ ignored }}{% endraw %} {{ used }}';
  assert.deepEqual(lintText(raw, { vars: ['used'] }), []);
});

test('mustache sections scope their inner names', () => {
  const text = '{{#items}}{{title}}{{/items}} {{! comment }} {{> partial}}';
  assert.deepEqual(lintText(text, { vars: ['items'] }), []);
  const leaked = '{{#items}}{{title}}{{/items}}\nSummary: {{title}}';
  assert.deepEqual(rules(lintText(leaked, { vars: ['items'] })), ['2 unfilled-variable']);
});

test('detects single-brace and dollar syntax', () => {
  assert.equal(scanVariables('Hello {name}, you are {age}.').syntax, 'single');
  assert.equal(scanVariables('Hello ${name}.').syntax, 'dollar');
  assert.deepEqual(lintText('Hello {name}', { vars: ['name'] }), []);
});

test('syntax mismatch only for known names', () => {
  const messages = lintText('Hi {{user}}. Example: {user}. Code: function() {return}');
  assert.deepEqual(rules(messages), ['1 syntax-mismatch']);
  assert.equal(messages[0].message, 'uses {user} but the template syntax is {{user}}');
  assert.deepEqual(lintText('Hi {{user}}. Write `{user}` for Python templates.'), []);
});

test('duplicate instructions', () => {
  const messages = lintText('- Always answer in JSON.\nBe brief.\n\n1. always answer in json');
  assert.deepEqual(rules(messages), ['1 duplicate-instruction']);
  assert.match(messages[0].message, /"Always answer in JSON" \(also line 4\)/);
});

test('contradicting instructions', () => {
  const messages = lintText('Always answer in JSON.\nKeep it short.\nNever answer in JSON.');
  assert.deepEqual(rules(messages), ['3 contradicting-instruction']);
  assert.match(messages[0].message, /contradicts line 1/);
  assert.deepEqual(rules(lintText('Use bullet points.\nDo not use bullet points.')), ['2 contradicting-instruction']);
});

test('token budget', () => {
  const text = 'word '.repeat(10000);
  const [message] = lintText(text, { budget: 8000 });
  assert.equal(message.rule, 'token-budget');
  assert.equal(message.message, '~12,500 tokens, over the 8k budget you set for this file');
  assert.deepEqual(lintText(text, { budget: 20000 }), []);
});

test('broken JSON examples, with variables filled in', () => {
  const good = '```json\n{"name": "{{name}}", "count": {{count}}}\n```';
  assert.deepEqual(lintText(good, { vars: ['name', 'count'] }), []);
  const bad = 'Example:\n\n```json\n{\n  "a": 1,\n}\n```';
  const messages = lintText(bad);
  assert.deepEqual(rules(messages), ['6 invalid-json']);
});

test('unclosed and stray XML tags', () => {
  const text = '<instructions>\n<example>\nhi\n</instructions>\n</context>\n<br> <img src="x"/> `<code>`\n```\n<inside>\n```';
  const messages = lintText(text);
  assert.deepEqual(rules(messages), ['2 unclosed-tag', '5 unclosed-tag']);
  assert.equal(messages[0].message, '<example> is never closed');
  assert.equal(messages[1].message, '</context> has no matching <context>');
});

test('rules can be turned off or changed', () => {
  const text = 'Always answer in JSON.\nAlways answer in JSON.';
  assert.deepEqual(lintText(text, { rules: { 'duplicate-instruction': 'off' } }), []);
  assert.equal(lintText(text, { rules: { 'duplicate-instruction': 'error' } })[0].severity, 'error');
});

test('typeKeys reads interfaces and type literals', () => {
  const src = `
    // comment: ignored
    export interface Vars extends Base {
      readonly name: string;
      age?: number; /* note */
      'quoted-key': string
      nested: { inner: string; other: number };
      fn: (a: string) => void;
    }
    type Other = { a: string, b: Array<{ c: number }> };
    type WithLiterals$ = { url: 'https://example.com'; tag: '<foo>'; after: number };
  `;
  assert.deepEqual(typeKeys(src, 'Vars'), ['name', 'age', 'quoted-key', 'nested', 'fn']);
  assert.deepEqual(typeKeys(src, 'Other'), ['a', 'b']);
  assert.deepEqual(typeKeys(src, 'WithLiterals$'), ['url', 'tag', 'after']);
  assert.throws(() => typeKeys(src, 'Missing'), /not found/);
});

test('optionsFor merges matching globs in order', () => {
  const config = {
    budget: 8000,
    rules: { 'unclosed-tag': 'warn' },
    files: {
      'prompts/**/*.md': { budget: 4000 },
      'prompts/**/foo.md': { budget: 1000 },
      'prompts/support.md': { vars: ['a'], rules: { 'token-budget': 'error' } },
    },
  };
  assert.deepEqual(optionsFor(config, 'prompts/support.md'), {
    vars: ['a'], budget: 4000, syntax: undefined,
    rules: { 'unclosed-tag': 'warn', 'token-budget': 'error' },
  });
  assert.equal(optionsFor(config, 'prompts/deep/x.md').budget, 4000);
  assert.equal(optionsFor(config, 'prompts/foo.md').budget, 1000);
  assert.equal(optionsFor(config, 'prompts/deep/foo.md').budget, 1000);
  assert.equal(optionsFor(config, 'prompts/xfoo.md').budget, 4000);
  assert.equal(optionsFor(config, 'other.md').budget, 8000);
  assert.throws(() => optionsFor({ varsFrom: 'types.ts' }, 'a.md'), /invalid varsFrom/);
  assert.throws(() => optionsFor({ varsFrom: 'types.ts#' }, 'a.md'), /invalid varsFrom/);
  assert.throws(() => optionsFor({ varsFrom: '#Foo' }, 'a.md'), /invalid varsFrom/);
});

test('lintFiles merges rule overrides and collectFiles matches extensions case-insensitively', () => {
  const files = collectFiles(['test/fixtures'], ['.MD']);
  assert.equal(files.length, 1);
  assert.match(files[0], /clean\.md$/);

  const [result] = lintFiles(['test/fixtures/clean.md'], {
    config: { budget: 1, rules: { 'token-budget': 'off' } },
    overrides: { vars: [], rules: { 'unfilled-variable': 'warn' } },
  });
  assert.deepEqual(result.messages.map((m) => `${m.rule}:${m.severity}`), ['unfilled-variable:warn']);
});

test('github format escapes property characters in filenames', () => {
  const out = format([{
    file: 'dir/a,b:c%d.md',
    messages: [{ rule: 'unclosed-tag', severity: 'error', line: 2, message: '<x> is never closed' }],
  }], 'github');
  assert.match(out, /^::error file=dir\/a%2Cb%3Ac%25d\.md,line=2,title=lint-prompts \(unclosed-tag\)::/);
});
