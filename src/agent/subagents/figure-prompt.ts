/**
 * The figure's content as structured data, and the ready-to-paste prompt that
 * an image AI (Gemini, ChatGPT, ...) turns into the same diagram. The visual
 * maker writes the spec after its notes; this module parses it, checks its
 * shape, and renders the prompt. Pure: no model, no I/O.
 */

export interface FigureForce {
	/** The symbol used in the equations, e.g. "P" or "A_x". */
	label: string;
	/** Magnitude with unit, e.g. "10 kN"; "unknown" for a reaction to solve. */
	value: string;
	/** Direction in words, e.g. "downward", "to the right, 30° above horizontal". */
	direction: string;
	/** The point it acts on, e.g. "point B". */
	point: string;
}

export interface FigureMoment {
	label: string;
	value: string;
	/** "clockwise" or "counter-clockwise", as seen by the reader. */
	sense: string;
	point: string;
}

export interface FigureDistributed {
	label: string;
	/** Intensity with unit, e.g. "w = 2 kN/m". */
	intensity: string;
	/** Where it acts, e.g. "from A to B". */
	extent: string;
	/** The resultant and where it acts, e.g. "R = 8 kN at 2 m from A". */
	resultant: string;
}

export interface FigureSupport {
	/** "pin", "roller", "smooth surface", "link", "fixed" or similar. */
	type: string;
	point: string;
	/** The reaction symbols drawn in its place, e.g. ["A_x", "A_y"]. */
	reactions: string[];
}

export interface FigureDimension {
	/** The two points or edges the dimension runs between. */
	between: string;
	value: string;
}

export interface FigureSpec {
	kind: "fbd" | "diagram";
	title: string;
	/** The body or object, e.g. "a uniform beam AB, 4 m long, horizontal". */
	body: string;
	forces: FigureForce[];
	moments: FigureMoment[];
	distributed: FigureDistributed[];
	supports: FigureSupport[];
	dimensions: FigureDimension[];
	/** Where the axes go and which way is positive, e.g. "x to the right, y up, origin at A". */
	axes?: string;
	/** Anything else the drawing must show. */
	notes?: string;
}

const MAX_ITEMS = 30;
const MAX_TEXT = 300;
export const FIGURE_SPEC_MARKER = "FIGURE_SPEC:";

const text = (value: unknown, fallback = ""): string => {
	if (typeof value !== "string") return fallback;
	return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
};
const items = <T>(value: unknown, map: (row: Record<string, unknown>) => T | null): T[] => {
	if (!Array.isArray(value)) return [];
	const out: T[] = [];
	for (const row of value.slice(0, MAX_ITEMS)) {
		if (row && typeof row === "object") {
			const mapped = map(row as Record<string, unknown>);
			if (mapped) out.push(mapped);
		}
	}
	return out;
};

/** Checks the shape of a parsed spec and trims it. Null when it is not usable. */
export function normaliseFigureSpec(value: unknown): FigureSpec | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const spec: FigureSpec = {
		kind: raw.kind === "diagram" ? "diagram" : "fbd",
		title: text(raw.title),
		body: text(raw.body),
		forces: items(raw.forces, (r) => {
			const label = text(r.label), point = text(r.point);
			return label && point ? { label, value: text(r.value, "unknown"), direction: text(r.direction), point } : null;
		}),
		moments: items(raw.moments, (r) => {
			const label = text(r.label), point = text(r.point);
			return label && point ? { label, value: text(r.value, "unknown"), sense: text(r.sense, "as drawn"), point } : null;
		}),
		distributed: items(raw.distributed, (r) => {
			const label = text(r.label);
			return label ? { label, intensity: text(r.intensity), extent: text(r.extent), resultant: text(r.resultant) } : null;
		}),
		supports: items(raw.supports, (r) => {
			const point = text(r.point), type = text(r.type);
			if (!point || !type) return null;
			const reactions = Array.isArray(r.reactions) ? r.reactions.map((x) => text(x)).filter(Boolean).slice(0, 4) : [];
			return { type, point, reactions };
		}),
		dimensions: items(raw.dimensions, (r) => {
			const between = text(r.between), value = text(r.value);
			return between && value ? { between, value } : null;
		}),
		...(text(raw.axes) ? { axes: text(raw.axes) } : {}),
		...(text(raw.notes) ? { notes: text(raw.notes) } : {}),
	};
	const content = spec.body || spec.forces.length + spec.moments.length + spec.distributed.length + spec.supports.length + spec.dimensions.length;
	if (!spec.title || !content) return null;
	return spec;
}

