const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);

/**
 * Turns lint results into text.
 * @param {{ file: string, messages: object[] }[]} results
 * @param {'pretty' | 'json' | 'github'} [style]
 */
export function format(results, style = 'pretty') {
  if (style === 'json') return JSON.stringify(results, null, 2);
  if (style === 'github') return github(results);
  return pretty(results);
}

function pretty(results) {
  const lines = [];
  for (const { file, messages } of results) {
    if (!messages.length) continue;
    lines.push(paint('4', file));
    const hasLines = messages.some((m) => m.line);
    for (const m of messages) {
      const where = m.line ? paint('2', `line ${m.line}`.padEnd(9)) : hasLines ? ' '.repeat(9) : '';
      const severity = paint(m.severity === 'error' ? '31' : '33', m.severity.padEnd(9));
      lines.push(`  ${where}${severity}${m.message}`);
    }
  }
  lines.push(summary(results));
  return lines.join('\n');
}

function github(results) {
  const escape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const lines = [];
  for (const { file, messages } of results) {
    for (const m of messages) {
      const kind = m.severity === 'error' ? 'error' : 'warning';
      const where = `file=${file}` + (m.line ? `,line=${m.line}` : '');
      lines.push(`::${kind} ${where},title=lint-prompts (${m.rule})::${escape(m.message)}`);
    }
  }
  lines.push(summary(results));
  return lines.join('\n');
}

export function summary(results) {
  const all = results.flatMap((r) => r.messages);
  const errors = all.filter((m) => m.severity === 'error').length;
  const warnings = all.length - errors;
  const files = `${results.length} file${results.length === 1 ? '' : 's'}`;
  if (!all.length) return `\n${files} checked, no problems found`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `\n${plural(all.length, 'problem')} (${plural(errors, 'error')}, ${plural(warnings, 'warning')}) in ${files}`;
}
