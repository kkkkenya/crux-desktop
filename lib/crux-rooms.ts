/**
 * The study room you are in, kept outside the screens so it runs while you study (the same rooms as Crux web's
 * Focus page; study/web/src/room-store.js there). A hosted room: the last state from Crux, the gap between this
 * computer's clock and the server's, one engine that asks again every 20 s while the window is on screen and chimes
 * when the phase changes. A public room: a clock to the hour, and a count of others in it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CruxBridge } from "@/components/crux-hub";
import { length, phaseAt, publicPhase, settle, type PublicRoomId, type RoomClock, type RoomPlan, type RoomView } from "@/lib/crux-room-clock";

export interface RoomPerson { key: string; name: string; host: boolean; here: boolean; me: boolean }
export interface RoomState { now: number; room: { code: string; name: string; unit: string | null; clock: RoomClock; version: number; locked: boolean; host: boolean }; people: RoomPerson[] }
export interface RoomsList { now: number; public: { id: PublicRoomId; name: string; focus: number; block: number; count: number | null }[]; mine: { code: string; name: string } | null }

const KEY = "crux:room";
const POLL = 20e3;
const bridge = (): CruxBridge | undefined => (typeof window === "undefined" ? undefined : window.lh?.crux);

type Saved = { code: string | null; pub: PublicRoomId | null };
const load = (): Saved => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null") as Saved | null; return { code: v?.code ?? null, pub: v?.pub === "hub" || v?.pub === "long" ? v.pub : null }; } catch { return { code: null, pub: null }; } };

export interface RoomsSnapshot { code: string | null; pub: PublicRoomId | null; data: RoomState | null; offset: number; notice: string | null; pubCount: number | null; open: boolean }
let st: RoomsSnapshot = { code: null, pub: null, data: null, offset: 0, notice: null, pubCount: null, open: false };
let loaded = false;
const subs = new Set<() => void>();
function set(patch: Partial<RoomsSnapshot>) {
	st = { ...st, ...patch };
	try { localStorage.setItem(KEY, JSON.stringify({ code: st.code, pub: st.pub })); } catch { /* storage blocked */ }
	subs.forEach((f) => f());
}
function ensureLoaded() { if (!loaded && typeof window !== "undefined") { loaded = true; st = { ...st, ...load() }; } }
export function useRooms(): RoomsSnapshot {
	ensureLoaded();
	return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st, () => st);
}
export const serverNow = () => Date.now() + st.offset;
/** The room panel: open (full) or folded to the mini bar. */
export const setRoomPanel = (open: boolean) => set({ open });
export const clearRoomNotice = () => set({ notice: null });

/** A reply from Crux; an older one than we hold (a poll that crossed a host action) is dropped. */
function adopt(v: RoomState) {
	if (st.data && st.data.room.code === v.room.code && v.room.version < st.data.room.version) return;
	set({ code: v.room.code, pub: null, data: v, offset: v.now - Date.now(), notice: null });
}
function gone(message: string | null) { tellFocus(null); set({ code: null, data: null, notice: message, open: Boolean(message) }); }

let told: string | null = null;
function tellFocus(until: string | null, room: PublicRoomId | null = null) {
	const key = `${until}|${room}`;
	if (key === told) return;
	told = key;
	void bridge()?.focus?.(until, room).then((r) => { if (r.ok && room) set({ pubCount: r.value.room }); }).catch(() => {});
}

class RoomError extends Error { constructor(message: string, readonly status?: number) { super(message); } }
async function call<T>(p: Promise<{ ok: true; value: T } | { ok: false; error: string; status?: number }> | undefined): Promise<T> {
	if (!p) throw new RoomError("Update Crux Harness to use study rooms.");
	const r = await p;
	if (!r.ok) throw new RoomError(r.error, r.status);
	return r.value;
}

let chimeCtx: AudioContext | null = null;
function prime() { try { chimeCtx = chimeCtx || new AudioContext(); void chimeCtx.resume(); } catch { /* no sound */ } }
function chime() {
	try {
		const a = chimeCtx;
		if (a) [0, 0.22].forEach((at, i) => {
			const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
			o.frequency.value = i ? 880 : 660;
			g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
			o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.55);
		});
	} catch { /* no sound */ }
}

