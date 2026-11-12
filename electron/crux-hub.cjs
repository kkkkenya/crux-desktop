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
const { pathToFileURL } = require("node:url");

const ORIGIN = (process.env.CRUX_ORIGIN || "https://crux.engineeringhub.site").replace(/\/+$/, "");
const PARTITION = "persist:crux-account";
const SIGN_IN_HOSTS = new Set([new URL(ORIGIN).host, "discord.com", "www.engineeringhub.site"]);
const FILE_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const MAX_FILE_BYTES = 100 * 1024 * 1024;
// A student who signed in recently can keep studying without a connection for this long.
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const OPS = new Set([
	"status", "login", "logout", "units", "files", "download", "reveal",
	// Study setup, the notes panel and "open in book" (2026-11-12).
	"study", "catalog", "saveSetup", "skipSetup", "addNote", "removeNote", "learn", "makeGuide", "openAt",
	// Sharing a file with the class, and the contributor board.
	"uploads", "contributors", "share",
	// The new-version notice.
	"updateCheck", "openUpdate",
]);
const ID = /^[\w-]{1,40}$/;
const UNIT = /^[A-Z]{2,5} ?\d{3}[A-Z]?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v, max) => String(v ?? "").trim().slice(0, max);

class CruxError extends Error {
	constructor(code, message, extra) {
		super(message);
		this.code = code;
		this.extra = extra;
	}
}

