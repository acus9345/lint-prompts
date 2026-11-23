import { fences, lineIndex, render, scanVariables } from './variables.js';

/** Every rule and its default severity. Set a rule to "off", "warn" or "error" in the config. */
export const RULES = {
  'unfilled-variable': 'error',
  'unused-variable': 'warn',
  'misspelled-variable': 'warn',
  'syntax-mismatch': 'warn',
  'duplicate-instruction': 'warn',
  'contradicting-instruction': 'error',
  'token-budget': 'warn',
  'invalid-json': 'error',
  'unclosed-tag': 'error',
};

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'source', 'area', 'col', 'embed']);

/** Rough token count (about 4 characters per token for English text). */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Lints one prompt template and returns its problems, sorted by line.
 * File-level problems (no line) come last.
 *
 * @param {string} text
 * @param {{ vars?: string[], budget?: number, syntax?: string, rules?: Record<string, string> }} [options]
 */
export function lintText(text, options = {}) {
  const { vars, budget, syntax = 'auto', rules = {} } = options;
  const messages = [];
  const report = (rule, line, message) => {
    const severity = rules[rule] ?? RULES[rule];
    if (severity && severity !== 'off') messages.push({ rule, severity, line: line ?? null, message });
  };

  checkVariables(text, syntax, vars, report);
  checkInstructions(maskCode(text), report);
  checkJson(text, report);
  checkTags(maskCode(text), report);

  if (budget) {
    const tokens = estimateTokens(text);
    if (tokens > budget) {
      report('token-budget', null, `~${formatTokens(tokens)} tokens, over the ${formatBudget(budget)} budget you set for this file`);
    }
  }

  return messages.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
}

