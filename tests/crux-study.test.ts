/**
 * Crux study setup, notes and "open in book" (electron/crux-hub.cjs), against a
 * fake Crux API that records each call's method and body. No network, no Electron.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { notesFor, pagesText } from "../components/crux-study.tsx";

const require = createRequire(import.meta.url);
const { createCruxHub, cruxControl } = require("../electron/crux-hub.cjs");

type Route = { status: number; body?: unknown };
type Call = { method: string; path: string; body: unknown };
let dir: string;
let routes: Record<string, Route>;
let calls: Call[];
let windows: { options: Record<string, any>; url: string }[];
let opened: string[];
const realFetch = globalThis.fetch;

function hub() {
	return createCruxHub({
		app: { getPath: () => dir },
		BrowserWindow: class {
			options: Record<string, any>;
			record: { options: Record<string, any>; url: string };
			webContents = { on: () => {}, setWindowOpenHandler: () => {} };
			constructor(options: Record<string, any>) { this.options = options; this.record = { options, url: "" }; windows.push(this.record); }
			on() {}
			isDestroyed() { return false; }
			focus() {}
			loadURL(url: string) { this.record.url = url; return Promise.resolve(); }
		},
		session: {
			fromPartition: () => ({
				fetch: async (url: string, init: { method?: string; body?: string } = {}) => {
					const { pathname, search } = new URL(url);
					calls.push({ method: init.method ?? "GET", path: pathname + search, body: init.body ? JSON.parse(init.body) : undefined });
					const route = routes[`${init.method ?? "GET"} ${pathname}`] ?? { status: 404, body: { error: "no such endpoint" } };
					return new Response(route.body === undefined ? "not json" : JSON.stringify(route.body), { status: route.status });
				},
				clearStorageData: async () => {},
			}),
		},
		shell: { showItemInFolder: () => {}, openExternal: async () => {}, openPath: async (p: string) => { opened.push(p); return ""; } },
	});
}

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "crux-study-"));
	routes = {}; calls = []; windows = []; opened = [];
});
afterEach(() => {
	globalThis.fetch = realFetch;
	fs.rmSync(dir, { recursive: true, force: true });
});

const STATE = {
	settings: { cohort: { course: "EMM", year: 3, sem: 1 } },
	data: {
		units: [{ code: "EMM 305", title: "Machine Design", catDate: "2026-12-01", confidence: 3 }],
		topics: [{ id: "t1", unit: "EMM 305", name: "Gears", extra: true }, { id: 7, unit: "EMM 305", name: "bad id" }],
		stickies: [{ id: "n1", text: "Module = d/N", unit: "EMM 305", from: "Lesson", at: "2026-11-12T10:00:00Z" }],
	},
};

it("study: units, topics and notes from the Crux document, only the fields the panel needs", async () => {
	routes["GET /api/state"] = { status: 200, body: STATE };
	const s = await hub().study();
	assert.deepEqual(s.units, [{ code: "EMM 305", title: "Machine Design", catDate: "2026-12-01" }]);
	assert.deepEqual(s.topics, [{ id: "t1", unit: "EMM 305", name: "Gears" }], "a topic without a string id is dropped");
	assert.deepEqual(s.notes, [{ id: "n1", text: "Module = d/N", unit: "EMM 305", from: "Lesson", at: "2026-11-12T10:00:00Z" }]);
	assert.deepEqual(s.cohort, { course: "EMM", year: 3, sem: 1 });
	assert.equal(s.setupSkipped, false);
});

it("skipSetup is remembered on this computer, and saving a setup clears it", async () => {
	routes["GET /api/state"] = { status: 200, body: STATE };
	routes["POST /api/settings"] = { status: 200, body: {} };
	routes["PUT /api/units"] = { status: 200, body: {} };
	const h = hub();
	h.skipSetup();
	assert.equal((await h.study()).setupSkipped, true);
	await h.saveSetup({ cohort: { course: "EMM", year: 3, sem: 1 }, units: [{ code: "EMM 305", title: "Machine Design" }], dates: {} });
	assert.equal((await h.study()).setupSkipped, false);
});

it("saveSetup: cohort, then units, then only the valid CAT dates, in that order", async () => {
	routes["GET /api/state"] = { status: 200, body: STATE };
	routes["POST /api/settings"] = { status: 200, body: {} };
	routes["PUT /api/units"] = { status: 200, body: {} };
	routes["PATCH /api/units"] = { status: 200, body: {} };
	await hub().saveSetup({
		cohort: { course: "EMM", year: 3, sem: 1 },
		units: [{ code: "EMM 305", title: "Machine Design" }, { code: "SMA 301", title: "Stats" }, { code: "<script>", title: "x" }],
		dates: { "EMM 305": "2026-12-01", "SMA 301": "next week" },
	});
	assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
		"POST /api/settings", "PUT /api/units", "PATCH /api/units?code=EMM%20305", "GET /api/state",
	]);
	assert.deepEqual(calls[0]!.body, { cohort: { course: "EMM", year: 3, sem: 1 } });
	assert.deepEqual(calls[1]!.body, [{ code: "EMM 305", title: "Machine Design" }, { code: "SMA 301", title: "Stats" }], "a code that isn't a unit code is dropped");
	assert.deepEqual(calls[2]!.body, { catDate: "2026-12-01" });
});

it("saveSetup refuses a bad cohort or no units without calling Crux", async () => {
	const h = hub();
	await assert.rejects(h.saveSetup({ cohort: { course: "EMM", year: 9, sem: 1 }, units: [{ code: "EMM 305" }] }), /course, a year and a semester/);
	await assert.rejects(h.saveSetup({ cohort: { course: "EMM", year: 3, sem: 1 }, units: [] }), /at least one unit/);
	assert.equal(calls.length, 0);
});

it("addNote and removeNote: trimmed text, a unit only when it is a unit code, and ids checked", async () => {
	routes["POST /api/stickies"] = { status: 200, body: { id: "n2", text: "Pinned", unit: null, from: "Gears lesson", at: "2026-11-12T11:00:00Z" } };
	routes["DELETE /api/stickies/n2"] = { status: 200, body: { removed: true } };
	const h = hub();
	const note = await h.addNote({ text: "  Pinned  ", unit: "not a unit", from: "Gears lesson" });
	assert.deepEqual(calls[0]!.body, { text: "Pinned", unit: null, from: "Gears lesson" });
	assert.equal(note.id, "n2");
	await assert.rejects(h.addNote({ text: "   ", unit: null }), /Write something first/);
	assert.equal(await h.removeNote("n2"), true);
	await assert.rejects(h.removeNote("../units"), /can't be removed/);
	assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["POST /api/stickies", "DELETE /api/stickies/n2"]);
});

it("learn keeps hub files only; makeGuide passes Crux's own refusal through", async () => {
	routes["GET /api/learn"] = { status: 200, body: {
		guide: null,
		read: [{ fileId: 12, name: "Shigley.pdf", pages: [210, 214], snippet: "Spur gears" }, { fileId: "own-1", name: "mine.pdf", pages: null }],
		examples: [], books: [{ id: 12, name: "Shigley.pdf" }, { id: "own-1", name: "mine.pdf" }],
	} };
	const h = hub();
	const p = await h.learn("EMM 305", "t1");
	assert.deepEqual(p.read, [{ fileId: "12", name: "Shigley.pdf", pages: [210, 214], snippet: "Spur gears" }]);
	assert.deepEqual(p.books, [{ id: "12", name: "Shigley.pdf" }]);

	routes["POST /api/learn/guide"] = { status: 429, body: { error: "Today's AI limit is used. Take this pack to any AI." } };
	const reply = await cruxControl({ op: "makeGuide", unit: "EMM 305", topicId: "t1" }, h, null);
	assert.equal(reply.ok, false);
	assert.match(reply.error, /AI limit is used/);
	routes["POST /api/learn/guide"] = { status: 400, body: { error: "Add some topics first." } };
	assert.match((await cruxControl({ op: "makeGuide", unit: "EMM 305", topicId: "t1" }, h, null)).error, /Add some topics first/);
});

it("openAt: a PDF opens in a Crux reader window at the page; other files in their own app", async () => {
	globalThis.fetch = (async () => new Response("BYTES", { status: 200 })) as typeof fetch;
	routes["GET /api/files/12/download"] = { status: 200, body: { url: "https://cdn.discordapp.com/attachments/1/2/Shigley.pdf", left: 4 } };
	routes["GET /api/files/13/download"] = { status: 200, body: { url: "https://cdn.discordapp.com/attachments/1/3/notes.docx", left: 3 } };
	const h = hub();
	const pdf = await h.openAt("EMM 305", "12", "Shigley.pdf", 212);
	assert.equal(windows.length, 1);
	assert.equal(windows[0]!.options.webPreferences.plugins, true);
	assert.equal(windows[0]!.options.webPreferences.nodeIntegration, false);
	assert.match(windows[0]!.url, /^file:\/\/.*Shigley%20%5B12%5D\.pdf#page=212$/);
	assert.ok(fs.existsSync(pdf.path));
	await h.openAt("EMM 305", "12", "Shigley.pdf", 5);
	assert.equal(windows.length, 1, "the same book reuses its reader window");
	assert.match(windows[0]!.url, /#page=5$/);
	await h.openAt("EMM 305", "13", "notes.docx", null);
	assert.equal(opened.length, 1);
	assert.match(opened[0]!, /notes \[13\]\.docx$/);
	assert.equal(calls.filter((c) => c.path === "/api/files/12/download").length, 1, "a book is downloaded once");
});

it("unknown commands are refused", async () => {
	const reply = await cruxControl({ op: "deleteEverything" }, hub(), null);
	assert.deepEqual(reply, { ok: false, code: "bad-request", error: "Unknown request." });
});

it("notesFor: the unit's notes first, then all-unit notes, newest first; other units hidden", () => {
	const n = (id: string, unit: string | null, at: string) => ({ id, text: id, unit, from: "", at });
	const list = [n("a", null, "2026-11-10"), n("b", "EMM 305", "2026-11-09"), n("c", "EMM 305", "2026-11-11"), n("d", "SMA 301", "2026-11-12")];
	assert.deepEqual(notesFor(list, "EMM 305").map((x) => x.id), ["c", "b", "a"]);
	assert.deepEqual(notesFor(list, null).map((x) => x.id), ["a"]);
});

it("pagesText", () => {
	assert.equal(pagesText(null), "");
	assert.equal(pagesText([12]), "p. 12");
	assert.equal(pagesText([12, 12]), "p. 12");
	assert.equal(pagesText([12, 14]), "pp. 12–14");
});
