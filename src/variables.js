// Finds template variables in prompt text for the three supported syntaxes:
//   double  {{name}} / {{ name | filter }} / {% for x in items %}  (Mustache, Handlebars, Jinja)
//   dollar  ${name}                                                (JS template literals)
//   single  {name}                                                 (Python str.format, LangChain)

const KEYWORDS = new Set([
  'and', 'or', 'not', 'in', 'is', 'if', 'else', 'elif', 'for', 'true', 'false', 'none',
  'True', 'False', 'None', 'loop', 'range', 'super', 'self', 'caller', 'varargs', 'kwargs',
  'recursive', 'with', 'as', 'this',
]);

export const SYNTAXES = ['double', 'dollar', 'single'];

export function render(syntax, name) {
  if (syntax === 'dollar') return '${' + name + '}';
  if (syntax === 'single') return '{' + name + '}';
  return '{{' + name + '}}';
}

export function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// Offsets [start, end) of fenced code blocks (``` or ~~~), with their info string.
export function fences(text) {
  const out = [];
  const re = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n]*)$/gm;
  let open = null;
  let m;
  while ((m = re.exec(text))) {
    if (!open) {
      open = { start: m.index, bodyStart: m.index + m[0].length + 1, marker: m[1], lang: m[2].trim().split(/\s+/)[0].toLowerCase() };
    } else if (m[1][0] === open.marker[0] && m[1].length >= open.marker.length && !m[2].trim()) {
      out.push({ ...open, bodyEnd: m.index, end: m.index + m[0].length });
      open = null;
    }
  }
  if (open) out.push({ ...open, bodyEnd: text.length, end: text.length });
  return out;
}

function identifiersIn(expr) {
  const cleaned = expr
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/\|\s*[A-Za-z_]\w*/g, ' ')
    .replace(/\bis\s+(?:not\s+)?[A-Za-z_]\w*/g, ' ')
    .replace(/\b[A-Za-z_]\w*\s*=(?!=)/g, ' ');
  const names = [];
  for (const m of cleaned.matchAll(/(?<![\w.])[A-Za-z_]\w*/g)) {
    if (!KEYWORDS.has(m[0])) names.push(m[0]);
  }
  return names;
}

function scanDouble(text) {
  const uses = [];
  const defined = new Set();
  let depth = 0;
  let tags = 0;
  const re = /\{\{\{\s*([\s\S]*?)\s*\}\}\}|\{\{-?\s*([\s\S]*?)\s*-?\}\}|\{%-?\s*([\s\S]*?)\s*-?%\}|\{#[\s\S]*?#\}/g;
  const use = (name, index, raw) => uses.push({ name, index, raw, scoped: depth > 0 });
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    if (m[1] !== undefined || m[2] !== undefined) {
      const body = (m[1] ?? m[2]).trim();
      const sigil = body[0];
      if (sigil === '!' || sigil === '>' || sigil === '=' || body === '.' || body === 'else') continue;
      if (sigil === '/') { depth = Math.max(0, depth - 1); continue; }
      if (sigil === '#' || sigil === '^') {
        // Mustache sections and Handlebars block helpers: {{#items}}, {{#each items}}, {{#if x}}
        const parts = body.slice(1).trim().split(/\s+/);
        const target = ['each', 'if', 'unless', 'with'].includes(parts[0]) ? parts[1] : parts[0];
        const name = target?.match(/^[A-Za-z_]\w*/)?.[0];
        if (name && !KEYWORDS.has(name)) use(name, m.index, raw);
        depth++;
        continue;
      }
      for (const name of identifiersIn(sigil === '&' ? body.slice(1) : body)) use(name, m.index, raw);
      continue;
    }
    if (m[3] === undefined) continue; // {# comment #}
    tags++;
    const body = m[3].trim();
    const tag = body.split(/\s+/)[0];
    const rest = body.slice(tag.length).trim();
    if (tag === 'raw') {
      const end = text.indexOf('endraw', re.lastIndex);
      if (end !== -1) re.lastIndex = end;
      continue;
    }
    if (tag === 'for') {
      const f = rest.match(/^(.+?)\s+in\s+(.+?)(?:\s+if\s+(.+?))?(?:\s+recursive)?$/);
      if (f) {
        for (const t of f[1].split(',')) defined.add(t.trim());
        for (const name of identifiersIn(f[2] + ' ' + (f[3] ?? ''))) use(name, m.index, raw);
      }
      depth++;
    } else if (tag === 'endfor') {
      depth = Math.max(0, depth - 1);
    } else if (tag === 'set' || tag === 'with') {
      const s = rest.match(/^([\w\s,]+?)\s*(?:=\s*([\s\S]+))?$/);
      if (s) {
        for (const t of s[1].split(',')) defined.add(t.trim());
        if (s[2]) for (const name of identifiersIn(s[2])) use(name, m.index, raw);
      }
    } else if (tag === 'macro') {
      const s = rest.match(/^(\w+)\s*\(([^)]*)\)/);
      if (s) {
        defined.add(s[1]);
        for (const a of s[2].split(',')) if (a.trim()) defined.add(a.split('=')[0].trim());
      }
    } else if (tag === 'if' || tag === 'elif') {
      for (const name of identifiersIn(rest)) use(name, m.index, raw);
    }
  }
  return { uses: uses.filter((u) => !defined.has(u.name)), tags: tags + uses.length };
}

function scanDollar(text) {
  const uses = [];
  for (const m of text.matchAll(/(?<!\\)\$\{\s*([A-Za-z_$][\w$]*)[^}]*\}/g)) {
    uses.push({ name: m[1], index: m.index, raw: m[0], scoped: false });
  }
  return { uses, tags: uses.length };
}

function scanSingle(text) {
  const uses = [];
  for (const m of text.matchAll(/(?<![{$\\])\{([A-Za-z_]\w*)(?:[.[][^{}\s]*)?(?:![rsa])?(?::[^{}]*)?\}(?!\})/g)) {
    uses.push({ name: m[1], index: m.index, raw: m[0], scoped: false });
  }
  return { uses, tags: uses.length };
}

/**
 * Returns the template syntax in use, every variable use in that syntax, and every
 * use written in one of the other syntaxes (`other`), each with its line number.
 */
export function scanVariables(text, syntax = 'auto') {
  const lineOf = lineIndex(text);
  const blocks = fences(text);
  const outsideCode = (u) => !blocks.some((b) => u.index >= b.start && u.index < b.end);
  const found = { double: scanDouble(text), dollar: scanDollar(text), single: scanSingle(text) };

  if (syntax === 'auto' || !SYNTAXES.includes(syntax)) {
    // {{x}} and ${x} are unambiguous; a lone {x} is often an example or a slip, so it only
    // wins when neither of the others appears.
    if (found.double.tags) syntax = 'double';
    else if (found.dollar.tags) syntax = 'dollar';
    else if (found.single.uses.some(outsideCode)) syntax = 'single';
    else syntax = 'double';
  }

  const withLine = (s) => (u) => ({ ...u, syntax: s, line: lineOf(u.index) });
  return {
    syntax,
    uses: found[syntax].uses.map(withLine(syntax)),
    other: SYNTAXES.filter((s) => s !== syntax).flatMap((s) => found[s].uses.map(withLine(s))),
  };
}