function checkVariables(text, syntax, vars, report) {
  const scan = scanVariables(text, syntax);
  // `{user}` in inline code is usually documentation, not a slip.
  const spans = [...text.matchAll(/`[^`\n]+`/g)].map((m) => [m.index, m.index + m[0].length]);
  const inInlineCode = (u) => spans.some(([start, end]) => u.index > start && u.index < end);
  const firstUse = new Map();
  const counts = new Map();
  for (const u of scan.uses) {
    const prev = firstUse.get(u.name);
    if (!prev || (prev.scoped && !u.scoped)) firstUse.set(u.name, u);
    counts.set(u.name, (counts.get(u.name) ?? 0) + 1);
  }

  const known = new Set([...firstUse.keys(), ...(vars ?? [])]);
  for (const u of scan.other) {
    if (known.has(u.name) && !inInlineCode(u)) {
      report('syntax-mismatch', u.line, `uses ${u.raw} but the template syntax is ${render(scan.syntax, u.name)}`);
    }
  }

  if (vars) {
    const passed = new Set(vars);
    for (const [name, u] of firstUse) {
      if (passed.has(name) || u.scoped) continue;
      const guess = closest(name, vars);
      report('unfilled-variable', u.line,
        `${render(scan.syntax, name)} is never filled in by any caller` + (guess ? ` (did you mean ${render(scan.syntax, guess)}?)` : ''));
    }
    for (const name of vars) {
      if (!firstUse.has(name)) report('unused-variable', null, `"${name}" is passed in but the template never uses it`);
    }
    return;
  }

  // No list of passed variables: flag a rare name that is one or two edits from a more common one.
  for (const [name, u] of firstUse) {
    if (inInlineCode(u)) continue;
    const others = [...counts.keys()].filter((n) => counts.get(n) > counts.get(name));
    const guess = closest(name, others);
    if (guess) report('misspelled-variable', u.line, `${u.raw} looks like a typo of ${render(scan.syntax, guess)}`);
  }
}

function checkInstructions(text, report) {
  const seen = new Map();
  const stance = new Map();
  text.split('\n').forEach((line, i) => {
    for (const sentence of sentences(line)) {
      const norm = normalize(sentence);
      if (norm.split(' ').length < 3) continue;
      const lineNo = i + 1;

      const prev = seen.get(norm);
      if (prev) prev.lines.push(lineNo);
      else seen.set(norm, { sentence, lines: [lineNo] });

      const { negative, core } = polarity(norm);
      if (core.split(' ').length < 2) continue;
      const entry = stance.get(core) ?? { pos: null, neg: null, reported: false };
      const opposite = negative ? entry.pos : entry.neg;
      if (opposite && !entry.reported) {
        report('contradicting-instruction', lineNo, `"${sentence}" contradicts line ${opposite.line}: "${opposite.sentence}"`);
        entry.reported = true;
      }
      const side = negative ? 'neg' : 'pos';
      entry[side] ??= { line: lineNo, sentence };
      stance.set(core, entry);
    }
  });

  for (const { sentence, lines } of seen.values()) {
    if (lines.length < 2) continue;
    const also = lines.slice(1).map((l) => (l === lines[0] ? 'same line' : `line ${l}`));
    report('duplicate-instruction', lines[0], `instruction repeated: "${sentence}" (also ${[...new Set(also)].join(', ')})`);
  }
}

function checkJson(text, report) {
  const lineOf = lineIndex(text);
  for (const block of fences(text)) {
    if (block.lang !== 'json') continue;
    const body = text.slice(block.bodyStart, block.bodyEnd);
    if (!body.trim() || body.includes('{%')) continue;
    const filled = body
      .replace(/\{\{\{[^{}]*\}\}\}|\{\{[^{}]*\}\}/g, '0')
      .replace(/\$\{[^{}]*\}/g, '0');
    try {
      JSON.parse(filled);
    } catch (err) {
      const pos = Number(err.message.match(/position (\d+)/)?.[1]);
      const line = Number.isFinite(pos)
        ? lineOf(block.bodyStart) + (filled.slice(0, pos).match(/\n/g)?.length ?? 0)
        : lineOf(block.start);
      const reason = err.message.replace(/\s*(?:in JSON )?at position \d+.*$/s, '').replace(/^JSON\.parse: /, '');
      report('invalid-json', line, `JSON example does not parse: ${reason}`);
    }
  }
}

function checkTags(text, report) {
  const lineOf = lineIndex(text);
  const stack = [];
  for (const m of text.matchAll(/<(\/?)([A-Za-z][\w.:-]*)(\s[^<>]*?)?(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (selfClosing || VOID_TAGS.has(name.toLowerCase())) continue;
    const line = lineOf(m.index);
    if (!closing) {
      stack.push({ name, line });
      continue;
    }
    const at = stack.findLastIndex((t) => t.name === name);
    if (at === -1) {
      report('unclosed-tag', line, `</${name}> has no matching <${name}>`);
      continue;
    }
    for (const t of stack.splice(at).slice(1)) report('unclosed-tag', t.line, `<${t.name}> is never closed`);
  }
  for (const t of stack) report('unclosed-tag', t.line, `<${t.name}> is never closed`);
}

// Blank out fenced and inline code, keeping line numbers intact.
function maskCode(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  let out = text;
  for (const b of fences(text)) out = out.slice(0, b.start) + blank(out.slice(b.start, b.end)) + out.slice(b.end);
  return out.replace(/`[^`\n]+`/g, blank);
}

function sentences(line) {
  const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)]|#+|>)\s+/, '').trim();
  if (!stripped || stripped.startsWith('|')) return [];
  return stripped
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/[.!?:;,]+$/, '').trim())
    .filter(Boolean);
}

function normalize(sentence) {
  return sentence
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\w\s{}$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NEGATIVE = /^(?:please |you )?(?:must |should |will )?(?:never|not|do not|dont|mustnt|shouldnt|cannot|cant|avoid)\s+/;
const POSITIVE = /^(?:please |you )?(?:must |should |will )?(?:always |do )?/;

function polarity(norm) {
  const neg = norm.match(NEGATIVE);
  if (neg) return { negative: true, core: norm.slice(neg[0].length) };
  return { negative: false, core: norm.slice(norm.match(POSITIVE)[0].length) };
}

function closest(name, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    if (c === name || c.replace(/\d+/g, '') === name.replace(/\d+/g, '')) continue;
    const limit = Math.min(name.length, c.length) < 6 ? 1 : 2;
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d <= limit && d < bestDistance) [best, bestDistance] = [c, d];
  }
  return best;
}

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function formatTokens(n) {
  return (n >= 1000 ? Math.round(n / 100) * 100 : n).toLocaleString('en-US');
}

function formatBudget(n) {
  return n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString('en-US');
}
