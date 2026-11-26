import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { colorLuminance, formatLintForMaker, lintFigureSvg } from "../src/agent/subagents/figure-lint.ts";

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200">';
const DEFS = '<defs><marker id="arr" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#111"/></marker></defs>';

/** A clean two-force free body diagram: the reference the lint must pass. */
const CLEAN = [
	HEAD,
	DEFS,
	'<line x1="50" y1="100" x2="350" y2="100" stroke="#111" stroke-width="2"/>',
	'<line class="force" x1="200" y1="40" x2="200" y2="95" stroke="#111" marker-end="url(#arr)"/>',
	'<text x="210" y="60">P = 10 kN</text>',
	'<line class="reaction" x1="50" y1="100" x2="50" y2="160" stroke="#111" marker-end="url(#arr)"/>',
	'<text x="58" y="172">A_y</text>',
	"</svg>",
].join("\n");

describe("lintFigureSvg", () => {
	it("passes a clean free body diagram with no errors and no warnings", () => {
		const result = lintFigureSvg(CLEAN);
		assert.deepEqual(result, { errors: [], warnings: [] });
		assert.equal(formatLintForMaker(result), "Lint: no problems found.");
	});

	it("flags a force arrow with no arrowhead", () => {
		const svg = CLEAN.replace(' marker-end="url(#arr)"/>\n<text x="210"', '/>\n<text x="210"');
		const { errors } = lintFigureSvg(svg);
		assert.ok(errors.some((e) => e.includes("force arrow has no arrowhead")), errors.join(" | "));
	});

	it("flags an arrowhead that points at a marker missing from defs", () => {
		const svg = CLEAN.replace("url(#arr)", "url(#missing)");
		const { errors } = lintFigureSvg(svg);
		assert.ok(errors.some((e) => e.includes('marker "missing"')), errors.join(" | "));
	});

	it("requires a viewBox", () => {
		const svg = CLEAN.replace(' viewBox="0 0 400 200"', "");
		assert.ok(lintFigureSvg(svg).errors.some((e) => e.includes("viewBox")));
	});

	it("flags a label that runs outside the viewBox", () => {
		const svg = CLEAN.replace('<text x="210" y="60">P = 10 kN</text>', '<text x="380" y="60">P = 10 kN</text>');
		const { errors } = lintFigureSvg(svg);
		assert.ok(errors.some((e) => e.includes("outside the viewBox")), errors.join(" | "));
	});

	it("flags a zero-length arrow", () => {
		const svg = CLEAN.replace('x1="50" y1="100" x2="50" y2="160"', 'x1="50" y1="100" x2="50" y2="101"');
		assert.ok(lintFigureSvg(svg).errors.some((e) => e.includes("shorter than 4 units")));
	});

	it("warns when two labels overlap", () => {
		const svg = CLEAN.replace('<text x="58" y="172">A_y</text>', '<text x="212" y="62">B_y</text>');
		const { warnings } = lintFigureSvg(svg);
		assert.ok(warnings.some((w) => w.includes("overlap")), warnings.join(" | "));
	});

	it("warns when an arrow passes through a label", () => {
		const svg = CLEAN.replace('<text x="210" y="60">P = 10 kN</text>', '<text x="196" y="70">P</text>');
		const { warnings } = lintFigureSvg(svg);
		assert.ok(warnings.some((w) => w.includes("passes through")), warnings.join(" | "));
	});

	it("warns about near-white text on the white page", () => {
		const svg = CLEAN.replace('<text x="58" y="172">A_y</text>', '<text x="58" y="172" fill="#f5f5f5">A_y</text>');
		assert.ok(lintFigureSvg(svg).warnings.some((w) => w.includes("nearly white")));
	});

	it("rejects scripts and event handlers", () => {
		const svg = CLEAN.replace("<defs>", '<script>alert(1)</script><defs>').replace('stroke-width="2"', 'stroke-width="2" onclick="x()"');
		const { errors } = lintFigureSvg(svg);
		assert.ok(errors.some((e) => e.includes("<script>")));
		assert.ok(errors.some((e) => e.includes("onclick")));
	});

	it("rejects text that is not an svg document at all", () => {
		assert.ok(lintFigureSvg("<div>no figure here</div>").errors.length > 0);
	});

	it("accepts a double-headed moment with a start and end marker", () => {
		const svg = CLEAN.replace("</svg>", '<line class="moment" x1="300" y1="40" x2="340" y2="40" marker-start="url(#arr)" marker-end="url(#arr)"/></svg>');
		assert.deepEqual(lintFigureSvg(svg).errors, []);
	});
});

describe("colorLuminance", () => {
	it("reads hex and names", () => {
		assert.equal(colorLuminance("#fff"), 1);
		assert.equal(colorLuminance("white"), 1);
		assert.equal(colorLuminance("#000000"), 0);
		assert.equal(colorLuminance("not-a-colour"), null);
		assert.equal(colorLuminance(null), null);
	});
});
