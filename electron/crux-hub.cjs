"use strict";
/*
 * Crux account and hub files (Crux desktop, 2026-11-11).
 *
 * The student signs in to Crux in a small window of its own, on the Crux web
 * origin (Discord sign-in). That window uses a dedicated session partition, so
 * the Crux session cookie never reaches the app's own window or the local
 * server. Every call to Crux's API is made here, in the main process, through
 * that partition. The renderer only receives names, tiers, file lists and
 * local file paths.
 *
 * Hub files (notes, past papers) are downloaded once into
 * Documents/Crux/Hub/<unit>/ and reused from there, so opening a file again
 * never spends another daily download. The teaching agent reads them by path,
 * like any other attached file.
 */
const fs = require("node:fs");
const path = require("node:path");

const ORIGIN = (process.env.CRUX_ORIGIN || "https://crux.engineeringhub.site").replace(/\/+$/, "");
const PARTITION = "persist:crux-account";
const SIGN_IN_HOSTS = new Set([new URL(ORIGIN).host, "discord.com", "www.engineeringhub.site"]);
const FILE_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const MAX_FILE_BYTES = 100 * 1024 * 1024;
// A student who signed in recently can keep studying without a connection for this long.
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const OPS = new Set(["status", "login", "logout", "units", "files", "download", "reveal"]);

class CruxError extends Error {
	constructor(code, message, extra) {
		super(message);
		this.code = code;
		this.extra = extra;
	}
}

/** A name that is safe as one path segment on Windows, macOS and Linux. */
function safeSegment(name, fallback) {
	const cleaned = String(name ?? "")
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
		.replace(/\s+/g, " ")
		.replace(/^[ .]+|[ .]+$/g, "")
		.slice(0, 150);
	if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned)) return fallback;
	return cleaned;
}

