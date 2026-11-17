"use strict";
/**
 * Study from your phone (Crux, 2026-11-18). The laptop stays on at home; the student opens Crux in the phone's
 * browser at school. Off until the student turns it on in Crux Harness.
 *
 *   phone ──https──▶ Cloudflare quick tunnel ──▶ this proxy (127.0.0.1, random port) ──▶ the app's own server
 *
 * The proxy is the only door. A phone gets in once, by opening the pairing link from the QR code shown in Crux
 * Harness (a one-time code, 10 minutes). It then holds a long random key in an HttpOnly cookie; this computer keeps
 * only a hash. A paired phone's requests are passed to the app's server with the same desktop capability header the
 * window gets, except the routes that change keys, providers or settings, which stay laptop-only. The window's
 * bridge (window.lh.crux: Hub files, schemes, rooms, notes) is offered to the phone over HTTP for an allow-list of
 * operations; signing out, updates and opening folders on the laptop are not on it.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PAIR_MS = 10 * 60 * 1000;
const COOKIE = "crux_phone";
const COOKIE_DAYS = 90;
const MAX_PHONES = 5;
const WRONG_CODES = 10; // per 10 minutes, all phones together
const DESKTOP_HEADER = "x-learnharness-desktop";
const PREFIX = "/__crux-remote/";

// Bridge operations a phone may use (electron/crux-hub.cjs OPS). Not: login, logout, reveal, updateCheck,
// openUpdate, applyUpdate, skipSetup (the laptop's account and app stay the laptop's).
const PHONE_OPS = new Set([
	"status", "units", "files", "download", "study", "catalog", "saveSetup", "addNote", "removeNote", "learn", "makeGuide", "openAt",
	"local", "openLocal", "bytes", "schemes", "askScheme", "uploads", "contributors", "share",
	"rooms", "roomHost", "roomJoin", "roomState", "roomAct", "roomLeave", "roomCheckin", "focus",
]);
// API routes a phone may not use at all, and ones it may only read.
const BLOCKED = /^\/api\/(keys|subscriptions|custom-provider|claude-code)(\/|$)/;
const READ_ONLY = /^\/api\/settings(\/|$)/;

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const token = (bytes) => crypto.randomBytes(bytes).toString("base64url");
const sameHash = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOf = (header) => { const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(header || ""); return m ? m[1] : null; };
// a short device name from the user agent, for the list of paired phones
function deviceName(ua = "") {
	const s = String(ua);
	const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? (/;\s*([^;)]+?)\s+Build\//.exec(s)?.[1] || "Android phone") : /Windows/.test(s) ? "Windows" : /Mac OS/.test(s) ? "Mac" : "Phone";
	const browser = /EdgA?\//.test(s) ? "Edge" : /SamsungBrowser/.test(s) ? "Samsung Internet" : /Firefox|FxiOS/.test(s) ? "Firefox" : /CriOS|Chrome/.test(s) ? "Chrome" : /Safari/.test(s) ? "Safari" : "browser";
	return `${os.slice(0, 40)}, ${browser}`;
}

/** The pairing and phone list, kept in a JSON file (hashes only). Pure apart from the file. */
function createPhones(file, now = () => Date.now()) {
	let pending = null; // { hash, expires }
	let wrong = [];
	const load = () => { try { const v = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(v) ? v : []; } catch { return []; } };
	const save = (list) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(list, null, 1), { mode: 0o600 }); fs.renameSync(tmp, file); };
	return {
		/** A new one-time code (the old one stops working). */
		newCode() { const code = token(12); pending = { hash: sha(code), expires: now() + PAIR_MS }; wrong = []; return { code, expiresAt: pending.expires }; },
		codeOpen() { return Boolean(pending && pending.expires > now()); },
		/** A pairing link was opened: the phone's id and key, or the reason not. */
		pair(code, ua) {
			wrong = wrong.filter((t) => now() - t < PAIR_MS);
			if (wrong.length >= WRONG_CODES) return { error: "Too many tries. Make a new code in Crux Harness on your laptop." };
			if (!pending || pending.expires <= now() || !code || !sameHash(sha(code), pending.hash)) { wrong.push(now()); return { error: "This pairing link has expired or was already used. Make a new code in Crux Harness on your laptop." }; }
			pending = null;
			const list = load();
			if (list.length >= MAX_PHONES) list.sort((a, b) => a.lastSeen - b.lastSeen).shift(); // the phone not seen longest goes
			const id = token(9), key = token(32);
			list.push({ id, hash: sha(key), name: deviceName(ua), pairedAt: now(), lastSeen: now() });
			save(list);
			return { id, key };
		},
		/** The phone a cookie belongs to, or null. Updates when it was last seen (at most once a minute). */
		check(cookie) {
			const [id, key] = String(cookie || "").split(".");
			if (!id || !key) return null;
			const list = load();
			const phone = list.find((p) => p.id === id);
			if (!phone || !sameHash(sha(key), phone.hash)) return null;
			if (now() - phone.lastSeen > 60e3) { phone.lastSeen = now(); save(list); }
			return phone;
		},
		list() { return load().map(({ hash, ...p }) => p); },
		remove(id) { save(load().filter((p) => p.id !== id)); },
		clear() { save([]); pending = null; },
	};
}

