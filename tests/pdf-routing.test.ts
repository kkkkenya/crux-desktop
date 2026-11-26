/**
 * PDF read routing and disclaimers: the pure decisions (pdf-disclaimer.ts) and
 * the reader's text-only path (a picture-blind model never gets page images,
 * a fallback image model takes over when the plan has one, a scan says so).
 */
import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import { runPdfReaderAgent } from "../src/agent/subagents/pdf-reader.ts";
import type { HeadlessApi } from "../src/agent/subagents/headless.ts";
import {
	isScannedPdf,
	pagePhrase,
	figureNeedsPicturesNotice,
	pictureReadPlan,
	pdfRoute,
	scannedTextOnlyFailure,
	textOnlyFiguresNotice,
	unreadablePdfFailure,
	visualPages,
} from "../src/agent/pdf-disclaimer.ts";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "sample-3page.pdf");

function engineWith(input: ("text" | "image")[], steps: FauxResponseStep[], name = "DeepSeek Flash"): PiEngine {
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	faux.setResponses(steps);
	const model = { ...faux.getModel(), input, name } as PiEngine["model"];
	return { model, streamFn: faux.streamSimple };
}

function spyHeadless(): HeadlessApi & { renders: number } {
	const api = {
		renders: 0,
		available: () => true,
		unavailableReason: () => null,
		runDemo: async () => {
			throw new Error("unused");
		},
		renderSvg: async () => {
			throw new Error("unused");
		},
		renderPdfPages: async () => {
			api.renders++;
			return [];
		},
	};
	return api;
}

