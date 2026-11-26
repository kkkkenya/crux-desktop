import assert from "node:assert/strict";
import { it } from "node:test";
import {
	checkChosenFiles,
	describeChosenFiles,
	fileExtension,
	fileTypeLabel,
	naturalCompare,
	parseSortMode,
	sortFiles,
} from "../lib/file-list.ts";

const DOCS = /\.(?:md|markdown|txt|pdf)$/i;

it("natural compare puts CAT 2 before CAT 10 and ignores case", () => {
	const names = ["CAT 10.pdf", "cat 2.pdf", "CAT 1.pdf"];
	assert.deepEqual([...names].sort(naturalCompare), ["CAT 1.pdf", "cat 2.pdf", "CAT 10.pdf"]);
	assert.equal(naturalCompare("CAT 2", "CAT 10") < 0, true);
	assert.equal(naturalCompare("same", "same"), 0);
});

it("sortFiles by name is natural and does not mutate the input", () => {
	const input = [{ name: "Week 10.md" }, { name: "Week 9.md" }, { name: "Week 1.md" }];
	const out = sortFiles(input, "name").map((f) => f.name);
	assert.deepEqual(out, ["Week 1.md", "Week 9.md", "Week 10.md"]);
	assert.equal(input[0]?.name, "Week 10.md");
});

it("sortFiles by kind groups papers first, then natural name", () => {
	const out = sortFiles([
		{ name: "Notes 10.pdf", paper: false },
		{ name: "Paper 2.pdf", paper: true },
		{ name: "Notes 2.pdf", paper: false },
		{ name: "Paper 10.pdf", paper: true },
	], "kind").map((f) => f.name);
	assert.deepEqual(out, ["Paper 2.pdf", "Paper 10.pdf", "Notes 2.pdf", "Notes 10.pdf"]);
});

it("sortFiles by saved puts files already on this computer first", () => {
	const out = sortFiles([
		{ name: "Week 10.pdf", saved: false },
		{ name: "Week 2.pdf", saved: true },
		{ name: "Week 1.pdf", saved: false },
		{ name: "Week 9.pdf", saved: true },
	], "saved").map((f) => f.name);
	assert.deepEqual(out, ["Week 2.pdf", "Week 9.pdf", "Week 1.pdf", "Week 10.pdf"]);
});

it("sortFiles by recent puts the newest first and undated files last", () => {
	const out = sortFiles([
		{ name: "a.pdf", addedAt: "2026-11-01T10:00:00Z" },
		{ name: "b.pdf", addedAt: null },
		{ name: "c.pdf", addedAt: "2026-11-20T10:00:00Z" },
		{ name: "d.pdf", addedAt: "not a date" },
	], "recent").map((f) => f.name);
	assert.deepEqual(out, ["c.pdf", "a.pdf", "b.pdf", "d.pdf"]);
});

it("parseSortMode accepts known modes and falls back for anything else", () => {
	assert.equal(parseSortMode("kind"), "kind");
	assert.equal(parseSortMode("recent"), "recent");
	assert.equal(parseSortMode("saved"), "saved");
	assert.equal(parseSortMode("bogus"), "name");
	assert.equal(parseSortMode(null, "recent"), "recent");
	assert.equal(parseSortMode(42), "name");
});

it("extension and type labels", () => {
	assert.equal(fileExtension("Exam.PDF"), "pdf");
	assert.equal(fileExtension("README"), "");
	assert.equal(fileExtension(".hidden"), "");
	assert.equal(fileTypeLabel("notes.md"), "MD");
	assert.equal(fileTypeLabel("noext"), "File");
});

it("checkChosenFiles accepts, flags duplicates and rejects unsupported types with a reason", () => {
	const existing = [{ name: "Notes.pdf" }];
	const incoming = [{ name: "notes.PDF" }, { name: "Photo.png" }, { name: "Week 2.md" }, { name: "Week 2.md" }, { name: "Scan.docx" }];
	const check = checkChosenFiles(existing, incoming, DOCS, ".md, .txt or .pdf");
	assert.deepEqual(check.accepted.map((f) => f.name), ["Week 2.md"]);
	assert.deepEqual(check.duplicates, ["notes.PDF", "Week 2.md"]);
	assert.deepEqual(check.rejected.map((r) => r.name), ["Photo.png", "Scan.docx"]);
	assert.match(check.rejected[0]?.reason ?? "", /PNG files can't be used here\. Use \.md, \.txt or \.pdf\./);
});

it("describeChosenFiles summarises a batch in one line", () => {
	assert.equal(describeChosenFiles({ accepted: [{ name: "a" }], duplicates: [], rejected: [] }), "Added 1 file.");
	assert.equal(describeChosenFiles({ accepted: [], duplicates: ["a"], rejected: [] }), "1 already chosen, skipped.");
	assert.equal(
		describeChosenFiles({ accepted: [{ name: "a" }, { name: "b" }], duplicates: ["c"], rejected: [{ name: "x.png", reason: "PNG files can't be used here." }] }),
		"Added 2 files. 1 already chosen, skipped. PNG files can't be used here.",
	);
	assert.equal(describeChosenFiles({ accepted: [], duplicates: [], rejected: [] }), "");
});
