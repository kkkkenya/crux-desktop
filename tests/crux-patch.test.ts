/**
 * In-app updates (electron/crux-patch.cjs, owner 2026-11-15): a server zip named in latest.json is checked (release
 * link, size, SHA-256, Ed25519 signature, shell version), unpacked into userData/server-patch/<version>, and used on
 * the next start. Tests sign with a throwaway key.
 */

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const patcher = require("../electron/crux-patch.cjs");
const keys = generateKeyPairSync("ed25519");
patcher.setPublicKeyForTests(keys.publicKey.export({ type: "spki", format: "pem" }));

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
const urlFor = (v: string) => `${patcher.RELEASE_DOWNLOADS}v${v}/crux-harness-server-${v}.zip`;
const signed = (p: Record<string, unknown>) => ({ ...p, sig: sign(null, Buffer.from(patcher.signedText(p)), keys.privateKey).toString("base64") });
const patchFor = (bytes: Buffer, version = "0.6.4", shell = "0.6.3") => signed({ version, url: urlFor(version), sha256: sha(bytes), size: bytes.length, shell });
const fake = (bytes: Buffer) => async () => new Response(new Uint8Array(bytes), { status: 200 });
const userData = () => fs.mkdtempSync(path.join(os.tmpdir(), "crux-patch-user-"));

