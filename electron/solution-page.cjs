"use strict";

/*
 * Solution pages (Crux, 2026-11-16): a marking scheme or worked solution as ONE
 * self-contained HTML file, with the free body diagrams drawn as inline SVG and
 * the equations in MathJax. The tutor writes it (src/agent/tools/solution.ts);
 * the main process checks it here, saves it to Documents/Crux/Hub/<unit>/Solutions
 * and opens it in the reader window. The owner's format is in
 * src/agent/prompts/shared/36-marking-scheme.md.
 *
 * The tutor's page is never trusted to run code (its text can come from a PDF a
 * student added). Every <script> it wrote is removed; Crux puts in its own MathJax
 * setup and a Content-Security-Policy that allows only that setup (by hash) and the
 * MathJax 3.2.2 folder on cdnjs. No 'unsafe-inline' for scripts, so inline handlers
 * and javascript: links cannot run either. Both go straight after the doctype, where
 * the parser puts them in <head> and no comment or later tag can move them.
 */

const crypto = require("node:crypto");

const MATHJAX = "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js";
const MATHJAX_DIR = "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/";
// The MathJax setup, and the text the student selects, sent to Crux's viewer for "Add to notes" (crux-reader.tsx).
const CONFIG = "window.MathJax = { tex: { inlineMath: [['\\\\(','\\\\)']], displayMath: [['\\\\[','\\\\]']] }, svg: { fontCache: 'global' } };" +
	"(function () { var tell = function () { var s = String(window.getSelection() || '').trim().slice(0, 2000);" +
	" if (window.parent !== window) window.parent.postMessage({ cruxSelection: s }, '*'); };" +
	" document.addEventListener('mouseup', function () { setTimeout(tell, 0); }); document.addEventListener('keyup', tell); })();";
const CONFIG_HASH = crypto.createHash("sha256").update(CONFIG, "utf8").digest("base64");
const CSP = `default-src 'none'; script-src 'sha256-${CONFIG_HASH}' ${MATHJAX_DIR}; style-src 'unsafe-inline'; ` +
	`img-src data:; font-src data:; connect-src ${MATHJAX_DIR}; base-uri 'none'; form-action 'none'`;
/** Marks a page Crux saved, so the reader knows it carries the policy. */
const MARK = "<!-- crux-solution-page -->";
const MAX_BYTES = 1_500_000;

/** Problems with a solution page, as plain sentences for the tutor. Empty means it can be saved. */
function solutionProblems(html) {
	if (typeof html !== "string" || !html.trim()) return ["The page is empty."];
	const problems = [];
	if (Buffer.byteLength(html, "utf8") > MAX_BYTES) problems.push("The page is larger than 1.5 MB. Draw the figures with fewer points.");
	if (!/^\s*<!doctype html>/i.test(html)) problems.push("The page must start with <!DOCTYPE html>.");
	if (!/<head[\s>]/i.test(html) || !/<body[\s>]/i.test(html)) problems.push("The page needs a <head> and a <body>.");
	if (!/<title>[^<]{2,}<\/title>/i.test(html)) problems.push("The page needs a <title>.");
	if (/<(iframe|object|embed|frame|frameset|form|link|base|foreignObject)\b/i.test(html)) problems.push("Frames, forms, <link>, <base> and <foreignObject> are not allowed.");
	if (/<(img|image|use|source)\b[^>]*\b(src|srcset|href|xlink:href)\s*=\s*["']?(?!data:|#)/i.test(html)) problems.push("Images must be inline SVG (or data: URLs), not files or web links.");
	if (/<a\b[^>]*\bhref\s*=\s*(?:"(?!#)|'(?!#)|(?!["'#]))/i.test(html)) problems.push("Links may point only inside the page (#id): the page opens with no web pages around it.");
	if (/url\(\s*["']?(?!data:|#)/i.test(html)) problems.push("CSS url(...) may point only to data: or #ids.");
	// The template's bare "svg { width: 100% }" also stretches MathJax's own SVG output: each symbol fills the line.
	if (/(^|[}\s,>;])svg\s*\{[^}]*width\s*:\s*100%/i.test(html)) problems.push("Scope the figure CSS to a class (svg.fig { width: 100% }); a bare svg rule also stretches every MathJax equation.");
	return [...new Set(problems)];
}

/**
 * The page as Crux saves it: the tutor's scripts and http-equiv/base tags removed,
 * then Crux's policy and MathJax right after the doctype.
 */
function withPolicy(html) {
	const body = String(html)
		.replace(/^\s*<!doctype html>/i, "")
		.replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, "")
		.replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "")
		.replace(/<base\b[^>]*>/gi, "");
	return `<!DOCTYPE html>\n${MARK}\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n` +
		`<script>${CONFIG}</script>\n<script src="${MATHJAX}" async></script>\n${body.replace(/^\s+/, "")}`;
}

/** Whether a saved HTML file is one Crux wrote with the policy (safe for the reader window). */
function isSolutionPage(text) {
	return typeof text === "string" && text.startsWith(`<!DOCTYPE html>\n${MARK}\n<meta http-equiv="Content-Security-Policy"`);
}

/** A file name from the page title: "EMM 302 CAT 1 2026-27 marking scheme.html". */
function solutionFileName(title) {
	let base = String(title ?? "")
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[ .]+|[ .]+$/g, "")
		.slice(0, 120);
	if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `${base} solution`;
	return `${base || "Solution"}.html`;
}

module.exports = { solutionProblems, withPolicy, isSolutionPage, solutionFileName, MATHJAX, CSP, CONFIG };
