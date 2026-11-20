#!/usr/bin/env node
/**
 * Publish a Crux Harness installer so installed apps take it without a browser (owner, 2026-11-20).
 *
 *   node scripts/crux-installer-release.mjs            hash and sign dist/Crux-Harness-<version>-x64-setup.exe; print the entry
 *   node scripts/crux-installer-release.mjs --publish  also upload it to the GitHub release v<version> (as Crux-Setup.exe,
 *                                                      the site's Download link) and write Crux web's latest.json
 *
 * latest.json gets `installer: { version, url, sha256, size, sig }`, signed "crux-harness-installer|<version>|<sha256>"
 * with the release key (~/.crux-desktop/patch-signing.pem); the app's server downloads it in the background and installs
 * it silently (src/server/crux-installer.ts). An existing `patch` for an older shell stays, so apps on that shell take
 * the patch first (it carries the background installer) and then this installer. Build the installer first
 * (docs/crux/RELEASING.md), then run this; afterwards write the version into docs/crux/shell-version and tag it.
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const fail = (msg) => { console.error(`crux-installer-release: ${msg}`); process.exit(1); };
const publish = process.argv.includes("--publish");
const exe = path.join(root, "dist", `Crux-Harness-${version}-x64-setup.exe`);
if (!fs.existsSync(exe)) fail(`no installer at ${path.relative(root, exe)}; build it first (docs/crux/RELEASING.md)`);
const keyFile = process.env.CRUX_PATCH_KEY || path.join(os.homedir(), ".crux-desktop", "patch-signing.pem");
if (!fs.existsSync(keyFile)) fail(`no release key at ${keyFile}`);

const bytes = fs.readFileSync(exe);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const url = `https://github.com/kkkkenya/crux-desktop/releases/download/v${version}/Crux-Setup.exe`;
const sig = sign(null, Buffer.from(`crux-harness-installer|${version}|${sha256}`), createPrivateKey(fs.readFileSync(keyFile))).toString("base64");
const installer = { version, url, sha256, size: bytes.length, sig };
console.log(`crux-installer-release: ${path.basename(exe)}, ${(bytes.length / 1048576).toFixed(1)} MB, sha256 ${sha256}`);
if (!publish) { console.log(JSON.stringify({ installer }, null, 2)); process.exit(0); }

const notesFile = path.join(root, "docs", "crux", "versions", `${version}.md`);
if (!fs.existsSync(notesFile)) fail(`write ${path.relative(root, notesFile)} first`);
const asset = path.join(os.tmpdir(), "Crux-Setup.exe");
fs.copyFileSync(exe, asset);
const repo = ["--repo", "kkkkenya/crux-desktop"];
const exists = spawnSync("gh", ["release", "view", `v${version}`, ...repo], { stdio: "ignore" }).status === 0;
const up = exists
	? spawnSync("gh", ["release", "upload", `v${version}`, asset, "--clobber", ...repo], { stdio: "inherit" })
	: spawnSync("gh", ["release", "create", `v${version}`, asset, ...repo, "--target", "crux", "--title", `Crux Harness ${version}`, "--notes-file", notesFile, "--latest"], { stdio: "inherit" });
fs.rmSync(asset, { force: true });
if (up.status !== 0) fail("the upload failed");

const web = process.env.CRUX_WEB_DIR || path.resolve(root, "..", "discord-sync-bot");
const latestFile = path.join(web, "study", "web", "public", "desktop", "latest.json");
const latest = JSON.parse(fs.readFileSync(latestFile, "utf8"));
const firstLine = fs.readFileSync(notesFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("- **"))?.replace(/^- \*\*(.+?)\*\*.*$/, "$1") ?? "";
const keepPatch = latest.patch && latest.patch.shell !== version ? { patch: latest.patch } : {};
fs.writeFileSync(latestFile, `${JSON.stringify({
	version, url: "https://github.com/kkkkenya/crux-desktop/releases/latest/download/Crux-Setup.exe",
	notes: firstLine || latest.notes, released: new Date().toISOString().slice(0, 10), ...keepPatch, installer,
}, null, 2)}\n`);
console.log(`crux-installer-release: wrote ${latestFile}. Commit and push Crux web so installed apps see it.`);
