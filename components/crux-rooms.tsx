"use client";

/**
 * Study rooms (2026-11-18): the same rooms as Crux web's Focus page. Host a room and others join with a four-letter
 * code; the host runs one clock for everyone (start, pause, skip, Room settings). Or join a public room on the clock.
 * Not a call and not a screen share: everyone keeps studying in their own Crux. The room panel lives in the app shell,
 * so the clock keeps going in a session; it folds into a small bar. Design and words follow Crux web's Rooms.jsx.
 */
import { useEffect, useRef, useState } from "react";
import { CopyIcon, SettingsIcon, UserIcon, UsersIcon, XIcon, ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { LIMITS, PRESETS, PUBLIC_ROOMS, type PublicRoomId, type RoomPlan, type RoomView } from "@/lib/crux-room-clock";
import {
	clearRoomNotice, clockText, hostRoom, joinPublic, joinRoomCode, leaveRoom, roomAct, roomCheckin, roomViewNow, roomsList, setRoomPanel, useRoomTick, useRooms,
	type RoomBoard, type RoomState, type RoomsList,
} from "@/lib/crux-rooms";

const MODES = { focus: "Focus", short: "Short break", long: "Long break" } as const;
const LETTERS = "BCDFGHJKLMNPQRSTVWXZ";
const tidy = (v: string) => v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
const validCode = (c: string) => c.length === 4 && [...c].every((ch) => LETTERS.includes(ch));
const WEB = "https://crux.engineeringhub.site";

export function RoomRing({ v, sub, small = false }: { v: RoomView; sub: React.ReactNode; small?: boolean }) {
	const R = 112, C = 2 * Math.PI * R;
	const done = v.total ? 1 - v.left / v.total : 0;
	return (
		<div className={cn("crux-ring", small && "is-small")}>
			<svg viewBox="0 0 260 260" aria-hidden>
				<circle cx="130" cy="130" r={R} className="crux-ring-track" />
				<circle cx="130" cy="130" r={R} className={cn("crux-ring-fill", v.mode)} strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, done)))} />
			</svg>
			<div className="crux-ring-text">
				<span className="crux-ring-time" role="timer" aria-live="off">{clockText(v.left)}</span>
				<span className="crux-ring-sub">{sub}</span>
			</div>
		</div>
	);
}

function PlanFields({ plan, setPlan }: { plan: RoomPlan; setPlan: (p: RoomPlan) => void }) {
	const num = (k: "focus" | "short" | "long" | "longEvery" | "rounds", label: string, unit: string, step = 1) => (
		<label className="crux-room-field">{label}
			<span className="crux-room-num">
				<input type="number" inputMode="numeric" min={LIMITS[k][0]} max={LIMITS[k][1]} step={step} value={plan[k]} onChange={(e) => setPlan({ ...plan, [k]: Number(e.target.value) })} />
				<span>{unit}</span>
			</span>
		</label>
	);
	const preset = (Object.entries(PRESETS) as [string, RoomPlan][]).find(([, p]) => p.focus === plan.focus && p.short === plan.short)?.[0];
	return (
		<>
			<div className="crux-segmented" role="group" aria-label="Preset">
				{(Object.entries(PRESETS) as [string, RoomPlan][]).map(([id, p]) => (
					<button key={id} type="button" aria-pressed={preset === id} onClick={() => setPlan({ ...p, rounds: plan.rounds, wait: plan.wait })}>{p.focus}/{p.short}</button>
				))}
			</div>
			<div className="crux-room-fields">
				{num("focus", "Focus", "min", 5)}
				{num("short", "Break", "min")}
				{num("long", "Long break", "min")}
				{num("longEvery", "Long break after", plan.longEvery ? "blocks" : "never")}
				{num("rounds", "Rounds", plan.rounds ? "blocks" : "until stopped")}
			</div>
			<label className="crux-room-check"><input type="checkbox" checked={plan.wait} onChange={(e) => setPlan({ ...plan, wait: e.target.checked })} /> Wait for the host between focus and breaks</label>
		</>
	);
}

