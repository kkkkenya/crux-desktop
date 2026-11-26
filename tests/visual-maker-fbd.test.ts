/**
 * End to end: the visual maker writes an FBD with a missing arrowhead, reads
 * the lint report back, fixes it, renders, and finishes with a FIGURE_SPEC.
 * The result must carry the notes and a ready-to-paste image prompt.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type FauxResponseStep, type TranscriptContext } from "@earendil-works/pi-ai";

// Storage/auth seams before importing the agent, as the other visual tests do.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-visual-fbd-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
fs.mkdirSync(path.join(scratch, "home"));
fs.writeFileSync(path.join(scratch, "auth.json"), "{}");
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	HOME: path.join(scratch, "home"),
	LH_DATA_DIR: path.join(scratch, "data"),
	LH_AUTH_FILE: path.join(scratch, "auth.json"),
};
globalThis.fetch = async () => { throw new Error("CLOSED: unexpected network request"); };
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

import type { HeadlessApi } from "../src/agent/subagents/headless.ts";
const { runVisualMaker } = await import("../src/agent/subagents/visual-maker.ts");
type Engine = Parameters<typeof runVisualMaker>[1] extends { engine?: infer E } ? E : never;

const DEFS = '<defs><marker id="arr" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#111"/></marker></defs>';
const BODY = '<line x1="50" y1="100" x2="350" y2="100" stroke="#111" stroke-width="2"/>';
const LABEL_P = '<text x="210" y="60">P = 10 kN</text>';
const FORCE_NO_HEAD = '<line class="force" x1="200" y1="40" x2="200" y2="95" stroke="#111"/>';
const FORCE_WITH_HEAD = '<line class="force" x1="200" y1="40" x2="200" y2="95" stroke="#111" marker-end="url(#arr)"/>';
const svgWith = (force: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200">${DEFS}${BODY}${force}${LABEL_P}</svg>`;

const SPEC = {
	kind: "fbd",
	title: "Beam AB under P",
	body: "uniform beam AB, 4 m, horizontal",
	forces: [{ label: "P", value: "10 kN", direction: "downward", point: "B" }],
	moments: [],
	distributed: [],
	supports: [{ type: "pin", point: "A", reactions: ["A_x", "A_y"] }],
	dimensions: [{ between: "A and B", value: "4 m" }],
	axes: "x to the right, y up, origin at A",
	notes: "",
};

function png(): Buffer {
	const canvas = createCanvas(40, 20);
	const context = canvas.getContext("2d");
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, 40, 20);
	return canvas.toBuffer("image/png");
}

function scripted(steps: FauxResponseStep[]) {
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	faux.setResponses(steps);
	const base = faux.getModel();
	const model = { ...base, input: ["text"] as ("text" | "image")[] };
	const requests: TranscriptContext[] = [];
	const engine = {
		model,
		streamFn: (m: typeof model, context: TranscriptContext, options: unknown) => {
			requests.push(structuredClone(context));
			return faux.streamSimple(m, context, options as never);
		},
	} as unknown as Engine;
	return { engine, requests };
}

function toolText(context: TranscriptContext): string {
	return context.messages
		.filter((message) => message.role === "toolResult")
		.map((message) => (Array.isArray(message.content) ? message.content : [])
			.map((part) => ("text" in part ? part.text : ""))
			.join("\n"))
		.join("\n");
}

test("visual maker reads its lint back, fixes the figure and delivers an image prompt", async () => {
	const steps: FauxResponseStep[] = [
		fauxAssistantMessage([fauxToolCall("write_svg", { svg: svgWith(FORCE_NO_HEAD) }, { id: "w1" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("write_svg", { svg: svgWith(FORCE_WITH_HEAD) }, { id: "w2" }), fauxToolCall("render_svg", {}, { id: "r1" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([
			fauxText(`Pin at A takes A_x and A_y; P acts at B. Unknowns 2, equations 3, counts checked.\nFIGURE_SPEC: ${JSON.stringify(SPEC)}`),
		]),
	];
	const { engine, requests } = scripted(steps);
	const headless = { available: () => true, unavailableReason: () => null, renderSvg: async () => png() } as unknown as HeadlessApi;

	const result = await runVisualMaker({ brief: "Beam AB, 4 m, pin at A, roller-free, P = 10 kN down at B." }, { engine, headless });

	const feedback = toolText(requests[1]!);
	assert.match(feedback, /Lint errors/, "the first write's lint must reach the maker");
	assert.match(feedback, /force arrow has no arrowhead/);
	assert.ok(result.svg.includes('marker-end="url(#arr)"'), "the delivered figure is the fixed one");
	assert.equal(result.notes, "Pin at A takes A_x and A_y; P acts at B. Unknowns 2, equations 3, counts checked.");
	assert.ok(result.imagePrompt, "a drawn figure with a spec gets an image prompt");
	assert.match(result.imagePrompt!, /P = 10 kN, downward, acting at B/);
	assert.match(result.imagePrompt!, /pin at A: A_x and A_y/);
});

test("a figure without a spec carries notes and no image prompt", async () => {
	const steps: FauxResponseStep[] = [
		fauxAssistantMessage([fauxToolCall("write_svg", { svg: svgWith(FORCE_WITH_HEAD) }, { id: "w1" }), fauxToolCall("render_svg", {}, { id: "r1" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("A plain sketch.")]),
	];
	const { engine } = scripted(steps);
	const headless = { available: () => true, unavailableReason: () => null, renderSvg: async () => png() } as unknown as HeadlessApi;
	const result = await runVisualMaker({ brief: "Sketch." }, { engine, headless });
	assert.equal(result.notes, "A plain sketch.");
	assert.equal(result.imagePrompt, undefined);
});
