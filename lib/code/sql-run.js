// Running a student's SQL (fixplan-g G6): SQLite compiled to WebAssembly (sql.js), on the student's own device. A
// fresh database each run: the question's tables first (its CREATE and INSERT lines), then the student's SQL. Pure
// apart from the engine it is given, so the worker and the tests (Node) share it.

export const SQL_ROWS_CAP = 500; // rows shown per result

// The CREATE TABLE and INSERT statements printed in a question, as one script, or ''.
export function tablesFrom(text) {
  const t = String(text || '').replace(/\r/g, '');
  const out = [];
  for (const m of t.matchAll(/\b(CREATE\s+TABLE\b[\s\S]*?\)\s*;|INSERT\s+INTO\b[\s\S]*?\)\s*;)/gi)) out.push(m[1].trim());
  return out.join('\n');
}

// A SQL error's message without SQLite's prefix
const message = (e) => String(e?.message || e).replace(/^Error:\s*/, '');

/**
 * Run SQL on a fresh database. SQL: the sql.js module (initSqlJs's result). setup: the question's tables.
 * Returns { results: [{ columns, rows, truncated }], changes, error: { type, message } | null, setupError }.
 */
export function runSql(SQL, code, setup = '') {
  const db = new SQL.Database();
  try {
    let setupError = null;
    if (setup.trim()) { try { db.run(setup); } catch (e) { setupError = message(e); } }
    let results = [];
    try {
      results = db.exec(String(code || '')).map((r) => ({ columns: r.columns, rows: r.values.slice(0, SQL_ROWS_CAP), truncated: r.values.length > SQL_ROWS_CAP }));
    } catch (e) {
      return { results: [], changes: 0, error: { type: 'SQL error', message: message(e) }, setupError };
    }
    return { results, changes: db.getRowsModified(), error: null, setupError };
  } finally { db.close(); }
}

/** A result as plain text (for the output box and for comparing): a header line, then one line per row. */
export function resultText(r) {
  if (!r) return '';
  return [r.columns.join(' | '), ...r.rows.map((row) => row.map((v) => (v === null ? 'NULL' : String(v))).join(' | '))].join('\n');
}

/**
 * Do two query results hold the same rows? Column names are not compared (an alias is fine); values are compared
 * as text, numbers to about 6 figures. Row order counts only when the query asks for it (ORDER BY).
 */
export function sameResult(got, want, ordered) {
  if (!got || !want) return { same: false, why: !got ? 'Your query returned no table.' : 'The model answer returned no table.' };
  if (got.columns.length !== want.columns.length) return { same: false, why: `You return ${got.columns.length} column${got.columns.length === 1 ? '' : 's'}; the model answer returns ${want.columns.length}.` };
  if (got.rows.length !== want.rows.length) return { same: false, why: `You return ${got.rows.length} row${got.rows.length === 1 ? '' : 's'}; the model answer returns ${want.rows.length}.` };
  const cell = (v) => { if (typeof v === 'number') return String(Number(v.toPrecision(6))); return v === null ? 'NULL' : String(v); };
  const key = (row) => row.map(cell).join('\u0001');
  const a = got.rows.map(key), b = want.rows.map(key);
  if (!ordered) { a.sort(); b.sort(); }
  const i = a.findIndex((x, n) => x !== b[n]);
  if (i < 0) return { same: true, why: '' };
  return { same: false, why: ordered ? `Row ${i + 1} differs, or comes in a different order.` : 'Some rows differ.' };
}
export const ordered = (code) => /\border\s+by\b/i.test(String(code || ''));
