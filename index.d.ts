export type Severity = 'error' | 'warn';
export type RuleSetting = Severity | 'off';
export type Syntax = 'auto' | 'double' | 'single' | 'dollar';

export type RuleId =
  | 'unfilled-variable'
  | 'unused-variable'
  | 'misspelled-variable'
  | 'syntax-mismatch'
  | 'duplicate-instruction'
  | 'contradicting-instruction'
  | 'token-budget'
  | 'invalid-json'
  | 'unclosed-tag';

export interface Message {
  rule: RuleId;
  severity: Severity;
  /** 1-based line, or null for file-level problems. */
  line: number | null;
  message: string;
}

export interface LintOptions {
  /** Variables your code passes in. Enables the unfilled-variable and unused-variable rules. */
  vars?: string[];
  /** Token budget for the file. */
  budget?: number;
  /** Template syntax. "auto" prefers double, then dollar, then single outside code fences. */
  syntax?: Syntax;
  rules?: Partial<Record<RuleId, RuleSetting>>;
}

export interface FileOptions extends LintOptions {
  /** "path/to/types.ts#TypeName": take vars from a TypeScript interface or type literal. */
  varsFrom?: string;
}

export interface Config extends FileOptions {
  /** Paths to lint when none are given on the command line. */
  paths?: string[];
  /** File extensions to pick up inside folders. */
  extensions?: string[];
  /** Per-file options, keyed by glob relative to the config file. */
  files?: Record<string, FileOptions>;
  /** Folder the config file lives in (set by loadConfig). */
  dir?: string;
}

export interface FileResult {
  file: string;
  messages: Message[];
}

export interface VariableUse {
  name: string;
  raw: string;
  line: number;
  index: number;
  syntax: Exclude<Syntax, 'auto'>;
  /** Inside a loop or section, so it may be filled by the loop rather than the caller. */
  scoped: boolean;
}

export const RULES: Record<RuleId, Severity>;
export const EXTENSIONS: string[];

export function lintText(text: string, options?: LintOptions): Message[];
export function lintFiles(
  paths: string[],
  options?: { config?: Config; cwd?: string; overrides?: LintOptions },
): FileResult[];
export function collectFiles(paths: string[], extensions?: string[]): string[];
export function estimateTokens(text: string): number;
export function scanVariables(
  text: string,
  syntax?: Syntax,
): { syntax: Exclude<Syntax, 'auto'>; uses: VariableUse[]; other: VariableUse[] };

export function findConfig(dir?: string): string | null;
export function loadConfig(file: string): Config;
export function optionsFor(config: Config, relPath: string): LintOptions;
export function typeKeys(source: string, name: string, label?: string): string[];
export function format(results: FileResult[], style?: 'pretty' | 'json' | 'github'): string;
