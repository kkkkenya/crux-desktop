/**
 * Installer updates in the background (owner, 2026-11-20): see src/core/crux-update.ts for the signed latest.json
 * entry. stage() downloads the installer into <data>/updates/ while the student works, checks size, hash and
 * signature, and reports "ready"; the window then shows the green "Restart to update" bar. install() checks the file
 * again and runs it silently (/S --force-run): it closes Crux Harness, installs over it with no clicks, and opens the
 * new version. Nothing here opens a browser.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { type SignedInstaller, usableInstaller } from "../core/crux-update.ts";

const ORIGIN = (process.env.CRUX_ORIGIN || "https://crux.engineeringhub.site").replace(/\/+$/, "");

export type InstallerState =
	| { status: "none" }
	| { status: "checking" }
	| { status: "downloading"; version: string }
	| { status: "ready"; version: string }
	| { status: "failed"; version?: string; error: string };

let state: InstallerState = { status: "none" };
let staged: (SignedInstaller & { file: string }) | null = null;
let running: Promise<void> | null = null;

const dir = () => path.join(PATHS.data, "updates");
const fileFor = (version: string) => path.join(dir(), `Crux-Harness-${version}-setup.exe`);
const hashOf = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export const installerState = (): InstallerState => state;

interface Deps { fetcher?: typeof fetch; publicKey?: string; origin?: string }

/** Look for a signed installer newer than `current` and download it in the background. Returns the state now. */
export function stageInstaller(current: string, deps: Deps = {}): InstallerState {
	if (process.platform !== "win32" && !deps.fetcher) return state; // the silent installer is Windows only
	if (running || state.status === "ready") return state;
	// Say "checking" at once: the window keeps asking until it hears ready or none (0.7.1 heard "none" here and
	// stopped, so the bar waited for the six-hour check).
	state = { status: "checking" };
	running = (async () => {
		const fetcher = deps.fetcher ?? fetch;
		let latest: unknown;
		try {
			const r = await fetcher(`${deps.origin ?? ORIGIN}/desktop/latest.json`, { headers: { accept: "application/json" }, cache: "no-store", redirect: "error" });
			latest = r.ok ? await r.json() : null;
		} catch { latest = null; } // offline: try again next time
		const p = usableInstaller(latest, current, deps.publicKey);
		if (!p) { state = { status: "none" }; return; }
		const file = fileFor(p.version);
		try {
			if (fs.existsSync(file) && fs.statSync(file).size === p.size && hashOf(file) === p.sha256) {
				staged = { ...p, file }; state = { status: "ready", version: p.version }; return;
			}
		} catch { /* download again */ }
		state = { status: "downloading", version: p.version };
		try {
			const r = await fetcher(p.url, { redirect: "follow" });
			if (!r.ok) throw new Error(`The download failed (${r.status}).`);
			const bytes = Buffer.from(await r.arrayBuffer());
			if (bytes.length !== p.size || createHash("sha256").update(bytes).digest("hex") !== p.sha256) throw new Error("The download didn't match the release.");
			fs.mkdirSync(dir(), { recursive: true });
			for (const old of fs.readdirSync(dir())) if (old.endsWith("-setup.exe") || old.endsWith(".part")) fs.rmSync(path.join(dir(), old), { force: true });
			fs.writeFileSync(`${file}.part`, bytes);
			fs.renameSync(`${file}.part`, file);
			staged = { ...p, file };
			state = { status: "ready", version: p.version };
		} catch (err) {
			state = { status: "failed", version: p.version, error: err instanceof Error ? err.message : "The download failed." };
		}
	})().finally(() => { running = null; });
	return state;
}

/** Test seam: wait for a background stage to finish. */
export const stageSettled = (): Promise<void> => running ?? Promise.resolve();

/** Run the staged installer silently. It closes this app, installs, and opens the new version. */
export function installStaged(version: string, run: typeof spawn = spawn): { ok: true } | { ok: false; error: string } {
	if (!staged || state.status !== "ready" || staged.version !== version) return { ok: false, error: "The update isn't ready yet." };
	try {
		if (fs.statSync(staged.file).size !== staged.size || hashOf(staged.file) !== staged.sha256) {
			state = { status: "failed", version, error: "The update file changed. It will be downloaded again." };
			fs.rmSync(staged.file, { force: true });
			staged = null;
			return { ok: false, error: "The update file changed. It will be downloaded again." };
		}
		// Windows starts it through WMI, outside Crux Harness's own process group: the installer closes Crux Harness
		// first, and a child of Crux Harness would be closed with it (seen on 2026-11-21: the app closed, nothing installed).
		const child = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", wmiStart(staged.file)], { detached: true, stdio: "ignore", windowsHide: true });
		child.unref();
		return { ok: true };
	} catch {
		return { ok: false, error: "The update couldn't start. Try again." };
	}
}

/** The PowerShell line that has Windows (WMI) start the installer silently, as its own process. Pure, for tests. */
export function wmiStart(file: string): string {
	if (!/^[A-Za-z]:\\[^'"`$]+\.exe$/.test(file)) throw new Error("not an installer path");
	return `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '"${file}" /S --force-run' } | Out-Null`;
}

/** Test seam. */
export function resetInstallerForTests(): void { state = { status: "none" }; staged = null; running = null; }