/** Whether release version a (x.y.z) is newer than b. */
function newerVersion(a, b) {
	const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
	for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
	return false;
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
			const pic = typeof saved.avatar === "string" && saved.avatar.startsWith("https://cdn.discordapp.com/") ? { avatar: saved.avatar } : {};
			return { signedIn: true, name: String(saved.name ?? ""), tier: String(saved.tier ?? ""), ...pic, offline: true };
		} catch { return null; }
	};

	async function api(pathname, method = "GET", payload) {
		let response;
		try {
			const headers = { accept: "application/json" };
			if (payload !== undefined) headers["content-type"] = "application/json";
			response = await ses().fetch(`${ORIGIN}${pathname}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload), redirect: "manual" });
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
				body?.error === "download-limit" ? "Today's downloads are used up on your plan." : (typeof body?.error === "string" ? body.error.slice(0, 300) : "Today's limit is used up."),
				{ resetsAt: body?.resetsAt ?? null });
		}
		if (!response.ok || body === null) {
			// Crux's own words for a refusal it explains (a 4xx with { error }), else a plain retry message.
			const said = response.status >= 400 && response.status < 500 && typeof body?.error === "string" ? body.error.slice(0, 300) : "";
			throw new CruxError("failed", said || `Crux answered ${response.status}. Try again in a moment.`);
		}
		return body;
	}

	async function status() {
		try {
			const me = await api("/api/me");
			const account = { signedIn: true, name: String(me.name ?? ""), tier: String(me.tier ?? "") };
			// The Discord picture, for the rail; only from Discord's own image host.
			if (typeof me.avatar === "string" && me.avatar.startsWith("https://cdn.discordapp.com/")) account.avatar = me.avatar;
			remember({ name: account.name, tier: account.tier, ...(account.avatar ? { avatar: account.avatar } : {}) });
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
			// Wide enough that Discord shows its QR code beside the password form.
			width: 980,
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
		aiKey = null; // the hosted-models key belongs to the account that signed out
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

	// ---- Study setup, notes panel, study guides, open in book (2026-11-12) ----

	// Kept on this computer only: "I'm not an engineering student" skips the setup for good.
	const prefsFile = () => path.join(app.getPath("userData"), "crux-prefs.json");
	const prefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile(), "utf8")) ?? {}; } catch { return {}; } };
	const setPref = (key, value) => {
		try { fs.writeFileSync(prefsFile(), JSON.stringify({ ...prefs(), [key]: value })); } catch { /* a convenience */ }
	};

	const noteOf = (n) => ({ id: String(n?.id ?? ""), text: String(n?.text ?? ""), unit: typeof n?.unit === "string" ? n.unit : null, from: typeof n?.from === "string" ? n.from : "", at: String(n?.at ?? "") });
	const list = (v) => (Array.isArray(v) ? v : []);

	/** What the notes panel and the setup need from the student's Crux document. */
	async function study() {
		const state = await api("/api/state");
		const data = state?.data ?? {};
		return {
			units: list(data.units).filter((u) => u && typeof u.code === "string").map((u) => ({ code: u.code, title: String(u.title ?? ""), catDate: typeof u.catDate === "string" ? u.catDate : null })),
			topics: list(data.topics).filter((t) => t && typeof t.id === "string" && typeof t.unit === "string").map((t) => ({ id: t.id, unit: t.unit, name: String(t.name ?? "") })),
			notes: list(data.stickies).filter((n) => n && typeof n.id === "string").map(noteOf),
			cohort: state?.settings?.cohort ?? null,
			setupSkipped: prefs().setupSkipped === true,
		};
	}

	async function catalog(course, year) {
		const q = new URLSearchParams();
		if (typeof course === "string" && /^[A-Z]{3}$/.test(course)) q.set("course", course);
		if (Number.isInteger(year) && year >= 1 && year <= 5) q.set("year", String(year));
		const c = await api(`/api/catalog?${q}`);
		const units = (v) => list(v).filter((u) => u && typeof u.code === "string").map((u) => ({ code: u.code, title: String(u.title ?? "") }));
		return {
			courses: list(c?.courses).filter((x) => x && typeof x.code === "string").map((x) => ({ code: x.code, name: String(x.name ?? x.code) })),
			course: String(c?.course ?? ""), year: Number(c?.year) || null,
			core: units(c?.core), shared: units(c?.shared),
		};
	}

	/** Course, year and semester, the units taken, and any CAT dates, saved to Crux in that order. */
	async function saveSetup(setup) {
		const cohort = setup?.cohort;
		if (!cohort || !/^[A-Z]{3}$/.test(String(cohort.course)) || ![1, 2, 3, 4, 5].includes(cohort.year) || ![1, 2].includes(cohort.sem)) {
			throw new CruxError("bad-request", "Pick a course, a year and a semester.");
		}
		const picked = list(setup.units).filter((u) => u && UNIT.test(String(u.code))).slice(0, 20)
			.map((u) => ({ code: String(u.code), title: text(u.title, 200) }));
		if (picked.length === 0) throw new CruxError("bad-request", "Pick at least one unit.");
		await api("/api/settings", "POST", { cohort: { course: cohort.course, year: cohort.year, sem: cohort.sem } });
		await api("/api/units", "PUT", picked);
		const dates = setup.dates && typeof setup.dates === "object" ? setup.dates : {};
		for (const u of picked) {
			const d = dates[u.code];
			if (d === "TBA" || (typeof d === "string" && DAY.test(d))) await api(`/api/units?code=${encodeURIComponent(u.code)}`, "PATCH", { catDate: d });
		}
		setPref("setupSkipped", false);
		return study();
	}

	function skipSetup() { setPref("setupSkipped", true); return true; }

	async function addNote(note) {
		const payload = { text: text(note?.text, 2000), unit: typeof note?.unit === "string" && UNIT.test(note.unit) ? note.unit : null };
		if (!payload.text) throw new CruxError("bad-request", "Write something first.");
		const from = text(note?.from, 120);
		if (from) payload.from = from;
		return noteOf(await api("/api/stickies", "POST", payload));
	}

	async function removeNote(id) {
		if (typeof id !== "string" || !ID.test(id)) throw new CruxError("bad-request", "That note can't be removed.");
		await api(`/api/stickies/${id}`, "DELETE");
		return true;
	}

	const refOf = (r) => ({
		fileId: String(r?.fileId ?? ""), name: String(r?.name ?? ""),
		pages: Array.isArray(r?.pages) ? r.pages.filter(Number.isFinite).slice(0, 2) : null,
		snippet: text(r?.snippet, 400),
	});
	const guideOf = (g) => (g && Array.isArray(g.outline) ? {
		overview: text(g.overview, 4000),
		outline: g.outline.slice(0, 20).map((o) => ({
			name: text(o?.name, 200), expect: text(o?.expect, 1000), skip: text(o?.skip, 500),
			formulas: list(o?.formulas).slice(0, 12).map((f) => text(f, 300)),
			read: list(o?.read).slice(0, 8).map((r) => ({ book: text(r?.book, 200), where: text(r?.where, 120), focus: text(r?.focus, 300), page: Number.isFinite(r?.page) ? r.page : null })),
		})),
		exam: text(g.exam, 1500),
		plan: list(g.plan).slice(0, 12).map((x) => text(x, 300)),
		checklist: list(g.checklist).slice(0, 15).map((x) => text(x, 300)),
	} : null);

	/** A topic's study path from Crux: its guide (if made), the pages to read, worked examples, the unit's books. */
	async function learn(unit, topicId) {
		if (!UNIT.test(String(unit)) || !ID.test(String(topicId))) throw new CruxError("bad-request", "Pick a unit and a topic.");
		const p = await api(`/api/learn?unit=${encodeURIComponent(unit)}&topicId=${encodeURIComponent(topicId)}`);
		const refs = (v) => list(v).slice(0, 6).map(refOf).filter((r) => /^\d+$/.test(r.fileId));
		return {
			guide: guideOf(p?.guide),
			read: refs(p?.read), examples: refs(p?.examples),
			books: list(p?.books).filter((b) => b && /^\d+$/.test(String(b.id))).map((b) => ({ id: String(b.id), name: String(b.name ?? "") })),
		};
	}

	/** Make (or remake) the topic's study guide. One AI action on the student's Crux plan. */
	async function makeGuide(unit, topicId, fresh) {
		if (!UNIT.test(String(unit)) || !ID.test(String(topicId))) throw new CruxError("bad-request", "Pick a unit and a topic.");
		const g = await api("/api/learn/guide", "POST", { unit, topicId, fresh: fresh === true });
		if (g?.needAi) throw new CruxError("failed", typeof g.message === "string" ? g.message : "Crux has no AI available for this right now.");
		const guide = guideOf(g);
		if (!guide) throw new CruxError("failed", "Crux did not send a study guide back. Try again.");
		return guide;
	}

	// "Open in book · p. 112": the hub file, downloaded once, in a reader window at that page.
	// PDFs open in Chromium's own viewer inside Crux; anything else in the computer's own app.
	const readers = new Map();
	async function openAt(unit, id, name, page) {
		if (!UNIT.test(String(unit))) throw new CruxError("bad-request", "That file can't be opened.");
		const file = await download(unit, id, name);
		const at = Number.isInteger(page) && page > 0 && page < 100000 ? page : null;
		if (!/\.pdf$/i.test(file.path)) {
			const problem = await shell.openPath(file.path);
			if (problem) throw new CruxError("failed", `The file could not be opened: ${problem}`);
			return { path: file.path, left: file.left };
		}
		const url = `${pathToFileURL(file.path).href}${at ? `#page=${at}` : ""}`;
		const existing = readers.get(file.path);
		if (existing && !existing.isDestroyed()) {
			void existing.loadURL(url).catch(() => {});
			existing.focus();
			return { path: file.path, left: file.left };
		}
		const win = new BrowserWindow({
			width: 1000, height: 900, title: path.basename(file.path), autoHideMenuBar: true, backgroundColor: "#120e0c",
			webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, plugins: true, partition: "crux-reader" },
		});
		readers.set(file.path, win);
		win.on("closed", () => readers.delete(file.path));
		// The reader shows this one file: links in it open in the browser, nothing else loads here.
		const home = url.split("#")[0];
		win.webContents.on("will-navigate", (event, target) => {
			if (String(target).split("#")[0] === home) return;
			event.preventDefault();
			if (/^https:\/\//i.test(String(target))) void shell.openExternal(target).catch(() => {});
		});
		win.webContents.setWindowOpenHandler(({ url: target }) => {
			if (/^https:\/\//i.test(target)) void shell.openExternal(target).catch(() => {});
			return { action: "deny" };
		});
		void win.loadURL(url).catch((err) => log(`crux reader: ${err?.message ?? err}`));
		return { path: file.path, left: file.left };
	}

	// ---- Share a file with the class, with the student's consent (2026-11-12) ----
	// Crux web's own pipeline: a signed upload to Crux storage, then the hub PC (the bot)
	// posts it to the unit's Discord thread, credited to the student. Duplicates earn nothing.
	const SHARE_TYPES = /\.(pdf|jpe?g|png|pptx?|docx?)$/i;
	const SHARE_MAX = 50 * 1024 * 1024;
	const sameName = (a, b) => String(a).toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, " ").trim() === String(b).toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, " ").trim();

	async function uploads(unit) {
		if (!UNIT.test(String(unit))) throw new CruxError("bad-request", "Pick a unit first.");
		const r = await api(`/api/uploads?unit=${encodeURIComponent(unit)}`);
		const c = r?.credits ?? {};
		return {
			files: list(r?.files).slice(0, 20).map((f) => ({ name: text(f?.name, 200), status: text(f?.status, 20), at: text(f?.created_at, 40) })),
			credits: { count: Number(c.count) || 0, goal: Number(c.goal) || 10, until: typeof c.until === "string" ? c.until : null, premium: c.premium === true, earned: c.earned === true },
		};
	}

	async function contributors() {
		const r = await api("/api/contributors");
		const pic = (v) => (typeof v === "string" && v.startsWith("https://cdn.discordapp.com/") ? v : null);
		return {
			top: list(r?.top).slice(0, 10).map((c) => ({ name: text(c?.name, 80), files: Number(c?.files) || 0, you: c?.you === true, medal: c?.medal === true, avatar: pic(c?.avatar) })),
			you: r?.you && Number.isFinite(r.you.rank) ? { rank: r.you.rank, files: Number(r.you.files) || 0 } : null,
			goal: Number(r?.goal) || 10,
		};
	}

	/** { unit, name, bytes, consent: true } → the file joins the hub PC's queue. */
	async function share(request) {
		if (request?.consent !== true) throw new CruxError("bad-request", "Tick the box to agree to share the file first.");
		const unit = String(request.unit ?? "");
		const name = text(request.name, 200);
		const bytes = request.bytes instanceof Uint8Array ? request.bytes : null;
		if (!UNIT.test(unit)) throw new CruxError("bad-request", "Pick one of your units first.");
		if (!SHARE_TYPES.test(name)) throw new CruxError("bad-request", "PDFs, photos (JPG, PNG), PowerPoint and Word files only.");
		if (!bytes || bytes.byteLength === 0) throw new CruxError("bad-request", "That file is empty.");
		if (bytes.byteLength > SHARE_MAX) throw new CruxError("bad-request", "Up to 50 MB a file.");
		// The hub already has one by this name: say so instead of spending the upload.
		const have = await files(unit).catch(() => null);
		const twin = have?.files.find((f) => sameName(f.name, name));
		if (twin) throw new CruxError("duplicate", `The hub already has "${twin.name}" for ${unit}. Duplicates don't earn credit.`);
		const start = await api("/api/uploads/start", "POST", { unit, name, size: bytes.byteLength, batch: String(Date.now()) });
		let url;
		try { url = new URL(start?.uploadUrl); } catch { throw new CruxError("failed", "Crux sent an upload link that can't be used."); }
		if (url.protocol !== "https:" || !url.host.endsWith(".supabase.co")) throw new CruxError("failed", "Crux sent an upload link that can't be used.");
		const form = new FormData();
		form.append("cacheControl", "3600");
		form.append("", new Blob([bytes]), name);
		let put;
		try { put = await fetch(url, { method: "PUT", body: form, redirect: "error" }); } catch { throw new CruxError("offline", "The upload failed. Check your connection and try again."); }
		if (!put.ok) throw new CruxError("failed", `The upload failed (${put.status}).`);
		await api("/api/uploads/done", "POST", { id: start.id });
		return uploads(unit);
	}


	// ---- "A new version of Crux is out" (2026-11-12) ----
	// Crux web serves desktop/latest.json: { version, url, notes }. The app compares it with its own
	// version and the renderer shows a banner; the download opens in the browser. Downloads come
	// only from the Crux desktop releases on GitHub.
	const RELEASES = "https://github.com/kkkkenya/crux-desktop/releases/";
	async function updateCheck() {
		let latest;
		try {
			const response = await fetch(`${ORIGIN}/desktop/latest.json`, { headers: { accept: "application/json" }, cache: "no-store", redirect: "error" });
			if (!response.ok) return { available: false };
			latest = await response.json();
		} catch { return { available: false }; } // offline: say nothing
		const version = typeof latest?.version === "string" ? latest.version.trim() : "";
		const url = typeof latest?.url === "string" ? latest.url : "";
		if (!/^\d+\.\d+\.\d+$/.test(version) || !url.startsWith(RELEASES)) return { available: false };
		const current = app.getVersion();
		return { available: newerVersion(version, current), version, current, url, notes: text(latest.notes, 300) };
	}
	// The relay key for hosted models (study/server/ai-relay.js): 12 hours, fetched again 10 minutes before it ends.
	let aiKey = null;
	async function aiToken() {
		if (aiKey && aiKey.exp - Date.now() > 10 * 60 * 1000) return { token: aiKey.token, exp: aiKey.exp };
		const r = await api("/api/ai/token");
		if (typeof r?.token !== "string" || !Number.isFinite(r?.exp)) throw new CruxError("failed", "Crux did not send a key for hosted models.");
		aiKey = { token: r.token, exp: r.exp };
		return { token: aiKey.token, exp: aiKey.exp };
	}

	async function openUpdate(url) {
		if (typeof url !== "string" || !url.startsWith(RELEASES)) throw new CruxError("bad-request", "That download link isn't a Crux release.");
		await shell.openExternal(url);
		return true;
	}

	return { status, login, logout, units, files, download, reveal, hubRoot, study, catalog, saveSetup, skipSetup, addNote, removeNote, learn, makeGuide, openAt, uploads, contributors, share, updateCheck, openUpdate, aiToken };
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
			case "study": return { ok: true, value: await hub.study() };
			case "catalog": return { ok: true, value: await hub.catalog(command.course, command.year) };
			case "saveSetup": return { ok: true, value: await hub.saveSetup(command.setup) };
			case "skipSetup": return { ok: true, value: hub.skipSetup() };
			case "addNote": return { ok: true, value: await hub.addNote(command.note) };
			case "removeNote": return { ok: true, value: await hub.removeNote(command.id) };
			case "learn": return { ok: true, value: await hub.learn(command.unit, command.topicId) };
			case "makeGuide": return { ok: true, value: await hub.makeGuide(command.unit, command.topicId, command.fresh) };
			case "openAt": return { ok: true, value: await hub.openAt(command.unit, command.id, command.name, command.page) };
			case "uploads": return { ok: true, value: await hub.uploads(command.unit) };
			case "contributors": return { ok: true, value: await hub.contributors() };
			case "share": return { ok: true, value: await hub.share(command.request) };
			case "updateCheck": return { ok: true, value: await hub.updateCheck() };
			case "openUpdate": return { ok: true, value: await hub.openUpdate(command.url) };
		}
	} catch (err) {
		// Errors cross IPC as data so the renderer can show the reason and react to the code.
		if (err instanceof CruxError) return { ok: false, code: err.code, error: err.message, ...(err.extra ?? {}) };
		return { ok: false, code: "failed", error: "Something went wrong talking to Crux. Try again." };
	}
}

