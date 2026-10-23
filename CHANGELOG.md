# Changelog

## 0.1.0

- First release: CLI, library and GitHub Action.
- Rules: unfilled-variable, unused-variable, misspelled-variable, syntax-mismatch, duplicate-instruction, contradicting-instruction, token-budget, invalid-json, unclosed-tag.
- Syntaxes: `{{x}}` (Mustache/Handlebars), Jinja, `{x}`, `${x}`.
- Config file with per-file globs, token budgets and `varsFrom` for TypeScript types.
