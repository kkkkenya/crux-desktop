/**
 * Crux Harness updates without an installer (owner, 2026-11-15).
 *
 * Most releases change only the app's server (pages, tutor prompts, Crux features), not the window shell. Such a
 * release ships a zip of the server (`standalone/…`) beside the installer. latest.json on Crux web names it:
 *   { version, url, notes, patch: { version, url, sha256, size, shell, sig } }
 * `shell` is the installed app version the server was built against. `sig` is an Ed25519 signature over
 * "crux-harness-patch|<version>|<shell>|<sha256>" made with the release key (kept on the owner's laptop, never in
 * the repo); the app holds only the public key below. So a changed latest.json, a changed release file or a
 * redirect elsewhere can never get code run: the bytes must hash to sha256, and sha256 must carry our signature.
 *
 * "Update now" downloads the zip, checks size, hash and signature, unpacks it into userData/server-patch/<version>/
 * (no links, nothing outside that folder), marks it active, and restarts. The app then starts the server from there.
 * A patch that does not start is switched off, remembered as failed, and never offered again.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const RELEASE_ORIGIN = "https://github.com";
const RELEASE_PATH = "/kkkkenya/crux-desktop/releases/download/";
const RELEASE_DOWNLOADS = RELEASE_ORIGIN + RELEASE_PATH;
const MAX_BYTES = 400 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+$/;
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAp2OiapGUsB/A83fR0sJW75srwjAOI3PHedL8yf1nixc=
-----END PUBLIC KEY-----
`;

let publicKey = PUBLIC_KEY;
/** Tests sign with a throwaway key. */
function setPublicKeyForTests(pem) { publicKey = pem; }

const root = (userData) => path.join(userData, "server-patch");
const activeFile = (userData) => path.join(root(userData), "active.json");
const failedFile = (userData) => path.join(root(userData), "failed.json");

/** What the release key signs for one patch. */
const signedText = (p) => `crux-harness-patch|${p.version}|${p.shell}|${String(p.sha256).toLowerCase()}`;

/** -1, 0 or 1, comparing "1.2.3" versions. */
function compareVersions(a, b) {
	const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
	return 0;
}

function writeAtomic(file, text) {
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, text);
	fs.renameSync(tmp, file);
}

/** Versions that failed to start here: never offered or loaded again. */
function failedVersions(userData) {
	try { const v = JSON.parse(fs.readFileSync(failedFile(userData), "utf8")); return Array.isArray(v) ? v.filter((x) => VERSION.test(x)) : []; } catch { return []; }
}

/** The patch in use: { version, dir, entry } when one is active, built for this shell, newer than it, and complete. */
function activePatch(userData, shellVersion) {
	let a;
	try { a = JSON.parse(fs.readFileSync(activeFile(userData), "utf8")); } catch { return null; }
	if (!a || !VERSION.test(a.version) || a.shell !== shellVersion || compareVersions(a.version, shellVersion) <= 0) return null;
	if (failedVersions(userData).includes(a.version)) return null;
	const dir = path.join(root(userData), a.version, "standalone");
	const entry = path.join(dir, "server.js");
	return fs.existsSync(entry) ? { version: a.version, dir, entry } : null;
}

/** The version the student is running: the active patch's, else the installed app's. */
function currentVersion(userData, shellVersion) {
	return activePatch(userData, shellVersion)?.version ?? shellVersion;
}

/** Stop using the active patch (it failed to start) and remember its version as failed. */
function disablePatch(userData) {
	let version = null;
	try { version = JSON.parse(fs.readFileSync(activeFile(userData), "utf8"))?.version ?? null; } catch { /* unreadable */ }
	if (VERSION.test(String(version))) {
		try { writeAtomic(failedFile(userData), JSON.stringify([...new Set([...failedVersions(userData), version])])); } catch { /* best effort */ }
	}
	fs.rmSync(activeFile(userData), { force: true }); // throws only if the file can't be removed: then no relaunch loop
}

