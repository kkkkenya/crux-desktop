/**
 * Pure helpers for the file lists students see (Hub files, the Files chip,
 * session documents): natural sort ("CAT 2" before "CAT 10"), the sort
 * choice that is remembered between visits, and the check that sorts a
 * batch of picked files into accepted, duplicate and rejected ones with a
 * reason for each. No DOM, no Electron: everything here is unit-tested.
 */

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Natural, case-insensitive order: digits compare by value, so "CAT 2" < "CAT 10". */
export function naturalCompare(a: string, b: string): number {
	return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export type FileSortMode = "name" | "kind" | "recent" | "saved";
export const FILE_SORT_MODES: readonly FileSortMode[] = ["name", "kind", "recent", "saved"];
export const FILE_SORT_LABELS: Record<FileSortMode, string> = {
	name: "Name",
	kind: "Papers first",
	recent: "Recently added",
	saved: "On this computer first",
};

/** Falls back to name for anything that is not a known mode (a stale or hand-edited setting). */
export function parseSortMode(value: unknown, fallback: FileSortMode = "name"): FileSortMode {
	return (FILE_SORT_MODES as readonly unknown[]).includes(value) ? (value as FileSortMode) : fallback;
}

/** The item shape the sorter needs. Extra fields are carried through untouched. */
export interface SortableFile {
	name: string;
	/** Papers and past exams group first when sorting by kind. */
	paper?: boolean;
	/** ISO time the file arrived on this computer or the Hub; newest first when sorting by recent. */
	addedAt?: string | null;
	/** Already on this computer; those group first when sorting by saved. */
	saved?: boolean;
}

/** Returns a new array; never mutates the input. Ties fall back to natural name order. */
export function sortFiles<T extends SortableFile>(files: readonly T[], mode: FileSortMode): T[] {
	const byName = (a: T, b: T) => naturalCompare(a.name, b.name);
	const copy = [...files];
	if (mode === "saved") return copy.sort((a, b) => Number(b.saved ?? false) - Number(a.saved ?? false) || byName(a, b));
	if (mode === "kind") return copy.sort((a, b) => Number(b.paper ?? false) - Number(a.paper ?? false) || byName(a, b));
	if (mode === "recent") {
		const time = (f: T) => { const t = f.addedAt ? Date.parse(f.addedAt) : NaN; return Number.isNaN(t) ? -Infinity : t; };
		return copy.sort((a, b) => time(b) - time(a) || byName(a, b));
	}
	return copy.sort(byName);
}

/** Lower-case extension without the dot, or "" when there is none. */
export function fileExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Short type label for a list row: PDF, DOCX, MD, ... (uppercase extension), or "File". */
export function fileTypeLabel(name: string): string {
	const ext = fileExtension(name);
	return ext ? ext.toUpperCase() : "File";
}

export interface ChosenFileCheck<T> {
	accepted: T[];
	duplicates: string[];
	rejected: { name: string; reason: string }[];
}

/**
 * Sorts a batch of picked files for a source list. `existing` names win:
 * a re-pick of a name already chosen is a duplicate, not a replacement.
 * Names repeated inside one batch keep the first occurrence.
 * Rejections carry the reason the student can act on.
 */
export function checkChosenFiles<T extends { name: string }>(
	existing: readonly T[],
	incoming: readonly T[],
	accept: RegExp,
	acceptLabel: string,
): ChosenFileCheck<T> {
	const seen = new Set(existing.map((f) => f.name.toLowerCase()));
	const accepted: T[] = [];
	const duplicates: string[] = [];
	const rejected: { name: string; reason: string }[] = [];
	for (const file of incoming) {
		const key = file.name.toLowerCase();
		if (!accept.test(file.name)) { rejected.push({ name: file.name, reason: `${fileTypeLabel(file.name)} files can't be used here. Use ${acceptLabel}.` }); continue; }
		if (seen.has(key)) { duplicates.push(file.name); continue; }
		seen.add(key);
		accepted.push(file);
	}
	return { accepted, duplicates, rejected };
}

/** One sentence for the message line after a batch, or "" when everything was added cleanly. */
export function describeChosenFiles(check: Pick<ChosenFileCheck<unknown>, "accepted" | "duplicates" | "rejected">): string {
	const parts: string[] = [];
	if (check.accepted.length) parts.push(`Added ${check.accepted.length} ${check.accepted.length === 1 ? "file" : "files"}.`);
	if (check.duplicates.length) parts.push(`${check.duplicates.length} already chosen, skipped.`);
	const first = check.rejected[0];
	if (first) parts.push(check.rejected.length === 1 ? first.reason : `${check.rejected.length} files skipped: ${first.reason}`);
	return parts.join(" ");
}
