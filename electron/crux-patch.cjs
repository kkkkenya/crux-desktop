/**
 * Crux Harness updates without an installer (owner, 2026-11-15).
 *
 * Most releases change only the app's server (pages, tutor prompts, Crux features), not the window shell. Such a
 * release ships a zip of the server (`standalone/…`) beside the installer. latest.json on Crux web names it:
 *   { version, url, notes, patch: { version, url, sha256, size, shell } }
 * `shell` is the installed app version the server was built against. "Update now" downloads the zip, checks its
 * size and SHA-256, unpacks it into userData/server-patch/<version>/, marks it active, and restarts. The app then
 * starts the server from there. A patch that does not start is switched off and the installed server is used again.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const RELEASE_DOWNLOADS = "https://github.com/kkkkenya/crux-desktop/releases/download/";
const MAX_BYTES = 400 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+$/;

const root = (userData) => path.join(userData, "server-patch");
const activeFile = (userData) => path.join(root(userData), "active.json");

/** -1, 0 or 1, comparing "1.2.3" versions. */
function compareVersions(a, b) {
	const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
	return 0;
}

/** The patch in use: { version, dir, entry } when one is active, built for this shell, newer than it, and complete. */
function activePatch(userData, shellVersion) {
	let a;
	try { a = JSON.parse(fs.readFileSync(activeFile(userData), "utf8")); } catch { return null; }
	if (!a || !VERSION.test(a.version) || a.shell !== shellVersion || compareVersions(a.version, shellVersion) <= 0) return null;
	const dir = path.join(root(userData), a.version, "standalone");
	const entry = path.join(dir, "server.js");
	return fs.existsSync(entry) ? { version: a.version, dir, entry } : null;
}

/** The version the student is running: the active patch's, else the installed app's. */
function currentVersion(userData, shellVersion) {
	return activePatch(userData, shellVersion)?.version ?? shellVersion;
}

/** Stop using the patch (it failed to start); the files stay for a look but are never loaded again. */
function disablePatch(userData) {
	try { fs.renameSync(activeFile(userData), path.join(root(userData), `failed-${Date.now()}.json`)); } catch { /* none active */ }
}

/** latest.json's patch, when it can be applied to this shell: same shell version, newer than what runs now. */
function usablePatch(latest, shellVersion, running) {
	const p = latest?.patch;
	if (!p || typeof p !== "object") return null;
	if (!VERSION.test(p.version) || p.shell !== shellVersion || compareVersions(p.version, running) <= 0) return null;
	if (typeof p.url !== "string" || !p.url.startsWith(RELEASE_DOWNLOADS) || !p.url.endsWith(".zip")) return null;
	if (!/^[0-9a-f]{64}$/i.test(String(p.sha256 || "")) || !Number.isInteger(p.size) || p.size <= 0 || p.size > MAX_BYTES) return null;
	return { version: p.version, url: p.url, sha256: p.sha256.toLowerCase(), size: p.size, shell: p.shell };
}

/** Windows' own tar (bsdtar) reads zip files; Git's GNU tar on PATH does not. */
function unzip(zipFile, into) {
	const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
	const r = spawnSync(tar, ["-xf", zipFile, "-C", into], { stdio: "ignore", windowsHide: true });
	if (r.status !== 0) throw new Error(`unpacking failed (tar ${r.status})`);
}

/**
 * Download, check and unpack a patch, then mark it active. Returns { version }. Throws a plain Error with a message
 * a student can read. fetcher: the global fetch, or a fake in tests.
 */
async function applyPatch(patch, { userData, shellVersion, fetcher = fetch }) {
	const p = usablePatch({ patch }, shellVersion, currentVersion(userData, shellVersion));
	if (!p) throw new Error("This update can't be installed from inside the app. Download the installer instead.");
	let response;
	try { response = await fetcher(p.url, { redirect: "follow" }); } catch { throw new Error("The download failed. Check your connection and try again."); }
	if (!response.ok) throw new Error(`The download failed (${response.status}).`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length !== p.size) throw new Error("The download was incomplete. Try again.");
	if (crypto.createHash("sha256").update(bytes).digest("hex") !== p.sha256) throw new Error("The download didn't match the release. Try again.");

	fs.mkdirSync(root(userData), { recursive: true });
	const work = fs.mkdtempSync(path.join(root(userData), "incoming-"));
	try {
		const zip = path.join(work, "server.zip");
		fs.writeFileSync(zip, bytes);
		unzip(zip, work);
		if (!fs.existsSync(path.join(work, "standalone", "server.js"))) throw new Error("The update is missing its server.");
		const target = path.join(root(userData), p.version);
		fs.rmSync(target, { recursive: true, force: true });
		fs.mkdirSync(target, { recursive: true });
		fs.renameSync(path.join(work, "standalone"), path.join(target, "standalone"));
		fs.writeFileSync(activeFile(userData), JSON.stringify({ version: p.version, shell: p.shell, at: new Date().toISOString() }));
	} finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
	cleanOld(userData, p.version); // the running patch's files are locked until restart; the next start finishes the job
	return { version: p.version };
}

/** Remove patch folders other than `keep` (and unpacking leftovers). Best effort: files in use stay until next time. */
function cleanOld(userData, keep) {
	let names = [];
	try { names = fs.readdirSync(root(userData)); } catch { return; }
	for (const name of names) {
		if ((VERSION.test(name) && name !== keep) || name.startsWith("incoming-")) {
			try { fs.rmSync(path.join(root(userData), name), { recursive: true, force: true }); } catch { /* in use */ }
		}
	}
}

module.exports = { RELEASE_DOWNLOADS, activePatch, applyPatch, cleanOld, compareVersions, currentVersion, disablePatch, usablePatch };
