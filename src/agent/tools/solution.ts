import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { cruxRequest, type CruxBridgeReply } from "../crux-bridge.ts";
import { unitCode } from "./hub.ts";

/**
 * solution_page (Crux, 2026-11-16): a marking scheme or full worked solution as
 * one HTML file with the free body diagrams as inline SVG, in the owner's format
 * (prompts/shared/36-marking-scheme.md). The Electron main process checks the
 * page (electron/solution-page.cjs), saves it to Documents/Crux/Hub/<unit>/Solutions
 * and opens it beside the lesson; the student finds it again under Files.
 */

type Request = <T>(op: "saveSolution", fields?: Record<string, unknown>) => Promise<CruxBridgeReply<T>>;

const input = Type.Object({
	unit: Type.String({ description: "The unit code, e.g. \"EMM 302\"." }),
	title: Type.String({ minLength: 3, maxLength: 120, description: "The file's title, e.g. \"EMM 302 CAT 1 2026-27 marking scheme\". Saving again with the same title replaces the page." }),
	html: Type.String({ minLength: 200, description: "The whole page: one self-contained HTML document in the marking-scheme format, figures as inline SVG, equations for MathJax." }),
});

export function createSolutionTool(request: Request = cruxRequest): AgentTool<typeof input> {
	return {
		name: "solution_page",
		label: "solution_page",
		description:
			"Save a marking scheme or full worked solution as one HTML page (inline SVG free body diagrams, MathJax equations) " +
			"and open it beside the lesson. Follow the marking-scheme format exactly. Use it when the student asks for a marking " +
			"scheme, a full solution of a paper or CAT, or a solution to keep. The page is checked before it is saved; if it is " +
			"refused, fix what the reply names and call again.",
		parameters: input,
		execute: serverExecute("solution_page", input, async ({ unit, title, html }) => {
			const code = unitCode(unit);
			if (!code) return `"${unit}" is not a unit code. Use a code like "EMM 302".`;
			const reply = await request<{ path: string }>("saveSolution", { unit: code, title, html });
			if (!reply.ok) return `solution_page failed: ${reply.error}`;
			return `Saved and opened beside the lesson: ${reply.value.path}. The student can open it again from Files in the top bar. ` +
				"Tell them it is there in one line; do not paste the page into the chat.";
		}),
	};
}

export const solutionTool = createSolutionTool();
