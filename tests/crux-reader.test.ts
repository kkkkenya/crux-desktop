/**
 * Crux's file viewer (components/crux-reader.tsx): open tabs, the unit a file belongs
 * to, and the bytes the main process hands it (electron/crux-hub.cjs bytes).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { askText, shortName, unitOfPath, withOpened, type ReaderTab } from "../components/crux-reader.tsx";

it("Ask the tutor quotes the passage with its file and page, then leaves room for the question", () => {
	assert.equal(askText("Take E = 200 GPa.\r\nFind the stress.", { name: "KU EMM 302 TUT 2 [3416].pdf", kind: "pdf", page: 3 }),
		"About this passage from KU EMM 302 TUT 2, page 3:\n> Take E = 200 GPa.\n> Find the stress.\n\n");
	assert.equal(askText("  d = 58.8 mm ", { name: "CAT 1 marking scheme.html", kind: "html", page: 1 }),
		"About this passage from CAT 1 marking scheme:\n> d = 58.8 mm\n\n");
});

const require = createRequire(import.meta.url);
const { createCruxHub } = require("../electron/crux-hub.cjs");
const { withPolicy } = require("../electron/solution-page.cjs");

it("a file's unit comes from its Hub folder; names lose the hub id and extension", () => {
	assert.equal(unitOfPath("C:\\Users\\a\\OneDrive\\Documents\\Crux\\Hub\\EMM 302\\Solutions\\CAT 1.html"), "EMM 302");
	assert.equal(unitOfPath("/home/a/Documents/Crux/Hub/ECU 300/notes [4].pdf"), "ECU 300");
	assert.equal(unitOfPath("C:\\Downloads\\x.pdf"), null);
	assert.equal(unitOfPath("C:\\Crux\\Hub\\not a unit\\x.pdf"), null);
	assert.equal(shortName("EMM 302 notes [12].pdf"), "EMM 302 notes");
	assert.equal(shortName("Strength_of_Materials.pdf"), "Strength of Materials");
});

it("opening a file puts its tab first, never twice, eight at most", () => {
	const tab = (n: number): ReaderTab => ({ path: `p${n}`, name: `f${n}.pdf`, kind: "pdf", page: 1 });
	const tabs = [1, 2, 3, 4, 5, 6, 7, 8].map(tab);
	assert.deepEqual(withOpened(tabs, { ...tab(3), page: 9 }).map((t) => [t.path, t.page]).slice(0, 3), [["p3", 9], ["p1", 1], ["p2", 1]]);
	assert.equal(withOpened(tabs, tab(3)).length, 8);
	const more = withOpened(tabs, tab(9));
	assert.equal(more.length, 8);
	assert.equal(more[0]!.path, "p9");
	assert.ok(!more.some((t) => t.path === "p8"), "the oldest tab drops off");
});

it("schemes: the hub's list with bad rows dropped, pages made for the student, and asking for a missing one", async () => {
	const documents = fs.mkdtempSync(path.join(os.tmpdir(), "crux-schemes-"));
	try {
		const unit = path.join(documents, "Crux", "Hub", "EMM 302", "Solutions");
		fs.mkdirSync(unit, { recursive: true });
		fs.writeFileSync(path.join(unit, "CAT 2 marking scheme.html"), withPolicy("<!DOCTYPE html><html><head><title>x</title></head><body></body></html>"));
		const calls: { path: string; method: string; body: string | undefined }[] = [];
		const hub = createCruxHub({
			app: { getPath: () => documents }, BrowserWindow: class {}, shell: {},
			session: { fromPartition: () => ({ fetch: async (url: string, init: { method?: string; body?: string }) => {
				const { pathname, search } = new URL(url);
				calls.push({ path: pathname + search, method: init?.method ?? "GET", body: init?.body });
				if (pathname === "/api/schemes") return new Response(JSON.stringify({ note: null, schemes: [{ id: 3691, name: "EMM 302 CAT 1 Marking Scheme.pdf", paper: null }, { id: "x", name: "bad" }], missing: [{ id: "1787", name: "EMM302_CAT_1.pdf" }] }), { status: 200 });
				if (pathname === "/api/schemes/ask") return new Response(JSON.stringify({ asked: true, sent: true }), { status: 200 });
				return new Response("{}", { status: 404 });
			} }) },
		});
		const list = await hub.schemes("EMM 302");
		assert.deepEqual(list.schemes, [{ id: "3691", name: "EMM 302 CAT 1 Marking Scheme.pdf", paper: null }]);
		assert.deepEqual(list.missing, [{ id: "1787", name: "EMM302_CAT_1.pdf" }]);
		assert.deepEqual(list.saved.map((f: { name: string }) => f.name), ["CAT 2 marking scheme.html"]);
		assert.equal(calls[0]!.path, "/api/schemes?unit=EMM%20302");
		assert.deepEqual(await hub.askScheme("EMM 302", "1787"), { asked: true });
		assert.deepEqual([calls[1]!.path, calls[1]!.method, JSON.parse(calls[1]!.body!)], ["/api/schemes/ask", "POST", { unit: "EMM 302", paperId: "1787" }]);
		await assert.rejects(hub.schemes("../x"), /Pick a unit/);
		await assert.rejects(hub.askScheme("EMM 302", "not-an-id"), /Pick a paper/);
	} finally {
		fs.rmSync(documents, { recursive: true, force: true });
	}
});

it("bytes: only PDFs and pages inside the Hub folder; a page Crux did not save is marked not safe", () => {
	const documents = fs.mkdtempSync(path.join(os.tmpdir(), "crux-bytes-"));
	try {
		const unit = path.join(documents, "Crux", "Hub", "EMM 302");
		fs.mkdirSync(path.join(unit, "Solutions"), { recursive: true });
		const page = "<!DOCTYPE html><html><head><title>CAT 1</title></head><body><svg class=\"fig\"></svg></body></html>";
		fs.writeFileSync(path.join(unit, "notes [3].pdf"), "%PDF-1.7 test");
		fs.writeFileSync(path.join(unit, "Solutions", "CAT 1.html"), withPolicy(page));
		fs.writeFileSync(path.join(unit, "other.html"), page);
		fs.writeFileSync(path.join(unit, "run.bat"), "echo");
		fs.writeFileSync(path.join(documents, "outside.pdf"), "%PDF-");
		const hub = createCruxHub({
			app: { getPath: () => documents }, BrowserWindow: class {}, shell: {},
			session: { fromPartition: () => ({ fetch: async () => new Response("{}", { status: 404 }) }) },
		});
		const pdf = hub.bytes(path.join(unit, "notes [3].pdf"));
		assert.equal(pdf.kind, "pdf");
		assert.equal(pdf.safe, true);
		assert.equal(Buffer.from(pdf.bytes).toString(), "%PDF-1.7 test");
		assert.deepEqual([hub.bytes(path.join(unit, "Solutions", "CAT 1.html")).safe, hub.bytes(path.join(unit, "other.html")).safe], [true, false]);
		assert.throws(() => hub.bytes(path.join(unit, "run.bat")), /isn't in the Hub folder/);
		assert.throws(() => hub.bytes(path.join(documents, "outside.pdf")), /isn't in the Hub folder/);
		assert.throws(() => hub.bytes(path.join(unit, "..", "..", "..", "outside.pdf")), /isn't in the Hub folder/);
	} finally {
		fs.rmSync(documents, { recursive: true, force: true });
	}
});