/**
 * Finds the spec in the maker's final message: everything after the
 * FIGURE_SPEC: marker, as a JSON object (a code fence around it is allowed).
 * Returns the notes before the marker too.
 */
export function splitFigureSpec(finalText: string): { notes: string; spec: FigureSpec | null } {
	const at = finalText.indexOf(FIGURE_SPEC_MARKER);
	if (at < 0) return { notes: finalText.trim(), spec: null };
	const notes = finalText.slice(0, at).trim();
	let json = finalText.slice(at + FIGURE_SPEC_MARKER.length).trim();
	json = json.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
	const start = json.indexOf("{");
	const end = json.lastIndexOf("}");
	if (start < 0 || end <= start) return { notes, spec: null };
	try {
		return { notes, spec: normaliseFigureSpec(JSON.parse(json.slice(start, end + 1))) };
	} catch {
		return { notes, spec: null };
	}
}

const list = (lines: string[]) => lines.map((line) => `  - ${line}`).join("\n");

/**
 * The prompt a student pastes into Gemini (or any image AI). It names every
 * force, support, distributed load, moment and dimension, and says what not
 * to draw, so the image matches the figure Crux drew.
 */
export function buildImagePrompt(spec: FigureSpec): string {
	const sections: string[] = [];
	const isFbd = spec.kind === "fbd";
	sections.push(
		isFbd
			? "Draw a clean engineering free-body diagram (statics / mechanics) of the isolated body described below, as a textbook line drawing."
			: "Draw a clean engineering textbook diagram of the figure described below, as a line drawing.",
	);
	sections.push(
		"Style: white background, black lines of even weight, sans-serif labels, labelled arrows with filled heads, lengths roughly to scale, no shading, no gradients, no 3D or perspective, no colour except black, no decoration, no watermark, no title block.",
	);
	if (spec.title) sections.push(`Title (small, optional): ${spec.title}`);
	if (spec.body) sections.push(`The body: ${spec.body}.`);

	if (spec.forces.length) {
		sections.push(
			"Forces. Each is a single-headed arrow that starts on the point it acts on, points the stated way, and carries its label and value:\n" +
				list(spec.forces.map((f) => `${f.label} = ${f.value}, ${f.direction || "direction as drawn"}, acting at ${f.point}`)),
		);
	}
	if (spec.moments.length) {
		sections.push(
			"Moments and couples. Each is a curved arrow around the point, with its label and value:\n" +
				list(spec.moments.map((m) => `${m.label} = ${m.value}, ${m.sense}, at ${m.point}`)),
		);
	}
	if (spec.distributed.length) {
		sections.push(
			"Distributed loads. Draw several short arrows along the span, labelled with the intensity, and one resultant arrow at the stated point:\n" +
				list(spec.distributed.map((d) => `${d.label}: ${d.intensity}, ${d.extent}${d.resultant ? `; resultant ${d.resultant}` : ""}`)),
		);
	}
	if (spec.supports.length) {
		sections.push(
			(isFbd
				? "Supports are replaced by their reactions (no support symbols or hatching). Draw each reaction as an arrow at its point:\n"
				: "Supports (draw the standard symbol for each type):\n") +
				list(
					spec.supports.map((s) =>
						isFbd
							? `${s.type} at ${s.point}: ${s.reactions.length ? s.reactions.join(" and ") : "its reaction components"}`
							: `${s.type} at ${s.point}`,
					),
				),
		);
	}
	if (spec.dimensions.length) {
		sections.push(
			"Dimensions. Draw a dimension line with arrowheads at both ends, outside the body, labelled with the value:\n" +
				list(spec.dimensions.map((d) => `${d.value}, between ${d.between}`)),
		);
	}
	if (spec.axes) sections.push(`Coordinate axes: draw x and y arrows at one corner, labelled x and y. ${spec.axes}.`);
	if (spec.notes) sections.push(`Also: ${spec.notes}`);

	sections.push(
		"Use the symbols and values exactly as written. Do not draw any other force, moment, label or number.\n" +
			"Do NOT draw: the solution or any answer, equations, extra forces or dimensions, shading, colour, 3D views, background grids, or text other than the labels listed above.",
	);
	return sections.join("\n\n");
}