/** The Rooms dialog from the rail: join with a code, host a room, or a public room. */
export function RoomsDialog({ unit, onClose }: { unit?: string | null; onClose: () => void }) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [code, setCode] = useState("");
	const [hosting, setHosting] = useState(false);
	const [name, setName] = useState("");
	const [plan, setPlan] = useState<RoomPlan>(PRESETS.classic);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [list, setList] = useState<RoomsList | null>(null);
	const s = useRooms();
	useEffect(() => { const d = dialogRef.current; if (d && !d.open) d.showModal(); }, []);
	useEffect(() => { roomsList().then(setList, () => setList(null)); }, []);
	const done = () => { setRoomPanel(true); dialogRef.current?.close(); };
	const run = (f: () => Promise<void>) => async (e?: React.FormEvent) => {
		e?.preventDefault();
		setBusy(true); setError(null); clearRoomNotice();
		try { await f(); done(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
	};
	const count = (id: PublicRoomId) => list?.public.find((p) => p.id === id)?.count;
	return (
		<dialog ref={dialogRef} onClose={onClose}
			onMouseDown={(e) => { const b = dialogRef.current?.getBoundingClientRect(); if (b && (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom)) dialogRef.current?.close(); }}
			aria-labelledby="rooms-title" data-testid="rooms-dialog"
			className="lh-no-drag m-auto max-h-[86vh] w-[min(560px,92vw)] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60">
			<div className="flex max-h-[86vh] flex-col">
				<header className="flex items-start gap-3 border-b border-border/60 px-6 pb-4 pt-5">
					<div className="min-w-0 flex-1">
						<h2 id="rooms-title" className="font-title text-2xl tracking-tight">Study rooms</h2>
						<p className="mt-1 text-xs text-muted-foreground">Study with others on one clock. The same rooms as Crux on the web.</p>
					</div>
					<Button type="button" size="icon-sm" variant="ghost" className="cursor-pointer" aria-label="Close" onClick={() => dialogRef.current?.close()}><XIcon className="size-4" /></Button>
				</header>
				<div className="crux-rooms min-h-0 flex-1 overflow-y-auto px-6 py-5">
					{s.notice && <p className="crux-room-notice" role="status">{s.notice}</p>}
					{(s.code || s.pub) && <p className="crux-room-notice" role="status">You are in {s.code ? `room ${s.code}` : PUBLIC_ROOMS[s.pub!].name}. Joining another room leaves it.</p>}
					<form className="crux-room-card" onSubmit={run(() => joinRoomCode(code))} aria-label="Join with a code">
						<label className="crux-room-field">Join with a code
							<span className="crux-room-join">
								<input className="crux-room-code" value={code} onChange={(e) => setCode(tidy(e.target.value))} placeholder="KXQT" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={6} aria-describedby="room-names" data-testid="room-code" />
								<Button type="submit" className="cursor-pointer" disabled={!validCode(code) || busy}>Join</Button>
							</span>
						</label>
						<p className="crux-room-sub" id="room-names">People in a room see your name.</p>
					</form>
					<section className="crux-room-card" aria-label="Host a room">
						{!hosting ? (
							<div className="crux-room-row">
								<span className="crux-room-main"><b>Host a room</b><span className="crux-room-sub">You run the clock. Others join with a code.</span></span>
								<Button type="button" variant="outline" className="cursor-pointer" onClick={() => setHosting(true)} data-testid="room-host">Host</Button>
							</div>
						) : (
							<form className="crux-room-form" onSubmit={run(() => hostRoom({ name, unit: unit ?? null, plan }))}>
								<label className="crux-room-field">Name <span className="crux-room-sub">(optional)</span>
									<input className="crux-room-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={unit ?? "Revision"} />
								</label>
								<PlanFields plan={plan} setPlan={setPlan} />
								<div className="flex gap-2"><Button type="submit" className="cursor-pointer" disabled={busy}>Start the room</Button><Button type="button" variant="ghost" className="cursor-pointer" onClick={() => setHosting(false)}>Cancel</Button></div>
							</form>
						)}
					</section>
					{error && <p className="crux-room-error" role="alert">{error}</p>}
					<section className="crux-room-card" aria-label="Public rooms">
						<h3 className="crux-room-h">Public rooms</h3>
						{(Object.entries(PUBLIC_ROOMS) as [PublicRoomId, (typeof PUBLIC_ROOMS)[PublicRoomId]][]).map(([id, r]) => (
							<div key={id} className="crux-room-row">
								<span className="crux-room-main"><b>{r.name}</b><span className="crux-room-sub">{r.focus} min focus, {r.block - r.focus} min break, on the clock{count(id) != null ? ` · ${count(id)} here` : ""}</span></span>
								<Button type="button" variant="outline" className="cursor-pointer" onClick={() => void run(() => joinPublic(id))()}>Join</Button>
							</div>
						))}
						<p className="crux-room-sub">Public rooms show how many are in them, never who.</p>
					</section>
				</div>
			</div>
		</dialog>
	);
}

// a Hub file's name for a button: no extension or underscores, at most 50 characters
const shortFile = (n: string | null) => { const t = String(n || "paper").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim(); return t.length > 50 ? `${t.slice(0, 47)}…` : t; };

/** The board (the same as Crux web): the host's question and working, one step at a time; everyone follows. */
function Board({ board, me, run }: { board: RoomBoard; me: boolean; run: (f: () => Promise<void>) => () => Promise<void> }) {
	const [hidden, setHidden] = useState(false);
	const [busy, setBusy] = useState(false);
	const go = (step: number) => { if (busy) return; setBusy(true); void run(async () => { await roomAct("board", { board: { ...board, step } }); })().finally(() => setBusy(false)); };
	if (hidden && !me) return <div className="crux-room-row crux-room-settings"><span className="crux-room-main"><b>The host is presenting</b></span><Button size="sm" variant="outline" className="cursor-pointer" onClick={() => setHidden(false)}>Back to the board</Button></div>;
	return (
		<section className="crux-room-settings crux-board" aria-label="The board" aria-live="polite">
			<div className="crux-room-row"><h3 className="crux-room-h flex-1">{board.title || "The board"}</h3>{!me && <Button size="xs" variant="ghost" className="cursor-pointer" onClick={() => setHidden(true)}>Stop following</Button>}</div>
			{board.text && <div className="crux-board-text"><MessageResponse>{board.text}</MessageResponse></div>}
			{board.step > 0 && <ol className="crux-board-steps">{board.steps.slice(0, board.step).map((x, i) => <li key={i}><MessageResponse>{x}</MessageResponse></li>)}</ol>}
			{(board.stepCount ?? board.steps.length) > 0 && <p className="crux-room-sub">Step {board.step} of {board.stepCount ?? board.steps.length}</p>}
			{board.code && <pre className="crux-board-code"><code>{board.code}</code></pre>}
			{board.output && <pre className="crux-board-code"><code>{board.output}</code></pre>}
			{me && <div className="crux-room-actions"><Button size="sm" variant="outline" className="cursor-pointer" disabled={busy || board.step <= 0} onClick={() => go(board.step - 1)}>Back</Button><Button size="sm" className="cursor-pointer" disabled={busy || board.step >= board.steps.length} onClick={() => go(board.step + 1)}>Next step</Button></div>}
		</section>
	);
}

function BoardEditor({ board, onDone, run }: { board: RoomBoard | null | undefined; onDone: () => void; run: (f: () => Promise<void>) => () => Promise<void> }) {
	const [title, setTitle] = useState(board?.title || "");
	const [text, setText] = useState(board?.text || "");
	const [steps, setSteps] = useState((board?.steps || []).join("\n"));
	const [code, setCode] = useState(board?.code || "");
	const [output, setOutput] = useState(board?.output || "");
	const lines = steps.split("\n").filter((x) => x.trim());
	return (
		<form className="crux-room-form crux-room-settings" aria-label="Present" onSubmit={(e) => { e.preventDefault(); void run(async () => { await roomAct("board", { board: { title, text, steps: lines, step: board ? Math.min(board.step, lines.length) : 0, code, output } }); onDone(); })(); }}>
			<label className="crux-room-field">Title<input className="crux-room-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="CAT 1 2024, question 3" /></label>
			<label className="crux-room-field">Question<textarea className="crux-room-input" rows={3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} /></label>
			<label className="crux-room-field">Working <span className="crux-room-sub">(one step per line)</span><textarea className="crux-room-input" rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} /></label>
			<label className="crux-room-field">Code <span className="crux-room-sub">(optional)</span><textarea className="crux-room-input font-mono" rows={3} value={code} maxLength={6000} onChange={(e) => setCode(e.target.value)} /></label>
			<label className="crux-room-field">Its output <span className="crux-room-sub">(optional)</span><textarea className="crux-room-input font-mono" rows={2} value={output} maxLength={4000} onChange={(e) => setOutput(e.target.value)} /></label>
			<div className="crux-room-actions"><Button type="submit" size="sm" className="cursor-pointer">{board ? "Update the board" : "Show to the room"}</Button><Button type="button" size="sm" variant="ghost" className="cursor-pointer" onClick={onDone}>Cancel</Button></div>
		</form>
	);
}

