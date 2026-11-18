// Checking a program's output (fixplan-f F9). Pure. Line by line, ignoring spaces at line ends and blank lines at the
// end; numbers match when they are equal to about 6 significant figures (12.5 and 12.50 are the same). It says what
// matched, never that the program is right: one input can match by chance.

const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const lines = (t) => {
  const out = String(t || '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd());
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
};
const sameToken = (a, b) => {
  if (a === b) return true;
  if (NUM.test(a) && NUM.test(b)) { const x = Number(a), y = Number(b); return Math.abs(x - y) <= 1e-6 * Math.max(Math.abs(x), Math.abs(y)) || Math.abs(x - y) < 1e-12; }
  return false;
};
const indent = (l) => /^\s*/.exec(l)[0].length;
const sameLine = (a, b) => {
  if (indent(a) !== indent(b)) return false; // "   *" is not "*": patterns and tables depend on it
  const x = a.trim().split(/\s+/), y = b.trim().split(/\s+/);
  return x.length === y.length && x.every((t, i) => sameToken(t, y[i]));
};

/** { same, line (1-based, the first that differs), got, expected } */
export function compareOutputs(got, expected) {
  const g = lines(got), e = lines(expected);
  for (let i = 0; i < Math.max(g.length, e.length); i++) {
    if (g[i] === undefined || e[i] === undefined || !sameLine(g[i], e[i])) return { same: false, line: i + 1, got: g[i] ?? null, expected: e[i] ?? null };
  }
  return { same: true, line: null, got: null, expected: null };
}

/** A plain sentence for the result of compareOutputs. */
export function describe(r, against) {
  if (r.same) return `Same output as ${against}.`;
  if (r.got === null) return `Line ${r.line} is missing: ${against} prints "${r.expected}".`;
  if (r.expected === null) return `Line ${r.line} is extra: you print "${r.got}", ${against} stops before it.`;
  return `Line ${r.line} differs: you print "${r.got}", ${against} prints "${r.expected}".`;
}

// Sample input and output printed in a question ("Sample input: ... Sample output: ..."), or null.
// "Sample output:", "Example output 1", or a line that is only "Output:" (not "Output the largest number.")
const HEAD = (w) => new RegExp(`(?:^|\\n)[ \\t]*(?:(?:sample|example)[ \\t]+${w}(?:[ \\t]*\\d+)?[ \\t]*:?|${w}[ \\t]*:)[ \\t]*\\n?`, 'i');
export function sampleFrom(text) {
  const t = String(text || '').replace(/\r/g, '');
  const o = HEAD('output').exec(t);
  if (!o) return null;
  const outText = t.slice(o.index + o[0].length).split(/\n\s*\n|\n\s*(?:sample|example)\b/i)[0];
  const i = HEAD('input').exec(t.slice(0, o.index));
  const inText = i ? t.slice(i.index + i[0].length, o.index) : '';
  const output = lines(outText).join('\n');
  if (!output || output.length > 2000) return null;
  return { input: lines(inText).join('\n'), output };
}

/** The language a question is in: SQL when it shows tables or queries, JavaScript when it says so, else Python. */
export function languageOf(text = '', codeLanguage = '') {
  const l = String(codeLanguage || '').toLowerCase();
  if (/^(sql|sqlite|mysql|postgres)/.test(l)) return 'sql';
  if (/^(js|javascript|node)/.test(l)) return 'js';
  if (/^(py|python)/.test(l)) return 'python';
  const t = String(text || '');
  if (/\b(SELECT\s+[\w*]|CREATE\s+TABLE|INSERT\s+INTO|SQL\b|query\b.*\btable)/i.test(t)) return 'sql';
  if (/\b(javascript|console\.log|node\.?js)\b/i.test(t)) return 'js';
  return 'python';
}
