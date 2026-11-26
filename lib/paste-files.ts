/**
 * Ctrl+V of files or a screenshot into a composer. Each pasted file becomes a
 * composer chip the same way the attach button makes one: its local path when
 * the desktop bridge knows it, else its bytes saved to Documents/Crux/Pasted.
 * Problems are announced on FILE_NOTICE_EVENT, which the drop zone shows.
 */
import { quoteFilePath } from "@/src/core";
import { MAX_IMPORT_BYTES } from "@/lib/notes-import-limits";

export const FILE_NOTICE_EVENT = "lh:file-notice";

export interface PasteBridge {
	getPathForFile?: (file: File) => string;
	saveAttachmentPaste?: (payload: { name: string; mime: string; bytes: Uint8Array }) => Promise<string>;
}

/** → the usable paths, in paste order, and one readable line per file that could not be added. */
export async function pastedFilePaths(files: readonly File[], bridge: PasteBridge | undefined): Promise<{ paths: string[]; problems: string[] }> {
	const paths: string[] = [];
	const problems: string[] = [];
	if (!bridge?.getPathForFile && !bridge?.saveAttachmentPaste) {
		return { paths, problems: ["Pasted files can only be attached in the desktop app. You can paste a full path instead."] };
	}
	for (const file of files) {
		const name = file.name || "Pasted screenshot";
		if (file.size > MAX_IMPORT_BYTES) { problems.push(`${name} is over 25 MB. Save it first, then drop it in.`); continue; }
		try {
			const known = bridge.getPathForFile?.(file) ?? "";
			if (known) { quoteFilePath(known); paths.push(known); continue; }
			if (!bridge.saveAttachmentPaste) { problems.push(`${name} has no file path to attach.`); continue; }
			const bytes = new Uint8Array(await file.arrayBuffer());
			const saved = await bridge.saveAttachmentPaste({ name, mime: file.type, bytes });
			quoteFilePath(saved);
			paths.push(saved);
		} catch (error) {
			problems.push(`${name} could not be attached${error instanceof Error && error.message ? `: ${error.message}` : "."}`);
		}
	}
	return { paths, problems };
}

/** Announce problems for the drop zone to show; a no-op when there are none. */
export function announceFileProblems(problems: readonly string[]): void {
	if (problems.length === 0 || typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(FILE_NOTICE_EVENT, { detail: problems.length === 1 ? problems[0] : `${problems.length} files could not be attached. ${problems[0]}` }));
}
