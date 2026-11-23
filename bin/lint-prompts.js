#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findConfig, format, lintFiles, loadConfig } from '../src/index.js';

const HELP = `Usage: lint-prompts [paths...] [options]

Checks prompt template files (.md, .txt, .prompt, .jinja, .j2, .hbs, ...) for
unfilled or misspelled variables, duplicate or contradicting instructions,
token budgets, broken JSON examples and unclosed XML tags.

Options:
  -c, --config <file>   config file (default: lint-prompts.config.json, searched upward)
      --vars <a,b,c>    variables your code passes in (applies to every file)
      --budget <n>      token budget for every file
      --syntax <name>   auto | double | single | dollar  (default: auto)
  -f, --format <name>   pretty | json | github           (default: pretty)
      --max-warnings <n> exit with 1 when there are more than n warnings
      --init            write a starter lint-prompts.config.json
  -h, --help            show this help
  -v, --version         show the version

Exit codes: 0 no errors, 1 problems found, 2 bad usage or config.`;

const STARTER = {
  paths: ['prompts'],
  budget: 8000,
  files: {
    'prompts/support.md': { vars: ['customer_name', 'question'], budget: 4000 },
  },
  rules: { 'duplicate-instruction': 'warn' },
};

function parseArgs(argv) {
  const args = { paths: [] };
  const valueFlags = { '-c': 'config', '--config': 'config', '--vars': 'vars', '--budget': 'budget', '--syntax': 'syntax', '-f': 'format', '--format': 'format', '--max-warnings': 'maxWarnings' };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--') {
      args.paths.push(...argv.slice(i + 1));
      break;
    }
    let value;
    if (arg.startsWith('--') && arg.includes('=')) [arg, value] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
    if (arg === '-h' || arg === '--help') args.help = true;
    else if (arg === '-v' || arg === '--version') args.version = true;
    else if (arg === '--init') args.init = true;
    else if (valueFlags[arg]) {
      value ??= argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      args[valueFlags[arg]] = value;
    } else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else args.paths.push(arg);
  }
  return args;
}

function toNumber(value, flag) {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) throw new Error(`${flag} must be a number`);
  return n;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP), 0;
  if (args.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(pkg.version), 0;
  }
  if (args.init) {
    const file = 'lint-prompts.config.json';
    if (existsSync(file)) throw new Error(`${file} already exists`);
    writeFileSync(file, JSON.stringify(STARTER, null, 2) + '\n');
    return console.log(`wrote ${file}`), 0;
  }

  const configFile = args.config ?? findConfig();
  const config = configFile ? loadConfig(configFile) : {};
  const overrides = {};
  if (args.vars !== undefined) overrides.vars = args.vars.split(',').map((v) => v.trim()).filter(Boolean);
  if (args.budget !== undefined) {
    overrides.budget = toNumber(args.budget, '--budget');
    if (overrides.budget <= 0) throw new Error('--budget must be a positive number');
  }
  if (args.syntax !== undefined) {
    if (!['auto', 'double', 'single', 'dollar'].includes(args.syntax)) {
      throw new Error(`unknown syntax ${args.syntax}`);
    }
    overrides.syntax = args.syntax;
  }
  const style = args.format ?? 'pretty';
  if (!['pretty', 'json', 'github'].includes(style)) throw new Error(`unknown format ${style}`);

  const paths = args.paths.length ? args.paths : (config.paths ?? ['.']).map((p) => resolve(config.dir ?? '.', p));
  for (const p of paths) if (!existsSync(p)) throw new Error(`no such file or folder: ${p}`);

  const results = lintFiles(paths, { config, overrides });
  console.log(format(results, style));

  const all = results.flatMap((r) => r.messages);
  const errors = all.filter((m) => m.severity === 'error').length;
  const maxWarnings = args.maxWarnings === undefined ? Infinity : toNumber(args.maxWarnings, '--max-warnings');
  return errors > 0 || all.length - errors > (maxWarnings < 0 ? Infinity : maxWarnings) ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`lint-prompts: ${err.message}`);
  process.exitCode = 2;
}
