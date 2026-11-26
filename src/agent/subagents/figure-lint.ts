import { DOMParser } from "linkedom";

/**
 * Deterministic checks on a drawn figure (free body diagrams in particular).
 * The maker sees these problems in the write_svg / edit_svg result and fixes
 * them; nothing here calls a model.
 *
 * Conventions the checks rely on (the maker is told them in its instructions):
 * - an arrow is a <line> or <path> whose class lists "arrow", "force",
 *   "reaction", "load" or "moment"; it must reference a marker that exists
 *   (marker-end; marker-start too for a double-headed moment or torque).
 * - text is measured roughly: 0.6 em per character at font-size (default 13),
 *   so the bounds are an estimate.
 */

export interface FigureLintResult {
	/** Things that make the figure wrong or unreadable: the maker must fix them. */
	errors: string[];
	/** Things to look at: overlaps and tight spots that may be intentional. */
	warnings: string[];
}

const ARROW_CLASSES = ["arrow", "force", "reaction", "load", "moment"];
const CHAR_EM = 0.6;
const DEFAULT_FONT = 13;
const FORBIDDEN = ["script", "foreignobject", "style", "animate", "animatemotion", "animatetransform", "set"];

interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

function num(value: string | null | undefined): number | null {
	if (value == null) return null;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : null;
}

/** Luminance 0..1 of a simple colour (#rgb, #rrggbb, white/black); null when unknown. */
export function colorLuminance(value: string | null | undefined): number | null {
	if (!value) return null;
	const v = value.trim().toLowerCase();
	if (v === "white") return 1;
	if (v === "black") return 0;
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
	if (!hex) return null;
	const raw = hex[1]!;
	const digits = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw;
	const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16) / 255);
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function parseViewBox(value: string | null): Box | null {
	if (!value) return null;
	const parts = value.trim().split(/[\s,]+/).map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2]! <= 0 || parts[3]! <= 0) return null;
	return { x0: parts[0]!, y0: parts[1]!, x1: parts[0]! + parts[2]!, y1: parts[1]! + parts[3]! };
}

