/**
 * In-app updates (electron/crux-patch.cjs, owner 2026-11-15): a server zip named in latest.json is checked (size,
 * SHA-256, release link, shell version), unpacked into userData/server-patch/<version>, and used on the next start.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const patcher = require("../electron/crux-patch.cjs");

const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
const zipAvailable = process.platform !== "win32" || fs.existsSync(tar);

function makeZip(withServer = true) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crux-patch-src-"));
	fs.mkdirSync(path.join(dir, "standalone", "src"), { recursive: true });
	if (withServer) fs.writeFileSync(path.join(dir, "standalone", "server.js"), "console.log('patched')\n");
	fs.writeFileSync(path.join(dir, "standalone", "src", "prompt.md"), "new tutor rule\n");
	const zip = path.join(dir, "server.zip");
	const r = spawnSync(tar, ["-a", "-c", "-f", zip, "-C", dir, "standalone"]);
	assert.equal(r.status, 0, "tar could not make the zip");
	return fs.readFileSync(zip);
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const URL0 = `${patcher.RELEASE_DOWNLOADS}v0.6.4/crux-harness-server-0.6.4.zip`;
const fake = (bytes: Buffer) => async () => new Response(new Uint8Array(bytes), { status: 200 });
const userData = () => fs.mkdtempSync(path.join(os.tmpdir(), "crux-patch-user-"));

describe("crux-patch", () => {
	it("compares versions", () => {
		assert.equal(patcher.compareVersions("0.6.10", "0.6.9"), 1);
		assert.equal(patcher.compareVersions("0.6.3", "0.6.3"), 0);
		assert.equal(patcher.compareVersions("0.5.9", "0.6.0"), -1);
	});

	it("only offers a patch built for this shell, newer than what runs, from a Crux release, with a hash", () => {
		const good = { version: "0.6.4", url: URL0, sha256: "a".repeat(64), size: 10, shell: "0.6.3" };
		assert.ok(patcher.usablePatch({ patch: good }, "0.6.3", "0.6.3"));
		assert.equal(patcher.usablePatch({ patch: { ...good, shell: "0.6.2" } }, "0.6.3", "0.6.3"), null);
		assert.equal(patcher.usablePatch({ patch: good }, "0.6.3", "0.6.4"), null);
		assert.equal(patcher.usablePatch({ patch: { ...good, url: "https://example.com/x.zip" } }, "0.6.3", "0.6.3"), null);
		assert.equal(patcher.usablePatch({ patch: { ...good, sha256: "nope" } }, "0.6.3", "0.6.3"), null);
		assert.equal(patcher.usablePatch({}, "0.6.3", "0.6.3"), null);
	});

	it("installs a good zip and starts from it; the version shown is the patch's", { skip: !zipAvailable }, async () => {
		const bytes = makeZip();
		const dir = userData();
		const done = await patcher.applyPatch({ version: "0.6.4", url: URL0, sha256: sha(bytes), size: bytes.length, shell: "0.6.3" }, { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) });
		assert.equal(done.version, "0.6.4");
		const active = patcher.activePatch(dir, "0.6.3");
		assert.ok(active && fs.existsSync(active.entry));
		assert.equal(patcher.currentVersion(dir, "0.6.3"), "0.6.4");
		// a newer full install (shell 0.6.5) ignores the old patch
		assert.equal(patcher.activePatch(dir, "0.6.5"), null);
		assert.equal(patcher.currentVersion(dir, "0.6.5"), "0.6.5");
		// a patch that fails to start is switched off
		patcher.disablePatch(dir);
		assert.equal(patcher.activePatch(dir, "0.6.3"), null);
	});

	it("refuses a download that is the wrong size, the wrong hash, or has no server", { skip: !zipAvailable }, async () => {
		const bytes = makeZip();
		const dir = userData();
		const patch = { version: "0.6.4", url: URL0, sha256: sha(bytes), size: bytes.length, shell: "0.6.3" };
		await assert.rejects(patcher.applyPatch({ ...patch, size: bytes.length + 1 }, { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) }), /incomplete/);
		await assert.rejects(patcher.applyPatch({ ...patch, sha256: "b".repeat(64) }, { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) }), /didn't match/);
		const empty = makeZip(false);
		await assert.rejects(patcher.applyPatch({ ...patch, sha256: sha(empty), size: empty.length }, { userData: dir, shellVersion: "0.6.3", fetcher: fake(empty) }), /missing its server/);
		assert.equal(patcher.activePatch(dir, "0.6.3"), null);
		assert.ok(!fs.readdirSync(path.join(dir, "server-patch")).some((n) => n.startsWith("incoming-")), "no unpacking leftovers");
	});

	it("an older patch folder is removed once a newer one is in", { skip: !zipAvailable }, async () => {
		const bytes = makeZip();
		const dir = userData();
		await patcher.applyPatch({ version: "0.6.4", url: URL0, sha256: sha(bytes), size: bytes.length, shell: "0.6.3" }, { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) });
		const url5 = URL0.replace(/0\.6\.4/g, "0.6.5");
		await patcher.applyPatch({ version: "0.6.5", url: url5, sha256: sha(bytes), size: bytes.length, shell: "0.6.3" }, { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) });
		assert.equal(patcher.currentVersion(dir, "0.6.3"), "0.6.5");
		assert.ok(!fs.existsSync(path.join(dir, "server-patch", "0.6.4")));
	});
});
