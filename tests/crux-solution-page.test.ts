/**
 * Solution pages and the Files chip (Crux, 2026-11-16): the page check
 * (electron/solution-page.cjs), saving and listing in the Hub folder
 * (electron/crux-hub.cjs local / openLocal / saveSolution), the tutor's
 * solution_page tool, and what the Files dialog shows (components/crux-files.tsx).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { createSolutionTool } from "../src/agent/tools/solution.ts";
import { notSaved, readable } from "../components/crux-files.tsx";

const require = createRequire(import.meta.url);
const { solutionProblems, withPolicy, isSolutionPage, solutionFileName, MATHJAX, CSP, CONFIG } = require("../electron/solution-page.cjs");
const { createCruxHub, cruxControl } = require("../electron/crux-hub.cjs");

const page = (body = "<svg class=\"fig\" viewBox=\"0 0 10 10\"><line x1=\"0\" y1=\"0\" x2=\"5\" y2=\"5\"/></svg><p>\\(T_A = 2000\\)</p>", head = "") =>
	`<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>EMM 302 CAT 1 marking scheme</title>\n` +
	`<script>\nwindow.MathJax = { tex: { inlineMath: [['\\\\(','\\\\)']], displayMath: [['\\\\[','\\\\]']] } };\n</script>\n` +
	`<script src="${MATHJAX}" async></script>\n<style>svg.fig { width: 100%; height: auto; }</style>${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

it("a page in the owner's format passes; the shipped EMM 302 scheme's structure passes too", () => {
	assert.deepEqual(solutionProblems(page()), []);
	const noMath = page("<svg class=\"fig\" viewBox=\"0 0 1 1\"></svg><p>No equations.</p>").replace(/<script[\s\S]*?<\/script>\n/g, "");
	assert.deepEqual(solutionProblems(noMath), []);
});

it("refuses frames, forms, remote images and the svg rule that stretches MathJax", () => {
	const has = (html: string, re: RegExp) => assert.ok(solutionProblems(html).some((p: string) => re.test(p)), `expected ${re} for ${html.slice(-200)}`);
	has(page("<iframe src=\"https://x\"></iframe>"), /Frames, forms/);
	has(page("<link rel=\"stylesheet\" href=\"https://x\">"), /Frames, forms/);
	has(page("<svg><foreignObject><div>x</div></foreignObject></svg>"), /foreignObject/);
	has(page("<a href=\"https://evil.example\">x</a>"), /Links may point only inside the page/);
	has(page("<a href=x.html>x</a>"), /Links may point only inside the page/);
	assert.deepEqual(solutionProblems(page("<svg class=\"fig\"></svg><a href=\"#q2\">Question 2</a>")), [], "links within the page are fine");
	has(page("<img src=\"https://x/fbd.png\">"), /inline SVG/);
	has(page("<img srcset=\"https://x/fbd.png 2x\">"), /inline SVG/);
	has(page("<div style=\"background:url(https://x/a.png)\"></div>"), /url\(/);
	has(page().replace("svg.fig { width: 100%", "svg { width: 100%"), /stretches every MathJax equation/);
	has("<html><body>x</body></html>", /DOCTYPE/);
	has(page().replace(/<title>.*<\/title>/, ""), /<title>/);
	assert.deepEqual(solutionProblems(""), ["The page is empty."]);
	assert.deepEqual(solutionProblems(page("<svg class=\"fig\"></svg><p>Take one = 1 and on = 2.</p>")), []);
});

it("withPolicy removes every script the tutor wrote and puts Crux's policy and MathJax right after the doctype", () => {
	const evil = page(
		"<svg/onload=alert(1)><a href=\"&#106;avascript:alert(1)\">x</a><script>fetch('https://evil.example')</script><SCRIPT >alert(2)</SCRIPT ><script src=https://evil/x.js>window.MathJax={};</script>",
		"<meta http-equiv=\"refresh\" content=\"0;url=https://evil\"><base href=\"https://evil/\">",
	).replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n<!-- <head> -->");
	const out = withPolicy(evil);
	assert.ok(isSolutionPage(out));
	assert.ok(out.startsWith("<!DOCTYPE html>\n<!-- crux-solution-page -->\n<meta http-equiv=\"Content-Security-Policy\""));
	const scripts = [...out.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
	assert.deepEqual(scripts, ["<script>", `<script src="${MATHJAX}" async>`], "only Crux's two scripts remain");
	assert.ok(out.includes(`<script>${CONFIG}</script>`));
	assert.doesNotMatch(out, /evil\.example|alert\(2\)|evil\/x\.js|http-equiv="refresh"|<base/i);
	// No inline script runs unless it is Crux's own config (hash), so handlers and javascript: links are dead too.
	const scriptSrc = /script-src ([^;]+)/.exec(CSP)![1]!;
	assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval|\*/);
	assert.match(scriptSrc, /^'sha256-[A-Za-z0-9+/=]{44}' https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mathjax\/3\.2\.2\/$/);
	assert.match(CSP, /default-src 'none'.*base-uri 'none'; form-action 'none'/);
	const hash = createHash("sha256").update(CONFIG, "utf8").digest("base64");
	assert.ok(CSP.includes(`'sha256-${hash}'`), "the hash matches the config Crux writes");
	assert.equal(isSolutionPage(page()), false);
});

