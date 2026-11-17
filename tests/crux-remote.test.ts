/**
 * Study from your phone (electron/crux-remote.cjs): pairing, the phone's key, the routes that stay laptop-only,
 * the bridge allow-list, the page script, and streaming through the proxy to a stand-in app server.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

const require = createRequire(import.meta.url);
const { createPhones, createRemoteServer, apiRule, canonicalPath, inject, forPhone, deviceName, downloadCloudflared, hasCloudflared, PREFIX, COOKIE } = require("../electron/crux-remote.cjs");
import crypto from "node:crypto";
import { phoneAccessOn } from "../src/server/file-access.ts";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "crux-remote-")), "phones.json");

it("pairing: a code works once, expires after 10 minutes, and only a hash of the key is kept", () => {
	let t = 1_000_000;
	const file = tmp();
	const phones = createPhones(file, () => t);
	const { code } = phones.newCode();
	const ok = phones.pair(code, "Mozilla/5.0 (Linux; Android 14; SM-A146P Build/UP1A) Chrome/131");
	assert.ok(ok.id && ok.key && ok.key.length >= 40);
	assert.match(phones.pair(code, "x").error, /expired or was already used/);
	assert.equal(fs.readFileSync(file, "utf8").includes(ok.key), false, "the key itself is never stored");
	assert.equal(phones.check(`${ok.id}.${ok.key}`)?.id, ok.id);
	assert.equal(phones.check(`${ok.id}.wrong`), null);
	assert.equal(phones.list()[0].name, "SM-A146P, Chrome");
	const late = phones.newCode();
	t += 10 * 60 * 1000 + 1;
	assert.match(phones.pair(late.code, "x").error, /expired/);
	phones.remove(ok.id);
	assert.equal(phones.check(`${ok.id}.${ok.key}`), null, "a removed phone is out at once");
});

it("guessing codes stops after 10 wrong tries, and at most 5 phones stay paired", () => {
	const phones = createPhones(tmp());
	const { code } = phones.newCode();
	for (let i = 0; i < 10; i++) phones.pair("guess" + i, "x");
	assert.match(phones.pair(code, "x").error, /Too many tries/);
	const more = createPhones(tmp());
	for (let i = 0; i < 6; i++) { const c = more.newCode().code; assert.ok(more.pair(c, "x").id); }
	assert.equal(more.list().length, 5);
});

it("keys, providers and subscriptions stay laptop-only; settings are read-only from a phone", () => {
	assert.equal(apiRule("POST", "/api/chat"), "pass");
	assert.equal(apiRule("GET", "/api/keys"), "laptop-only");
	assert.equal(apiRule("DELETE", "/api/keys/abc"), "laptop-only");
	assert.equal(apiRule("POST", "/api/subscriptions/browser"), "laptop-only");
	assert.equal(apiRule("POST", "/api/custom-provider"), "laptop-only");
	assert.equal(apiRule("GET", "/api/settings"), "pass");
	assert.equal(apiRule("PUT", "/api/settings/appearance"), "laptop-only");
	assert.equal(apiRule("GET", "/api/settingsx"), "laptop-only", "an allow-list: anything not named is laptop-only");
	assert.equal(apiRule("DELETE", "/api/chats/abc"), "laptop-only", "a phone never deletes");
	assert.equal(apiRule("GET", "/api/claude-code"), "laptop-only");
});

it("the page script goes first in <head>; bytes travel as base64; device names are short", () => {
	assert.equal(inject("<html><head><title>x</title></head></html>"), `<html><head><script src="${PREFIX}shim.js"></script><title>x</title></head></html>`);
	const r = forPhone({ ok: true, value: { kind: "pdf", bytes: new Uint8Array([1, 2, 3]) } });
	assert.deepEqual(r, { ok: true, value: { kind: "pdf", __bytes: "AQID" } });
	assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18 Safari/605"), "iPhone, Safari");
});

it("the proxy: an unpaired phone sees only the pairing note; a paired one reaches the app with the desktop capability, never its cookie; streams pass as they come", async () => {
	const seen: Record<string, string | undefined>[] = [];
	const app = http.createServer((req, res) => {
		seen.push({ path: req.url, desktop: req.headers["x-learnharness-desktop"] as string | undefined, cookie: req.headers.cookie });
		if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head></head><body>Crux</body></html>"); return; }
		if (req.url === "/api/events") {
			res.writeHead(200, { "content-type": "text/event-stream" });
			let n = 0; const t = setInterval(() => { res.write(`data: ${++n}\n\n`); if (n === 3) { clearInterval(t); res.end(); } }, 80);
			return;
		}
		res.writeHead(200, { "content-type": "application/json" }); res.end("{}");
	});
	await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
	const appPort = (app.address() as { port: number }).port;
	const phones = createPhones(tmp());
	const calls: unknown[] = [];
	const remote = createRemoteServer({ upstream: () => `http://127.0.0.1:${appPort}`, secret: "s".repeat(64), phones, control: async (c: unknown) => { calls.push(c); return { ok: true, value: { kind: "pdf", bytes: new Uint8Array([9]) } }; } });
	const port = await remote.start();
	const base = `http://127.0.0.1:${port}`;
	try {
		const anon = await fetch(`${base}/`);
		assert.equal(anon.status, 401);
		assert.match(await anon.text(), /scan the code/);
		assert.equal(seen.length, 0, "nothing reaches the app before pairing");

		const { code } = phones.newCode();
		const paired = await fetch(`${base}${PREFIX}pair?code=${code}`, { redirect: "manual" });
		assert.equal(paired.status, 303);
		const cookie = paired.headers.get("set-cookie")!.split(";")[0]!;
		assert.ok(cookie.startsWith(`${COOKIE}=`));
		assert.match(paired.headers.get("set-cookie")!, /HttpOnly/);

		const home = await fetch(`${base}/`, { headers: { cookie, accept: "text/html" } });
		assert.match(await home.text(), /<head><script src="\/__crux-remote\/shim.js"><\/script><\/head>/);
		assert.equal(seen.at(-1)!.cookie, undefined, "the phone's key never reaches the app");
		assert.equal(seen.at(-1)!.desktop, undefined, "pages get no capability");

		await fetch(`${base}/api/chats`, { headers: { cookie } });
		assert.equal(seen.at(-1)!.desktop, "s".repeat(64));
		assert.equal((await fetch(`${base}/api/keys`, { headers: { cookie } })).status, 403);

		const t0 = Date.now(); const times: number[] = [];
		const stream = await fetch(`${base}/api/events`, { headers: { cookie } });
		const reader = stream.body!.getReader();
		for (;;) { const { done } = await reader.read(); if (done) break; times.push(Date.now() - t0); }
		assert.ok(times.length >= 2 && times[0]! < 200, `events arrive as they are sent (${times.join(", ")} ms)`);

		const bytes = await (await fetch(`${base}${PREFIX}crux`, { method: "POST", headers: { cookie }, body: JSON.stringify({ op: "bytes", path: "x.pdf" }) })).json();
		assert.equal(bytes.value.__bytes, "CQ==");
		const out = await fetch(`${base}${PREFIX}crux`, { method: "POST", headers: { cookie }, body: JSON.stringify({ op: "logout" }) });
		assert.equal(out.status, 403);
		assert.equal(calls.length, 1, "logout never reached the bridge");
		assert.match(await (await fetch(`${base}${PREFIX}shim.js`, { headers: { cookie } })).text(), /window\.lh = /);
	} finally { remote.stop(); app.close(); }
});

it("security review: encoded, dotted, doubled or absolute paths never reach the app; phones unused for 30 days must pair again", async () => {
	for (const bad of ["/%61pi/keys", "/api/%6Beys", "/api/../api/keys", "/api/./keys", "//api/keys", `/api${String.fromCharCode(92)}keys`, "http://x/api/keys", "*"]) assert.equal(canonicalPath(bad), null, bad);
	assert.equal(canonicalPath("/api/chat?q=%20"), "/api/chat", "a query may be encoded");
	let t = 1_000_000;
	const phones = createPhones(tmp(), () => t);
	const { id, key } = phones.pair(phones.newCode().code, "x");
	t += 31 * 864e5;
	assert.equal(phones.check(`${id}.${key}`), null);
	assert.equal(phones.list().length, 0);
	assert.equal(inject("<html><header>x</header><head></head>"), `<html><header>x</header><head><script src="${PREFIX}shim.js"></script></head>`);
});

it("the tunnel helper is kept only when it matches GitHub's published checksum, and is checked again before each use", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crux-cf-"));
	const body = Buffer.from("MZ pretend helper");
	const digest = crypto.createHash("sha256").update(body).digest("hex");
	const fake = (sha: string | null) => async (url: string) => url.includes("api.github.com")
		? new Response(JSON.stringify({ assets: [{ name: "cloudflared-windows-amd64.exe", browser_download_url: "https://example.invalid/cf.exe", size: body.length, ...(sha ? { digest: `sha256:${sha}` } : {}) }] }), { status: 200 })
		: new Response(body, { status: 200 });
	await assert.rejects(downloadCloudflared(dir, () => {}, fake(null)), /checksum is not published/);
	await assert.rejects(downloadCloudflared(dir, () => {}, fake("0".repeat(64))), /did not match/);
	assert.equal(hasCloudflared(dir), false);
	await downloadCloudflared(dir, () => {}, fake(digest));
	assert.equal(hasCloudflared(dir), true);
	fs.writeFileSync(path.join(dir, "cloudflared.exe"), "MZ swapped");
	assert.equal(hasCloudflared(dir), false, "a changed file is not used");
});

it("while phone access is on (its flag file exists), the tutor's file access is restricted", () => {
	const flag = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "crux-flag-")), "on.flag");
	assert.equal(phoneAccessOn(flag), false);
	fs.writeFileSync(flag, "on");
	assert.equal(phoneAccessOn(flag), true);
	assert.equal(phoneAccessOn(undefined), false);
});
