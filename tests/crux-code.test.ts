/**
 * Code cells in Crux Harness (components/crux-code.tsx): the engines are served as plain files from public/engines
 * (copies of Crux web's tested runners). These must match lib/code, and SQL must run end to end.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { it } from "node:test";
import { runSql, sameResult } from "../lib/code/sql-run.js";
import { languageOf } from "../lib/code/code-check.js";

it("the worker's copy of the SQL runner is the tested one, and every engine file is there", () => {
	assert.equal(fs.readFileSync("public/engines/sql-run.js", "utf8"), fs.readFileSync("lib/code/sql-run.js", "utf8"));
	for (const f of ["code-worker.js", "py-run.js", "js-run.js", "micropython.mjs", "micropython.wasm", "sql-wasm.js", "sql-wasm.wasm"]) assert.ok(fs.existsSync(`public/engines/${f}`), f);
});

it("SQL runs on a fresh database and results compare by rows", async () => {
	const req = createRequire(import.meta.url);
	const initSqlJs = req("sql.js") as (o: { locateFile: (f: string) => string }) => Promise<unknown>; // sql.js ships no types
	const SQL = await initSqlJs({ locateFile: (f) => req.resolve(`sql.js/dist/${f}`) });
	const r = runSql(SQL, "CREATE TABLE t (n INT); INSERT INTO t VALUES (2), (1); SELECT n FROM t;");
	assert.deepEqual(r.results[0].rows, [[2], [1]]);
	assert.equal(sameResult(r.results[0], { columns: ["x"], rows: [[1], [2]] }, false).same, true);
	assert.equal(languageOf("SELECT name FROM students"), "sql");
});
