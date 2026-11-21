#!/usr/bin/env node
/**
 * An in-app update for Crux Harness (electron/crux-patch.cjs): the server only, no installer.
 *
 *   node scripts/crux-patch-release.mjs            build, zip, hash; prints the latest.json entry
 *   node scripts/crux-patch-release.mjs --publish  also uploads the zip to the GitHub release v<version>
 *                                                  (created if missing) and writes Crux web's latest.json
 *   --no-build                                     zip the server already in .next/standalone
 *   --for-shell 0.7.0 --version 0.7.2              an update for apps still on an older shell (they take it, then the
 *                                                  newer installer in the background); latest.json keeps its version
 *
 * Use it when electron/ is unchanged since the installed version (the "shell"). If electron/ changed, build the
 * full installer instead (docs/crux/RELEASING.md): the script refuses then.
 * The shell version is the last version released with an installer, read from docs/crux/shell-version.
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const olderShell = arg("--for-shell");
const version = (olderShell && arg("--version")) || pkg.version;
const shellFile = path.join(root, "docs", "crux", "shell-version");
const shell = olderShell || fs.readFileSync(shellFile, "utf8").trim();
const fail = (msg) => { console.error(`crux-patch-release: ${msg}`); process.exit(1); };
const publish = process.argv.includes("--publish");

if (!/^\d+\.\d+\.\d+$/.test(version) || !/^\d+\.\d+\.\d+$/.test(shell)) fail(`bad version (${version}) or shell version (${shell})`);
if (version === shell) fail(`package.json is still ${version}, the installer's version. Raise it first (for example to the next patch number).`);

// The shell is what the installer packaged: electron/ must not have changed since the tag v<shell>.
const changed = olderShell ? { status: 0, stdout: "" } : spawnSync("git", ["diff", "--name-only", `v${shell}`, "--", "electron", "electron-builder.yml", "build"], { cwd: root, encoding: "utf8" });
if (changed.status !== 0) fail(`no git tag v${shell} to compare the shell with. Tag the installer's commit: git tag v${shell} <commit>`);
const untracked = olderShell ? "" : spawnSync("git", ["ls-files", "--others", "--exclude-standard", "--", "electron", "build"], { cwd: root, encoding: "utf8" }).stdout.trim();
if (changed.stdout.trim() || untracked) fail(`the window shell changed since ${shell}; release a full installer instead:\n${changed.stdout}${untracked}`);
// The release key signs every update; the app checks it with the public key in electron/crux-patch.cjs.
const keyFile = process.env.CRUX_PATCH_KEY || path.join(os.homedir(), ".crux-desktop", "patch-signing.pem");
if (!fs.existsSync(keyFile)) fail(`no release key at ${keyFile}`);

if (!process.argv.includes("--no-build")) {
	console.log("crux-patch-release: building (next build, a few minutes)…");
	execSync("npm run build", { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
}
// always: it copies public/ and .next/static in and replaces links, as the installer build does
execSync("node scripts/build-server.mjs", { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) fail("no server in .next/standalone; run without --no-build");

const name = `crux-harness-server-${version}.zip`;
const zip = path.join(root, "dist", name);
fs.mkdirSync(path.dirname(zip), { recursive: true });
fs.rmSync(zip, { force: true });
// Windows' own tar writes zip files (-a picks the format from the name); the app unpacks with the same tool.
const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
const made = spawnSync(tar, ["-a", "-c", "-f", zip, "-C", path.join(root, ".next"), "standalone"], { stdio: "inherit" });
if (made.status !== 0) fail(`zipping failed (tar ${made.status})`);
const bytes = fs.readFileSync(zip);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const url = `https://github.com/kkkkenya/crux-desktop/releases/download/v${version}/${name}`;
const sig = sign(null, Buffer.from(`crux-harness-patch|${version}|${shell}|${sha256}`), createPrivateKey(fs.readFileSync(keyFile))).toString("base64");
const patch = { version, url, sha256, size: bytes.length, shell, sig };
console.log(`crux-patch-release: ${name}, ${(bytes.length / 1048576).toFixed(1)} MB, sha256 ${sha256}`);

const notesFile = path.join(root, "docs", "crux", "versions", `${version}.md`);
if (!publish) {
	console.log(JSON.stringify({ patch }, null, 2));
	console.log("Run again with --publish to upload it and update Crux web's latest.json.");
	process.exit(0);
}
if (!fs.existsSync(notesFile)) fail(`write ${path.relative(root, notesFile)} first`);
const gh = (args) => spawnSync("gh", args, { cwd: root, stdio: "inherit" });
const exists = spawnSync("gh", ["release", "view", `v${version}`, "--repo", "kkkkenya/crux-desktop"], { cwd: root, stdio: "ignore" }).status === 0;
const up = exists
	? gh(["release", "upload", `v${version}`, zip, "--clobber", "--repo", "kkkkenya/crux-desktop"])
	: gh(["release", "create", `v${version}`, zip, "--repo", "kkkkenya/crux-desktop", "--target", "crux", "--title", `Crux Harness ${version}`, "--notes-file", notesFile, "--latest=false"]); // the site's Download (releases/latest) stays on the last installer
if (up.status !== 0) fail("the upload failed");

// Crux web's latest.json: the new version, the installer link stays (students without the shell still need it).
const web = process.env.CRUX_WEB_DIR || path.resolve(root, "..", "discord-sync-bot");
const latestFile = path.join(web, "study", "web", "public", "desktop", "latest.json");
const latest = JSON.parse(fs.readFileSync(latestFile, "utf8"));
const firstLine = fs.readFileSync(notesFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("- **"))?.replace(/^- \*\*(.+?)\*\*.*$/, "$1") ?? "";
// An update for an older shell leaves the newest version (and its installer) as they are.
const top = olderShell ? {} : { version, notes: firstLine || latest.notes, released: new Date().toISOString().slice(0, 10) };
fs.writeFileSync(latestFile, `${JSON.stringify({ ...latest, ...top, patch }, null, 2)}\n`);
console.log(`crux-patch-release: wrote ${latestFile}. Commit and push Crux web so installed apps see it.`);
