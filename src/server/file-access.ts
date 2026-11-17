/** Current optional learner-source preferences, wired by the server
 * composition root into the #157 policy seam. Mandatory #421 protection
 * stays in fs-shared; do NOT add a whole data/userData denial here. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FileAccessPolicy } from "../agent/tools/file-access.ts";
import { readFileAccessSettings } from "../store/settings.ts";

export function expandFolder(folder: string, home: string = os.homedir()): string {
	if (folder === "~") return home;
	if (folder.startsWith("~/")) return path.join(home, folder.slice(2));
	if (!path.isAbsolute(folder)) throw new Error("Invalid file-access folder for this server filesystem");
	return path.resolve(folder);
}

/** Study from your phone is on (electron/crux-remote.cjs; the main process keeps this flag file while it is): someone
 * other than the person at the laptop may be asking, so file access is restricted to the allowed folders, Hub files
 * and session documents, whatever the setting says. */
export function phoneAccessOn(flag: string | undefined = process.env.LH_REMOTE_FLAG): boolean {
	if (!flag) return false;
	try { return fs.existsSync(flag); } catch { return true; }
}

export function fileAccessPolicy(): FileAccessPolicy {
	const result = readFileAccessSettings();
	if (!result.ok) return { restricted: true, folders: [], error: result.error };
	return { restricted: result.settings.restricted || phoneAccessOn(), folders: result.settings.folders.map((folder) => expandFolder(folder)) };
}

/** Safe UI diagnostic, no raw JSON/file contents. A corrupt record must
 * not make the restriction toggle appear safely OFF while reads are blocked. */
export function fileAccessConfigurationError(): string | null {
	const result = readFileAccessSettings();
	return result.ok ? null : result.error;
}
