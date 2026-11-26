import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { it } from "node:test";

const { pastedFileName, MAX_PASTE_BYTES } = createRequire(import.meta.url)("../electron/pasted-files.cjs");
const NOW = new Date("2026-11-26T08:15:30.000Z");

it("a screenshot with no name gets a dated png name from its type", () => {
	assert.equal(pastedFileName("", "image/png", NOW), "2026-11-26T08-15-30-pasted.png");
});

it("keeps the base name and extension, drops path pieces and unsafe characters", () => {
	assert.equal(pastedFileName("C:\\Users\\x\\Past <Paper>?.PDF", "application/pdf", NOW), "2026-11-26T08-15-30-Past Paper.pdf");
	assert.equal(pastedFileName("../../etc/notes.md", "text/markdown", NOW), "2026-11-26T08-15-30-notes.md");
});

it("an unknown type falls back to .bin, and the size cap is 25 MB", () => {
	assert.equal(pastedFileName("blob", "application/x-weird", NOW), "2026-11-26T08-15-30-blob.bin");
	assert.equal(MAX_PASTE_BYTES, 25 * 1024 * 1024);
});
