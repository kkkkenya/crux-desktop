import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { cruxRequest, type CruxBridgeReply } from "../crux-bridge.ts";

/**
 * Hub tools (Crux desktop, 2026-11-12): the Study Hub's notes and past papers,
 * the files the Hub bot posts for each unit, found and opened by the tutor
 * itself. hub_files lists; hub_download saves one file to Documents/Crux/Hub
 * (once: a saved file is reused and costs no daily download) and returns its
 * local path, which the tutor then reads with read or pdf like any learner file.
 */

type Unit = { code: string; title: string };
type HubFile = { id: string; name: string; paper: boolean; pages: number | null; path: string | null };
type Request = <T>(op: "units" | "files" | "download", fields?: Record<string, unknown>) => Promise<CruxBridgeReply<T>>;

const UNIT_CODE = /^[A-Za-z]{2,5}\s?\d{3}[A-Za-z]?$/;
/** "emm312", "EMM 312" → "EMM 312" (the Hub's spelling). */
export function unitCode(input: string): string | null {
	const m = /^\s*([A-Za-z]{2,5})\s*(\d{3}[A-Za-z]?)\s*$/.exec(input);
	return m ? `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}` : null;
}

/** The units whose code or title holds every word of the query, best eight. */
export function findUnits(units: readonly Unit[], query: string): Unit[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	return units.filter((u) => { const hay = `${u.code} ${u.title}`.toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, 8);
}

export function formatFiles(unit: string, files: readonly HubFile[], note: string | null): string {
	if (!files.length) return `${unit} has no hub files yet.${note ? ` ${note}` : ""}`;
	const line = (f: HubFile) => `- [${f.id}] ${f.name}${f.pages ? ` (${f.pages} pages)` : ""}${f.path ? ` — saved: ${f.path}` : ""}`;
	const papers = files.filter((f) => f.paper), notes = files.filter((f) => !f.paper);
	return [
		`Hub files for ${unit} (id in brackets; files marked "saved" can be read at that path now):`,
		...(notes.length ? ["Notes and books:", ...notes.map(line)] : []),
		...(papers.length ? ["Past papers:", ...papers.map(line)] : []),
		"To open one, call hub_download with the unit, the id and the exact name, then read the path it returns.",
	].join("\n");
}

const filesInput = Type.Object({
	unit: Type.Optional(Type.String({ description: "A unit code such as \"EMM 312\". Omit to list the student's own units." })),
	search: Type.Optional(Type.String({ description: "Words to find a unit by title when the code is unknown, e.g. \"fluid mechanics\"." })),
});
const downloadInput = Type.Object({
	unit: Type.String({ description: "The unit code, e.g. \"EMM 312\"." }),
	id: Type.String({ description: "The file's id from hub_files." }),
	name: Type.String({ description: "The file's exact name from hub_files." }),
});

export function createHubTools(request: Request = cruxRequest): Record<string, AgentTool<any>> {
	return {
		hub_files: {
			name: "hub_files",
			label: "hub_files",
			description:
				"The Study Hub's files: lecture notes, books and past papers posted for each university unit. " +
				"With no arguments, lists the student's own units. With `search`, finds units by title. " +
				"With `unit`, lists that unit's notes and past papers. Use it when the student names a unit or topic " +
				"so the lesson follows their course material and past papers.",
			parameters: filesInput,
			execute: serverExecute("hub_files", filesInput, async ({ unit, search }) => {
				if (unit) {
					const code = unitCode(unit);
					if (!code) return `"${unit}" is not a unit code. Use a code like "EMM 312", or call hub_files with search.`;
					const reply = await request<{ note: string | null; files: HubFile[] }>("files", { unit: code });
					if (!reply.ok) return `hub_files failed: ${reply.error}`;
					return formatFiles(code, reply.value.files, reply.value.note);
				}
				const reply = await request<{ mine: Unit[]; all: Unit[] }>("units");
				if (!reply.ok) return `hub_files failed: ${reply.error}`;
				const { mine, all } = reply.value;
				if (search?.trim()) {
					const found = findUnits(all.length ? all : mine, search);
					return found.length
						? `Units matching "${search}":\n${found.map((u) => `- ${u.code} ${u.title}`).join("\n")}\nCall hub_files with one of these codes to see its files.`
						: `No unit matches "${search}". Try other words, or ask the student for the unit code.`;
				}
				return mine.length
					? `The student's units:\n${mine.map((u) => `- ${u.code} ${u.title}`).join("\n")}`
					: "The student has not picked units on Crux yet. Ask which unit, or call hub_files with search.";
			}),
		},
		hub_download: {
			name: "hub_download",
			label: "hub_download",
			description:
				"Save one Study Hub file to this computer and return its local path, to read with read or pdf. " +
				"A file already saved is reused and costs nothing; a new one uses one of the student's daily downloads, " +
				"so download only what the lesson needs.",
			parameters: downloadInput,
			execute: serverExecute("hub_download", downloadInput, async ({ unit, id, name }) => {
				const code = unitCode(unit);
				if (!code || !UNIT_CODE.test(code)) return `"${unit}" is not a unit code.`;
				if (!/^\d+$/.test(id.trim())) return `"${id}" is not a hub file id. Use the id in brackets from hub_files.`;
				const reply = await request<{ path: string; left: number | null; cached: boolean }>("download", { unit: code, fileId: id.trim(), name });
				if (!reply.ok) return `hub_download failed: ${reply.error}`;
				const left = typeof reply.value.left === "number" ? ` ${reply.value.left} downloads left today.` : "";
				return `${reply.value.cached ? "Already saved" : "Saved"}: ${reply.value.path}.${left} Read it with ${/\.pdf$/i.test(reply.value.path) ? "pdf (or read)" : "read"}.`;
			}),
		},
	};
}

export const hubTools = createHubTools();
