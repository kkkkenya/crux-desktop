/**
 * The tutor's line to the Crux account (Crux desktop, 2026-11-12).
 *
 * The local server is a child of the Electron main process, which holds the
 * Crux session (electron/crux-hub.cjs). Hub requests go over the child's
 * private IPC channel ("lh:crux"); only names, ids and local paths come back.
 * Outside the desktop app there is no account: every request says so.
 */
export type CruxBridgeReply<T> = { ok: true; value: T } | { ok: false; code: string; error: string };
type Send = (message: Record<string, unknown>, callback: (error: Error | null) => void) => boolean;
interface Port { connected: () => boolean; send: Send; onMessage: (listener: (message: unknown) => void) => void }

interface Pending { resolve(value: CruxBridgeReply<unknown>): void; timer: ReturnType<typeof setTimeout> }
const KEY = Symbol.for("crux.bridge");
const TIMEOUT_MS = 120_000; // a large book can take a while to download

const processPort = (): Port => ({
	connected: () => process.env.LH_DESKTOP_SERVER === "1" && typeof process.send === "function" && process.connected === true,
	send: (message, callback) => process.send!(message, callback),
	onMessage: (listener) => { process.on("message", listener); },
});

export function createCruxBridge(port: Port) {
	const pending = new Map<string, Pending>();
	let counter = 0;
	let listening = false;
	const listen = () => {
		if (listening) return;
		listening = true;
		port.onMessage((raw) => {
			const message = raw as { channel?: string; id?: string; ok?: boolean; value?: unknown; code?: string; error?: string };
			if (message?.channel !== "lh:crux" || typeof message.id !== "string") return;
			const waiting = pending.get(message.id);
			if (!waiting) return;
			clearTimeout(waiting.timer);
			pending.delete(message.id);
			waiting.resolve(message.ok
				? { ok: true, value: message.value }
				: { ok: false, code: String(message.code ?? "failed"), error: String(message.error ?? "Crux did not answer.") });
		});
	};
	return function cruxRequest<T>(op: "units" | "files" | "download", fields: Record<string, unknown> = {}): Promise<CruxBridgeReply<T>> {
		if (!port.connected()) return Promise.resolve({ ok: false, code: "no-desktop", error: "Hub files are available only in the Crux desktop app." });
		listen();
		return new Promise((resolve) => {
			const id = `${process.pid}:crux:${++counter}`;
			const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, code: "timeout", error: "Crux took too long to answer. Try again." }); }, TIMEOUT_MS);
			pending.set(id, { resolve: resolve as (value: CruxBridgeReply<unknown>) => void, timer });
			port.send({ ...fields, channel: "lh:crux", id, op }, (error) => {
				if (!error) return;
				clearTimeout(timer);
				pending.delete(id);
				resolve({ ok: false, code: "closed", error: "The desktop connection closed." });
			});
		});
	};
}

/** The one bridge for this server process. */
export function cruxRequest<T>(op: "units" | "files" | "download", fields: Record<string, unknown> = {}): Promise<CruxBridgeReply<T>> {
	const global = globalThis as typeof globalThis & { [KEY]?: ReturnType<typeof createCruxBridge> };
	global[KEY] ??= createCruxBridge(processPort());
	return global[KEY]<T>(op, fields);
}

export const cruxDesktopConnected = (): boolean => processPort().connected();