/** What a phone may do with an API request: "pass", "laptop-only" (403), "read-only" (403 for writes). */
function apiRule(method, pathname) {
	if (BLOCKED.test(pathname)) return "laptop-only";
	if (READ_ONLY.test(pathname) && method !== "GET" && method !== "HEAD") return "laptop-only";
	return "pass";
}

/** The script that gives a phone's page the window's bridge, over HTTP. Loaded first, before the app. */
const SHIM = `(() => {
	if (window.lh) return;
	const call = async (op, args) => {
		try {
			const r = await fetch(${JSON.stringify(PREFIX + "crux")}, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ op, ...args }) });
			const out = await r.json();
			if (out && out.ok && out.value && out.value.__bytes) out.value = { ...out.value, bytes: Uint8Array.from(atob(out.value.__bytes), (c) => c.charCodeAt(0)), __bytes: undefined };
			return out;
		} catch { return { ok: false, code: "offline", error: "Your laptop can't be reached. Check that it is on and Crux Harness is open." }; }
	};
	const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
	const no = () => Promise.resolve({ ok: false, code: "laptop-only", error: "Do this on your laptop." });
	const crux = new Proxy({}, { get: (_, op) => {
		if (op === "onOpen") return () => () => {};
		if (op === "login" || op === "logout" || op === "applyUpdate" || op === "openUpdate" || op === "reveal" || op === "skipSetup") return no;
		if (op === "updateCheck") return () => Promise.resolve({ ok: true, value: { available: false } });
		if (op === "share") return (request) => call("share", { request: { ...request, bytes: b64(request.bytes) } });
		const names = { files: ["unit"], download: ["unit", "id", "name"], catalog: ["course", "year"], saveSetup: ["setup"], addNote: ["note"], removeNote: ["id"], learn: ["unit", "topicId"], makeGuide: ["unit", "topicId", "fresh"], openAt: ["unit", "id", "name", "page"], local: ["unit"], openLocal: ["path", "page"], bytes: ["path"], schemes: ["unit"], askScheme: ["unit", "paperId"], uploads: ["unit"], roomHost: ["room"], roomJoin: ["code"], roomState: ["code"], roomAct: ["code", "action", "extra"], roomCheckin: ["code", "how"], focus: ["until", "room"] };
		return (...a) => call(op, Object.fromEntries((names[op] || []).map((k, i) => [k, a[i]])));
	} });
	window.lh = { platform: "remote", remote: true, crux, getZoom: () => Promise.resolve(1), onZoom: () => () => {}, onUpdateStatus: () => () => {}, getUpdateState: () => Promise.resolve(null), checkForUpdates: () => Promise.resolve(null), onOpenSettings: () => () => {}, expandWindow: () => {} };
	document.documentElement.dataset.remote = "phone";
})();`;

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0f0d0b;color:#f2efe9;font:16px/1.5 system-ui,sans-serif}main{max-width:340px;padding:24px}h1{font:600 24px/1.2 Georgia,serif;margin:0 0 12px}p{color:#bdb6ab;margin:0}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;

