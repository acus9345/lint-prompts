import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const CONFIG_FILES = ['lint-prompts.config.json', '.lint-prompts.json'];

/** Looks for a config file in `dir` and its parents. Returns its path or null. */
export function findConfig(dir = process.cwd()) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    for (const name of CONFIG_FILES) if (existsSync(join(d, name))) return join(d, name);
    if (dirname(d) === d) return null;
  }
}

/** Reads and validates a config file. `dir` is set to the folder it lives in. */
export function loadConfig(file) {
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`could not read config ${file}: ${err.message}`);
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(`config ${file} must be a JSON object`);
  }
  return { ...config, dir: dirname(resolve(file)) };
}

/**
 * Merges the top-level options with every `files` entry whose glob matches `relPath`
 * (later entries win) and resolves `varsFrom` against a TypeScript type.
 */
export function optionsFor(config, relPath) {
  const pick = ({ vars, varsFrom, budget, syntax, rules }) => ({ vars, varsFrom, budget, syntax, rules });
  let options = pick(config);
  for (const [glob, entry] of Object.entries(config.files ?? {})) {
    if (!globToRegExp(glob).test(relPath)) continue;
    const next = pick(entry);
    options = {
      ...options,
      ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)),
      rules: { ...options.rules, ...next.rules },
    };
  }
  if (options.varsFrom) {
    const [file, type] = options.varsFrom.split('#');
    const fromType = typeKeys(readFileSync(resolve(config.dir ?? '.', file), 'utf8'), type, options.varsFrom);
    options.vars = [...new Set([...(options.vars ?? []), ...fromType])];
  }
  delete options.varsFrom;
  return options;
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Top-level property names of `interface Name {}` or `type Name = {}` in TypeScript source. */
export function typeKeys(source, name, label = name) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const head = new RegExp(`(?:interface\\s+${name}\\b[^{]*|type\\s+${name}\\b[^=]*=\\s*)\\{`).exec(code);
  if (!head) throw new Error(`type ${label} not found`);

  let top = '';
  let depth = 1;
  for (let i = head.index + head[0].length; i < code.length && depth > 0; i++) {
    const c = code[i];
    if ('{([<'.includes(c)) depth++;
    else if ('})]>'.includes(c) && !(c === '>' && code[i - 1] === '=')) depth--;
    if (depth === 1) top += c;
    else if (depth === 0) break;
  }
  const keys = [];
  for (const m of top.matchAll(/(?:^|[;,\n])\s*(?:readonly\s+)?(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*\??\s*:/g)) {
    keys.push(m[1] ?? m[2] ?? m[3]);
  }
  return keys;
}