it("file names are safe", () => {
	assert.equal(solutionFileName("EMM 302: CAT 1 / 2026?"), "EMM 302 CAT 1 2026.html");
	assert.equal(solutionFileName("  ..  "), "Solution.html");
	assert.equal(solutionFileName("CON"), "CON solution.html");
});

let documents: string;
let opened: string[];
let external: string[];
class FakeWindow {
	static focused: unknown = null;
	static all: FakeWindow[] = [];
	static getAllWindows() { return FakeWindow.all; }
	url = "";
	webContents = { on: () => {}, setWindowOpenHandler: () => {} };
	constructor(public options: Record<string, unknown>) { FakeWindow.all.push(this); }
	on() {}
	isDestroyed() { return false; }
	focus() {}
	async loadURL(url: string) { this.url = url; opened.push(url); }
}
const hub = () => createCruxHub({
	app: { getPath: () => documents },
	BrowserWindow: FakeWindow,
	session: { fromPartition: () => ({ fetch: async () => new Response("{}", { status: 404 }), clearStorageData: async () => {} }) },
	shell: { showItemInFolder: () => {}, openExternal: async () => {}, openPath: async (p: string) => { external.push(p); return ""; } },
});

beforeEach(() => { documents = fs.mkdtempSync(path.join(os.tmpdir(), "crux-sol-")); opened = []; external = []; FakeWindow.all = []; });
afterEach(() => { fs.rmSync(documents, { recursive: true, force: true }); });

it("saveSolution checks, saves to <unit>/Solutions with the CSP, and opens it in the reader", async () => {
	const h = hub();
	const saved = await h.saveSolution("EMM 302", "EMM 302 CAT 1 marking scheme", page());
	assert.equal(saved.path, path.join(documents, "Crux", "Hub", "EMM 302", "Solutions", "EMM 302 CAT 1 marking scheme.html"));
	assert.ok(isSolutionPage(fs.readFileSync(saved.path, "utf8")));
	assert.equal(opened.length, 1);
	assert.match(opened[0]!, /^file:\/\/.*Solutions\/EMM%20302%20CAT%201%20marking%20scheme\.html$/);
	await assert.rejects(h.saveSolution("EMM 302", "Bad", page("<iframe></iframe>")), /was not saved\. Fix: Frames/);
	await assert.rejects(h.saveSolution("not a unit", "x", page()), /not a unit code/);
});