/** Put the bridge script first in a page's <head>. */
function inject(html) {
	const tag = `<script src="${PREFIX}shim.js"></script>`;
	return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}

/** Bytes in a bridge reply go to the phone as base64. */
function forPhone(reply) {
	if (reply?.ok && reply.value?.bytes instanceof Uint8Array) {
		const { bytes, ...rest } = reply.value;
		return { ...reply, value: { ...rest, __bytes: Buffer.from(bytes).toString("base64") } };
	}
	return reply;
}

/**
 * The proxy. upstream(): the app server's origin (http://127.0.0.1:port). secret: the desktop capability.
 * control(command): the bridge (cruxControl with the signed-in hub). phones: createPhones(...).
 */
function createRemoteServer({ upstream, secret, control, phones, log = () => {} }) {
	const json = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(body)); };
	const html = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(body); };
	const readBody = (req, max) => new Promise((resolve, reject) => {
		const chunks = []; let n = 0;
		req.on("data", (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error("too big"), { status: 413 })); req.destroy(); } else chunks.push(c); });
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});

	async function handle(req, res) {
		const url = new URL(req.url, "http://phone.invalid");
		// pairing: the one door without a cookie
		if (url.pathname === `${PREFIX}pair`) {
			const r = phones.pair(url.searchParams.get("code"), req.headers["user-agent"]);
			if (r.error) return html(res, 403, page("Not paired", r.error));
			// over the tunnel the phone uses https (Cloudflare says so in these headers); the cookie is then Secure
			const secure = req.headers["x-forwarded-proto"] === "https" || /"scheme":"https"/.test(String(req.headers["cf-visitor"] || ""));
			const cookie = `${COOKIE}=${r.id}.${r.key}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_DAYS * 86400}${secure ? "; Secure" : ""}`;
			res.writeHead(303, { location: "/", "set-cookie": cookie, "cache-control": "no-store" });
			return res.end();
		}
		const phone = phones.check(cookieOf(req.headers.cookie));
		if (!phone) return html(res, 401, page("Open Crux on your laptop", "To study from this phone, open Crux Harness on your laptop, choose Study from your phone, and scan the code with this phone."));
		if (url.pathname === `${PREFIX}shim.js`) { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); return res.end(SHIM); }
		if (url.pathname === `${PREFIX}crux`) {
			if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only." });
			let command;
			try { command = JSON.parse((await readBody(req, 40 * 1024 * 1024)).toString() || "{}"); } catch (e) { return json(res, e.status || 400, { ok: false, code: "bad-request", error: "That request was not valid." }); }
			if (!command || !PHONE_OPS.has(command.op)) return json(res, 403, { ok: false, code: "laptop-only", error: "Do this on your laptop." });
			if (command.op === "share" && typeof command.request?.bytes === "string") command.request.bytes = new Uint8Array(Buffer.from(command.request.bytes, "base64"));
			return json(res, 200, forPhone(await control(command)));
		}
		if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
			if (apiRule(req.method, url.pathname) !== "pass") return json(res, 403, { error: "Change this on your laptop." });
		}
		return forward(req, res, url);
	}

	function forward(req, res, url) {
		const target = new URL(upstream());
		const headers = { ...req.headers };
		delete headers.cookie; // the phone's key never reaches the app server
		delete headers[DESKTOP_HEADER];
		delete headers.host;
		headers.host = target.host;
		const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
		if (isApi && secret) headers[DESKTOP_HEADER] = secret;
		const wantsPage = req.method === "GET" && !isApi && /text\/html/.test(String(req.headers.accept || ""));
		if (wantsPage) headers["accept-encoding"] = "identity"; // a page is read here to add the bridge script
		const up = http.request({ hostname: target.hostname, port: target.port, path: url.pathname + url.search, method: req.method, headers }, (r) => {
			const out = { ...r.headers };
			delete out["set-cookie"]; // the app server sets no cookie a phone needs
			if (wantsPage && /text\/html/.test(String(r.headers["content-type"] || ""))) {
				const chunks = [];
				r.on("data", (c) => chunks.push(c));
				r.on("end", () => {
					const body = Buffer.from(inject(Buffer.concat(chunks).toString("utf8")));
					delete out["content-length"]; delete out["content-encoding"]; delete out["transfer-encoding"];
					res.writeHead(r.statusCode, { ...out, "content-length": body.length });
					res.end(body);
				});
				return;
			}
			res.writeHead(r.statusCode, out);
			r.pipe(res); // streams (the tutor's replies) pass as they come
			res.on("close", () => r.destroy());
		});
		up.on("error", (e) => { log(`remote: upstream ${e.message}`); if (!res.headersSent) json(res, 502, { error: "Crux on your laptop is not answering. Is it still open?" }); else res.end(); });
		req.pipe(up);
		req.on("aborted", () => up.destroy());
	}

	let server = null;
	return {
		async start() {
			if (server) return server.address().port;
			server = http.createServer((req, res) => { handle(req, res).catch((e) => { log(`remote: ${e.message}`); if (!res.headersSent) json(res, 500, { error: "Something went wrong on your laptop." }); }); });
			server.keepAliveTimeout = 65000;
			await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
			return server.address().port;
		},
		stop() { server?.close(); server?.closeAllConnections?.(); server = null; },
		port: () => server?.address()?.port ?? null,
	};
}

