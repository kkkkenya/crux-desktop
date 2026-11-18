// Crux Harness code cells (same engines as Crux web, fixplan-g G6): Python (MicroPython), SQL (SQLite), JavaScript.
// Served as plain files from /engines so the app's bundler never touches the engines; one run per worker, ended by
// the page after 3 s. Each engine loads only the first time its language runs.
self.onmessage = async ({ data }) => {
  try {
    if (data.lang === 'sql') {
      if (!self.initSqlJs) importScripts('/engines/sql-wasm.js');
      const SQL = await self.initSqlJs({ locateFile: () => '/engines/sql-wasm.wasm' });
      const { runSql } = await import('/engines/sql-run.js');
      self.postMessage({ ok: true, result: runSql(SQL, data.code, data.setup || '') });
      return;
    }
    if (data.lang === 'js') {
      const { runJs } = await import('/engines/js-run.js');
      self.postMessage({ ok: true, result: runJs(data.code, data.input) });
      return;
    }
    const [{ loadMicroPython }, { runPython }] = await Promise.all([import('/engines/micropython.mjs'), import('/engines/py-run.js')]);
    self.postMessage({ ok: true, result: await runPython((opts) => loadMicroPython({ ...opts, url: '/engines/micropython.wasm' }), data.code, data.input) });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.message || e) });
  }
};
