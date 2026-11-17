/**
 * The clock of a hosted study room. A copy of Crux web's study/web/src/room-clock.js (keep them the same): the server
 * stores a schedule, every device works out the phase from it with the server's time, so a laptop that sleeps or has
 * the wrong time still shows the right block. Anchored to the current phase, so a skip or a settings change never
 * moves the boundaries after it.
 */
export type RoomPhaseName = "focus" | "short" | "long";
export type RoomClockState = "idle" | "running" | "paused" | "waiting" | "done" | "ended";
/** Minutes; longEvery 0 = never; rounds 0 = until the host stops. */
export interface RoomPlan { focus: number; short: number; long: number; longEvery: number; rounds: number; wait: boolean }
export interface RoomClock { plan: RoomPlan; state: RoomClockState; phase: RoomPhaseName; round: number; phaseStart: number | null; leftMs: number | null }
export interface RoomView { state: RoomClockState; mode: RoomPhaseName; left: number; total: number; round: number; rounds: number }

export const PRESETS: Record<"classic" | "long" | "paper", RoomPlan> = {
	classic: { focus: 25, short: 5, long: 15, longEvery: 4, rounds: 0, wait: false },
	long: { focus: 50, short: 10, long: 20, longEvery: 0, rounds: 0, wait: false },
	paper: { focus: 90, short: 20, long: 20, longEvery: 0, rounds: 0, wait: false },
};
export const LIMITS = { focus: [10, 120], short: [0, 30], long: [0, 60], longEvery: [0, 8], rounds: [0, 12] } as const;

const int = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
export function cleanPlan(p: Partial<RoomPlan> = {}): RoomPlan {
	const d = PRESETS.classic;
	const plan: RoomPlan = {
		focus: Math.round(int(p.focus, LIMITS.focus, d.focus) / 5) * 5,
		short: int(p.short, LIMITS.short, d.short),
		long: int(p.long, LIMITS.long, d.long),
		longEvery: int(p.longEvery, LIMITS.longEvery, d.longEvery),
		rounds: int(p.rounds, LIMITS.rounds, d.rounds),
		wait: p.wait === true,
	};
	if (plan.longEvery === 1) plan.longEvery = 2;
	return plan;
}

export const length = (plan: RoomPlan, phase: RoomPhaseName) => (plan[phase] || 0) * 60e3;

export function next(plan: RoomPlan, phase: RoomPhaseName, round: number): { phase: RoomPhaseName; round: number } | null {
	if (phase !== "focus") return { phase: "focus", round: round + 1 };
	if (plan.rounds && round >= plan.rounds) return null;
	const brk: RoomPhaseName = plan.longEvery > 0 && round % plan.longEvery === 0 ? "long" : "short";
	return length(plan, brk) > 0 ? { phase: brk, round } : { phase: "focus", round: round + 1 };
}

export function settle(c: RoomClock, now: number): RoomClock {
	if (c.state !== "running" || c.phaseStart == null) return c;
	let { phase, round } = c;
	let phaseStart = c.phaseStart;
	for (let i = 0; i < 500; i++) {
		const len = length(c.plan, phase);
		if (now - phaseStart < len) return { ...c, phase, round, phaseStart };
		const n = next(c.plan, phase, round);
		const endsAt = phaseStart + len;
		if (!n) return { ...c, state: "done", phase, round, phaseStart: null, leftMs: 0 };
		if (c.plan.wait) return { ...c, state: "waiting", phase: n.phase, round: n.round, phaseStart: null, leftMs: length(c.plan, n.phase) };
		({ phase, round } = n);
		phaseStart = endsAt;
	}
	return { ...c, phase, round, phaseStart: now };
}

export function phaseAt(c: RoomClock, now: number): RoomView {
	const s = settle(c, now);
	const total = length(s.plan, s.phase);
	const left = s.state === "running" && s.phaseStart != null ? total - (now - s.phaseStart)
		: s.state === "idle" ? length(s.plan, "focus")
			: s.state === "paused" || s.state === "waiting" ? (s.leftMs ?? 0) : 0;
	return { state: s.state, mode: s.phase, left: Math.max(0, left), total, round: s.round, rounds: s.plan.rounds };
}

/** A public room on the clock: the Study room focuses :00–:25 and :30–:55, the Long room :00–:50. */
export const PUBLIC_ROOMS = { hub: { name: "Study room", focus: 25, block: 30 }, long: { name: "Long room", focus: 50, block: 60 } } as const;
export type PublicRoomId = keyof typeof PUBLIC_ROOMS;
export function publicPhase(id: PublicRoomId, now: number): RoomView {
	const r = PUBLIC_ROOMS[id];
	const block = r.block * 60e3, focus = r.focus * 60e3, into = now % block;
	return into < focus
		? { state: "running", mode: "focus", left: focus - into, total: focus, round: 1, rounds: 0 }
		: { state: "running", mode: "short", left: block - into, total: block - focus, round: 1, rounds: 0 };
}
