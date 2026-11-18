/**
 * The Hub files desk, laptop side (electron/hub-desk.cjs): names the dumper sorts without guessing, the Drop copy,
 * the dumper's status, retrying a problem. The names are checked against the dumper's own classifier when its
 * repo is next to this one (discord-sync-bot/pc/src/uploader/classify.js).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "node:test";

const require = createRequire(import.meta.url);
const { deskName, dropFiles, status, retry, findHome } = require("../electron/hub-desk.cjs");

it("names: the unit code first, the kind word, the year; nothing the file system refuses", () => {
	assert.equal(deskName({ unit: "emm302", kind: "scheme", year: "2024", title: "CAT 1", ext: ".pdf" }), "EMM 302 CAT 1 Marking Scheme 2024.pdf");
	assert.equal(deskName({ unit: "EMM 302", kind: "paper", year: "2023/24", title: "EMM 302 Final exam", ext: "pdf" }), "EMM 302 Final exam Past Paper 2023-24.pdf");
	assert.equal(deskName({ unit: "ECU 300", kind: "notes", title: 'Topic 3: "Fourier"', ext: ".docx" }), "ECU 300 Topic 3 Fourier Notes.docx");
	assert.equal(deskName({ unit: "EMM 308", kind: "tutorial", title: "Tutorial 4", ext: ".pdf" }), "EMM 308 Tutorial 4.pdf", "the kind word isn't repeated");
	assert.throws(() => deskName({ unit: "", kind: "paper", ext: ".pdf" }), /unit/);
	assert.throws(() => deskName({ unit: "EMM 302", kind: "photo", ext: ".pdf" }), /kind/);
	assert.throws(() => deskName({ unit: "EMM 302", kind: "paper", ext: "" }), /type/);
});

it("the dumper's own classifier reads each kind the desk writes", async () => {
	const file = path.resolve("..", "discord-sync-bot", "pc", "src", "uploader", "classify.js");
	if (!fs.existsSync(file)) return; // the dumper's repo isn't beside this one: nothing to compare with
	const { kindOf } = await import(pathToFileURL(file).href);
	const want: Record<string, string> = { paper: "paper", scheme: "paper", notes: "notes", tutorial: "notes", slides: "slides", book: "book" };
	for (const [kind, expect] of Object.entries(want)) {
		const name = deskName({ unit: "EMM 302", kind, title: kind === "book" ? "Strength of Materials" : "Week 3", ext: kind === "slides" ? ".pptx" : ".pdf" });
		const got = kindOf(name, name);
		assert.equal(typeof got === "string" ? got : got?.kind, expect, `${kind}: ${name}`);
	}
});

it("Drop: copied under its desk name, never over another file; status and retry read the dumper's folders", async () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "hub-dumper-"));
	for (const d of ["Drop", "Done/2026-11", "Problems"]) fs.mkdirSync(path.join(home, d), { recursive: true });
	const src = path.join(home, "scan.pdf");
	fs.writeFileSync(src, "%PDF-1.4 test");
	assert.equal(findHome(home), home);
	const [a] = await dropFiles(home, [{ path: src, unit: "EMM 302", kind: "paper", year: "2024", title: "CAT 1" }]);
	const [b] = await dropFiles(home, [{ path: src, unit: "EMM 302", kind: "paper", year: "2024", title: "CAT 1" }]);
	assert.equal(a.name, "EMM 302 CAT 1 Past Paper 2024.pdf");
	assert.equal(b.name, "EMM 302 CAT 1 Past Paper 2024 (2).pdf");
	assert.match(a.hash, /^[0-9a-f]{64}$/);
	const [bad] = await dropFiles(home, [{ path: path.join(home, "nope.pdf"), unit: "EMM 302", kind: "paper" }]);
	assert.match(bad.error, /can't be read/);
	fs.writeFileSync(path.join(home, "Done/2026-11/old.pdf"), "x");
	fs.writeFileSync(path.join(home, "Problems/broken.pdf"), "x");
	fs.writeFileSync(path.join(home, "Problems/broken.pdf.txt"), "broken.pdf wasn't posted: Discord said 413\r\n");
	const s = status(home);
	assert.deepEqual(s.drop.sort(), ["EMM 302 CAT 1 Past Paper 2024 (2).pdf", "EMM 302 CAT 1 Past Paper 2024.pdf"]);
	assert.equal(s.done[0].name, "old.pdf");
	assert.deepEqual(s.problems, [{ name: "broken.pdf", why: "Discord said 413" }]);
	assert.equal(retry(home, "broken.pdf").name, "broken.pdf");
	assert.equal(fs.existsSync(path.join(home, "Problems/broken.pdf.txt")), false);
	assert.throws(() => retry(home, "../../etc/passwd"), /isn't in Problems/);
	await assert.rejects(dropFiles(null, []), /Hub Dumper folder isn't on this computer/);
});

it("Share: the kind word and year go into the student's file name, once", async () => {
	const { shareName } = await import("../components/crux-study");
	assert.equal(shareName("cat_1.pdf", "scheme", "2024"), "cat 1 Marking Scheme 2024.pdf");
	assert.equal(shareName("Tutorial 4.pdf", "tutorial", ""), "Tutorial 4.pdf");
	assert.equal(shareName("EMM 302 2023 exam.pdf", "paper", "2023"), "EMM 302 2023 exam Past Paper.pdf");
	assert.equal(shareName("notes", "notes", "soon"), "notes");
});

it("G0: the window reaches only listed Crux web paths, with their methods and a plain query", () => {
	const { webTarget } = require("../electron/crux-hub.cjs");
	assert.equal(webTarget("GET", "/api/hub/desk"), "/api/hub/desk");
	assert.equal(webTarget("GET", "/api/hub/has?hash=ab12"), "/api/hub/has?hash=ab12");
	assert.equal(webTarget("POST", "/api/hub/sort"), "/api/hub/sort");
	for (const [m, p] of [["GET", "/api/keys"], ["DELETE", "/api/learner"], ["POST", "/api/hub/desk"], ["GET", "/api/../api/state"], ["GET", "/api/hub/desk?x=1;rm"], ["GET", "https://evil.example/api/state"], ["GET", "/api/state#x"]])
		assert.equal(webTarget(m, p), null, `${m} ${p}`);
});