describe("pdf-disclaimer: pure decisions", () => {
	it("routes to the selected model when it sees images, else to the fallback, else text-only", () => {
		assert.deepEqual(pdfRoute(true, "gemini-x"), { kind: "selected" });
		assert.deepEqual(pdfRoute(false, "gemini-x"), { kind: "fallback", modelId: "gemini-x" });
		assert.deepEqual(pdfRoute(false, undefined), { kind: "text-only" });
	});

	it("names pages plainly and caps long lists", () => {
		assert.equal(pagePhrase([3]), "page 3");
		assert.equal(pagePhrase([5, 3]), "pages 3 and 5");
		assert.equal(pagePhrase([1, 2, 3]), "pages 1, 2 and 3");
		assert.match(pagePhrase(Array.from({ length: 12 }, (_, i) => i + 1)), /^pages 1, 2, 3, 4, 5, 6, 7 and 8 \(and 4 more\)$/);
	});

	it("text-only notice names the model and the skipped pages; no skipped pages means no notice", () => {
		assert.equal(textOnlyFiguresNotice("DeepSeek Flash", []), undefined);
		assert.equal(
			textOnlyFiguresNotice("DeepSeek Flash", [4, 2]),
			"I couldn't read the pictures, diagrams or equations on pages 2 and 4 of this PDF, because DeepSeek Flash reads text only. To read them, switch your vision model in Settings to one that accepts images, such as Gemini.",
		);
	});

	it("a scan (no text on any page) is a failure that says so; a text page is not", () => {
		assert.equal(isScannedPdf([{ text_length: 0 }, { text_length: 5 }]), true);
		assert.equal(isScannedPdf([{ text_length: 0 }, { text_length: 800 }]), false);
		assert.equal(isScannedPdf([]), false);
		assert.match(scannedTextOnlyFailure("DeepSeek Flash"), /^PDF failed: This PDF has no text layer, so it is a scan/);
	});

	it("visual pages are the ones with pictures or dense math", () => {
		assert.deepEqual(
			visualPages([
				{ page: 1, image_count: 0, math_density: 0 },
				{ page: 2, image_count: 1, math_density: 0 },
				{ page: 3, image_count: 0, math_density: 0.05 },
			]),
			[2, 3],
		);
	});

	it("unreadable files get a plain sentence per cause, never the raw error", () => {
		assert.match(unreadablePdfFailure({ name: "PasswordException", message: "No password given" }), /^PDF failed: This PDF is password-protected/);
		assert.match(unreadablePdfFailure({ name: "InvalidPDFException", message: "Invalid PDF structure." }), /may be damaged/);
		assert.match(unreadablePdfFailure({ message: "ENOENT: no such file or directory" }), /couldn't find this file/);
		assert.match(unreadablePdfFailure({ message: "Access denied: /x is a protected location." }), /not allowed to open this file/);
		assert.match(unreadablePdfFailure({ message: "file is empty" }), /This file is empty/);
		assert.match(unreadablePdfFailure({ name: "Error", message: "something odd" }), /^PDF failed: I couldn't open this PDF/);
	});
});

describe("pdf-reader: text-only and fallback reads", () => {
	it("a text-only model never gets pdf_render, never renders, and keeps the read honest", async () => {
		const headless = spyHeadless();
		let offered: string[] = [];
		const engine = engineWith(["text"], [
			fauxAssistantMessage([fauxToolCall("pdf_info", {}, { id: "i1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("pdf_render", { pages: "1" }, { id: "r1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("pdf_extract", { pages: "1" }, { id: "e1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("The text on page 1 gives the integral rule (p. 1).")]),
		]);
		const stream = engine.streamFn;
		engine.streamFn = (model, context, options) => {
			offered = ((context as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name);
			return stream(model, context, options);
		};
		const result = await runPdfReaderAgent({ path: FIXTURE, question: "page 1?" }, { engine, headless });
		assert.equal(headless.renders, 0, "no page image is ever rendered for a text-only model");
		assert.ok(!offered.includes("pdf_render"), "pdf_render is not offered to a text-only model");
		assert.deepEqual(result.pagesRead, [1], "only the extracted page is read; the refused render adds nothing");
		assert.match(result.brief, /integral rule/);
	});

	it("with an image fallback, the picture-blind selected model is never called and the fallback reads", async () => {
		let selectedCalls = 0;
		const selected = engineWith(["text"], []);
		selected.streamFn = () => {
			selectedCalls++;
			throw new Error("the text-only model must not be called");
		};
		const fallback = engineWith(
			["text", "image"],
			[
				fauxAssistantMessage([fauxToolCall("pdf_extract", { pages: "1" }, { id: "e1" })], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxText("Page 1 covers the integral rule (p. 1).")]),
			],
			"Gemini",
		);
		const result = await runPdfReaderAgent(
			{ path: FIXTURE, question: "page 1?" },
			{ engine: selected, imageFallback: () => fallback, headless: spyHeadless() },
		);
		assert.equal(selectedCalls, 0);
		assert.deepEqual(result.pagesRead, [1]);
		assert.equal(result.notice, undefined, "a fully routed read carries no skipped-pictures notice");
	});

	it("a picture-capable selected model reads as before: no fallback is asked for", async () => {
		let asked = 0;
		const engine = engineWith(["text", "image"], [
			fauxAssistantMessage([fauxToolCall("pdf_extract", { pages: "1" }, { id: "e1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Page 1 (p. 1).")]),
		]);
		const result = await runPdfReaderAgent(
			{ path: FIXTURE, question: "x" },
			{
				engine,
				imageFallback: () => {
					asked++;
					return undefined;
				},
			},
		);
		assert.equal(asked, 0);
		assert.match(result.brief, /Page 1/);
	});
});

describe("picture reads: notes import and figures", () => {
	it("a picture-capable selected model is used as is", () => {
		assert.deepEqual(pictureReadPlan({ selectedSeesImages: true, fallbackAvailable: false, skippedPages: [2], modelName: "Gemini" }), { mode: "selected" });
	});

	it("a text-only model with an image fallback routes the pictures there, with no notice", () => {
		assert.deepEqual(pictureReadPlan({ selectedSeesImages: false, fallbackAvailable: true, skippedPages: [2], modelName: "DeepSeek Flash" }), { mode: "fallback" });
	});

	it("a text-only model with no fallback never drops pages silently: the notice names them", () => {
		const plan = pictureReadPlan({ selectedSeesImages: false, fallbackAvailable: false, skippedPages: [3, 1], modelName: "DeepSeek Flash" });
		assert.equal(plan.mode, "text-only");
		assert.match(plan.notice ?? "", /pictures, diagrams or equations on pages 1 and 3 of this PDF, because DeepSeek Flash reads text only/);
	});

	it("a figure with no picture-capable model gets one plain sentence, no prefix", () => {
		assert.equal(
			figureNeedsPicturesNotice("DeepSeek Flash"),
			"I couldn't draw this figure from the PDF page, because DeepSeek Flash reads text only. Switch your vision model in Settings to one that accepts images, such as Gemini, then try again.",
		);
	});
});
