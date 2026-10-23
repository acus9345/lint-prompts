# lint-prompts

A linter for prompt templates. It checks prompt files before they ship. It comes as a CLI, a library and a GitHub Action, with zero dependencies.

```bash
npx lint-prompts prompts/
```

```
prompts/support.md
  line 4   error    {{customer_name}} is never filled in by any caller
  line 12  warn     instruction repeated: "Always answer in JSON" (also line 30)
  line 18  warn     uses {user} but the template syntax is {{user}}
prompts/summarize.md
  warn     ~14,200 tokens, over the 8k budget you set for this file
```

Prompts now live in repos as `.md` or `.txt` files and change in pull requests. A broken template fails silently: the model still answers, just worse. `lint-prompts` catches those mistakes in CI.

## What it checks

| Rule | Default | Catches |
| --- | --- | --- |
| `unfilled-variable` | error | `{{customer_name}}` in the template, but your code never passes it (needs `vars`) |
| `unused-variable` | warn | a variable you pass that the template never uses (needs `vars`) |
| `misspelled-variable` | warn | `{{custome_name}}` once next to `{{customer_name}}` several times |
| `syntax-mismatch` | warn | `{user}` or `${user}` in a `{{user}}` template |
| `duplicate-instruction` | warn | the same instruction written twice |
| `contradicting-instruction` | error | "Always answer in JSON" vs "Never answer in JSON" |
| `token-budget` | warn | a file over its token budget (about 4 characters per token) |
| `invalid-json` | error | a ```` ```json ```` example that does not parse (variables are filled with placeholders first) |
| `unclosed-tag` | error | `<example>` with no `</example>`, or a stray closing tag |

Supported template syntaxes, detected automatically:

- `{{x}}` (Mustache, Handlebars), including sections such as `{{#items}}…{{/items}}`
- Jinja, including `{{ x | filter }}`, `{% for x in items %}`, `{% if %}` and `{% set %}`
- `{x}` (Python `str.format`, LangChain)
- `${x}` (JavaScript template literals)

Folders are scanned for `.md`, `.txt`, `.prompt`, `.jinja`, `.jinja2`, `.j2`, `.mustache`, `.hbs`, `.tmpl` and `.tpl` files. `node_modules`, `.git` and dot-folders are skipped.

## Install

```bash
npm install --save-dev lint-prompts
```

Requires Node.js 18 or later.

## CLI

```
lint-prompts [paths...] [options]

  -c, --config <file>    config file (default: lint-prompts.config.json, searched upward)
      --vars <a,b,c>     variables your code passes in (applies to every file)
      --budget <n>       token budget for every file
      --syntax <name>    auto | double | single | dollar
  -f, --format <name>    pretty | json | github
      --max-warnings <n> exit with 1 when there are more than n warnings
      --init             write a starter lint-prompts.config.json
```

Exit codes: `0` no errors, `1` problems found, `2` bad usage or config.

## Config

Create `lint-prompts.config.json` (or run `npx lint-prompts --init`):

```json
{
  "paths": ["prompts"],
  "budget": 8000,
  "files": {
    "prompts/support.md": { "vars": ["customer_name", "question"] },
    "prompts/summarize.md": { "varsFrom": "src/types.ts#SummarizeVars", "budget": 16000 },
    "prompts/legacy/**": { "rules": { "duplicate-instruction": "off" } }
  },
  "rules": {
    "unclosed-tag": "warn"
  }
}
```

- `vars`: the variables your code passes to the template. This turns on `unfilled-variable` and `unused-variable`.
- `varsFrom`: reads the variable names from a TypeScript `interface` or `type` instead, so the prompt and your types cannot drift apart.
- `budget`: the token budget for the file.
- `syntax`: `auto` (default), `double`, `single` or `dollar`.
- `rules`: set any rule to `"error"`, `"warn"` or `"off"`.
- `files`: per-file options keyed by glob (`*`, `**`, `?`), relative to the config file. Every matching entry applies, in order.
- `paths` and `extensions`: what to lint when no paths are given on the command line.

## GitHub Action

```yaml
name: Lint prompts
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: acus9345/lint-prompts@v0.1.0
        with:
          paths: prompts
          # config: lint-prompts.config.json
          # max-warnings: 0
```

Problems show up as annotations on the pull request diff.

## Library

```js
import { lintText, lintFiles, loadConfig, format } from 'lint-prompts';

lintText('Hi {{nme}}', { vars: ['name'] });
// [{ rule: 'unfilled-variable', severity: 'error', line: 1,
//    message: '{{nme}} is never filled in by any caller (did you mean {{name}}?)' }]

const results = lintFiles(['prompts'], { config: loadConfig('lint-prompts.config.json') });
console.log(format(results)); // 'pretty' | 'json' | 'github'
```

TypeScript types are included.

## License

MIT
