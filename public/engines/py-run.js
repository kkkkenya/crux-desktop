// Running a student's Python (fixplan-f F9): MicroPython compiled to WebAssembly, on the student's own device. Pure
// apart from the interpreter it is given, so the same code runs in the browser's worker (py-worker.js) and in the
// tests (Node). No server runs anyone's code.

export const OUTPUT_CAP = 20000; // characters of output kept
// Libraries the plain interpreter does not have. Code that imports them gets a plain message instead of a crash.
const HEAVY = /^\s*(?:import|from)\s+(numpy|matplotlib|pandas|scipy|sympy|tkinter|turtle|requests|cv2|sklearn)\b/m;
export const heavyImport = (code) => HEAVY.exec(String(code || ''))?.[1] || null;

// input() reads the Input box, one line per call, and echoes it like a terminal does
const PRELUDE = `_crux_in = list(_crux_lines)
def input(prompt=''):
    print(prompt, end='')
    if not _crux_in:
        raise EOFError('No more input. Add another line in Input.')
    v = _crux_in.pop(0)
    print(v)
    return v
`;

// The last "File ..., line N" and the error line of a MicroPython traceback.
export function readError(text) {
  const lines = String(text || '').split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const where = [...lines].reverse().find((l) => /line \d+/.test(l));
  const last = lines[lines.length - 1] || 'Error';
  const m = /^(\w+(?:Error|Exception|Interrupt|Exit)?):?\s*(.*)$/.exec(last);
  return { line: where ? Number(/line (\d+)/.exec(where)[1]) : null, type: m ? m[1] : 'Error', message: m ? m[2] : last };
}

/**
 * Run code with the given input lines. load: loadMicroPython from the package. Returns
 * { out, error: { line, type, message } | null, truncated, blocked }.
 */
export async function runPython(load, code, input = '') {
  const lib = heavyImport(code);
  if (lib) return { out: '', error: null, truncated: false, blocked: lib };
  let out = '', truncated = false;
  const write = (line) => {
    if (out.length >= OUTPUT_CAP) { truncated = true; return; }
    out += `${line}\n`;
    if (out.length > OUTPUT_CAP) { out = out.slice(0, OUTPUT_CAP); truncated = true; }
  };
  let err = '';
  const mp = await load({ stdout: write, stderr: (l) => { err += `${l}\n`; }, linebuffer: true });
  mp.globals.set('_crux_lines', String(input || '').replace(/\r/g, '').split('\n').filter((l, i, all) => i < all.length - 1 || l !== ''));
  mp.runPython(PRELUDE);
  try {
    mp.runPython(String(code || ''));
  } catch (e) {
    return { out, error: readError(e?.message || err || String(e)), truncated, blocked: null };
  }
  return { out, error: null, truncated, blocked: null };
}
