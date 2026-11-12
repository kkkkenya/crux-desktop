/**
 * The tutor's hub tools: hub_files / hub_download (src/agent/tools/hub.ts),
 * the server-side bridge (src/agent/crux-bridge.ts) and the main-process end
 * of the "lh:crux" channel (electron/crux-hub.cjs attachCruxChild).
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { it } from "node:test";
import { createHubTools, findUnits, formatFiles, unitCode } from "../src/agent/tools/hub.ts";
import { createCruxBridge, type CruxBridgeReply } from "../src/agent/crux-bridge.ts";

const require = createRequire(import.meta.url);
const { attachCruxChild } = require("../electron/crux-hub.cjs");

const text = (result: any): string => result.content.map((c: any) => c.text ?? "").join("");
const run = (tool: any, input: Record<string, unknown>) => tool.execute("call-1", input, undefined);

it("unitCode and findUnits", () => {
	assert.equal(unitCode("emm312"), "EMM 312");
	assert.equal(unitCode(" EMM 312 "), "EMM 312");
	assert.equal(unitCode("fluid mechanics"), null);
	const all = [{ code: "EMM 312", title: "Fluid Mechanics III" }, { code: "EMM 205", title: "Fluid Mechanics II" }, { code: "SMA 301", title: "Statistics" }];
	assert.deepEqual(findUnits(all, "fluid III").map((u) => u.code), ["EMM 312"]);
	assert.deepEqual(findUnits(all, "fluid").map((u) => u.code), ["EMM 312", "EMM 205"]);
	assert.deepEqual(findUnits(all, "  "), []);
});

it("formatFiles: notes and papers apart, ids in brackets, saved paths shown", () => {
	const out = formatFiles("EMM 312", [
		{ id: "11", name: "EMM 312 notes.pdf", paper: false, pages: 80, path: null },
		{ id: "12", name: "EMM 312 CAT 1 2023.pdf", paper: true, pages: 2, path: "C:\\Docs\\Crux\\Hub\\EMM 312\\cat [12].pdf" },
	], null);
	assert.match(out, /Notes and books:\n- \[11\] EMM 312 notes\.pdf \(80 pages\)/);
	assert.match(out, /Past papers:\n- \[12\] EMM 312 CAT 1 2023\.pdf \(2 pages\) — saved: C:\\Docs/);
	assert.match(formatFiles("EMM 312", [], "Files are still being added."), /no hub files yet\. Files are still being added\./);
});

it("hub_files: own units, search, and a unit's files through the account", async () => {
	const calls: unknown[] = [];
	const request = async (op: string, fields: Record<string, unknown> = {}): Promise<CruxBridgeReply<any>> => {
		calls.push({ op, ...fields });
		if (op === "units") return { ok: true, value: { mine: [{ code: "EMM 312", title: "Fluid Mechanics III" }], all: [{ code: "EMM 312", title: "Fluid Mechanics III" }, { code: "SMA 301", title: "Statistics" }] } };
		if (op === "files") return { ok: true, value: { note: null, files: [{ id: "11", name: "notes.pdf", paper: false, pages: 3, path: null }] } };
		return { ok: false, code: "bad", error: "no" };
	};
	const tools = createHubTools(request as any);
	assert.match(text(await run(tools.hub_files, {})), /The student's units:\n- EMM 312 Fluid Mechanics III/);
	assert.match(text(await run(tools.hub_files, { search: "statistics" })), /- SMA 301 Statistics/);
	assert.match(text(await run(tools.hub_files, { unit: "emm312" })), /\[11\] notes\.pdf/);
	assert.deepEqual(calls.at(-1), { op: "files", unit: "EMM 312" }, "the code is normalised before asking Crux");
	assert.match(text(await run(tools.hub_files, { unit: "fluids" })), /not a unit code/);
});

it("hub_download: returns the local path and the downloads left; refuses bad ids; passes Crux's refusal on", async () => {
	let reply: CruxBridgeReply<any> = { ok: true, value: { path: "C:\\Docs\\Crux\\Hub\\EMM 312\\notes [11].pdf", left: 4, cached: false } };
	const seen: unknown[] = [];
	const tools = createHubTools((async (op: string, fields: Record<string, unknown>) => { seen.push({ op, ...fields }); return reply; }) as any);
	const out = text(await run(tools.hub_download, { unit: "EMM 312", id: "11", name: "notes.pdf" }));
	assert.match(out, /^Saved: C:\\Docs\\Crux\\Hub\\EMM 312\\notes \[11\]\.pdf\. 4 downloads left today\. Read it with pdf/);
	assert.deepEqual(seen[0], { op: "download", unit: "EMM 312", fileId: "11", name: "notes.pdf" });
	assert.match(text(await run(tools.hub_download, { unit: "EMM 312", id: "../x", name: "x" })), /not a hub file id/);
	assert.equal(seen.length, 1, "a bad id never reaches Crux");
	reply = { ok: false, code: "download-limit", error: "Today's downloads are used up on your plan." };
	assert.match(text(await run(tools.hub_download, { unit: "EMM 312", id: "12", name: "cat.pdf" })), /hub_download failed: Today's downloads are used up/);
});

it("bridge: outside the desktop app every request says so without sending", async () => {
	let sent = 0;
	const request = createCruxBridge({ connected: () => false, send: () => { sent++; return true; }, onMessage: () => {} });
	const reply = await request("units");
	assert.equal(reply.ok, false);
	assert.equal(sent, 0);
});

it("bridge ↔ main process: a request round-trips over the lh:crux channel", async () => {
	// The child process side and the main side, joined by two emitters.
	const toMain = new EventEmitter(), toChild = new EventEmitter();
	const child = Object.assign(toMain, { connected: true, send: (packet: unknown, cb: () => void) => { toChild.emit("message", packet); cb(); return true; } });
	const hub = {
		units: async () => ({ mine: [{ code: "EMM 312", title: "Fluid Mechanics III" }], all: [] }),
		files: async (unit: string) => ({ note: null, files: [{ id: "11", name: `${unit} notes.pdf`, paper: false, pages: 1, path: null }] }),
		download: async (unit: string, id: string, name: string) => ({ path: `C:\\Hub\\${unit}\\${name} [${id}]`, left: 2, cached: false }),
	};
	const link = attachCruxChild(child, () => hub);
	const request = createCruxBridge({
		connected: () => true,
		send: (message, callback) => { toMain.emit("message", message); callback(null); return true; },
		onMessage: (listener) => { toChild.on("message", listener); },
	});
	const units = await request<any>("units");
	assert.deepEqual(units, { ok: true, value: { mine: [{ code: "EMM 312", title: "Fluid Mechanics III" }], all: [] } });
	const files = await request<any>("files", { unit: "EMM 312" });
	assert.equal(files.ok && files.value.files[0].name, "EMM 312 notes.pdf");
	const saved = await request<any>("download", { unit: "EMM 312", fileId: "11", name: "notes.pdf" });
	assert.equal(saved.ok && saved.value.path, "C:\\Hub\\EMM 312\\notes.pdf [11]");
	const bad = await request<any>("logout" as any);
	assert.equal(bad.ok, false, "only units, files and download cross the channel");
	link.dispose();
});

it("main process: no account yet is a plain answer, not a crash", async () => {
	const toChild = new EventEmitter();
	const child = Object.assign(new EventEmitter(), { connected: true, send: (packet: unknown) => { toChild.emit("message", packet); return true; } });
	attachCruxChild(child, () => null);
	const answer = new Promise<any>((resolve) => toChild.once("message", resolve));
	child.emit("message", { channel: "lh:crux", id: "1", op: "units" });
	const reply = await answer;
	assert.equal(reply.ok, false);
	assert.match(reply.error, /still starting/);
});
