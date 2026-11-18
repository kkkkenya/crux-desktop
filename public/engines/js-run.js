// Running a student's JavaScript (fixplan-g G6): the browser's own engine, inside a worker the page ends after 3 s.
// console.log goes to the output; input() reads the Input box one line at a time, like the Python cell. Nothing to
// download. Pure enough for the tests to run it in Node.
export const JS_OUTPUT_CAP = 20000;

const show = (v) => (typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })());

/** { out, error: { line, type, message } | null, truncated } */
export function runJs(code, input = '') {
  let out = '', truncated = false;
  const write = (...args) => {
    if (out.length >= JS_OUTPUT_CAP) { truncated = true; return; }
    out += `${args.map(show).join(' ')}\n`;
    if (out.length > JS_OUTPUT_CAP) { out = out.slice(0, JS_OUTPUT_CAP); truncated = true; }
  };
  const lines = String(input || '').replace(/\r/g, '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const input_ = (prompt = '') => {
    if (!lines.length) throw Object.assign(new Error('No more input. Add another line in Input.'), { name: 'EOFError' });
    const v = lines.shift();
    write(`${prompt}${v}`);
    return v;
  };
  const console_ = { log: write, info: write, warn: write, error: write, table: (x) => write(x) };
  try {
    // the student's code sees only console, input and prompt, not the worker's own scope
    new Function('console', 'input', 'prompt', `"use strict";\n${String(code || '')}`)(console_, input_, input_);
    return { out, error: null, truncated };
  } catch (e) {
    const at = /<anonymous>:(\d+):\d+/.exec(String(e?.stack || ''));
    return { out, error: { line: at ? Math.max(1, Number(at[1]) - 3) : null, type: e?.name || 'Error', message: String(e?.message || e) }, truncated };
  }
}