export async function hostRoom(room: { name?: string; unit?: string | null; plan?: Partial<RoomPlan> }) {
	prime();
	const v = await call(bridge()?.roomHost?.(room));
	adopt(v);
}
export async function joinRoomCode(code: string) {
	prime();
	const v = await call(bridge()?.roomJoin?.(code));
	adopt(v);
}
export async function refreshRoom() {
	if (!st.code) return;
	try { adopt(await call(bridge()?.roomState?.(st.code))); } catch (e) {
		const s = (e as RoomError).status;
		if (s === 410 || s === 403 || s === 400) gone((e as Error).message);
		// no connection: keep the last state; the clock runs on its own
	}
}
export async function roomAct(action: string, extra: { plan?: Partial<RoomPlan>; name?: string; person?: string } = {}) {
	prime();
	if (!st.code) return;
	try {
		const v = await call(bridge()?.roomAct?.(st.code, action, { version: st.data?.room.version, ...extra }));
		if ("ended" in v) { gone("You ended the room."); return; }
		adopt(v);
	} catch (e) {
		const s = (e as RoomError).status;
		if (s === 409) { await refreshRoom(); throw new Error("The room changed. Check it and try again."); }
		if (s === 410) { gone((e as Error).message); return; }
		throw e;
	}
}
export async function leaveRoom() {
	if (st.code) await bridge()?.roomLeave?.().catch(() => null);
	tellFocus(null);
	set({ code: null, data: null, pub: null, notice: null, pubCount: null });
}
export async function joinPublic(id: PublicRoomId) {
	prime();
	if (st.code) await bridge()?.roomLeave?.().catch(() => null);
	set({ code: null, data: null, pub: id, notice: null, open: true });
	const v = publicPhase(id, Date.now());
	tellFocus(v.mode === "focus" ? new Date(Date.now() + v.left).toISOString() : null, id);
}
export async function roomsList(): Promise<RoomsList> { return call(bridge()?.rooms?.()); }

/** The clock now, as the panel shows it. */
export function roomViewNow(s: RoomsSnapshot = st): RoomView | null {
	if (s.pub) return publicPhase(s.pub, Date.now());
	if (!s.data) return null;
	return phaseAt(s.data.room.clock, Date.now() + s.offset);
}

/* One engine for the whole app, however many screens show the room. */
let users = 0;
let stopEngine: (() => void) | null = null;
function startEngine() {
	if (stopEngine) return;
	if (st.code && !st.data) void refreshRoom();
	let last: string | null = null, polled = Date.now();
	const beat = setInterval(() => {
		const v = roomViewNow();
		if (!v) return;
		const key = `${st.code ?? st.pub}:${v.state}:${v.mode}:${v.round}:${st.pub ? Math.round((Date.now() + v.left) / 60e3) : ""}`;
		if (last && key !== last) chime();
		last = key;
		if (st.pub) tellFocus(v.mode === "focus" ? new Date(Math.round((Date.now() + v.left) / 60e3) * 60e3).toISOString() : null, st.pub);
		else if (st.data) {
			// the block's exact end in server time, so the same value is sent once, not every second
			const c = settle(st.data.room.clock, serverNow());
			tellFocus(v.state === "running" && v.mode === "focus" && c.phaseStart != null ? new Date(c.phaseStart + length(c.plan, c.phase)).toISOString() : null);
		}
		if (st.code && Date.now() - polled >= POLL && document.visibilityState === "visible") { polled = Date.now(); void refreshRoom(); }
	}, 1000);
	const back = () => { if (document.visibilityState === "visible" && st.code) { polled = Date.now(); void refreshRoom(); } };
	document.addEventListener("visibilitychange", back);
	stopEngine = () => { clearInterval(beat); document.removeEventListener("visibilitychange", back); };
}

/** Subscribe a screen to the room: re-render once a second while in one. */
export function useRoomTick(): RoomsSnapshot {
	const s = useRooms();
	const [, tick] = useState(0);
	const active = Boolean(s.code || s.pub);
	useEffect(() => {
		if (!active) return;
		users++;
		startEngine();
		const t = setInterval(() => tick(Date.now()), 1000);
		return () => { clearInterval(t); if (--users === 0) { stopEngine?.(); stopEngine = null; } };
	}, [active]);
	return s;
}

export const clockText = (ms: number) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
