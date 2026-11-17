/**
 * Study rooms in Crux Harness: the bridge to Crux web's rooms API (electron/crux-hub.cjs) and the room clock
 * (lib/crux-room-clock.ts, a copy of Crux web's study/web/src/room-clock.js).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { it } from "node:test";
import { cleanPlan, next, phaseAt, publicPhase, settle, type RoomClock } from "../lib/crux-room-clock.ts";

const require = createRequire(import.meta.url);
const { createCruxHub, cruxControl } = require("../electron/crux-hub.cjs");

const M = 60e3;
const T0 = Date.parse("2026-11-18T17:00:00Z");
const running = (plan = {}): RoomClock => ({ plan: cleanPlan(plan), state: "running", phase: "focus", round: 1, phaseStart: T0, leftMs: null });

function fakeHub(reply: (path: string, method: string, body: unknown) => Response) {
	const calls: { path: string; method: string; body: unknown }[] = [];
	const hub = createCruxHub({
		app: { getPath: () => "/tmp" }, BrowserWindow: class {}, shell: {},
		session: { fromPartition: () => ({ fetch: async (url: string, init: { method?: string; body?: string }) => {
			const { pathname, search } = new URL(url);
			const body = init?.body ? JSON.parse(init.body) : undefined;
			calls.push({ path: pathname + search, method: init?.method ?? "GET", body });
			return reply(pathname, init?.method ?? "GET", body);
		} }) },
	});
	return { hub, calls };
}
const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

it("the clock: focus, short break, long break after the fourth block, and a sleeping laptop catching up", () => {
	const c = running();
	assert.equal(phaseAt(c, T0 + 25 * M).mode, "short");
	assert.equal(phaseAt(c, T0 + 30 * M).round, 2);
	assert.equal(phaseAt(c, T0 + 90 * M + 25 * M).mode, "long");
	const p = phaseAt(c, T0 + 75 * M + 30e3);
	assert.deepEqual([p.mode, p.round, p.left], ["focus", 3, 10 * M - 30e3]);
	assert.equal(phaseAt(running({ rounds: 2 }), T0 + 55 * M).state, "done");
	assert.equal(settle(running({ wait: true }), T0 + 40 * M).state, "waiting");
	assert.deepEqual(next(cleanPlan({ short: 0, longEvery: 0 }), "focus", 1), { phase: "focus", round: 2 });
});

it("public rooms: the Study room focuses :00–:25 and :30–:55, the Long room :00–:50", () => {
	assert.equal(publicPhase("hub", Date.parse("2026-11-18T17:24:00Z")).mode, "focus");
	assert.equal(publicPhase("hub", Date.parse("2026-11-18T17:26:00Z")).mode, "short");
	assert.equal(publicPhase("hub", Date.parse("2026-11-18T17:31:00Z")).mode, "focus");
	assert.equal(publicPhase("long", Date.parse("2026-11-18T17:49:00Z")).mode, "focus");
	assert.equal(publicPhase("long", Date.parse("2026-11-18T17:51:00Z")).left, 9 * M);
});

it("the bridge sends rooms calls to Crux web, with codes tidied and settings kept to numbers", async () => {
	const state = { now: T0, room: { code: "KXQT", name: "EMM 302", unit: "EMM 302", clock: running(), version: 1, locked: false, host: true }, people: [] };
	const { hub, calls } = fakeHub(() => ok(state));
	assert.equal((await cruxControl({ op: "roomJoin", code: " kx-qt " }, hub, null)).ok, true);
	await cruxControl({ op: "roomHost", room: { name: "  EMM 302 revision ".repeat(5), unit: "EMM 302", plan: { focus: "50", wait: "yes", junk: 1 } } }, hub, null);
	await cruxControl({ op: "roomState", code: "KXQT" }, hub, null);
	await cruxControl({ op: "roomAct", code: "KXQT", action: "remove", extra: { version: 3, person: "abc_12-x" } }, hub, null);
	await cruxControl({ op: "focus", until: "2026-11-18T17:25:00Z", room: "hub" }, hub, null);
	await cruxControl({ op: "focus", until: null, room: "room:5" }, hub, null);
	assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["POST /api/rooms/join", "POST /api/rooms", "GET /api/rooms/state?code=KXQT", "POST /api/rooms/act", "POST /api/focus", "POST /api/focus"]);
	assert.deepEqual(calls[0]!.body, { code: "KXQT" });
	const host = calls[1]!.body as { name: string; plan: Record<string, unknown> };
	assert.equal(host.name.length, 40);
	assert.deepEqual(host.plan, { focus: 50, wait: false });
	assert.deepEqual(calls[3]!.body, { code: "KXQT", action: "remove", version: 3, person: "abc_12-x" });
	assert.deepEqual(calls[4]!.body, { until: "2026-11-18T17:25:00.000Z", unit: "hub" });
	assert.deepEqual(calls[5]!.body, { until: null, unit: null }); // only public rooms are named
});

it("the bridge refuses bad codes, actions and people before anything goes out", async () => {
	const { hub, calls } = fakeHub(() => ok({}));
	for (const cmd of [
		{ op: "roomJoin", code: "KOQT" }, { op: "roomJoin", code: "ABC" }, { op: "roomState", code: "../x" },
		{ op: "roomAct", code: "KXQT", action: "delete" }, { op: "roomAct", code: "KXQT", action: "remove", extra: { person: "a/b" } },
		{ op: "focus", until: "soon" },
	]) {
		const r = await cruxControl(cmd, hub, null);
		assert.equal(r.ok, false, JSON.stringify(cmd));
		assert.equal(r.code, "bad-request");
	}
	assert.equal(calls.length, 0);
});

it("Crux's refusals come back with their words and status, so the room can react (ended, changed, removed)", async () => {
	const { hub } = fakeHub(() => new Response(JSON.stringify({ error: "The room changed. Try again." }), { status: 409 }));
	const r = await cruxControl({ op: "roomAct", code: "KXQT", action: "pause", extra: { version: 1 } }, hub, null);
	assert.deepEqual([r.ok, r.error, r.status], [false, "The room changed. Try again.", 409]);
});

it("classroom tools through the bridge: today's work is cleaned to its fields, check-ins take only done, partly or stuck", async () => {
	const { hub, calls } = fakeHub(() => ok({}));
	await cruxControl({ op: "roomAct", code: "KXQT", action: "work", extra: { version: 2, work: { text: "CAT 1, Q3", fileId: "3691", fileName: "CAT 1.pdf", page: 2, extra: "x" } } }, hub, null);
	assert.deepEqual(calls[0]!.body, { code: "KXQT", action: "work", version: 2, work: { text: "CAT 1, Q3", fileId: "3691", fileName: "CAT 1.pdf", page: 2 } });
	await cruxControl({ op: "roomAct", code: "KXQT", action: "work", extra: { work: { text: "x", fileId: "local-3" } } }, hub, null);
	assert.equal((calls[1]!.body as { work: { fileId: unknown } }).work.fileId, null, "a private file is never sent");
	await cruxControl({ op: "roomAct", code: "KXQT", action: "work", extra: { work: null } }, hub, null);
	assert.equal((calls[2]!.body as { work: unknown }).work, null);
	await cruxControl({ op: "roomCheckin", code: "KXQT", how: "stuck" }, hub, null);
	assert.deepEqual(calls[3], { path: "/api/rooms/checkin", method: "POST", body: { code: "KXQT", how: "stuck" } });
	assert.equal((await cruxControl({ op: "roomCheckin", code: "KXQT", how: "great" }, hub, null)).code, "bad-request");
});
