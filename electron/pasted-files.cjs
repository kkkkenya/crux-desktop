"use strict";
/**
 * Pasted files and screenshots (Ctrl+V into a composer). A clipboard image
 * has no file on disk, so the renderer sends its bytes here and they are
 * saved under Documents/Crux/Pasted, where the composer chips them like any
 * other file. Same trust rule as the attachment picker: only the app window.
 */
const fs = require("node:fs");
const path = require("node:path");
const { trustedSender } = require("./chatgpt-ipc.cjs");

/** One paste at most this big; matches the notes-import limit the renderer checks first. */
const MAX_PASTE_BYTES = 25 * 1024 * 1024;

const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md" };

/** A safe, dated file name: the basename only, no path separators or control characters. */
function pastedFileName(name, mime, now = new Date()) {
	const base = String(name || "").split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, "").trim();
	const stem = base.replace(/\.[^.]*$/, "").slice(0, 80) || "pasted";
	const ext = (base.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? MIME_EXT[String(mime || "").toLowerCase()] ?? "bin").toLowerCase();
	const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
	return `${stamp}-${stem}.${ext}`;
}

/** → the saved absolute path. Throws a readable Error for untrusted senders, bad input or oversize bytes. */
async function savePastedFile(event, payload, { BrowserWindow, trustedAppWindows, origin, documentsDir, now = new Date() }) {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!trustedAppWindows.has(win) || !trustedSender(event, origin, BrowserWindow)) throw new Error("Untrusted desktop request.");
	const bytes = payload && payload.bytes;
	if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("The pasted file was empty.");
	if (bytes.byteLength > MAX_PASTE_BYTES) throw new Error("The pasted file is over 25 MB. Save it first, then drop it in.");
	const dir = path.join(documentsDir, "Crux", "Pasted");
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, pastedFileName(payload.name, payload.mime, now));
	await fs.promises.writeFile(file, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { flag: "wx" });
	return file;
}

module.exports = { savePastedFile, pastedFileName, MAX_PASTE_BYTES };
