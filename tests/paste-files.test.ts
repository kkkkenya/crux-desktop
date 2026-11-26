import assert from "node:assert/strict";
import { it } from "node:test";
import { pastedFilePaths } from "../lib/paste-files.ts";

it("a file with a local path is added by that path, like the attach button", async () => {
	const file = new File(["x"], "Paper.pdf", { type: "application/pdf" });
	const out = await pastedFilePaths([file], { getPathForFile: () => "/home/me/Paper.pdf" });
	assert.deepEqual(out, { paths: ["/home/me/Paper.pdf"], problems: [] });
});

it("a screenshot with no path is saved and its saved path is used", async () => {
	const shot = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
	const seen: { name: string; mime: string; bytes: Uint8Array }[] = [];
	const out = await pastedFilePaths([shot], {
		getPathForFile: () => "",
		saveAttachmentPaste: async (payload) => { seen.push(payload); return "/home/me/Documents/Crux/Pasted/shot.png"; },
	});
	assert.deepEqual(out.paths, ["/home/me/Documents/Crux/Pasted/shot.png"]);
	assert.equal(seen[0]?.mime, "image/png");
	assert.deepEqual([...(seen[0]?.bytes ?? [])], [1, 2, 3]);
});

it("reports a clear reason in the browser and for a save that fails", async () => {
	const file = new File(["x"], "a.pdf", { type: "application/pdf" });
	const browser = await pastedFilePaths([file], undefined);
	assert.deepEqual(browser.paths, []);
	assert.match(browser.problems[0] ?? "", /desktop app/);
	const failed = await pastedFilePaths([file], { getPathForFile: () => "", saveAttachmentPaste: async () => { throw new Error("Disk full."); } });
	assert.match(failed.problems[0] ?? "", /a\.pdf could not be attached: Disk full\./);
});
