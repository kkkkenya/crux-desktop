/**
 * Crux account + hub files (electron/crux-hub.cjs), against a fake Crux API.
 * No network and no Electron: the session, the app paths and the file CDN are
 * stand-ins, so this pins the module's own rules — what counts as signed in,
 * which library rows are hub files, where a download lands, which links are
 * refused, and what the renderer is told when Crux says no.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, it } from "node:test";

const require = createRequire(import.meta.url);
const { createCruxHub, cruxControl, safeSegment } = require("../electron/crux-hub.cjs");

type Route = { status: number; body?: unknown };
let documents: string;
let routes: Record<string, Route>;
let apiCalls: string[];
let cleared = 0;
let revealed: string[];
const realFetch = globalThis.fetch;

function hub() {
	return createCruxHub({
		app: { getPath: (name: string) => { assert.ok(name === "documents" || name === "userData"); return documents; } },
		BrowserWindow: class {},
		session: {
			fromPartition: (partition: string) => {
				assert.equal(partition, "persist:crux-account");
				return {
					fetch: async (url: string) => {
						const { pathname, search } = new URL(url);
						apiCalls.push(pathname + search);
						const route = routes[pathname] ?? { status: 404, body: { error: "no such endpoint" } };
						return new Response(route.body === undefined ? "not json" : JSON.stringify(route.body), { status: route.status });
					},
					clearStorageData: async () => { cleared++; },
				};
			},
		},
		shell: { showItemInFolder: (target: string) => { revealed.push(target); }, openExternal: async () => {} },
	});
}

beforeEach(() => {
	documents = fs.mkdtempSync(path.join(os.tmpdir(), "crux-hub-"));
	routes = {};
	apiCalls = [];
	cleared = 0;
	revealed = [];
});
afterEach(() => {
	globalThis.fetch = realFetch;
	fs.rmSync(documents, { recursive: true, force: true });
});

it("status: signed in with a name and tier, signed out on 401, and a plain reason when the account has no plan", async () => {
	routes["/api/me"] = { status: 200, body: { id: "1", name: "Wanjiru", tier: "premium" } };
	assert.deepEqual(await hub().status(), { signedIn: true, name: "Wanjiru", tier: "premium" });

	routes["/api/me"] = { status: 401, body: { error: "Sign in first." } };
	assert.deepEqual(await hub().status(), { signedIn: false });

	routes["/api/me"] = { status: 403, body: { error: "no-access" } };
	const none = await hub().status();
	assert.equal(none.signedIn, false);
	assert.match(none.problem, /no Study Hub plan/);
});

it("status offline: a recent sign-in still counts for a week, then it doesn't; signing out or losing the plan ends it", async () => {
	const h = hub();
	routes["/api/me"] = { status: 200, body: { id: "1", name: "Wanjiru", tier: "basic" } };
	await h.status();
	routes["/api/me"] = { status: 502, body: { error: "bad gateway" } };
	assert.deepEqual(await h.status(), { signedIn: true, name: "Wanjiru", tier: "basic", offline: true });

	const file = path.join(documents, "crux-account.json");
	const saved = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.deepEqual(Object.keys(saved).sort(), ["at", "name", "tier"], "only the name and plan are kept, never the session");
	fs.writeFileSync(file, JSON.stringify({ ...saved, at: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
	assert.equal((await h.status()).signedIn, false, "older than a week");

	routes["/api/me"] = { status: 200, body: { id: "1", name: "Wanjiru", tier: "basic" } };
	await h.status();
	routes["/api/me"] = { status: 403, body: { error: "no-access" } };
	assert.equal((await h.status()).signedIn, false);
	routes["/api/me"] = { status: 502, body: {} };
	assert.equal((await h.status()).signedIn, false, "a lost plan is not revived by going offline");
});

it("units: the student's own units first, plus the catalogue for searching", async () => {
	routes["/api/state"] = { status: 200, body: { data: { units: [{ code: "EMM 302", title: "Solid Mechanics II", catDate: null }, { nope: true }] } } };
	routes["/api/catalog"] = { status: 200, body: { all: [{ code: "EMM 302", codes: ["EMM 302"], title: "Solid Mechanics II" }, { code: "EEE 201", title: "Circuit Theory" }] } };
	assert.deepEqual(await hub().units(), {
		mine: [{ code: "EMM 302", title: "Solid Mechanics II" }],
		all: [{ code: "EMM 302", title: "Solid Mechanics II" }, { code: "EEE 201", title: "Circuit Theory" }],
	});
});

it("files: only hub rows, without their extracted text, and already-downloaded ones carry their path", async () => {
	const already = path.join(documents, "Crux", "Hub", "EMM 302", "CAT 1 2024 [41].pdf");
	fs.mkdirSync(path.dirname(already), { recursive: true });
	fs.writeFileSync(already, "pdf");
	routes["/api/library"] = { status: 200, body: { note: "2 files", files: [
		{ id: 41, name: "CAT 1 2024.pdf", paper: true, pages: 3, text: "a very long extracted text", chars: 9000 },
		{ id: 42, name: "Torsion notes.pdf", paper: false, pages: 20, text: "more text" },
		{ id: "local-abc", name: "mine.docx", paper: false, local: true },
	] } };
	const out = await hub().files("EMM 302");
	assert.equal(apiCalls[0], "/api/library?unit=EMM%20302");
	assert.deepEqual(out, { note: "2 files", files: [
		{ id: "41", name: "CAT 1 2024.pdf", paper: true, pages: 3, path: already },
		{ id: "42", name: "Torsion notes.pdf", paper: false, pages: 20, path: null },
	] });
});

it("download: saves under Documents/Crux/Hub/<unit>, and the second time uses the saved copy without spending a download", async () => {
	routes["/api/files/42/download"] = { status: 200, body: { url: "https://cdn.discordapp.com/attachments/1/2/Torsion_notes.pdf?ex=1", name: "Torsion notes.pdf", left: 1 } };
	const fetched: string[] = [];
	globalThis.fetch = (async (url: URL) => { fetched.push(String(url)); return new Response("PDFBYTES", { status: 200 }); }) as typeof fetch;

	const first = await hub().download("EMM 302", "42", "Torsion notes.pdf");
	const expected = path.join(documents, "Crux", "Hub", "EMM 302", "Torsion notes [42].pdf");
	assert.deepEqual(first, { path: expected, left: 1, cached: false });
	assert.equal(fs.readFileSync(expected, "utf8"), "PDFBYTES");
	assert.equal(fs.existsSync(`${expected}.part`), false);
	assert.equal(fetched.length, 1);

	apiCalls = [];
	const second = await hub().download("EMM 302", "42", "Torsion notes.pdf");
	assert.deepEqual(second, { path: expected, left: null, cached: true });
	assert.deepEqual(apiCalls, [], "a saved file must not ask Crux for another link");
	assert.equal(fetched.length, 1);
});

it("download: two hub files with one name stay separate, and a double click spends one download", async () => {
	routes["/api/files/42/download"] = { status: 200, body: { url: "https://cdn.discordapp.com/attachments/1/2/a.pdf", name: "notes.pdf", left: 1 } };
	routes["/api/files/43/download"] = { status: 200, body: { url: "https://cdn.discordapp.com/attachments/1/3/b.pdf", name: "notes.pdf", left: 0 } };
	globalThis.fetch = (async (url: URL) => new Response(String(url).includes("/2/") ? "FIRST" : "SECOND", { status: 200 })) as typeof fetch;
	const h = hub();
	const [a, again, b] = await Promise.all([h.download("EMM 302", "42", "notes.pdf"), h.download("EMM 302", "42", "notes.pdf"), h.download("EMM 302", "43", "notes.pdf")]);
	assert.equal(a.path, again.path);
	assert.notEqual(a.path, b.path);
	assert.equal(fs.readFileSync(a.path, "utf8"), "FIRST");
	assert.equal(fs.readFileSync(b.path, "utf8"), "SECOND");
	assert.equal(apiCalls.filter((c) => c === "/api/files/42/download").length, 1, "the double click asked Crux once");
});

it("download: a body larger than the cap is refused even without a Content-Length, and nothing is saved", async () => {
	routes["/api/files/50/download"] = { status: 200, body: { url: "https://cdn.discordapp.com/attachments/1/5/big.pdf", name: "big.pdf", left: 1 } };
	const piece = new Uint8Array(8 * 1024 * 1024);
	let sent = 0;
	globalThis.fetch = (async () => new Response(new ReadableStream({ pull(c) { if (sent++ < 14) c.enqueue(piece); else c.close(); } }), { status: 200 })) as typeof fetch;
	const reply = await cruxControl({ op: "download", unit: "EMM 302", id: "50", name: "big.pdf" }, hub(), null);
	assert.equal(reply.ok, false);
	assert.match(reply.error, /too large/);
	assert.equal(fs.existsSync(path.join(documents, "Crux")), false);
});

it("download: a link anywhere but Discord's file hosts is refused and nothing is fetched or written", async () => {
	routes["/api/files/7/download"] = { status: 200, body: { url: "https://evil.example/attachments/x.pdf", name: "x.pdf", left: 1 } };
	let fetched = 0;
	globalThis.fetch = (async () => { fetched++; return new Response("x"); }) as typeof fetch;
	const reply = await cruxControl({ op: "download", unit: "EMM 302", id: "7", name: "x.pdf" }, hub(), null);
	assert.equal(reply.ok, false);
	assert.equal(reply.code, "failed");
	assert.equal(fetched, 0);
	assert.equal(fs.existsSync(path.join(documents, "Crux")), false);
});

it("control: the daily download limit reaches the renderer as data, with when it resets", async () => {
	routes["/api/files/9/download"] = { status: 429, body: { error: "download-limit", resetsAt: "2026-11-11T21:00:00.000Z" } };
	const reply = await cruxControl({ op: "download", unit: "EMM 302", id: "9", name: "paper.pdf" }, hub(), null);
	assert.deepEqual(reply, { ok: false, code: "download-limit", error: "Today's downloads are used up on your plan.", resetsAt: "2026-11-11T21:00:00.000Z" });
});

it("control: unknown operations and malformed requests are refused without calling Crux", async () => {
	for (const command of [null, {}, { op: "eval" }, { op: "files" }, { op: "download", unit: "EMM 302", id: "../1", name: "a.pdf" }]) {
		const reply = await cruxControl(command, hub(), null);
		assert.equal(reply.ok, false, JSON.stringify(command));
		assert.equal(reply.code, "bad-request", JSON.stringify(command));
	}
	assert.deepEqual(apiCalls, []);
});

it("logout clears the Crux session; reveal only opens files inside the hub folder", async () => {
	const h = hub();
	assert.deepEqual(await h.logout(), { signedIn: false });
	assert.equal(cleared, 1);

	const inside = path.join(documents, "Crux", "Hub", "EMM 302", "a.pdf");
	fs.mkdirSync(path.dirname(inside), { recursive: true });
	fs.writeFileSync(inside, "x");
	assert.equal(h.reveal(inside), true);
	assert.deepEqual(revealed, [inside]);
	const outside = path.join(documents, "secret.txt");
	fs.writeFileSync(outside, "x");
	assert.throws(() => h.reveal(outside), /isn't in the Hub folder/);
	assert.throws(() => h.reveal(path.join(documents, "Crux", "Hub", "..", "..", "secret.txt")), /isn't in the Hub folder/);
});

it("safeSegment: one safe folder or file name, whatever the hub called the file", () => {
	assert.equal(safeSegment("EMM 302", "unit"), "EMM 302");
	assert.equal(safeSegment("../../etc/passwd", "file"), "_.._etc_passwd");
	assert.equal(safeSegment('CAT: 1 "final"?.pdf', "file"), "CAT_ 1 _final__.pdf");
	assert.equal(safeSegment("   ", "file-3"), "file-3");
	assert.equal(safeSegment("CON", "file-4"), "file-4");
	assert.equal(safeSegment("nul.txt", "file-5"), "file-5");
	assert.ok(safeSegment("x".repeat(400), "f").length <= 150);
});