describe("crux-patch", () => {
	it("compares versions", () => {
		assert.equal(patcher.compareVersions("0.6.10", "0.6.9"), 1);
		assert.equal(patcher.compareVersions("0.6.3", "0.6.3"), 0);
		assert.equal(patcher.compareVersions("0.5.9", "0.6.0"), -1);
	});

	it("only offers a signed patch for this shell, newer than what runs, from this repo's releases", () => {
		const good = signed({ version: "0.6.4", url: urlFor("0.6.4"), sha256: "a".repeat(64), size: 10, shell: "0.6.3" });
		assert.ok(patcher.usablePatch({ patch: good }, "0.6.3", "0.6.3"));
		assert.equal(patcher.usablePatch({ patch: { ...good, shell: "0.6.2" } }, "0.6.3", "0.6.3"), null, "other shell");
		assert.equal(patcher.usablePatch({ patch: good }, "0.6.3", "0.6.4"), null, "not newer");
		assert.equal(patcher.usablePatch({ patch: good }, "0.6.3", "0.6.3", ["0.6.4"]), null, "failed here before");
		assert.equal(patcher.usablePatch({ patch: { ...good, sig: undefined } }, "0.6.3", "0.6.3"), null, "unsigned");
		assert.equal(patcher.usablePatch({ patch: { ...good, sha256: "b".repeat(64) } }, "0.6.3", "0.6.3"), null, "hash changed after signing");
		const other = generateKeyPairSync("ed25519");
		const forged = { ...good, sig: sign(null, Buffer.from(patcher.signedText(good)), other.privateKey).toString("base64") };
		assert.equal(patcher.usablePatch({ patch: forged }, "0.6.3", "0.6.3"), null, "signed with another key");
		assert.equal(patcher.usablePatch({}, "0.6.3", "0.6.3"), null);
	});

	it("release links: only this repo, after normalising", () => {
		assert.equal(patcher.releaseUrl(urlFor("0.6.4")), true);
		assert.equal(patcher.releaseUrl(`${patcher.RELEASE_DOWNLOADS}../../../../evil/repo/releases/download/v1/x.zip`), false);
		assert.equal(patcher.releaseUrl("https://github.com.evil.com/kkkkenya/crux-desktop/releases/download/v1/x.zip"), false);
		assert.equal(patcher.releaseUrl("http://github.com/kkkkenya/crux-desktop/releases/download/v1/x.zip"), false);
		assert.equal(patcher.releaseUrl(`${urlFor("0.6.4")}?x=1`), false);
	});

	it("installs a good zip and starts from it; the version shown is the patch's", { skip: !zipAvailable }, async () => {
		const bytes = makeZip();
		const dir = userData();
		const done = await patcher.applyPatch(patchFor(bytes), { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) });
		assert.equal(done.version, "0.6.4");
		const active = patcher.activePatch(dir, "0.6.3");
		assert.ok(active && fs.existsSync(active.entry));
		assert.equal(patcher.currentVersion(dir, "0.6.3"), "0.6.4");
		// a newer full install (shell 0.6.5) ignores the old patch
		assert.equal(patcher.activePatch(dir, "0.6.5"), null);
		assert.equal(patcher.currentVersion(dir, "0.6.5"), "0.6.5");
	});

	it("a patch that failed to start is switched off and never offered or loaded again", { skip: !zipAvailable }, async () => {
		const bytes = makeZip();
		const dir = userData();
		await patcher.applyPatch(patchFor(bytes), { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) });
		patcher.disablePatch(dir);
		assert.equal(patcher.activePatch(dir, "0.6.3"), null);
		assert.deepEqual(patcher.failedVersions(dir), ["0.6.4"]);
		await assert.rejects(patcher.applyPatch(patchFor(bytes), { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) }), /can't be installed/);
	});

	it("refuses a download that is the wrong size, the wrong bytes, or has no server, and leaves nothing behind", { skip: !zipAvailable }, async () => {
		const bytes = makeZip();
		const dir = userData();
		const p = patchFor(bytes);
		await assert.rejects(patcher.applyPatch(p, { userData: dir, shellVersion: "0.6.3", fetcher: fake(Buffer.concat([bytes, Buffer.from("x")])) }), /incomplete/);
		const swapped = Buffer.from(bytes); const last = swapped.length - 1; swapped.writeUInt8(swapped.readUInt8(last) ^ 1, last);
		await assert.rejects(patcher.applyPatch(p, { userData: dir, shellVersion: "0.6.3", fetcher: fake(swapped) }), /didn't match/);
		const empty = makeZip(false);
		await assert.rejects(patcher.applyPatch(patchFor(empty), { userData: dir, shellVersion: "0.6.3", fetcher: fake(empty) }), /missing its server/);
		assert.equal(patcher.activePatch(dir, "0.6.3"), null);
		assert.ok(!fs.readdirSync(path.join(dir, "server-patch")).some((n) => n.startsWith("incoming-")), "no unpacking leftovers");
	});

	it("an older patch folder is removed once a newer one is in", { skip: !zipAvailable }, async () => {
		const bytes = makeZip();
		const dir = userData();
		await patcher.applyPatch(patchFor(bytes), { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) });
		await patcher.applyPatch(patchFor(bytes, "0.6.5"), { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes) });
		assert.equal(patcher.currentVersion(dir, "0.6.3"), "0.6.5");
		assert.ok(!fs.existsSync(path.join(dir, "server-patch", "0.6.4")));
	});
	it("0.8.0: a patch downloaded in the background waits, survives a start's clean-up, and Restart switches to it", { skip: !zipAvailable }, async () => {
		const bytes = makeZip();
		const dir = userData();
		const done = await patcher.applyPatch(patchFor(bytes), { userData: dir, shellVersion: "0.6.3", fetcher: fake(bytes), activate: false });
		assert.equal(done.version, "0.6.4");
		assert.equal(patcher.activePatch(dir, "0.6.3"), null, "not running yet");
		assert.equal(patcher.currentVersion(dir, "0.6.3"), "0.6.3");
		assert.deepEqual(patcher.stagedPatch(dir, "0.6.3"), { version: "0.6.4", shell: "0.6.3" });
		patcher.cleanOld(dir, undefined); // what every start does
		assert.ok(fs.existsSync(path.join(dir, "server-patch", "0.6.4", "standalone", "server.js")), "the staged folder is kept");
		assert.equal(patcher.stagedPatch(dir, "0.6.5"), null, "another shell ignores it");
		assert.deepEqual(patcher.activateStaged(dir, "0.6.3"), { version: "0.6.4" });
		assert.equal(patcher.currentVersion(dir, "0.6.3"), "0.6.4");
		assert.equal(patcher.stagedPatch(dir, "0.6.3"), null, "used up");
		assert.equal(patcher.activateStaged(dir, "0.6.3"), null);
	});
});
