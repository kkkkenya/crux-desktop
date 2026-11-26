import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildImagePrompt, normaliseFigureSpec, splitFigureSpec, type FigureSpec } from "../src/agent/subagents/figure-prompt.ts";

const BEAM: FigureSpec = {
	kind: "fbd",
	title: "Simply supported beam",
	body: "uniform beam AB, 4 m long, horizontal",
	forces: [{ label: "P", value: "10 kN", direction: "downward", point: "B" }],
	moments: [{ label: "M", value: "5 kN·m", sense: "counter-clockwise", point: "C" }],
	distributed: [{ label: "w", intensity: "2 kN/m", extent: "from A to B", resultant: "R = 8 kN at 2 m from A" }],
	supports: [
		{ type: "pin", point: "A", reactions: ["A_x", "A_y"] },
		{ type: "roller", point: "B", reactions: ["B_y"] },
	],
	dimensions: [{ between: "A and B", value: "4 m" }],
	axes: "x to the right, y up, origin at A",
	notes: "lengths to scale",
};

describe("normaliseFigureSpec", () => {
	it("keeps a well-formed spec and trims text", () => {
		const spec = normaliseFigureSpec({ ...BEAM, title: "  Simply   supported beam  " });
		assert.ok(spec);
		assert.equal(spec.title, "Simply supported beam");
		assert.equal(spec.supports.length, 2);
		assert.deepEqual(spec.supports[0]!.reactions, ["A_x", "A_y"]);
	});

	it("rejects a spec with no title or no content", () => {
		assert.equal(normaliseFigureSpec({ kind: "fbd", title: "", body: "beam" }), null);
		assert.equal(normaliseFigureSpec({ kind: "fbd", title: "Beam" }), null);
		assert.equal(normaliseFigureSpec(null), null);
		assert.equal(normaliseFigureSpec("beam"), null);
	});

	it("drops rows that miss their required fields and caps long lists", () => {
		const forces = [{ label: "P", point: "" }, { label: "Q", value: "2 kN", direction: "left", point: "A" }];
		const many = Array.from({ length: 50 }, (_, i) => ({ label: `F${i}`, value: "1 N", direction: "up", point: "A" }));
		const spec = normaliseFigureSpec({ title: "t", forces: [...forces, ...many] });
		assert.ok(spec);
		assert.equal(spec.forces.length, 29, "the cap reads the first 30 raw rows; the bad row is one of them");
		assert.equal(spec.forces[0]!.label, "Q");
	});

	it("defaults the kind to fbd and a missing value to unknown", () => {
		const spec = normaliseFigureSpec({ title: "t", forces: [{ label: "R", point: "C", direction: "up" }] });
		assert.equal(spec?.kind, "fbd");
		assert.equal(spec?.forces[0]!.value, "unknown");
	});
});

describe("splitFigureSpec", () => {
	it("separates the notes from a fenced spec line", () => {
		const text = `Two reactions solved by equilibrium.\nFIGURE_SPEC: \`\`\`json\n${JSON.stringify(BEAM)}\n\`\`\``;
		const { notes, spec } = splitFigureSpec(text);
		assert.equal(notes, "Two reactions solved by equilibrium.");
		assert.equal(spec?.title, "Simply supported beam");
	});

	it("returns no spec when the marker is absent", () => {
		assert.deepEqual(splitFigureSpec("Just notes."), { notes: "Just notes.", spec: null });
	});

	it("keeps the notes and drops a spec that is not valid JSON", () => {
		assert.deepEqual(splitFigureSpec("Notes here.\nFIGURE_SPEC: {not json"), { notes: "Notes here.", spec: null });
	});
});

describe("buildImagePrompt", () => {
	const prompt = buildImagePrompt(BEAM);

	it("names every force with its value, direction and point", () => {
		assert.match(prompt, /P = 10 kN, downward, acting at B/);
	});

	it("draws moments, distributed loads and dimensions from the spec", () => {
		assert.match(prompt, /M = 5 kN·m, counter-clockwise, at C/);
		assert.match(prompt, /w: 2 kN\/m, from A to B; resultant R = 8 kN at 2 m from A/);
		assert.match(prompt, /4 m, between A and B/);
		assert.match(prompt, /x to the right, y up, origin at A/);
	});

	it("says supports are replaced by their reactions in a free body diagram", () => {
		assert.match(prompt, /Supports are replaced by their reactions/);
		assert.match(prompt, /pin at A: A_x and A_y/);
		assert.match(prompt, /roller at B: B_y/);
	});

	it("sets the style and lists what not to draw", () => {
		assert.match(prompt, /white background/);
		assert.match(prompt, /no shading/);
		assert.match(prompt, /Do NOT draw: the solution or any answer/);
	});

	it("omits empty sections and never prints undefined", () => {
		const bare = buildImagePrompt({ ...BEAM, forces: [], moments: [], distributed: [], supports: [], dimensions: [], axes: undefined, notes: undefined });
		assert.doesNotMatch(bare, /Forces\./);
		assert.doesNotMatch(bare, /Dimensions\./);
		assert.doesNotMatch(bare, /undefined/);
	});

	it("describes a non-FBD diagram without the free body wording", () => {
		const diagram = buildImagePrompt({ ...BEAM, kind: "diagram" });
		assert.match(diagram, /textbook diagram/);
		assert.match(diagram, /Supports \(draw the standard symbol/);
	});
});
