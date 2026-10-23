import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText, scanVariables, typeKeys, optionsFor } from '../src/index.js';

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

test('mustache sections scope their inner names', () => {
  const text = '{{#items}}{{title}}{{/items}} {{! comment }} {{> partial}}';
  assert.deepEqual(lintText(text, { vars: ['items'] }), []);
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
  `;
  assert.deepEqual(typeKeys(src, 'Vars'), ['name', 'age', 'quoted-key', 'nested', 'fn']);
  assert.deepEqual(typeKeys(src, 'Other'), ['a', 'b']);
  assert.throws(() => typeKeys(src, 'Missing'), /not found/);
});

test('optionsFor merges matching globs in order', () => {
  const config = {
    budget: 8000,
    rules: { 'unclosed-tag': 'warn' },
    files: {
      'prompts/**/*.md': { budget: 4000 },
      'prompts/support.md': { vars: ['a'], rules: { 'token-budget': 'error' } },
    },
  };
  assert.deepEqual(optionsFor(config, 'prompts/support.md'), {
    vars: ['a'], budget: 4000, syntax: undefined,
    rules: { 'unclosed-tag': 'warn', 'token-budget': 'error' },
  });
  assert.equal(optionsFor(config, 'prompts/deep/x.md').budget, 4000);
  assert.equal(optionsFor(config, 'other.md').budget, 8000);
});