/** A release link on GitHub for this repo, checked after the URL is normalised ("../" can't leave the repo). */
function releaseUrl(raw) {
	let u;
	try { u = new URL(raw); } catch { return false; }
	return u.origin === RELEASE_ORIGIN && u.pathname.startsWith(RELEASE_PATH) && u.pathname.endsWith(".zip") && !u.search && !u.username && !u.password;
}

/** latest.json's patch, when this app may apply it: signed, for this shell, newer than what runs, not failed before. */
function usablePatch(latest, shellVersion, running, failed = []) {
	const p = latest?.patch;
	if (!p || typeof p !== "object") return null;
	if (!VERSION.test(p.version) || p.shell !== shellVersion || compareVersions(p.version, running) <= 0 || failed.includes(p.version)) return null;
	if (typeof p.url !== "string" || !releaseUrl(p.url)) return null;
	if (!/^[0-9a-f]{64}$/i.test(String(p.sha256 || "")) || !Number.isInteger(p.size) || p.size <= 0 || p.size > MAX_BYTES) return null;
	let signed = false;
	try { signed = crypto.verify(null, Buffer.from(signedText(p)), publicKey, Buffer.from(String(p.sig || ""), "base64")); } catch { signed = false; }
	if (!signed) return null;
	return { version: p.version, url: p.url, sha256: p.sha256.toLowerCase(), size: p.size, shell: p.shell, sig: p.sig };
}

/** Windows' own tar (bsdtar) reads zip files; Git's GNU tar on PATH does not. */
function unzip(zipFile, into) {
	const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
	const r = spawnSync(tar, ["-xf", zipFile, "-C", into], { stdio: "ignore", windowsHide: true });
	if (r.status !== 0) throw new Error(`unpacking failed (tar ${r.status})`);
}

/** Every entry under dir is a plain file or folder inside dir: no links, no junctions, nothing outside. */
function checkTree(dir) {
	const top = fs.realpathSync(dir);
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const full = path.join(d, e.name);
			const st = fs.lstatSync(full);
			if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) throw new Error("The update contains a link. It was not installed.");
			const real = fs.realpathSync(full);
			if (real !== top && !real.startsWith(top + path.sep)) throw new Error("The update reaches outside its folder. It was not installed.");
			if (st.isDirectory()) walk(full);
		}
	};
	walk(dir);
}

let busy = false;

/**
 * Download, check and unpack a patch, then mark it active. Returns { version }. Throws a plain Error with a message
 * a student can read. fetcher: the global fetch, or a fake in tests. publicKey: tests only.
 */
async function applyPatch(patch, { userData, shellVersion, fetcher = fetch }) {
	if (busy) throw new Error("An update is already being installed.");
	busy = true;
	try {
		const p = usablePatch({ patch }, shellVersion, currentVersion(userData, shellVersion), failedVersions(userData));
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
			const out = path.join(work, "out");
			fs.mkdirSync(out);
			unzip(zip, out);
			checkTree(out);
			if (!fs.existsSync(path.join(out, "standalone", "server.js"))) throw new Error("The update is missing its server.");
			const target = path.join(root(userData), p.version);
			fs.rmSync(target, { recursive: true, force: true });
			fs.mkdirSync(target, { recursive: true });
			fs.renameSync(path.join(out, "standalone"), path.join(target, "standalone"));
			writeAtomic(activeFile(userData), JSON.stringify({ version: p.version, shell: p.shell, at: new Date().toISOString() }));
		} finally {
			try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* locked: the next start removes it */ }
		}
		cleanOld(userData, p.version); // the running patch's files are locked until restart; the next start finishes the job
		return { version: p.version };
	} finally {
		busy = false;
	}
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

module.exports = { RELEASE_DOWNLOADS, activePatch, applyPatch, cleanOld, compareVersions, currentVersion, disablePatch, failedVersions, releaseUrl, setPublicKeyForTests, signedText, usablePatch };