function classTokens(element: Element): string[] {
	return (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

function styleValue(element: Element, prop: string): string | null {
	const style = element.getAttribute("style") ?? "";
	const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(style);
	return m ? m[1]!.trim() : null;
}

function fontSizeOf(element: Element): number {
	const fromStyle = num(styleValue(element, "font-size")?.replace(/px$/, ""));
	const fromAttr = num(element.getAttribute("font-size")?.replace(/px$/, ""));
	return fromStyle ?? fromAttr ?? DEFAULT_FONT;
}

/** Rough bounding box of a <text> with an explicit x/y. Null when it cannot be placed. */
export function textBox(element: Element): Box | null {
	const x = num(element.getAttribute("x"));
	const y = num(element.getAttribute("y"));
	if (x === null || y === null) return null;
	const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
	if (!text) return null;
	const size = fontSizeOf(element);
	const width = text.length * size * CHAR_EM;
	const anchor = styleValue(element, "text-anchor") ?? element.getAttribute("text-anchor") ?? "start";
	const x0 = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
	return { x0, y0: y - size * 0.8, x1: x0 + width, y1: y + size * 0.2 };
}

function overlaps(a: Box, b: Box, pad = 0): boolean {
	return a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
}

function insideBox(a: Box, outer: Box): boolean {
	return a.x0 >= outer.x0 && a.y0 >= outer.y0 && a.x1 <= outer.x1 && a.y1 <= outer.y1;
}

/** Does the straight segment come within pad of the box (sampled; enough for a lint). */
function segmentHitsBox(x1: number, y1: number, x2: number, y2: number, box: Box, pad: number): boolean {
	for (let i = 0; i <= 40; i++) {
		const t = i / 40;
		const x = x1 + (x2 - x1) * t;
		const y = y1 + (y2 - y1) * t;
		if (x >= box.x0 - pad && x <= box.x1 + pad && y >= box.y0 - pad && y <= box.y1 + pad) return true;
	}
	return false;
}

const short = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, 24);

export function lintFigureSvg(svg: string): FigureLintResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (/<!DOCTYPE|<!ENTITY|<\?/i.test(svg)) errors.push("remove the XML prolog, doctype and entities: the figure must be plain SVG markup");
	const doc = new DOMParser().parseFromString(svg, "image/svg+xml") as unknown as Document;
	const root = doc.documentElement;
	if (!root || root.localName !== "svg") return { errors: [...errors, "the figure must be one complete <svg> document"], warnings };
	const elements = Array.from(doc.querySelectorAll("*"));

	for (const element of elements) {
		const name = element.localName.toLowerCase();
		if (FORBIDDEN.includes(name)) errors.push(`remove <${name}>: figures use static marks only`);
		for (const attr of Array.from(element.attributes)) {
			if (/^on/i.test(attr.name)) errors.push(`remove the event attribute ${attr.name} on <${name}>`);
		}
	}

	const viewBox = parseViewBox(root.getAttribute("viewBox"));
	if (!viewBox) errors.push('the <svg> needs a viewBox of the form "0 0 width height" with positive size');

	const markerIds = new Set(elements.filter((e) => e.localName === "marker").map((e) => e.getAttribute("id") ?? ""));
	const refersTo = (value: string | null): string | null => {
		const m = value ? /^url\(\s*#([^)]+?)\s*\)$/.exec(value.trim()) : null;
		return m ? m[1]! : null;
	};

	const texts: { element: Element; box: Box }[] = [];
	for (const element of elements) {
		const name = element.localName;
		const classes = classTokens(element);
		const arrowClass = classes.find((c) => ARROW_CLASSES.includes(c));
		if ((name === "line" || name === "path") && arrowClass) {
			const label = `${arrowClass} arrow`;
			const headEnd = refersTo(element.getAttribute("marker-end"));
			const headStart = refersTo(element.getAttribute("marker-start"));
			const isDouble = arrowClass === "moment" && headStart !== null;
			if (!headEnd && !isDouble) {
				errors.push(`a ${label} has no arrowhead: add marker-end="url(#arr)" (a moment or torque needs both ends)`);
			}
			for (const id of [headEnd, headStart]) {
				if (id && !markerIds.has(id)) errors.push(`a ${label} points at marker "${id}", which is not defined in <defs>`);
			}
			if (name === "line") {
				const x1 = num(element.getAttribute("x1")), y1 = num(element.getAttribute("y1"));
				const x2 = num(element.getAttribute("x2")), y2 = num(element.getAttribute("y2"));
				if (x1 !== null && y1 !== null && x2 !== null && y2 !== null && Math.hypot(x2 - x1, y2 - y1) < 4) {
					errors.push(`a ${label} is shorter than 4 units: a zero-length arrow cannot show its direction`);
				}
			}
		}
		if (name === "text") {
			const box = textBox(element);
			if (box) texts.push({ element, box });
			const lum = colorLuminance(styleValue(element, "fill") ?? element.getAttribute("fill"));
			if (lum !== null && lum > 0.75) warnings.push(`text "${short(element.textContent)}" is nearly white on a white background: use a dark fill`);
		}
	}

	if (viewBox) {
		for (const { element, box } of texts) {
			if (!insideBox(box, viewBox)) errors.push(`label "${short(element.textContent)}" runs outside the viewBox: move it inside or widen the viewBox`);
		}
	}

	for (let i = 0; i < texts.length; i++) {
		for (let j = i + 1; j < texts.length; j++) {
			if (overlaps(texts[i]!.box, texts[j]!.box, 2)) {
				warnings.push(`labels "${short(texts[i]!.element.textContent)}" and "${short(texts[j]!.element.textContent)}" overlap or sit within 2 units: separate them`);
			}
		}
	}

	for (const element of elements) {
		if (element.localName !== "line") continue;
		const arrowClass = classTokens(element).find((c) => ARROW_CLASSES.includes(c));
		if (!arrowClass) continue;
		const x1 = num(element.getAttribute("x1")), y1 = num(element.getAttribute("y1"));
		const x2 = num(element.getAttribute("x2")), y2 = num(element.getAttribute("y2"));
		if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
		const hit = texts.find(({ box }) => segmentHitsBox(x1, y1, x2, y2, box, 2));
		if (hit) warnings.push(`the ${arrowClass} arrow passes through the label "${short(hit.element.textContent)}": move one of them`);
	}

	return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

/** The lint as the maker reads it back after a write or an edit. */
export function formatLintForMaker(result: FigureLintResult): string {
	if (result.errors.length === 0 && result.warnings.length === 0) return "Lint: no problems found.";
	const parts: string[] = [];
	if (result.errors.length) parts.push(`Lint errors (fix before finishing):\n${result.errors.map((e) => `- ${e}`).join("\n")}`);
	if (result.warnings.length) parts.push(`Lint warnings (fix, or confirm they are intended):\n${result.warnings.map((w) => `- ${w}`).join("\n")}`);
	return parts.join("\n");
}