/*
 * The tutor's hub tools (src/agent/tools/hub.ts) run in the local server child.
 * They ask over the child's private IPC channel; the Crux session stays here.
 * Three questions only: the student's units, a unit's hub files, and one file
 * downloaded to the Hub folder (its local path comes back, nothing else).
 */
function attachCruxChild(child, getHub) {
	let disposed = false;
	const send = (packet) => { if (!disposed && child.connected) { try { child.send(packet, () => {}); } catch { /* child exited */ } } };
	const listener = async (message) => {
		if (disposed || message?.channel !== "lh:crux" || typeof message.id !== "string") return;
		const { id, op } = message;
		const hub = getHub();
		let reply;
		if (!hub) reply = { ok: false, code: "signed-out", error: "Crux is still starting. Try again in a moment." };
		else if (op === "units") reply = await cruxControl({ op: "units" }, hub, null);
		else if (op === "files") reply = await cruxControl({ op: "files", unit: message.unit }, hub, null);
		else if (op === "download") reply = await cruxControl({ op: "download", unit: message.unit, id: message.fileId, name: message.name }, hub, null);
		// The relay key goes to the local server only, never to the window.
		else if (op === "aiToken") {
			try { reply = { ok: true, value: await hub.aiToken() }; }
			catch (err) { reply = { ok: false, code: err?.code ?? "failed", error: err?.code ? err.message : "Crux could not give a key for hosted models." }; }
		}
		else reply = { ok: false, code: "bad-request", error: "Unknown request." };
		send({ channel: "lh:crux", id, op, ...reply });
	};
	child.on("message", listener);
	return { dispose() { disposed = true; child.removeListener("message", listener); } };
}

module.exports = { createCruxHub, cruxControl, attachCruxChild, safeSegment, newerVersion, CRUX_ORIGIN: ORIGIN };
