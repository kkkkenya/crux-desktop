"use strict";
/**
 * The Hub files desk (Crux, owner 2026-11-18), the laptop side: put files into the drive dumper's Drop folder with a
 * name the dumper sorts without guessing, and show what the dumper did with them. The dumper (discord-sync-bot
 * pc/src/uploader) does the posting with the bot token, which never comes here.
 *
 *   Hub Dumper\Drop       files in (the dumper picks them up within seconds; pc/src/uploader/index.js watches it)
 *   Hub Dumper\Done\YYYY-MM   posted
 *   Hub Dumper\Problems   failed 5 times, each beside "<name>.txt" saying why
 *
 * Staff only: the window shows the desk only to staff (Crux web's GET /api/hub/desk answers 403 otherwise), and the
 * Drop folder exists only on the hub PC, where Google Drive for desktop is signed in to the Hub's account.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// The dumper's kinds (pc/src/uploader/classify.js KINDS) and the words that make it pick each one.
const KIND_WORDS = { paper: "Past Paper", scheme: "Marking Scheme", notes: "Notes", tutorial: "Tutorial", slides: "Slides", book: "Book" };
const UNIT = /^[A-Z]{3} ?\d{3}$/;
const MAX_BYTES = 500 * 1024 * 1024;

const clean = (s, max) => String(s ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The name a file is dropped under, so the dumper puts it in the right place: the unit code first (its post), then the
 * kind word (paper, notes …), the year, and the student's own title. "EMM 302 CAT 1 Marking Scheme 2024.pdf".
 */
function deskName({ unit, kind, year, title, ext }) {
	const code = String(unit || "").toUpperCase().replace(/^([A-Z]{3})\s*(\d{3})$/, "$1 $2");
	if (!UNIT.test(code)) throw Object.assign(new Error("Pick the unit first."), { code: "bad-request" });
	if (!KIND_WORDS[kind]) throw Object.assign(new Error("Pick what kind of file it is."), { code: "bad-request" });
	const y = /^(19|20)\d\d(\/\d{2,4})?$/.test(String(year || "")) ? String(year).replace("/", "-") : "";
	let t = clean(title, 80).replace(new RegExp(`\\b${code.replace(" ", "\\s?")}\\b`, "i"), "").trim(); // the code goes first, once
	if (!new RegExp(KIND_WORDS[kind].split(" ")[0], "i").test(t)) t = `${t} ${KIND_WORDS[kind]}`.trim();
	const e = String(ext || "").toLowerCase().replace(/^\.?/, ".");
	if (!/^\.[a-z0-9]{1,5}$/.test(e)) throw Object.assign(new Error("That file has no type the Hub takes."), { code: "bad-request" });
	return `${code} ${t}${y ? ` ${y}` : ""}`.replace(/\s+/g, " ").trim().slice(0, 150) + e;
}

function sha256(file) {
	return new Promise((resolve, reject) => {
		const h = crypto.createHash("sha256");
		fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
	});
}

/** Where the dumper's folder is: a saved choice, then the dumper's default (G:\My Drive\Hub Dumper), then other drives. */
function findHome(saved) {
	const tries = [saved, "G:\\My Drive\\Hub Dumper", ..."DEFGHIJKLMNOPQRSTUVWXYZ".split("").map((d) => `${d}:\\My Drive\\Hub Dumper`)].filter(Boolean);
	for (const t of tries) { try { if (fs.statSync(path.join(t, "Drop")).isDirectory()) return t; } catch { /* not here */ } }
	return null;
}

/** Copy into Drop under its desk name: a temp name first, then a rename, so the dumper never sees half a file. */
async function dropFiles(home, files) {
	if (!home) throw Object.assign(new Error("Google Drive's Hub Dumper folder isn't on this computer. Open Google Drive for desktop, or pick the folder."), { code: "no-drop" });
	const drop = path.join(home, "Drop");
	const out = [];
	for (const f of (Array.isArray(files) ? files : []).slice(0, 50)) {
		const src = String(f?.path || "");
		let st;
		try { st = fs.statSync(src); } catch { out.push({ path: src, error: "That file can't be read." }); continue; }
		if (!st.isFile()) { out.push({ path: src, error: "Not a file." }); continue; }
		if (st.size > MAX_BYTES) { out.push({ path: src, error: "Over 500 MB: too big for the Hub." }); continue; }
		let name;
		try { name = deskName({ ...f, ext: path.extname(src) }); } catch (e) { out.push({ path: src, error: e.message }); continue; }
		let dest = path.join(drop, name);
		for (let n = 2; fs.existsSync(dest) && n < 100; n++) dest = path.join(drop, name.replace(/(\.[^.]+)$/, ` (${n})$1`));
		const tmp = path.join(drop, `.crux-${crypto.randomBytes(6).toString("hex")}.part`);
		fs.copyFileSync(src, tmp, fs.constants.COPYFILE_EXCL);
		fs.renameSync(tmp, dest);
		out.push({ path: src, name: path.basename(dest), hash: await sha256(dest) });
	}
	return out;
}

/** What the dumper has: waiting in Drop, posted lately (Done), and failed (Problems, with why). */
function status(home) {
	if (!home) return { home: null, drop: [], done: [], problems: [] };
	const list = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
	const drop = list(path.join(home, "Drop")).filter((d) => d.isFile() && !d.name.startsWith(".crux-") && d.name !== "README.txt").map((d) => d.name);
	const months = list(path.join(home, "Done")).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse().slice(0, 2);
	const done = months.flatMap((m) => list(path.join(home, "Done", m)).filter((d) => d.isFile()).map((d) => {
		const p = path.join(home, "Done", m, d.name);
		let at = 0; try { at = fs.statSync(p).mtimeMs; } catch { /* gone */ }
		return { name: d.name, at };
	})).sort((a, b) => b.at - a.at).slice(0, 30);
	const probDir = path.join(home, "Problems");
	const problems = list(probDir).filter((d) => d.isFile() && !d.name.endsWith(".txt")).map((d) => {
		let why = "";
		try { why = fs.readFileSync(path.join(probDir, `${d.name}.txt`), "utf8").split(" wasn't posted: ")[1]?.trim() || ""; } catch { /* no note */ }
		return { name: d.name, why: why.slice(0, 300) };
	});
	return { home, drop, done, problems };
}

/** A failed file back into Drop for another go; its note goes. Only names that are in Problems. */
function retry(home, name) {
	const n = path.basename(String(name || ""));
	const src = path.join(home || "", "Problems", n);
	if (!home || !n || n.endsWith(".txt") || !fs.existsSync(src)) throw Object.assign(new Error("That file isn't in Problems."), { code: "bad-request" });
	let dest = path.join(home, "Drop", n);
	for (let i = 2; fs.existsSync(dest) && i < 100; i++) dest = path.join(home, "Drop", n.replace(/(\.[^.]+)?$/, ` (${i})$1`));
	fs.renameSync(src, dest);
	fs.rmSync(`${src}.txt`, { force: true });
	return { name: path.basename(dest) };
}

module.exports = { deskName, findHome, dropFiles, status, retry, sha256, KIND_WORDS };
