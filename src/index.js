import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { optionsFor } from './config.js';
import { lintText } from './lint.js';

export { lintText, estimateTokens, RULES } from './lint.js';
export { scanVariables } from './variables.js';
export { findConfig, loadConfig, optionsFor, typeKeys } from './config.js';
export { format } from './format.js';

export const EXTENSIONS = ['.md', '.txt', '.prompt', '.jinja', '.jinja2', '.j2', '.mustache', '.hbs', '.tmpl', '.tpl'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

/** Expands folders into the prompt files inside them. Files named explicitly are always kept. */
export function collectFiles(paths, extensions = EXTENSIONS) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full);
      } else if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
        out.push(full);
      }
    }
  };
  for (const p of paths) {
    if (statSync(p).isDirectory()) walk(p);
    else out.push(p);
  }
  return [...new Set(out.map((f) => resolve(f)))];
}

/**
 * Lints every prompt file under `paths`.
 * Returns one `{ file, messages }` entry per file, with `file` relative to `cwd`.
 */
export function lintFiles(paths, { config = {}, cwd = process.cwd(), overrides = {} } = {}) {
  const base = config.dir ?? cwd;
  return collectFiles(paths.map((p) => resolve(cwd, p)), config.extensions).map((file) => {
    const options = { ...optionsFor(config, toPosix(relative(base, file))), ...overrides };
    return { file: toPosix(relative(cwd, file)), messages: lintText(readFileSync(file, 'utf8'), options) };
  });
}

function toPosix(p) {
  return p.split(sep).join('/');
}