/** Today's work (the same as Crux web): what the host has the room do, with a Hub paper to open at a page. */
function TodaysWork({ data, me, run }: { data: RoomState; me: boolean; run: (f: () => Promise<void>) => () => Promise<void> }) {
	const [editing, setEditing] = useState(false);
	const [text, setText] = useState("");
	const [fileId, setFileId] = useState("");
	const [page, setPage] = useState("");
	const [files, setFiles] = useState<{ id: string; name: string }[] | null>(null);
	const room = data.room, w = room.work;
	if (!w && !me) return null;
	const bridge = typeof window === "undefined" ? undefined : window.lh?.crux;
	const edit = () => {
		setText(w?.text || ""); setFileId(w?.fileId || ""); setPage(w?.page ? String(w.page) : ""); setEditing(true);
		if (room.unit && !files && bridge) void bridge.files(room.unit).then((r) => setFiles(r.ok ? r.value.files.filter((f) => /^\d+$/.test(f.id)).map((f) => ({ id: f.id, name: f.name })) : []), () => setFiles([]));
	};
	const save = (work: { text: string; fileId: string | null; fileName: string | null; page: number | null } | null) => void run(async () => { await roomAct("work", { work }); setEditing(false); })();
	const open = async () => {
		if (!bridge || !w?.fileId || !room.unit) return;
		const r = await bridge.openAt(room.unit, w.fileId, w.fileName || "Paper", w.page).catch(() => null);
		if (r?.ok) window.dispatchEvent(new CustomEvent("crux:open-file", { detail: { path: r.value.path, name: w.fileName, page: w.page } }));
	};
	if (editing) {
		const file = files?.find((f) => f.id === fileId);
		return (
			<form className="crux-room-form crux-room-settings" aria-label="Today's work" onSubmit={(e) => { e.preventDefault(); save({ text, fileId: fileId || null, fileName: file?.name || w?.fileName || null, page: page ? Number(page) : null }); }}>
				<label className="crux-room-field">Today's work<input className="crux-room-input" value={text} maxLength={140} onChange={(e) => setText(e.target.value)} placeholder="CAT 1 2024, questions 3 and 4" /></label>
				{room.unit && (
					<div className="crux-room-fields">
						<label className="crux-room-field">Paper
							<select className="crux-room-input" value={fileId} onChange={(e) => setFileId(e.target.value)} disabled={files === null}>
								<option value="">{files === null ? "Loading…" : "None"}</option>
								{w?.fileId && !(files || []).some((f) => f.id === w.fileId) && <option value={w.fileId}>{w.fileName}</option>}
								{(files || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
							</select>
						</label>
						<label className="crux-room-field">Page<input className="crux-room-input" type="number" inputMode="numeric" min={1} value={page} onChange={(e) => setPage(e.target.value)} disabled={!fileId} /></label>
					</div>
				)}
				<div className="crux-room-actions">
					<Button type="submit" size="sm" className="cursor-pointer" disabled={!text.trim() && !fileId}>Save</Button>
					{w && <Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={() => save(null)}>Clear</Button>}
					<Button type="button" size="sm" variant="ghost" className="cursor-pointer" onClick={() => setEditing(false)}>Cancel</Button>
				</div>
			</form>
		);
	}
	return (
		<section className="crux-room-row crux-room-settings" aria-label="Today's work">
			<span className="crux-room-main">
				<b>Today's work</b>
				<span className="crux-room-sub">{w ? w.text || w.fileName : "Set what the room works on. Everyone opens it in their own Crux."}</span>
				{w?.fileId && <button type="button" className="crux-room-link" onClick={() => void open()}>Open {shortFile(w.fileName)}{w.page ? ` · p. ${w.page}` : ""}</button>}
			</span>
			{me && <Button size="sm" variant="outline" className="cursor-pointer" onClick={edit}>{w ? "Change" : "Set"}</Button>}
		</section>
	);
}

/** At a break: how did that block go? Counts reach the host once 3 have answered, never who. */
function CheckIn({ v, data, me, run }: { v: RoomView; data: RoomState; me: boolean; run: (f: () => Promise<void>) => () => Promise<void> }) {
	const c = data.checkin;
	const atBreak = v.mode !== "focus" || v.state === "waiting" || v.state === "done";
	if (!c || !atBreak || v.state === "idle") return null;
	const n = c.counts;
	return (
		<section className="crux-room-settings" aria-label="Check in">
			<h3 className="crux-room-h">How did that block go?</h3>
			<div className="crux-segmented mt-2" role="group" aria-label="How did that block go">
				{(["done", "partly", "stuck"] as const).map((id) => <button key={id} type="button" aria-pressed={c.mine === id} onClick={run(() => roomCheckin(id))}>{id === "done" ? "Done" : id === "partly" ? "Partly" : "Stuck"}</button>)}
			</div>
			{me && <p className="crux-room-sub mt-2">{n ? `Round ${c.round}: ${n.done} done, ${n.partly} partly, ${n.stuck} stuck. Only counts are shown, never who.` : "The counts show once 3 people have answered."}</p>}
		</section>
	);
}

function statusLine(v: RoomView, hostName: string): React.ReactNode {
	if (v.state === "idle") return `Waiting for ${hostName} to start`;
	if (v.state === "paused") return `${MODES[v.mode]}, paused`;
	if (v.state === "waiting") return `Waiting for ${hostName} to start the ${v.mode === "focus" ? "next block" : "break"}`;
	if (v.state === "done") return "Session done";
	return <>{MODES[v.mode]} · round {v.round}{v.rounds ? ` of ${v.rounds}` : ""}</>;
}

/** The room panel in the app shell: the full room, or a small bar while you study. */
export function RoomPanel() {
	const s = useRoomTick();
	const [settings, setSettings] = useState(false);
	const [plan, setPlan] = useState<RoomPlan | null>(null);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [ending, setEnding] = useState(false);
	const [presenting, setPresenting] = useState(false);
	const v = roomViewNow(s);
	if (!s.code && !s.pub) {
		if (!s.notice || !s.open) return null;
		return (
			<aside className="crux-room-panel crux-glass" role="status" data-testid="room-panel">
				<p className="text-sm">{s.notice}</p>
				<div className="mt-3 flex justify-end"><Button size="sm" variant="outline" className="cursor-pointer" onClick={() => { clearRoomNotice(); setRoomPanel(false); }}>OK</Button></div>
			</aside>
		);
	}
	const pub = s.pub ? PUBLIC_ROOMS[s.pub] : null;
	const room = s.data?.room;
	const people = s.data?.people ?? [];
	const title = pub ? pub.name : room?.name ?? `Room ${s.code}`;
	if (!s.open) {
		return (
			<button type="button" className="crux-room-mini crux-glass lh-no-drag" onClick={() => setRoomPanel(true)} aria-label={`${title}: open the room`} data-testid="room-mini">
				<span className={cn("crux-room-dot", v?.mode)} aria-hidden />
				<b className="tabular-nums">{v ? clockText(v.left) : "--:--"}</b>
				<span className="crux-room-sub">{s.code ? `${s.code} · ` : ""}{v ? (v.state === "running" ? MODES[v.mode] : v.state === "paused" ? "Paused" : v.state === "done" ? "Done" : "Waiting") : "Opening…"}</span>
			</button>
		);
	}
	const run = (f: () => Promise<void>) => async () => { setError(null); try { await f(); } catch (err) { setError((err as Error).message); } };
	const me = Boolean(room?.host);
	const hostName = people.find((p) => p.host)?.name ?? "the host";
	const invite = async () => {
		if (!s.code) return;
		const text = `Join my Crux study room: code ${s.code}, or ${WEB}/#/room/${s.code}`;
		try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setError(text); }
	};
	return (
		<aside className="crux-room-panel crux-glass crux-rooms lh-no-drag" aria-label={`Study room: ${title}`} data-testid="room-panel">
			<header className="crux-room-head">
				<span className="min-w-0 flex-1">
					<b className="block truncate">{title}</b>
					<span className="crux-room-sub">{s.code ? <>Room <b className="crux-room-codetext">{s.code}</b>{room?.unit ? ` · ${room.unit}` : ""}{room?.locked ? " · locked" : ""}</> : pub ? `Everyone on the hub, one clock${s.pubCount ? ` · ${s.pubCount} others` : ""}` : null}</span>
				</span>
				<Button type="button" size="icon-sm" variant="ghost" className="cursor-pointer" aria-label="Fold the room" onClick={() => setRoomPanel(false)}><ChevronDownIcon className="size-4" /></Button>
			</header>
			{!v ? (
				<div className="flex items-center justify-between gap-2 py-6"><span className="crux-room-sub">Opening room {s.code}…</span><Button size="sm" variant="ghost" className="cursor-pointer" onClick={() => void leaveRoom()}>Leave</Button></div>
			) : (
				<>
					<RoomRing v={v} small sub={pub ? `${MODES[v.mode]} · the room's clock` : statusLine(v, me ? "you" : hostName)} />
					<p className="sr-only" aria-live="polite">{`${MODES[v.mode]}, ${v.state}`}</p>
					{me && (
						<div className="crux-room-actions">
							{(v.state === "idle" || v.state === "waiting" || v.state === "done") && <Button className="cursor-pointer" onClick={run(() => roomAct("start"))}>{v.state === "waiting" ? (v.mode === "focus" ? "Start the block" : "Start the break") : v.state === "done" ? "Start again" : "Start"}</Button>}
							{v.state === "running" && <Button className="cursor-pointer" onClick={run(() => roomAct("pause"))}>Pause</Button>}
							{v.state === "paused" && <Button className="cursor-pointer" onClick={run(() => roomAct("resume"))}>Resume</Button>}
							{(v.state === "running" || v.state === "paused") && <Button variant="outline" className="cursor-pointer" onClick={run(() => roomAct("skip"))}>{v.mode === "focus" ? "Skip to break" : "Skip to focus"}</Button>}
						</div>
					)}
					<div className="crux-room-actions">
						{s.code && <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => void invite()}><CopyIcon className="size-3.5" />{copied ? "Copied" : "Copy invite"}</Button>}
						{me && room && <Button variant="outline" size="sm" className="cursor-pointer" aria-expanded={settings} onClick={() => { if (settings) setSettings(false); else { setPlan(room.clock.plan); setName(room.name); setSettings(true); } }}><SettingsIcon className="size-3.5" />Room settings</Button>}
						<Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => void leaveRoom()}>Leave</Button>
					</div>
					{error && <p className="crux-room-error" role="alert">{error}</p>}
					{me && presenting && <BoardEditor board={room?.board} run={run} onDone={() => setPresenting(false)} />}
					{!presenting && room?.board && <Board board={room.board} me={me} run={run} />}
					{me && !presenting && room && (
						<div className="crux-room-actions">
							<Button size="sm" variant="outline" className="cursor-pointer" onClick={() => setPresenting(true)}>{room.board ? "Edit the board" : "Present"}</Button>
							{room.board && <Button size="sm" variant="ghost" className="cursor-pointer" onClick={run(() => roomAct("board", { board: { on: false } }))}>Stop presenting</Button>}
						</div>
					)}
					{s.data && <TodaysWork data={s.data} me={me} run={run} />}
					{s.data && <CheckIn v={v} data={s.data} me={me} run={run} />}
					{me && settings && plan && room && (
						<form className="crux-room-form crux-room-settings" aria-label="Room settings" onSubmit={(e) => { e.preventDefault(); void run(async () => { await roomAct("settings", { plan, name }); setSettings(false); })(); }}>
							<label className="crux-room-field">Name<input className="crux-room-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
							<PlanFields plan={plan} setPlan={setPlan} />
							<p className="crux-room-sub">Changes apply from the next block. Skip moves to it now.</p>
							<div className="crux-room-actions">
								<Button type="submit" size="sm" className="cursor-pointer">Save</Button>
								<Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={run(() => roomAct(room.locked ? "unlock" : "lock"))}>{room.locked ? "Unlock the room" : "Lock the room"}</Button>
								{!ending ? <Button type="button" size="sm" variant="ghost" className="cursor-pointer" onClick={() => setEnding(true)}>End the room</Button>
									: <Button type="button" size="sm" variant="destructive" className="cursor-pointer" onClick={run(() => roomAct("end"))}>End it for everyone</Button>}
							</div>
						</form>
					)}
					{s.code && (
						<section aria-label="People in the room">
							<h3 className="crux-room-h">In the room <span className="crux-room-sub tabular-nums">{people.length}</span></h3>
							<ul className="crux-room-people">
								{people.map((p) => (
									<li key={p.key} className={p.here ? "" : "is-away"}>
										<span className="crux-room-person"><UserIcon className="size-3.5" /></span>
										<span className="crux-room-main"><b>{p.name}{p.me ? " (you)" : ""}</b><span className="crux-room-sub">{p.host ? "Host" : p.here ? "Here" : "Away"}</span></span>
										{me && !p.me && (
											<span className="flex gap-1">
												<Button size="xs" variant="ghost" className="cursor-pointer" onClick={run(() => roomAct("host", { person: p.key }))}>Make host</Button>
												<Button size="xs" variant="ghost" className="cursor-pointer" onClick={run(() => roomAct("remove", { person: p.key }))}>Remove</Button>
											</span>
										)}
									</li>
								))}
							</ul>
						</section>
					)}
				</>
			)}
		</aside>
	);
}

export { UsersIcon as RoomsIcon };
