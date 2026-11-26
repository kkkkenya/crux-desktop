/**
 * PDF read routing and plain-language disclaimers (pure: no I/O, safe to test).
 *
 * Why this exists: the pdf-reader's pictures path (pdf_render) sends page images
 * to the model. Text-only models (DeepSeek Flash on the Crux relay) get those images
 * stripped, so they read nothing and used to say so nowhere. Every case where a PDF
 * is not fully read now yields one plain sentence the learner sees, and the model is
 * told to pass it on rather than pretend it read the pictures.
 */

/** Failure briefs start with this (job cards, steers and the runner key on it). */
export const PDF_FAILED_PREFIX = "PDF failed:";

/** How many page numbers a notice lists before it says "and N more". */
const LIST_LIMIT = 8;

export type PdfRoute =
	/** The selected model reads images: render visual pages as usual. */
	| { kind: "selected" }
	/** The selected model is text-only, but the plan has an image-capable model. */
	| { kind: "fallback"; modelId: string }
	/** Text-only and nothing image-capable is available: text extraction only. */
	| { kind: "text-only" };

/** Pure routing decision for a PDF read. */
export function pdfRoute(selectedSeesImages: boolean, fallbackModelId: string | undefined): PdfRoute {
	if (selectedSeesImages) return { kind: "selected" };
	if (fallbackModelId) return { kind: "fallback", modelId: fallbackModelId };
	return { kind: "text-only" };
}

/** "page 3", "pages 3 and 5", "pages 1, 2, 3 and 4 (and 6 more)". */
export function pagePhrase(pages: readonly number[]): string {
	const sorted = [...new Set(pages)].sort((a, b) => a - b);
	if (sorted.length === 1) return `page ${sorted[0]}`;
	const shown = sorted.slice(0, LIST_LIMIT);
	const rest = sorted.length - shown.length;
	const head = shown.slice(0, -1).join(", ");
	const tail = shown[shown.length - 1];
	const list = shown.length === 1 ? `${tail}` : `${head} and ${tail}`;
	return `pages ${list}${rest > 0 ? ` (and ${rest} more)` : ""}`;
}

/** A scan or picture-only PDF: no page has a text layer. */
export function isScannedPdf(pages: readonly { text_length: number }[]): boolean {
	return pages.length > 0 && pages.every((p) => p.text_length < 20);
}

/** Pages whose pictures, diagrams or equations the text does not carry. */
export function visualPages(pages: readonly { page: number; image_count: number; math_density: number }[]): number[] {
	return pages.filter((p) => p.image_count > 0 || p.math_density >= 0.03).map((p) => p.page);
}

const IMAGE_FIX = "Switch your vision model in Settings to one that accepts images, such as Gemini, then send it again.";
const PICTURES_FIX = "To read them, switch your vision model in Settings to one that accepts images, such as Gemini.";

/** The notice for a text-only read that skipped pictures. Empty pages list = no notice. */
export function textOnlyFiguresNotice(modelName: string, skippedPages: readonly number[]): string | undefined {
	if (skippedPages.length === 0) return undefined;
	return `I couldn't read the pictures, diagrams or equations on ${pagePhrase(skippedPages)} of this PDF, because ${modelName} reads text only. ${PICTURES_FIX}`;
}

/** The failure brief (already prefixed) for a scanned PDF read by a text-only model. */
export function scannedTextOnlyFailure(modelName: string): string {
	return `${PDF_FAILED_PREFIX} This PDF has no text layer, so it is a scan or pictures only, and ${modelName} reads text only, so I couldn't read it. ${IMAGE_FIX}`;
}

/**
 * Plain sentence for a PDF that could not be opened, from a pdf.js error name
 * or a local file check message. Returns the prefixed failure brief.
 */
export function unreadablePdfFailure(err: { name?: string; message?: string }): string {
	const name = err.name ?? "";
	const message = (err.message ?? "").toLowerCase();
	if (name === "PasswordException" || message.includes("password")) {
		return `${PDF_FAILED_PREFIX} This PDF is password-protected, so I can't open it. Remove the password in your PDF app, then send it again.`;
	}
	if (name === "MissingPDFException" || message.includes("enoent") || message.includes("no such file")) {
		return `${PDF_FAILED_PREFIX} I couldn't find this file. Check the path and send it again.`;
	}
	if (message.includes("access denied") || message.includes("protected location") || message.includes("not allowed")) {
		return `${PDF_FAILED_PREFIX} I'm not allowed to open this file. Copy it into a folder you have allowed in File access settings, then send it again.`;
	}
	if (message.includes("file is empty")) {
		return `${PDF_FAILED_PREFIX} This file is empty.`;
	}
	if (message.includes("not a regular file")) {
		return `${PDF_FAILED_PREFIX} This path is not a file I can read.`;
	}
	if (name === "InvalidPDFException" || message.includes("invalid pdf") || message.includes("not a readable pdf")) {
		return `${PDF_FAILED_PREFIX} This file is not a PDF I can read, so it may be damaged. Download or export it again and send it again.`;
	}
	return `${PDF_FAILED_PREFIX} I couldn't open this PDF. Try exporting it again.`;
}

/** The plain sentence a reader's crash or iteration limit gets. */
export function readerCrashFailure(): string {
	return `${PDF_FAILED_PREFIX} I started reading this PDF but could not finish. Ask again, or ask about a smaller part of it.`;
}

/** Model-facing instruction when the read carries a notice: say it, don't pretend. */
export function noticeForModel(notice: string): string {
	return `Tell the learner this, in your own words, before the brief: "${notice}" Do not describe pictures, diagrams or equations you were not shown.`;
}

/** Pure plan for a picture read (notes import, figures): which engine reads the
 *  pictures, and the one visible notice when none can. */
export function pictureReadPlan(input: {
	selectedSeesImages: boolean;
	fallbackAvailable: boolean;
	skippedPages: readonly number[];
	modelName: string;
}): { mode: "selected" | "fallback" | "text-only"; notice?: string } {
	if (input.selectedSeesImages) return { mode: "selected" };
	if (input.fallbackAvailable) return { mode: "fallback" };
	return { mode: "text-only", notice: textOnlyFiguresNotice(input.modelName, input.skippedPages) };
}

/** The one plain sentence a figure gets when no image-capable model is available. */
export function figureNeedsPicturesNotice(modelName: string): string {
	return `I couldn't draw this figure from the PDF page, because ${modelName} reads text only. Switch your vision model in Settings to one that accepts images, such as Gemini, then try again.`;
}
