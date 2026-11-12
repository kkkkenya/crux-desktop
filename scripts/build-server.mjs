/**
 * build-server.mjs — curate the Electron shell's server payload.
 *
 * `next build` (output: "standalone") produces .next/standalone/ with
 * server.js + the traced node_modules subset, but leaves two pieces
 * outside that the docs require us to copy: public/ and .next/static/.
 * This script finishes the job and sanity-checks the result — including
 * the exclusion that keeps the repo's real data/ OUT of the bundle
 * (see next.config.ts outputFileTracingExcludes). It also removes two
 * exact build-only paths the tracer sweeps in: old installers and the
 * development Electron runtime. Broad trace exclusions break externals.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

const copyTree = (from, to) => {
	fs.cpSync(from, to, { recursive: true });
};

const exists = (p) => fs.existsSync(p);

if (!exists(path.join(STANDALONE, "server.js"))) {
	console.error("[build-server] .next/standalone/server.js missing — run `next build` first (output: 'standalone').");
	process.exit(1);
}

// 1) Static assets: public/ → standalone/public, .next/static → standalone/.next/static
const staticFrom = path.join(ROOT, ".next", "static");
const staticTo = path.join(STANDALONE, ".next", "static");
if (!exists(staticFrom)) {
	console.error("[build-server] .next/static missing — the build looks incomplete.");
	process.exit(1);
}
copyTree(staticFrom, staticTo);
if (exists(path.join(ROOT, "public"))) {
	copyTree(path.join(ROOT, "public"), path.join(STANDALONE, "public"));
}

// 2) Safety: the repo's real data/ must NEVER ride along in the bundle.
const leakedData = path.join(STANDALONE, "data");
if (exists(leakedData)) {
	console.error("[build-server] REFUSING: standalone contains a data/ directory — repo session data would ship in the app.");
	console.error("             Check outputFileTracingExcludes in next.config.ts.");
	process.exit(1);
}

// 2b) Safety: the repo's dev SECRETS must never ride along either — the
// same trace sweep that catches data/ shipped the repo-root auth.json
// (the DEV BYOK key store, 0600) byte-identical into the DMG (caught in
// the 2026-10-08 payload audit; excluded in next.config.ts — this guard
// makes a regression loud instead of silent).
const subscriptionSecrets = fs.readdirSync(STANDALONE).filter((name) => /^(chatgpt|github-copilot|xai)-credentials\.json/.test(name));
for (const secret of ["auth.json", ...subscriptionSecrets, ".env", ".env.local"]) {
	if (exists(path.join(STANDALONE, secret))) {
		console.error(`[build-server] REFUSING: standalone contains ${secret} — dev secrets would ship in the app.`);
		console.error("             Check outputFileTracingExcludes in next.config.ts.");
		process.exit(1);
	}
}

// 2c) Payload curation (2026-10-11): the trace sweep can copy repo-root
// dist/ (previous installers, recursively) and the development Electron
// runtime (the demo helper's dev-only require). Neither belongs in the
// server: packaged helpers use process.execPath, the app's own binary.
// Remove ONLY these standalone-root paths AFTER tracing — excluding a
// generic dist/** earlier broke pi-ai / pi-agent-core's runtime dist/.
// Never touch ROOT/dist or ROOT/node_modules/electron (the running app
// and the build runtime); native canvas/resvg packages stay untouched.
for (const extra of ["dist", path.join("node_modules", "electron")]) {
	const target = path.join(STANDALONE, extra);
	if (exists(target)) {
		fs.rmSync(target, { recursive: true, force: true });
		console.log(`[build-server] removed build-only payload: ${extra}`);
	}
}

// 2d) Nested externals (Crux, 2026-11-12): Next links each external package into
// .next/node_modules/<name>-<hash>. When the real package lives NESTED (for example
// node_modules/@streamdown/code/node_modules/shiki), its dependencies sit beside it in
// that nested node_modules. On Windows the packager copies the link as a plain folder,
// so the copy can no longer see those neighbours and the packaged server answers 500
// ("Cannot find package '@shikijs/core'"), while the in-repo smoke test still passes.
// Copy the neighbours to the payload's top-level node_modules, where every copy can
// resolve them. Never overwrite a package that is already there.
function hoistNestedNeighbours() {
	const linkRoot = path.join(STANDALONE, ".next", "node_modules");
	if (!exists(linkRoot)) return;
	const top = path.join(STANDALONE, "node_modules");
	const links = [];
	for (const entry of fs.readdirSync(linkRoot, { withFileTypes: true })) {
		const full = path.join(linkRoot, entry.name);
		if (entry.isSymbolicLink()) links.push(full);
		else if (entry.isDirectory() && entry.name.startsWith("@")) {
			for (const scoped of fs.readdirSync(full, { withFileTypes: true })) if (scoped.isSymbolicLink()) links.push(path.join(full, scoped.name));
		}
	}
	const packagesIn = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		!e.isDirectory() || e.name.startsWith(".") ? []
			: e.name.startsWith("@") ? fs.readdirSync(path.join(dir, e.name)).map((n) => path.join(e.name, n))
				: [e.name]);
	for (const link of links) {
		const real = fs.realpathSync(link);
		// .../node_modules/<pkg> or .../node_modules/@scope/<pkg>
		let nested = path.dirname(real);
		if (path.basename(nested).startsWith("@")) nested = path.dirname(nested);
		if (path.basename(nested) !== "node_modules" || path.resolve(nested) === path.resolve(top)) continue;
		for (const name of packagesIn(nested)) {
			const target = path.join(top, name);
			if (exists(target)) continue;
			fs.cpSync(path.join(nested, name), target, { recursive: true, dereference: true });
			console.log(`[build-server] hoisted nested dependency: ${name.split(path.sep).join("/")}`);
		}
	}
}
hoistNestedNeighbours();

// 2b) No symbolic links in the payload (Crux, 2026-11-12). Next writes its
//     hashed external aliases (.next/node_modules/<pkg>-<hash>) as links to
//     ABSOLUTE paths on the build machine. They break on every other computer,
//     and the Windows installer cannot create links without admin rights: it
//     failed on them and aborted. Each link becomes a real copy of its package.
function replaceLinks(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isSymbolicLink()) {
			const real = fs.realpathSync(full);
			fs.rmSync(full, { recursive: true, force: true });
			if (fs.statSync(real).isDirectory()) fs.cpSync(real, full, { recursive: true, dereference: true });
			else fs.copyFileSync(real, full);
			console.log(`[build-server] link replaced by a copy: ${path.relative(STANDALONE, full).split(path.sep).join("/")}`);
		} else if (entry.isDirectory()) replaceLinks(full);
	}
}
replaceLinks(STANDALONE);
const leftover = [];
(function findLinks(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isSymbolicLink()) leftover.push(full);
		else if (entry.isDirectory()) findLinks(full);
	}
})(STANDALONE);
if (leftover.length) {
	console.error(`[build-server] symbolic links remain in the payload: ${leftover.join(", ")}`);
	process.exit(1);
}

// 3) Sanity: the runtime-read prompt assets must be present (the teacher
//    agent reads them from disk at request time).
for (const asset of [
	path.join("src", "agent", "system-prompt.md"),
	path.join("src", "agent", "prompts", "teacher", "20-teaching.md"),
]) {
	if (!exists(path.join(STANDALONE, asset))) {
		console.error(`[build-server] prompt asset missing from the trace: ${asset}`);
		process.exit(1);
	}
}

console.log("[build-server] server payload ready:", STANDALONE);