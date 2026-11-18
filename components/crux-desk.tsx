"use client";
/**
 * The Hub files desk (owner 2026-11-18), staff only: drop files into the drive dumper with the unit and kind set, see
 * what the dumper did with them, sort what it couldn't place, and follow students' uploads. The laptop side is
 * electron/hub-desk.cjs (the Drop folder); the Hub side is Crux web's /api/hub/* (staff checked there too).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcwIcon, UploadIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrailleSpinner } from "@/components/braille-spinner";

type Reply<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };
export interface DeskBridge {
	status: () => Promise<Reply<DeskStatus>>;
	pickFiles: () => Promise<Reply<{ path: string; name: string; size: number }[]>>;
	pickFolder: () => Promise<Reply<DeskStatus>>;
	hash: (path: string) => Promise<Reply<string>>;
	drop: (files: DropRequest[]) => Promise<Reply<{ path: string; name?: string; hash?: string; error?: string }[]>>;
	retry: (name: string) => Promise<Reply<{ name: string }>>;
}
interface DeskStatus { home: string | null; drop: string[]; done: { name: string; at: number }[]; problems: { name: string; why: string }[] }
interface DropRequest { path: string; unit: string; kind: string; year: string; title: string }
interface HubDesk {
	queue: { fileMsgId: string; noteMsgId: string; name: string; size: number; url: string; reason: string; suggestion: string; at: string }[];
	queueError: string | null;
	recent: { name: string; unit: string | null; where: string | null; at: string; link: string | null }[];
	students: { id: number; by: string; unit: string; name: string; status: string; note: string | null; at: string }[];
	units: { code: string; label: string }[];
	shelves: { id: string; name: string }[];
}
type WebCall = (method: string, path: string, body?: unknown) => Promise<Reply<unknown>>;

export const KINDS = [
	["paper", "Past paper"], ["scheme", "Marking scheme"], ["notes", "Notes"], ["tutorial", "Tutorial"], ["slides", "Slides"], ["book", "Book"],
] as const;
const STUDENT_STATUS: Record<string, string> = { uploading: "Uploading", new: "Waiting for the hub PC", received: "On the hub PC", posted: "Posted", merged: "Posted with others", duplicate: "Already on the Hub", failed: "Failed" };

function bridges() {
	if (typeof window === "undefined") return { desk: undefined, web: undefined };
	const lh = window.lh as { desk?: DeskBridge; crux?: { web?: WebCall } } | undefined;
	return { desk: lh?.desk, web: lh?.crux?.web };
}

/** Whether this account may use the desk: Crux web answers the desk only for staff. */
export function useDeskAccess() {
	const [ok, setOk] = useState(false);
	useEffect(() => {
		const { desk, web } = bridges();
		if (!desk || !web) return;
		let live = true;
		void web("GET", "/api/hub/desk").then((r) => { if (live) setOk(r.ok); }).catch(() => {});
		return () => { live = false; };
	}, []);
	return ok;
}

type Row = { path: string; name: string; size: number; unit: string; kind: string; year: string; title: string; dup?: string; result?: string; error?: string };
const titleOf = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
const guessUnit = (name: string) => (/([A-Z]{3})\s?(\d{3})/i.exec(name) ? `${RegExp.$1.toUpperCase()} ${RegExp.$2}` : "");
const guessKind = (name: string) => (/scheme/i.test(name) ? "scheme" : /tut/i.test(name) ? "tutorial" : /slide|\.pptx?$/i.test(name) ? "slides" : /note|lecture/i.test(name) ? "notes" : /book|edition/i.test(name) ? "book" : "paper");
const guessYear = (name: string) => /\b(19|20)\d\d\b/.exec(name)?.[0] ?? "";

