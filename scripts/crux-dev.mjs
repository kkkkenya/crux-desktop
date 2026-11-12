#!/usr/bin/env node
/**
 * Crux desktop with live reload: `node scripts/crux-dev.mjs`.
 * Starts `next dev` and an Electron window pointed at it. Edits to app/,
 * components/ and lib/ show in the window in seconds, with no build at all.
 * The dev window keeps its own data (%APPDATA%\Crux-dev), so it needs one
 * Discord sign-in of its own and never touches the installed app's sessions.
 * Ctrl+C stops both.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const port = process.env.PORT || "3000";
const url = `http://localhost:${port}`;
const bin = (name) => path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

const next = spawn(bin("next"), ["dev", "-p", port], { cwd: root, stdio: "inherit", shell: true });
let electron = null;

// Open the window once the dev server answers.
const wait = async () => {
	for (let i = 0; i < 240; i++) {
		try { const r = await fetch(url); if (r.status < 500) break; } catch { /* not up yet */ }
		await new Promise((r) => setTimeout(r, 1000));
	}
	electron = spawn(bin("electron"), ["."], { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, LH_DEV_URL: url } });
	electron.on("exit", stop);
};
const stop = () => { try { next.kill(); } catch {} try { electron?.kill(); } catch {} process.exit(0); };
process.on("SIGINT", stop);
next.on("exit", stop);
void wait();