it("local lists a unit's PDFs, pages and packs (solutions first, hub ids dropped); openLocal stays inside the Hub folder", async () => {
	const unit = path.join(documents, "Crux", "Hub", "EMM 302");
	fs.mkdirSync(path.join(unit, "Solutions"), { recursive: true });
	fs.writeFileSync(path.join(unit, "EMM 302 notes [12].pdf"), "%PDF-");
	fs.writeFileSync(path.join(unit, "EMM 302 checked solutions.md"), "# pack");
	fs.writeFileSync(path.join(unit, "Solutions", "CAT 1.html"), withPolicy(page()));
	fs.writeFileSync(path.join(unit, "other page.html"), page());
	fs.writeFileSync(path.join(unit, "run.bat"), "echo hi");
	fs.writeFileSync(path.join(unit, "photo.jpg"), "x");
	const h = hub();
	const list = h.local("EMM 302");
	assert.deepEqual(list.map((f: any) => [f.name, f.kind, f.solution]).sort(), [
		["CAT 1.html", "html", true], ["EMM 302 checked solutions.md", "md", true], ["EMM 302 notes.pdf", "pdf", false], ["other page.html", "html", false],
	].sort());
	assert.deepEqual(h.local("EMM 999"), []);
	assert.throws(() => h.local("../x"), /Pick a unit/);

	await h.openLocal(path.join(unit, "EMM 302 notes [12].pdf"), 4);
	assert.match(opened.at(-1)!, /notes%20%5B12%5D\.pdf#page=4$/);
	await h.openLocal(path.join(unit, "Solutions", "CAT 1.html"), 4);
	assert.match(opened.at(-1)!, /CAT%201\.html$/, "a page number is only for PDFs");
	// A page Crux did not save (no policy) goes to the browser, as hub HTML always did; other file types are refused.
	await h.openLocal(path.join(unit, "other page.html"), null);
	assert.deepEqual(external, [path.join(unit, "other page.html")]);
	await assert.rejects(h.openLocal(path.join(unit, "run.bat"), null), /isn't in the Hub folder/);
	await assert.rejects(h.openLocal(path.join(documents, "outside.pdf"), null), /isn't in the Hub folder/);
	await assert.rejects(h.openLocal(path.join(unit, "..", "..", "..", "x.pdf"), null), /isn't in the Hub folder/);

	const reply = await cruxControl({ op: "local", unit: "EMM 302" }, h, null);
	assert.equal(reply.ok, true);
	const bad = await cruxControl({ op: "openLocal", path: "C:\\Windows\\win.ini" }, h, null);
	assert.deepEqual([bad.ok, bad.code], [false, "bad-request"]);
});

it("solution_page sends the page to the main process and tells the tutor where it is", async () => {
	const calls: any[] = [];
	const tool = createSolutionTool(async (op: string, fields: Record<string, unknown> = {}) => {
		calls.push({ op, ...fields });
		return fields.title === "refused" ? { ok: false, code: "bad-request", error: "The page was not saved. Fix: x" } as any : { ok: true, value: { path: "C:\\Hub\\EMM 302\\Solutions\\a.html" } } as any;
	});
	const text = (r: any) => r.content.map((c: any) => c.text ?? "").join("");
	const ok = text(await tool.execute("c1", { unit: "emm302", title: "EMM 302 CAT 1", html: page() }, undefined));
	assert.equal(calls[0].op, "saveSolution");
	assert.equal(calls[0].unit, "EMM 302");
	assert.match(ok, /Saved and opened beside the lesson: C:\\Hub\\EMM 302\\Solutions\\a\.html/);
	assert.match(text(await tool.execute("c2", { unit: "EMM 302", title: "refused", html: page() }, undefined)), /solution_page failed: The page was not saved/);
	assert.match(text(await tool.execute("c3", { unit: "strength", title: "xyz", html: page() }, undefined)), /not a unit code/);
});

it("the Files dialog shows PDFs and pages (solutions apart) and only Hub PDFs not saved yet", () => {
	const r = readable([
		{ name: "a.html", path: "a", kind: "html", solution: true },
		{ name: "p.md", path: "p", kind: "md", solution: true },
		{ name: "n.pdf", path: "n", kind: "pdf", solution: false },
	]);
	assert.deepEqual(r.solutions.map((f) => f.name), ["a.html"]);
	assert.deepEqual(r.saved.map((f) => f.name), ["n.pdf"]);
	assert.deepEqual(notSaved([
		{ id: "1", name: "a.pdf", paper: true, pages: 2, path: null },
		{ id: "2", name: "b.pdf", paper: true, pages: 2, path: "x" },
		{ id: "3", name: "c.docx", paper: false, pages: null, path: null },
	]).map((f) => f.id), ["1"]);
});
