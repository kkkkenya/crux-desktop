/**
 * Track H3 (owner, 2026-11-20): a Crux hosted-model failure reaches the student as one plain sentence and what to
 * do next (src/core/crux-errors.ts); the raw text goes to the log, never a key. The relay (study/server/ai-relay.js)
 * already answers in plain sentences and moves to the next model itself; this side handles what the relay can't see:
 * the student's own connection, a cut-off stream, and the SDK's own wording.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { cruxErrorText, redactKeys } from "../src/core/crux-errors.ts";

const KEY = "sk-live-abcdef1234567890";
const TABLE: Array<[string, string, RegExp]> = [
	["the relay's own sentence (busy), after the SDK's status prefix", "503 Gemini 3.8 Flash is busy right now. Try again in a minute or pick another model.", /^Gemini 3\.8 Flash is busy right now\. Try again in a minute or pick another model\.$/],
	["the relay's daily allowance", "429 Today's 15 answers on your plan are used. They reset at midnight, Nairobi time.", /^Today's 15 answers/],
	["the relay's cut-stream chunk", "The answer stopped partway. Send your message again.", /^The answer stopped partway/],
	["the student's connection is down", "Connection error.", /Can't reach Crux\. Check your internet connection/],
	["fetch failed (offline)", "TypeError: fetch failed\n    at node:internal/deps/undici", /Can't reach Crux/],
	["SDK timeout", "Request timed out.", /took too long/],
	["stream cut without the relay's chunk", "terminated", /stopped partway/],
	["content filter finish reason", "Provider finish_reason: content_filter", /wouldn't answer that/],
	["signed out", "401 Sign in to Crux again in the desktop app.", /^Sign in to Crux again/],
	["a raw provider body with a key", `400 {"error":{"message":"Authentication Fails, Your api key: ${KEY} is invalid"}}`, /didn't answer\. Try again in a moment\./],
	["a stack", "Error: boom\n    at foo (C:\\x.js:1:1)", /didn't answer/],
];

for (const [what, raw, want] of TABLE) {
	it(`crux error: ${what}`, () => {
		const out = cruxErrorText(raw);
		assert.match(out, want);
		for (const bad of [KEY, "{", "\n", "    at ", "Error:", "TypeError"]) assert.equal(out.includes(bad), false, `"${bad}" reached the student`);
	});
}

it("redactKeys: bearer tokens and sk-/AIza keys never reach a log line", () => {
	const out = redactKeys(`Authorization: Bearer ${KEY} and AIzaSyD-abcdefghijklmnopqrstuvwxyz12345`);
	assert.equal(out.includes(KEY), false);
	assert.equal(out.includes("AIzaSy"), false);
});

it("withRelayNote: the relay's X-Crux-Note becomes a crux-note event, and the caller's own hook still runs", async () => {
	const { withRelayNote, relayNote } = await import("../src/agent/crux-hosted.ts");
	const { subscribe } = await import("../src/core/events.ts");
	assert.equal(relayNote({ "x-crux-note": " DeepSeek Flash is busy, so Gemini 3.8 Flash answered. " }), "DeepSeek Flash is busy, so Gemini 3.8 Flash answered.");
	assert.equal(relayNote({}), null);
	const seen: unknown[] = [];
	const off = subscribe((e) => { if (e.type === "crux-note") seen.push(e); });
	let callerHook = 0;
	const fake = {
		stream: (_m: unknown, _c: unknown, o?: { onResponse?: (r: unknown, m: unknown) => unknown }) => { void o?.onResponse?.({ status: 200, headers: { "x-crux-note": "DeepSeek Flash is out of credit, so Gemini 3.8 Flash answered." } }, {}); return "stream" as never; },
		streamSimple: () => "simple" as never,
	};
	const api = withRelayNote(fake as never);
	api.stream({} as never, {} as never, { onResponse: () => { callerHook += 1; } } as never);
	await new Promise((r) => setTimeout(r, 0));
	off();
	assert.deepEqual(seen, [{ type: "crux-note", text: "DeepSeek Flash is out of credit, so Gemini 3.8 Flash answered." }]);
	assert.equal(callerHook, 1);
});