function createCruxHub({ app, BrowserWindow, session, shell, log = () => {} }) {
	const ses = () => session.fromPartition(PARTITION);
	const hubRoot = () => path.join(app.getPath("documents"), "Crux", "Hub");
	let signInWindow = null;
	// The last confirmed account (name and plan only, never the session), for the offline grace.
	const accountFile = () => path.join(app.getPath("userData"), "crux-account.json");
	const remember = (account) => {
		try { fs.writeFileSync(accountFile(), JSON.stringify({ ...account, at: Date.now() })); } catch { /* the grace is a convenience */ }
	};
	const forget = () => { try { fs.rmSync(accountFile(), { force: true }); } catch { /* nothing to forget */ } };
	const remembered = () => {
		try {
			const saved = JSON.parse(fs.readFileSync(accountFile(), "utf8"));
			if (typeof saved?.at !== "number" || Date.now() - saved.at > OFFLINE_GRACE_MS || saved.at > Date.now()) return null;
			return { signedIn: true, name: String(saved.name ?? ""), tier: String(saved.tier ?? ""), offline: true };
		} catch { return null; }
	};

	async function api(pathname) {
		let response;
		try {
			response = await ses().fetch(`${ORIGIN}${pathname}`, { headers: { accept: "application/json" }, redirect: "manual" });
		} catch (err) {
			throw new CruxError("offline", "Could not reach Crux. Check your internet connection and try again.");
		}
		if (response.status === 401) throw new CruxError("signed-out", "Sign in to Crux first.");
		let body = null;
		try { body = await response.json(); } catch { /* not JSON: handled by the status below */ }
		if (response.status === 403 && body?.error === "no-access") {
			throw new CruxError("no-access", "This Discord account has no Study Hub plan yet. Join the Hub and pick a plan, then sign in again.");
		}
		if (response.status === 429) {
			throw new CruxError(body?.error === "download-limit" ? "download-limit" : "limit",
				body?.error === "download-limit" ? "Today's downloads are used up on your plan." : "Today's limit is used up.",
				{ resetsAt: body?.resetsAt ?? null });
		}
		if (!response.ok || body === null) throw new CruxError("failed", `Crux answered ${response.status}. Try again in a moment.`);
		return body;
	}

	async function status() {
		try {
			const me = await api("/api/me");
			const account = { signedIn: true, name: String(me.name ?? ""), tier: String(me.tier ?? "") };
			remember({ name: account.name, tier: account.tier });
			return account;
		} catch (err) {
			if (err instanceof CruxError && err.code === "signed-out") { forget(); return { signedIn: false }; }
			if (err instanceof CruxError && err.code === "no-access") { forget(); return { signedIn: false, problem: err.message }; }
			// No connection (or Crux is down): a recent sign-in still counts, for a week.
			if (err instanceof CruxError && (err.code === "offline" || err.code === "failed")) {
				const saved = remembered();
				if (saved) return saved;
				return { signedIn: false, problem: err.message };
			}
			throw err;
		}
	}

	/** Opens the sign-in window and resolves with the status once it closes. */
	function login(parent) {
		if (signInWindow && !signInWindow.isDestroyed()) {
			signInWindow.focus();
			return new Promise((resolve) => signInWindow.once("closed", () => resolve(status().catch(() => ({ signedIn: false })))));
		}
		const win = new BrowserWindow({
			width: 520,
			height: 760,
			parent: parent ?? undefined,
			title: "Sign in to Crux",
			autoHideMenuBar: true,
			backgroundColor: "#120e0c",
			webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
		});
		signInWindow = win;
		const allowed = (target) => {
			try {
				const url = new URL(target);
				return url.protocol === "https:" && (SIGN_IN_HOSTS.has(url.host) || url.host.endsWith(".discord.com"));
			} catch { return false; }
		};
		// Sign-in stays on Crux and Discord. Anything else opens in the real browser.
		const guard = (event, target) => {
			if (allowed(target)) return;
			event.preventDefault();
			if (/^https:\/\//i.test(String(target))) void shell.openExternal(target).catch(() => {});
		};
		win.webContents.on("will-navigate", guard);
		win.webContents.on("will-redirect", guard);
		win.webContents.setWindowOpenHandler(({ url }) => {
			if (/^https:\/\//.test(url)) void shell.openExternal(url).catch(() => {});
			return { action: "deny" };
		});
		// Once Crux has set its session, the page lands back on a Crux (or Hub) page: close.
		const settle = async (target) => {
			try {
				const url = new URL(target);
				if (url.host === "discord.com" || url.host.endsWith(".discord.com") || url.pathname.startsWith("/auth/")) return;
				const now = await status().catch(() => null);
				if (now?.signedIn && !win.isDestroyed()) win.close();
			} catch { /* keep the window open */ }
		};
		win.webContents.on("did-navigate", (_event, target) => void settle(target));
		win.webContents.on("did-redirect-navigation", (_event, target) => void settle(target));
		void win.loadURL(`${ORIGIN}/auth/login`).catch((err) => log(`crux sign-in: ${err?.message ?? err}`));
		return new Promise((resolve) => {
			win.once("closed", () => {
				if (signInWindow === win) signInWindow = null;
				resolve(status().catch(() => ({ signedIn: false })));
			});
		});
	}

	async function logout() {
		if (signInWindow && !signInWindow.isDestroyed()) signInWindow.close();
		await ses().clearStorageData();
		forget();
		return { signedIn: false };
	}

	/** The student's own units on Crux, then the whole catalogue for searching. */
	async function units() {
		const [state, catalog] = await Promise.all([
			api("/api/state").catch((err) => { if (err instanceof CruxError && err.code !== "failed") throw err; return null; }),
			api("/api/catalog").catch(() => null),
		]);
		const mine = Array.isArray(state?.data?.units)
			? state.data.units.filter((u) => u && typeof u.code === "string").map((u) => ({ code: u.code, title: String(u.title ?? "") }))
			: [];
		const all = Array.isArray(catalog?.all)
			? catalog.all.filter((u) => u && typeof u.code === "string").map((u) => ({ code: u.code, title: String(u.title ?? "") }))
			: [];
		return { mine, all };
	}

	// The hub id is part of the saved name: two hub files in one unit can share a name.
	const localPathFor = (unit, name, id) => {
		const safe = safeSegment(name, "file");
		const ext = path.extname(safe);
		return path.join(hubRoot(), safeSegment(unit, "unit"), `${safe.slice(0, safe.length - ext.length)} [${id}]${ext}`);
	};
	const inFlight = new Map();

	async function files(unit) {
		if (typeof unit !== "string" || !unit.trim() || unit.length > 40) throw new CruxError("bad-request", "Pick a unit first.");
		const library = await api(`/api/library?unit=${encodeURIComponent(unit.trim())}`);
		const rows = Array.isArray(library?.files) ? library.files : [];
		return {
			note: typeof library?.note === "string" ? library.note : null,
			files: rows
				// Hub rows have a numeric id; anything else is a file kept only on someone's own device.
				.filter((f) => f && /^\d+$/.test(String(f.id)) && typeof f.name === "string")
				.map((f) => {
					const local = localPathFor(unit.trim(), f.name, f.id);
					return {
						id: String(f.id),
						name: f.name,
						paper: f.paper === true,
						pages: Number.isFinite(f.pages) ? f.pages : null,
						path: fs.existsSync(local) ? local : null,
					};
				}),
		};
	}

	async function download(unit, id, name) {
		if (typeof unit !== "string" || !unit.trim() || !/^\d+$/.test(String(id)) || typeof name !== "string" || !name) {
			throw new CruxError("bad-request", "That file can't be downloaded.");
		}
		const target = localPathFor(unit.trim(), name, id);
		if (fs.existsSync(target)) return { path: target, left: null, cached: true };
		// A second request for a file that is already downloading waits for the first,
		// so a double click can never spend two of the day's downloads.
		if (inFlight.has(target)) return inFlight.get(target);
		const job = fetchToDisk(target, id).finally(() => inFlight.delete(target));
		inFlight.set(target, job);
		return job;
	}

	async function fetchToDisk(target, id) {
		const link = await api(`/api/files/${id}/download`);
		let url;
		try { url = new URL(link.url); } catch { throw new CruxError("failed", "Crux sent a link that can't be opened."); }
		if (url.protocol !== "https:" || !FILE_HOSTS.has(url.host)) throw new CruxError("failed", "Crux sent a link that can't be opened.");
		let response;
		try { response = await fetch(url, { redirect: "error" }); } catch { throw new CruxError("offline", "The download failed. Check your internet connection and try again."); }
		if (!response.ok) throw new CruxError("failed", `The file could not be downloaded (${response.status}).`);
		if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) throw new CruxError("failed", "That file is too large to download here.");
		// Read in pieces with a running total, so the size cap holds even without a Content-Length.
		const chunks = [];
		let total = 0;
		const reader = response.body?.getReader();
		if (!reader) throw new CruxError("failed", "The file could not be downloaded.");
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_FILE_BYTES) {
				void reader.cancel().catch(() => {});
				throw new CruxError("failed", "That file is too large to download here.");
			}
			chunks.push(value);
		}
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const partial = `${target}.part`;
		fs.writeFileSync(partial, Buffer.concat(chunks));
		fs.renameSync(partial, target);
		return { path: target, left: typeof link.left === "number" ? link.left : null, cached: false };
	}

	/** Show a downloaded hub file in the file manager. Only paths inside the hub folder. */
	function reveal(target) {
		const root = hubRoot();
		const resolved = path.resolve(String(target ?? ""));
		const rel = path.relative(root, resolved);
		if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(resolved)) throw new CruxError("bad-request", "That file isn't in the Hub folder.");
		shell.showItemInFolder(resolved);
		return true;
	}

	return { status, login, logout, units, files, download, reveal, hubRoot };
}

/** Renderer commands. The caller has already checked the sender is the trusted app window. */
async function cruxControl(command, hub, parentWindow) {
	try {
		if (!hub || !command || typeof command !== "object" || !OPS.has(command.op)) throw new CruxError("bad-request", "Unknown request.");
		switch (command.op) {
			case "status": return { ok: true, value: await hub.status() };
			case "login": return { ok: true, value: await hub.login(parentWindow) };
			case "logout": return { ok: true, value: await hub.logout() };
			case "units": return { ok: true, value: await hub.units() };
			case "files": return { ok: true, value: await hub.files(command.unit) };
			case "download": return { ok: true, value: await hub.download(command.unit, command.id, command.name) };
			case "reveal": return { ok: true, value: hub.reveal(command.path) };
		}
	} catch (err) {
		// Errors cross IPC as data so the renderer can show the reason and react to the code.
		if (err instanceof CruxError) return { ok: false, code: err.code, error: err.message, ...(err.extra ?? {}) };
		return { ok: false, code: "failed", error: "Something went wrong talking to Crux. Try again." };
	}
}

module.exports = { createCruxHub, cruxControl, safeSegment, CRUX_ORIGIN: ORIGIN };