/*
 * The tunnel: Cloudflare's quick tunnel (no account; a new random link each start). cloudflared is downloaded once
 * into the app's data folder when the student first turns this on (about 55 MB; the size is shown first).
 */
const CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
const CLOUDFLARED_MB = 55;
function cloudflaredPath(dir) { return path.join(dir, "cloudflared.exe"); }
function hasCloudflared(dir) { try { return fs.statSync(cloudflaredPath(dir)).size > 20 * 1024 * 1024; } catch { return false; } }
async function downloadCloudflared(dir, onProgress = () => {}, fetchImpl = fetch) {
	fs.mkdirSync(dir, { recursive: true });
	const final = cloudflaredPath(dir), part = `${final}.part`;
	const r = await fetchImpl(CLOUDFLARED_URL, { redirect: "follow" });
	if (!r.ok || !r.body) throw new Error(`The tunnel helper could not be downloaded (${r.status}).`);
	const total = Number(r.headers.get("content-length")) || CLOUDFLARED_MB * 1024 * 1024;
	const out = fs.createWriteStream(part);
	let got = 0;
	for await (const chunk of r.body) { got += chunk.length; out.write(chunk); onProgress(Math.min(1, got / total)); }
	await new Promise((resolve) => out.end(resolve));
	const head = Buffer.alloc(2); const fd = fs.openSync(part, "r"); fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
	if (got < 20 * 1024 * 1024 || head.toString() !== "MZ") { fs.rmSync(part, { force: true }); throw new Error("The tunnel helper download was incomplete. Try again on a steady connection."); }
	fs.renameSync(part, final);
	return final;
}
/** Start the tunnel to the proxy; resolves with the public https link. */
function startTunnel(dir, port, log = () => {}, spawnImpl = spawn) {
	return new Promise((resolve, reject) => {
		const child = spawnImpl(cloudflaredPath(dir), ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		let done = false;
		const timer = setTimeout(() => { if (!done) { done = true; child.kill(); reject(new Error("The tunnel did not open within 45 seconds. Check the internet connection.")); } }, 45000);
		const read = (buf) => {
			const text = buf.toString();
			const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text);
			if (m && !done) { done = true; clearTimeout(timer); resolve({ url: m[0], stop: () => child.kill() }); }
		};
		child.stdout.on("data", read); child.stderr.on("data", read);
		child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
		child.on("exit", (code) => { log(`tunnel exited (${code})`); if (!done) { done = true; clearTimeout(timer); reject(new Error("The tunnel closed. Try again.")); } });
	});
}

module.exports = { createPhones, createRemoteServer, apiRule, inject, forPhone, deviceName, PHONE_OPS, SHIM, hasCloudflared, downloadCloudflared, startTunnel, CLOUDFLARED_MB, PREFIX, COOKIE };