export function DeskDialog({ onClose }: { onClose: () => void }) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const { desk, web } = bridges();
	const [tab, setTab] = useState<"drop" | "queue" | "sort" | "students">("drop");
	const [st, setSt] = useState<DeskStatus | null>(null);
	const [hub, setHub] = useState<HubDesk | null>(null);
	const [rows, setRows] = useState<Row[]>([]);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState("");
	useEffect(() => { const d = dialogRef.current; if (d && !d.open) d.showModal(); }, []);

	const refresh = useCallback(async () => {
		if (!desk || !web) return;
		const [s, h] = await Promise.all([desk.status(), web("GET", "/api/hub/desk")]);
		if (s.ok) setSt(s.value);
		if (h.ok) setHub(h.value as HubDesk); else setProblem(h.error);
	}, [desk, web]);
	useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 15000); return () => clearInterval(t); }, [refresh]);

	const pick = async () => {
		if (!desk || !web) return;
		const r = await desk.pickFiles();
		if (!r.ok || !r.value.length) return;
		const add: Row[] = r.value.map((f) => ({ ...f, unit: guessUnit(f.name), kind: guessKind(f.name), year: guessYear(f.name), title: titleOf(f.name) }));
		setRows((old) => [...old, ...add]);
		for (const f of add) {
			const h = await desk.hash(f.path);
			if (!h.ok) continue;
			const has = await web("GET", `/api/hub/has?hash=${h.value}`);
			const v = has.ok ? (has.value as { exists: boolean; where?: string }) : null;
			if (v?.exists) setRows((old) => old.map((x) => (x.path === f.path ? { ...x, dup: v.where || "the Hub" } : x)));
		}
	};
	const edit = (i: number, patch: Partial<Row>) => setRows((old) => old.map((x, j) => (j === i ? { ...x, ...patch, error: undefined } : x)));
	const send = async () => {
		if (!desk) return;
		const todo = rows.filter((r) => !r.result && !r.dup);
		if (!todo.length) return;
		setBusy(true); setProblem("");
		const r = await desk.drop(todo.map(({ path, unit, kind, year, title }) => ({ path, unit, kind, year, title })));
		setBusy(false);
		if (!r.ok) { setProblem(r.error); return; }
		setRows((old) => old.map((x) => { const o = r.value.find((v) => v.path === x.path); return o ? { ...x, result: o.name, error: o.error } : x; }));
		void refresh();
	};
	const retry = async (name: string) => { if (!desk) return; const r = await desk.retry(name); if (!r.ok) setProblem(r.error); void refresh(); };
	const sortFile = async (item: HubDesk["queue"][number], target: string) => {
		if (!web || !target) return;
		const [kind, id] = target.split(":");
		const t = kind === "unit" ? { kind, code: id } : kind === "shelf" ? { kind, id } : { kind: "library" };
		setBusy(true);
		const r = await web("POST", "/api/hub/sort", { fileMsgId: item.fileMsgId, noteMsgId: item.noteMsgId, targets: [t] });
		setBusy(false);
		if (!r.ok) setProblem(r.error);
		void refresh();
	};

	const units = hub?.units ?? [];
	const ready = rows.filter((r) => !r.result && !r.dup);
	return (
		<dialog ref={dialogRef} onClose={onClose} aria-labelledby="desk-title" data-testid="desk-dialog"
			className="lh-no-drag m-auto max-h-[88vh] w-[min(820px,94vw)] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60">
			<div className="flex max-h-[88vh] flex-col">
				<header className="flex items-start gap-3 border-b border-border/60 px-6 pb-3 pt-5">
					<div className="min-w-0 flex-1">
						<h2 id="desk-title" className="font-title text-2xl tracking-tight">Hub files desk</h2>
						<p className="mt-1 text-xs text-muted-foreground">Files go into the drive dumper's Drop folder with their unit set, and it posts them to Discord.</p>
						<nav className="mt-3 flex flex-wrap gap-1 text-xs" aria-label="Desk">
							{([["drop", "Drop files"], ["queue", `Dumper${st?.problems.length ? ` (${st.problems.length} failed)` : ""}`], ["sort", `To sort${hub?.queue.length ? ` (${hub.queue.length})` : ""}`], ["students", "From students"]] as const).map(([id, label]) => (
								<button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} data-testid={`desk-tab-${id}`}
									className="cursor-pointer rounded-md border border-border px-2.5 py-1 aria-pressed:border-primary aria-pressed:bg-primary/10">{label}</button>
							))}
						</nav>
					</div>
					<Button type="button" size="icon-sm" variant="ghost" className="cursor-pointer" aria-label="Close" onClick={() => dialogRef.current?.close()}><XIcon className="size-4" /></Button>
				</header>
				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4 text-sm">
					{!desk ? <p className="text-muted-foreground">The desk works in Crux Harness 0.7.0 or later, on the hub PC.</p> : (
						<>
							{st && !st.home && (
								<p className="rounded-md border border-border p-3 text-xs" data-testid="desk-no-drop">
									Google Drive's Hub Dumper folder isn't on this computer. Open Google Drive for desktop, or{" "}
									<button type="button" className="cursor-pointer underline" onClick={() => void desk.pickFolder().then((r) => (r.ok ? setSt(r.value) : setProblem(r.error)))}>pick the folder</button>.
								</p>
							)}
							{tab === "drop" && (
								<>
									<Button type="button" size="xs" variant="outline" className="cursor-pointer" onClick={() => void pick()} data-testid="desk-pick"><UploadIcon />Choose files</Button>
									{rows.length > 0 && (
										<ul className="space-y-2">
											{rows.map((r, i) => (
												<li key={r.path} className="rounded-md border border-border/70 p-2 text-xs" data-testid="desk-row">
													<div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium" title={r.path}>{r.name}</span>
														{!r.result && <button type="button" className="cursor-pointer text-muted-foreground" aria-label={`Remove ${r.name}`} onClick={() => setRows((o) => o.filter((_, j) => j !== i))}><XIcon className="size-3.5" /></button>}</div>
													{r.result ? <p className="mt-1 text-muted-foreground">{r.error ? <span className="text-destructive">{r.error}</span> : <>In Drop as <b>{r.result}</b>. The dumper posts it within a minute.</>}</p>
														: r.dup ? <p className="mt-1 text-muted-foreground">Already on the Hub, in {r.dup}. It won't be dropped.</p> : (
															<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
																<label className="flex flex-col gap-0.5">Unit
																	<input list="desk-units" value={r.unit} onChange={(e) => edit(i, { unit: e.target.value.toUpperCase() })} placeholder="EMM 302" className="rounded border border-border bg-background px-1.5 py-1" /></label>
																<label className="flex flex-col gap-0.5">Kind
																	<select value={r.kind} onChange={(e) => edit(i, { kind: e.target.value })} className="rounded border border-border bg-background px-1.5 py-1">
																		{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
																<label className="flex flex-col gap-0.5">Year
																	<input value={r.year} onChange={(e) => edit(i, { year: e.target.value })} placeholder="2024" inputMode="numeric" className="rounded border border-border bg-background px-1.5 py-1" /></label>
																<label className="flex flex-col gap-0.5">Title
																	<input value={r.title} onChange={(e) => edit(i, { title: e.target.value })} className="rounded border border-border bg-background px-1.5 py-1" /></label>
															</div>
														)}
												</li>
											))}
										</ul>
									)}
									<datalist id="desk-units">{units.map((u) => <option key={u.label} value={u.code}>{u.label}</option>)}</datalist>
									{ready.length > 0 && (
										<Button type="button" size="xs" className="cursor-pointer" disabled={busy || !st?.home || ready.some((r) => !/^[A-Z]{3} ?\d{3}$/.test(r.unit))} onClick={() => void send()} data-testid="desk-send">
											{busy && <BrailleSpinner label="Dropping" />}Drop {ready.length} file{ready.length === 1 ? "" : "s"}
										</Button>
									)}
								</>
							)}
							{tab === "queue" && st && (
								<>
									<h3 className="text-xs font-medium">Waiting in Drop ({st.drop.length})</h3>
									{st.drop.length ? <ul className="text-xs text-muted-foreground">{st.drop.map((n) => <li key={n} className="truncate">{n}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nothing waiting.</p>}
									<h3 className="text-xs font-medium">Failed</h3>
									{st.problems.length ? (
										<ul className="space-y-1 text-xs">{st.problems.map((p) => (
											<li key={p.name} className="flex items-center gap-2"><span className="min-w-0 flex-1"><b className="block truncate">{p.name}</b><span className="text-muted-foreground">{p.why}</span></span>
												<Button type="button" size="xs" variant="outline" className="cursor-pointer" onClick={() => void retry(p.name)}><RotateCcwIcon />Retry</Button></li>
										))}</ul>
									) : <p className="text-xs text-muted-foreground">No failures.</p>}
									<h3 className="text-xs font-medium">Posted lately</h3>
									<ul className="text-xs text-muted-foreground">{(hub?.recent ?? []).slice(0, 20).map((f) => (
										<li key={f.name + f.at} className="flex gap-2"><span className="min-w-0 flex-1 truncate">{f.link ? <a href={f.link} target="_blank" rel="noreferrer" className="underline">{f.name}</a> : f.name}</span><span className="truncate">{f.where}</span></li>
									))}</ul>
								</>
							)}
							{tab === "sort" && hub && (
								hub.queueError ? <p className="text-xs text-destructive">{hub.queueError}</p> : !hub.queue.length ? <p className="text-xs text-muted-foreground">#to-sort is empty.</p> : (
									<ul className="space-y-2">{hub.queue.map((q) => (
										<li key={q.noteMsgId} className="rounded-md border border-border/70 p-2 text-xs" data-testid="desk-sort-row">
											<a href={q.url} target="_blank" rel="noreferrer" className="font-medium underline">{q.name}</a>
											{q.reason && <p className="text-muted-foreground">{q.reason}</p>}
											<select defaultValue="" disabled={busy} aria-label={`Sort ${q.name}`} onChange={(e) => void sortFile(q, e.target.value)} className="mt-1 w-full rounded border border-border bg-background px-1.5 py-1">
												<option value="" disabled>{q.suggestion ? `Suggested: ${q.suggestion}. Sort into…` : "Sort into…"}</option>
												{q.suggestion && <option value={`unit:${q.suggestion}`}>{q.suggestion}</option>}
												<optgroup label="Units">{units.map((u) => <option key={u.label} value={`unit:${u.code}`}>{u.label}</option>)}</optgroup>
												<optgroup label="Book shelves">{hub.shelves.map((s) => <option key={s.id} value={`shelf:${s.id}`}>{s.name}</option>)}</optgroup>
												<option value="library:">#pdf-library</option>
											</select>
										</li>
									))}</ul>
								)
							)}
							{tab === "students" && hub && (
								<ul className="text-xs">{hub.students.map((s) => (
									<li key={s.id} className="flex gap-2 border-b border-border/40 py-1"><span className="min-w-0 flex-1 truncate" title={s.note ?? ""}>{s.name}</span><span className="text-muted-foreground">{s.unit}</span><span className="text-muted-foreground">{s.by}</span><span>{STUDENT_STATUS[s.status] ?? s.status}</span></li>
								))}</ul>
							)}
							{problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
						</>
					)}
				</div>
			</div>
		</dialog>
	);
}
