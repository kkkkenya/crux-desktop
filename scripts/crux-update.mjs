#!/usr/bin/env node
/**
 * Quick update of the installed Crux desktop app, without electron-builder.
 *
 *   node scripts/crux-update.mjs            build the UI/server, then copy it in
 *   node scripts/crux-update.mjs --no-build copy the last build in
 *
 * The installed app keeps its UI and server in resources/server/standalone,
 * which is exactly what `next build` + scripts/build-server.mjs produce. So a
 * change to app/, components/, lib/ or src/ only needs those two steps and a
 * copy. Changes to electron/*.cjs (the window shell) live in app.asar and
 * still need the full package (electron-builder); this script warns when it
 * sees them.
 *
 * Crux must be closed (the copy replaces files the running server holds).
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const installed = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Crux");
const target = path.join(installed, "resources", "server", "standalone");
const source = path.join(root, ".next", "standalone");
const log = path.join(process.env.APPDATA ?? "", "Crux", "logs", "main.log");

const fail = (msg) => { console.error(`crux-update: ${msg}`); process.exit(1); };
const running = () => {
	const out = spawnSync("tasklist", ["/FI", "IMAGENAME eq Crux.exe", "/NH"], { encoding: "utf8" }).stdout ?? "";
	return /Crux\.exe/i.test(out);
};

if (!fs.existsSync(path.join(installed, "Crux.exe"))) fail(`no installed Crux at ${installed}`);

// The window shell changed since the installed asar was made: say so, the copy below won't carry it.
const asar = path.join(installed, "resources", "app.asar");
const shellChanged = fs.readdirSync(path.join(root, "electron"))
	.some((f) => fs.statSync(path.join(root, "electron", f)).mtimeMs > fs.statSync(asar).mtimeMs);
if (shellChanged) console.warn("crux-update: electron/ changed since the installed app was packaged; those changes need the full package (electron-builder).");

if (!process.argv.includes("--no-build")) {
	console.log("crux-update: building (next build + build-server, a few minutes)…");
	execSync("npm run build", { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
	execSync("node scripts/build-server.mjs", { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
}
if (!fs.existsSync(path.join(source, "server.js"))) fail("no build in .next/standalone; run without --no-build");

if (running()) {
	console.log("crux-update: closing Crux…");
	spawnSync("taskkill", ["/IM", "Crux.exe"]);
	for (let i = 0; i < 20 && running(); i++) execSync("ping -n 2 127.0.0.1 >NUL");
	if (running()) spawnSync("taskkill", ["/F", "/IM", "Crux.exe"]);
}

// robocopy /MIR copies only what changed and removes what is gone. Exit codes below 8 are success.
console.log("crux-update: copying the changed files in…");
const copy = spawnSync("robocopy", [source, target, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:1"], { stdio: "inherit" });
if (copy.status === null || copy.status >= 8) fail(`copy failed (robocopy ${copy.status})`);

// Start it again and wait for the window.
const before = fs.existsSync(log) ? fs.readFileSync(log, "utf8").length : 0;
spawnSync("cmd", ["/c", "start", "", path.join(installed, "Crux.exe")], { cwd: installed });
const until = Date.now() + 120_000;
while (Date.now() < until) {
	const tail = fs.existsSync(log) ? fs.readFileSync(log, "utf8").slice(before) : "";
	if (tail.includes("window open")) { console.log("crux-update: Crux is up with the new build."); process.exit(0); }
	if (/server exited/.test(tail)) fail(`the server stopped on start; see ${log}`);
	execSync("ping -n 2 127.0.0.1 >NUL");
}
fail(`no "window open" in ${log} after 2 minutes`);
